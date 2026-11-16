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
