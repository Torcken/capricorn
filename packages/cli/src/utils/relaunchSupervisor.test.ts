/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Every `import … from '…'` / `import '…'` specifier in a source file. */
function importSpecifiers(file: string): string[] {
  const source = fs.readFileSync(file, 'utf8');
  return [...source.matchAll(/^import\s[^;]*?['"]([^'"]+)['"]/gms)].map(
    (m) => m[1],
  );
}

// Startup time: the relaunch parent (packages/cli/index.ts) must stay tiny.
// Upstream's parent imported processUtils.ts, whose cleanup/update imports
// pulled ~0.8 s of shared bundle code in before the child even started.
describe('relaunch supervisor stays lightweight', () => {
  it('relaunchSupervisor.ts imports only Node built-ins', () => {
    const specifiers = importSpecifiers(
      path.join(here, 'relaunchSupervisor.ts'),
    );
    expect(specifiers.every((s) => s.startsWith('node:'))).toBe(true);
  });

  it('the CLI entry imports only Node built-ins and the supervisor statically', () => {
    const specifiers = importSpecifiers(
      path.join(here, '..', '..', 'index.ts'),
    );
    for (const s of specifiers) {
      expect(
        s.startsWith('node:') || s === './src/utils/relaunchSupervisor.js',
      ).toBe(true);
    }
  });
});

describe('canRunInProcess', () => {
  const GiB = 1024 * 1024 * 1024;
  it('runs headless prompts and one-shot commands in process', async () => {
    const { canRunInProcess } = await import('./relaunchSupervisor.js');
    expect(canRunInProcess(['-p', 'hi'], 4 * GiB)).toBe(true);
    expect(canRunInProcess(['--prompt=hi', '--model', 'x'], 4 * GiB)).toBe(
      true,
    );
    expect(canRunInProcess(['run', 'fix it'], 4 * GiB)).toBe(true);
    expect(canRunInProcess(['doctor', '--json'], 4 * GiB)).toBe(true);
    expect(canRunInProcess(['models'], 4 * GiB)).toBe(true);
  });

  it('keeps the relaunch for interactive sessions and small heaps', async () => {
    const { canRunInProcess } = await import('./relaunchSupervisor.js');
    expect(canRunInProcess([], 4 * GiB)).toBe(false);
    expect(canRunInProcess(['--model', 'gemma4:12b'], 4 * GiB)).toBe(false);
    expect(canRunInProcess(['-i', 'start here'], 4 * GiB)).toBe(false);
    expect(canRunInProcess(['-p', 'x', '-i', 'y'], 4 * GiB)).toBe(false);
    expect(canRunInProcess(['-p', 'hi'], 1.5 * GiB)).toBe(false);
  });
});
