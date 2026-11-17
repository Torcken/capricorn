/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  allChecksCommand,
  detectModuleSystem,
  detectProjectCommands,
  formatProjectCommands,
} from './projectCommands.js';
import { folderStructureMaxItems } from './environmentContext.js';

let dir: string;
const write = (name: string, content: string) =>
  fs.writeFileSync(path.join(dir, name), content);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capricorn-cmds-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('detectProjectCommands', () => {
  it('finds nothing in an empty directory', () => {
    expect(detectProjectCommands(dir)).toEqual([]);
    expect(formatProjectCommands([dir])).toBe('');
  });

  it('reads package.json scripts with the right package manager', () => {
    write(
      'package.json',
      JSON.stringify({
        scripts: { test: 'node --test', build: 'tsc', lint: 'eslint .' },
      }),
    );
    write('pnpm-lock.yaml', '');
    expect(detectProjectCommands(dir)).toEqual([
      { purpose: 'test', command: 'pnpm test', source: 'package.json' },
      { purpose: 'build', command: 'pnpm run build', source: 'package.json' },
      { purpose: 'lint', command: 'pnpm run lint', source: 'package.json' },
    ]);
  });

  it("ignores npm's placeholder test script and broken JSON", () => {
    write(
      'package.json',
      JSON.stringify({
        scripts: { test: 'echo "Error: no test specified" && exit 1' },
      }),
    );
    expect(detectProjectCommands(dir)).toEqual([]);
    write('package.json', '{ not json');
    expect(detectProjectCommands(dir)).toEqual([]);
  });

  it('detects pytest, Go, Cargo and Makefile targets', () => {
    write('pyproject.toml', '[tool.pytest.ini_options]\naddopts = "-q"\n');
    expect(detectProjectCommands(dir)).toEqual([
      {
        purpose: 'test',
        command: 'python -m pytest',
        source: 'pyproject.toml',
      },
    ]);
    fs.rmSync(path.join(dir, 'pyproject.toml'));
    write('go.mod', 'module example.com/x\n');
    expect(detectProjectCommands(dir).map((c) => c.command)).toEqual([
      'go test ./...',
      'go build ./...',
    ]);
    fs.rmSync(path.join(dir, 'go.mod'));
    write('Makefile', 'lint:\n\techo lint\ntest: build\n\techo test\n');
    expect(detectProjectCommands(dir).map((c) => c.command)).toEqual([
      'make test',
      'make lint',
    ]);
  });

  it('keeps one command per purpose, preferring the ecosystem manifest', () => {
    write('package.json', JSON.stringify({ scripts: { test: 'vitest' } }));
    write('Makefile', 'test:\n\tnpm test\n');
    const commands = detectProjectCommands(dir);
    expect(commands.filter((c) => c.purpose === 'test')).toEqual([
      { purpose: 'test', command: 'npm test', source: 'package.json' },
    ]);
  });

  it('formats a hint to verify, naming directories only in multi-root', () => {
    write('package.json', JSON.stringify({ scripts: { test: 'vitest' } }));
    expect(formatProjectCommands([dir])).toBe(
      '- **Project commands** (detected from project files; check them before relying on them):\n  - test: `npm test` (package.json)',
    );
    expect(formatProjectCommands([dir, os.tmpdir()])).toContain(
      `Project commands in ${dir}`,
    );
  });
});

describe('allChecksCommand', () => {
  it('joins lint, typecheck and test, fastest first, without build', () => {
    write(
      'package.json',
      JSON.stringify({
        scripts: { test: 'vitest', build: 'tsc', lint: 'eslint .' },
      }),
    );
    expect(allChecksCommand(detectProjectCommands(dir))).toBe(
      'npm run lint && npm test',
    );
    expect(formatProjectCommands([dir])).toContain(
      '  - all checks: `npm run lint && npm test`',
    );
  });

  it('is omitted with a single check', () => {
    write('package.json', JSON.stringify({ scripts: { test: 'vitest' } }));
    expect(allChecksCommand(detectProjectCommands(dir))).toBeUndefined();
    expect(formatProjectCommands([dir])).not.toContain('all checks');
  });
});

describe('detectModuleSystem', () => {
  it('reports only an explicit package.json "type"', () => {
    expect(detectModuleSystem(dir)).toBeUndefined();
    write('package.json', JSON.stringify({ name: 'x' }));
    expect(detectModuleSystem(dir)).toBeUndefined();
    write('package.json', JSON.stringify({ type: 'module' }));
    expect(detectModuleSystem(dir)).toBe('esm');
    write('package.json', JSON.stringify({ type: 'commonjs' }));
    expect(detectModuleSystem(dir)).toBe('commonjs');
    write('package.json', '{ broken');
    expect(detectModuleSystem(dir)).toBeUndefined();
  });

  // The eval fixture for tooluse-create-module: "type": "module", no scripts.
  it('is named in the context even when no command is detected', () => {
    write('package.json', JSON.stringify({ name: 'f', type: 'module' }));
    expect(formatProjectCommands([dir])).toBe(
      '- **Module system:** ES modules (`"type": "module"` in package.json): `.js` files use `import`/`export`, not `require`/`module.exports`.',
    );
  });

  it('follows the commands, naming the directory in multi-root', () => {
    write(
      'package.json',
      JSON.stringify({ type: 'commonjs', scripts: { test: 'vitest' } }),
    );
    const text = formatProjectCommands([dir]);
    expect(text.split('\n')).toHaveLength(3);
    expect(text).toMatch(/npm test[\s\S]*\*\*Module system:\*\* CommonJS/);
    expect(formatProjectCommands([dir, os.tmpdir()])).toContain(
      `Module system in ${dir}:`,
    );
  });
});

describe('folderStructureMaxItems', () => {
  it('shrinks the tree in small windows', () => {
    expect(folderStructureMaxItems(8_192)).toBe(60);
    expect(folderStructureMaxItems(16_384)).toBe(120);
    expect(folderStructureMaxItems(32_768)).toBe(200);
    expect(folderStructureMaxItems(undefined)).toBe(200);
  });
});
