/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Detects how a project is tested, built and linted from its
 * manifest files, for the session context.
 *
 * Why: small local models often write code and a test but never run it, or
 * guess the wrong command. Naming the project's own commands up front costs
 * a few dozen tokens and saves exploratory turns. Detection only *reads* a
 * handful of well-known files at the workspace root (size-capped) and never
 * runs anything; the result is presented as a hint to verify, because a
 * manifest can be wrong or stale.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/** What a detected command is for. */
export type ProjectCommandPurpose = 'test' | 'build' | 'lint' | 'typecheck';

/** One command, and the file it was derived from. */
export interface ProjectCommand {
  purpose: ProjectCommandPurpose;
  command: string;
  source: string;
}

/** Manifests larger than this are ignored (they are not hand-written). */
const MAX_MANIFEST_BYTES = 256 * 1024;

/** npm's placeholder `test` script; not a real test command. */
const NPM_PLACEHOLDER_TEST = /no test specified/i;

function readSmall(file: string): string | undefined {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) return undefined;
    return fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

function exists(dir: string, name: string): boolean {
  try {
    return fs.statSync(path.join(dir, name)).isFile();
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `npm`, `pnpm`, `yarn` or `bun`, from the lockfile present. */
function packageManager(dir: string): string {
  if (exists(dir, 'pnpm-lock.yaml')) return 'pnpm';
  if (exists(dir, 'yarn.lock')) return 'yarn';
  if (exists(dir, 'bun.lockb') || exists(dir, 'bun.lock')) return 'bun';
  return 'npm';
}

/** The parsed root `package.json` of `dir`, or undefined. */
function readPackageJson(dir: string): Record<string, unknown> | undefined {
  const text = readSmall(path.join(dir, 'package.json'));
  if (!text) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function fromPackageJson(dir: string): ProjectCommand[] {
  const parsed = readPackageJson(dir);
  if (!parsed || !isRecord(parsed['scripts'])) return [];
  const s = parsed['scripts'];
  const pm = packageManager(dir);
  const out: ProjectCommand[] = [];
  const add = (purpose: ProjectCommandPurpose, script: string) => {
    const body = s[script];
    if (typeof body !== 'string' || body.trim() === '') return;
    if (script === 'test' && NPM_PLACEHOLDER_TEST.test(body)) return;
    const command =
      script === 'test' && pm !== 'bun' ? `${pm} test` : `${pm} run ${script}`;
    out.push({ purpose, command, source: 'package.json' });
  };
  add('test', 'test');
  add('build', 'build');
  add('lint', 'lint');
  add('typecheck', 'typecheck');
  return out;
}

function fromPython(dir: string): ProjectCommand[] {
  const pyproject = readSmall(path.join(dir, 'pyproject.toml')) ?? '';
  const setupCfg = readSmall(path.join(dir, 'setup.cfg')) ?? '';
  const usesPytest =
    exists(dir, 'pytest.ini') ||
    exists(dir, 'conftest.py') ||
    /\[tool\.pytest/.test(pyproject) ||
    /\[tool:pytest\]/.test(setupCfg);
  if (!usesPytest) return [];
  const source = exists(dir, 'pytest.ini')
    ? 'pytest.ini'
    : /\[tool\.pytest/.test(pyproject)
      ? 'pyproject.toml'
      : exists(dir, 'conftest.py')
        ? 'conftest.py'
        : 'setup.cfg';
  return [{ purpose: 'test', command: 'python -m pytest', source }];
}

function fromGo(dir: string): ProjectCommand[] {
  if (!exists(dir, 'go.mod')) return [];
  return [
    { purpose: 'test', command: 'go test ./...', source: 'go.mod' },
    { purpose: 'build', command: 'go build ./...', source: 'go.mod' },
  ];
}

function fromCargo(dir: string): ProjectCommand[] {
  if (!exists(dir, 'Cargo.toml')) return [];
  return [
    { purpose: 'test', command: 'cargo test', source: 'Cargo.toml' },
    { purpose: 'build', command: 'cargo build', source: 'Cargo.toml' },
  ];
}

function fromMakefile(dir: string): ProjectCommand[] {
  const name = ['Makefile', 'makefile', 'GNUmakefile'].find((n) =>
    exists(dir, n),
  );
  if (!name) return [];
  const text = readSmall(path.join(dir, name));
  if (!text) return [];
  const out: ProjectCommand[] = [];
  for (const purpose of ['test', 'build', 'lint'] as const) {
    if (new RegExp(`^${purpose}\\s*:`, 'm').test(text)) {
      out.push({ purpose, command: `make ${purpose}`, source: name });
    }
  }
  return out;
}

/**
 * Commands detected in `dir` (not recursive), at most one per purpose.
 * Ecosystem manifests win over a Makefile, which often just wraps them.
 */
export function detectProjectCommands(dir: string): ProjectCommand[] {
  const found = [
    ...fromPackageJson(dir),
    ...fromPython(dir),
    ...fromGo(dir),
    ...fromCargo(dir),
    ...fromMakefile(dir),
  ];
  const seen = new Set<ProjectCommandPurpose>();
  return found.filter((c) => {
    if (seen.has(c.purpose)) return false;
    seen.add(c.purpose);
    return true;
  });
}

/** How Node treats `.js` files in a package. */
export type ModuleSystem = 'esm' | 'commonjs';

/**
 * The module system a package declares in its root `package.json`
 * (`"type": "module"` or `"commonjs"`), or undefined when it declares none.
 *
 * Why: in the eval, gemma4:e4b wrote a new module with `module.exports` and
 * `require` in a `"type": "module"` package, so it could not be imported
 * (`tooluse-create-module` passed 1/5; evals/capricorn/RESULTS.md,
 * 2026-11-17). Only an explicit `"type"` is reported: without one, Node
 * treats `.js` as CommonJS, but many TypeScript and bundler projects still
 * write `import`, so a guess could mislead.
 */
export function detectModuleSystem(dir: string): ModuleSystem | undefined {
  const type = readPackageJson(dir)?.['type'];
  if (type === 'module') return 'esm';
  if (type === 'commonjs') return 'commonjs';
  return undefined;
}

const MODULE_SYSTEM_TEXT: Record<ModuleSystem, string> = {
  esm: 'ES modules (`"type": "module"` in package.json): `.js` files use `import`/`export`, not `require`/`module.exports`.',
  commonjs:
    'CommonJS (`"type": "commonjs"` in package.json): `.js` files use `require`/`module.exports`; ES modules need `.mjs`.',
};

/** Checks joined into the "all checks" command, fastest first. */
const CHECK_ORDER: readonly ProjectCommandPurpose[] = [
  'lint',
  'typecheck',
  'test',
];

/**
 * One command that runs every detected check (`lint && typecheck && test`),
 * or undefined when fewer than two checks were found. Build is left out: it
 * can be slow and is not a check of the change itself.
 *
 * Why: in the eval, gemma4:12b ran `npm test`, saw it pass and stopped, and
 * neither a list of commands nor an instruction to run all of them changed
 * that (evals/capricorn/RESULTS.md, 2026-11-16). A single command makes
 * "run the checks" one step.
 */
export function allChecksCommand(
  commands: readonly ProjectCommand[],
): string | undefined {
  const checks = CHECK_ORDER.map(
    (purpose) => commands.find((c) => c.purpose === purpose)?.command,
  ).filter((c): c is string => c !== undefined);
  return checks.length >= 2 ? checks.join(' && ') : undefined;
}

/**
 * Session-context lines for the detected commands and declared module system
 * of each directory, or '' when nothing is found. Multi-root workspaces name
 * the directory.
 */
export function formatProjectCommands(dirs: readonly string[]): string {
  const blocks: string[] = [];
  for (const dir of dirs) {
    const where = dirs.length > 1 ? ` in ${dir}` : '';
    const commands = detectProjectCommands(dir);
    if (commands.length > 0) {
      const lines = commands.map(
        (c) => `  - ${c.purpose}: \`${c.command}\` (${c.source})`,
      );
      const all = allChecksCommand(commands);
      if (all) lines.push(`  - all checks: \`${all}\``);
      blocks.push(
        `- **Project commands${where}** (detected from project files; check them before relying on them):\n${lines.join('\n')}`,
      );
    }
    const moduleSystem = detectModuleSystem(dir);
    if (moduleSystem) {
      blocks.push(
        `- **Module system${where}:** ${MODULE_SYSTEM_TEXT[moduleSystem]}`,
      );
    }
  }
  return blocks.join('\n');
}
