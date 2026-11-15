/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractZipSafely, unsafeZipEntryReason } from './safeZip.js';

const hasZip = (() => {
  try {
    execFileSync('zip', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('unsafeZipEntryReason', () => {
  const file = 0o100644 << 16;
  const link = 0o120777 << 16;

  it('accepts plain relative entries', () => {
    expect(unsafeZipEntryReason('skill/SKILL.md', file)).toBeUndefined();
    expect(unsafeZipEntryReason('a/./b/../c.txt', file)).toBeUndefined();
  });

  it('refuses symbolic links', () => {
    expect(unsafeZipEntryReason('skill/evil', link)).toBe('is a symbolic link');
  });

  it.each(['../evil.txt', 'a/../../evil.txt', '/etc/passwd', 'C:/x', '..\\x'])(
    'refuses %s',
    (name) => {
      expect(unsafeZipEntryReason(name, file)).toBe(
        'points outside the extraction directory',
      );
    },
  );
});

describe.skipIf(!hasZip)('extractZipSafely (real archives)', () => {
  let work: string;
  beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'capricorn-zip-'));
  });
  afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  function zipOf(name: string, build: (src: string) => void, flags: string[]) {
    const src = path.join(work, `src-${name}`);
    fs.mkdirSync(src);
    build(src);
    const zipPath = path.join(work, `${name}.zip`);
    execFileSync('zip', ['-q', '-r', ...flags, zipPath, '.'], { cwd: src });
    return zipPath;
  }

  it('extracts a normal archive', async () => {
    const zipPath = zipOf(
      'ok',
      (src) => fs.writeFileSync(path.join(src, 'SKILL.md'), 'hello'),
      [],
    );
    const dest = path.join(work, 'out');
    fs.mkdirSync(dest);
    await extractZipSafely(zipPath, dest);
    expect(fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf8')).toBe('hello');
  });

  it('refuses an archive with a symbolic link and writes nothing', async () => {
    const outside = path.join(work, 'outside');
    fs.mkdirSync(outside);
    // `zip -y` stores the link itself, as a malicious archive would.
    const zipPath = zipOf(
      'link',
      (src) => {
        fs.writeFileSync(path.join(src, 'a.txt'), 'a');
        fs.symlinkSync(outside, path.join(src, 'escape'));
      },
      ['-y'],
    );
    const dest = path.join(work, 'out');
    fs.mkdirSync(dest);
    await expect(extractZipSafely(zipPath, dest)).rejects.toThrow(
      /entry "escape" is a symbolic link/,
    );
    expect(fs.readdirSync(dest)).toEqual([]);
  });
});
