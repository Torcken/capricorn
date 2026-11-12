/**
 * @license
 * Copyright 2026 Capricorn Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_CITED_UNREAD_FILES,
  OpenedFiles,
  citedFilesFollowUp,
  findCitedUnreadFiles,
} from './citedFiles.js';

let root: string;
const write = (rel: string) => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, 'x');
};
const allowAll = () => true;
const check = (answer: string, opened: OpenedFiles, prompt = '') =>
  findCitedUnreadFiles(answer, prompt, opened, root, allowAll);

beforeEach(() => {
  root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'capricorn-cited-')),
  );
  write('config/default.json');
  write('src/config.js');
  write('src/server.js');
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('findCitedUnreadFiles', () => {
  it('flags the eval failure: cited config file never opened', () => {
    const opened = new OpenedFiles(root);
    opened.record('read_file', { file_path: 'src/server.js' });
    opened.record('read_file', { file_path: 'src/config.js' });
    expect(
      check(
        'The server listens on port **3000** by default. This value is defined in **`config/default.json`**.',
        opened,
      ),
    ).toEqual(['config/default.json']);
  });

  it('is satisfied once the file was opened (relative or absolute path)', () => {
    const opened = new OpenedFiles(root);
    opened.record('read_file', {
      file_path: path.join(root, 'config/default.json'),
    });
    expect(check('Defined in `config/default.json`.', opened)).toEqual([]);
  });

  it('counts written and edited files as opened', () => {
    const opened = new OpenedFiles(root);
    opened.record('write_file', { file_path: 'src/config.js', content: '' });
    opened.record('replace', { file_path: 'src/server.js' });
    expect(check('Changed src/config.js and src/server.js.', opened)).toEqual(
      [],
    );
  });

  it('counts read_many_files paths, directories and (conservatively) globs', () => {
    const literal = new OpenedFiles(root);
    literal.record('read_many_files', { include: ['config/default.json'] });
    expect(check('See config/default.json', literal)).toEqual([]);

    const dir = new OpenedFiles(root);
    dir.record('read_many_files', { include: ['config/'] });
    expect(check('See config/default.json', dir)).toEqual([]);

    const glob = new OpenedFiles(root);
    glob.record('read_many_files', { include: ['**/*.json'] });
    expect(check('See config/default.json', glob)).toEqual([]);
  });

  it('ignores search and listing tools (a search hit is not opening a file)', () => {
    const opened = new OpenedFiles(root);
    opened.record('grep_search', { pattern: 'port', dir_path: 'config' });
    opened.record('list_directory', { dir_path: 'config' });
    expect(check('It is in config/default.json.', opened)).toEqual([
      'config/default.json',
    ]);
  });

  it('counts files whose lines a grep_search result showed', () => {
    const opened = new OpenedFiles(root);
    opened.record('grep_search', { pattern: 'port', dir_path: 'src' });
    // Paths relative to the workspace root, or to the searched directory.
    opened.recordSearchOutput(
      'Found 2 matches for pattern "x" in path "src":\n---\nFile: src/config.js\nL3: x\n---\nFile: server.js\nL1: x\n---',
    );
    expect(
      check('Matches in src/config.js and src/server.js.', opened),
    ).toEqual([]);
  });

  it('does not count a files-only grep listing as opened', () => {
    const opened = new OpenedFiles(root);
    opened.recordSearchOutput(
      'Found 1 files with matches for pattern "x":\nsrc/config.js',
    );
    expect(check('It is in src/config.js.', opened)).toEqual(['src/config.js']);
  });

  it('exempts files named in the user prompt', () => {
    expect(
      check(
        'config/default.json holds the defaults.',
        new OpenedFiles(root),
        'Without opening config/default.json, what is it for?',
      ),
    ).toEqual([]);
  });

  it('ignores missing files, URLs, directories and paths outside the workspace', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'capricorn-out-'));
    try {
      fs.writeFileSync(path.join(outside, 'x.json'), '{}');
      const rel = path.relative(root, outside);
      expect(
        check(
          `See missing.json, https://example.com/config/default.json, config/, ${rel}/x.json`,
          new OpenedFiles(root),
        ),
      ).toEqual([]);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('never cites files rejected by the read policy', () => {
    write('.env.json');
    expect(
      findCitedUnreadFiles(
        'Secrets are in .env.json',
        '',
        new OpenedFiles(root),
        root,
        (p) => !p.endsWith('.env.json'),
      ),
    ).toEqual([]);
  });

  it(`does not fire for listings of more than ${MAX_CITED_UNREAD_FILES} files`, () => {
    write('a.js');
    write('b.js');
    expect(
      check(
        'Files: a.js, b.js, src/config.js, src/server.js',
        new OpenedFiles(root),
      ),
    ).toEqual([]);
    expect(check('Files: a.js, b.js', new OpenedFiles(root))).toEqual([
      'a.js',
      'b.js',
    ]);
  });

  it('handles trailing punctuation and repeated mentions', () => {
    expect(
      check(
        'In src/config.js. Also (src/config.js), and "src/config.js".',
        new OpenedFiles(root),
      ),
    ).toEqual(['src/config.js']);
  });
});

describe('citedFilesFollowUp', () => {
  it('names the files and asks for a corrected final answer', () => {
    const text = citedFilesFollowUp(['config/default.json']);
    expect(text).toContain('`config/default.json`');
    expect(text).toContain('open it now with read_file');
    expect(text).toContain('give your final answer again');
  });
});
