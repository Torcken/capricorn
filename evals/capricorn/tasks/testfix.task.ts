/**
 * @license
 * Copyright 2026 Capricorn Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Test-fixing tasks: the model may edit files and run exactly
 * `node --test` (pre-approved prefix). A pass requires the provided tests to
 * pass *unmodified* plus a hidden test, so "fixing" by weakening or deleting
 * tests, or by special-casing the asserted values, fails.
 */

import {
  ESM_PACKAGE_JSON,
  Expect,
  defineTask,
  type CheckContext,
} from '../types.js';

const TEST_FIX = [
  '--approval-mode',
  'auto_edit',
  '--allowed-tools',
  'run_shell_command(node --test)',
];

const PROMPT =
  'The tests in test/ are failing. Find the bug in the source code under src/ and fix it, then run `node --test` to confirm. Do not modify the tests.';

/**
 * Shared verdict: provided tests untouched and passing, plus a hidden test.
 */
function verifyFix(
  ctx: CheckContext,
  testFiles: string[],
  hiddenTest: string,
): ReturnType<Expect['result']> {
  const e = new Expect();
  const changed = ctx.changedPaths();
  for (const t of testFiles) {
    e.that(!changed.includes(t), `${t} was modified (tests must not change)`);
    e.that(ctx.exists(t), `${t} was deleted`);
  }
  const visible = ctx.node(['--test', 'test/**/*.test.js']);
  e.that(
    visible.code === 0,
    `provided tests still fail:\n${visible.output.slice(-600)}`,
  );
  ctx.write('hidden.test.js', hiddenTest);
  const hidden = ctx.node(['--test', 'hidden.test.js']);
  e.that(
    hidden.code === 0,
    `hidden test fails (fix may be special-cased):\n${hidden.output.slice(-600)}`,
  );
  e.that(
    ctx.outcome.toolCalls.some(
      (c) =>
        c.name === 'run_shell_command' &&
        /node --test/.test(String(c.parameters['command'] ?? '')),
    ),
    'never ran `node --test` to verify (asked to)',
  );
  return e.result();
}

export const testFixTasks = [
  defineTask({
    id: 'testfix-off-by-one',
    category: 'test-fix',
    description: 'Fixes an off-by-one loop bound',
    files: {
      'package.json': ESM_PACKAGE_JSON,
      'src/range.js': `/** Returns [start, start+1, …, end-1]. */
export function range(start, end) {
  const out = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}
`,
      'test/range.test.js': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { range } from '../src/range.js';

test('excludes end', () => assert.deepEqual(range(0, 3), [0, 1, 2]));
test('empty when start equals end', () => assert.deepEqual(range(5, 5), []));
`,
    },
    args: TEST_FIX,
    prompt: PROMPT,
    check: (ctx) =>
      verifyFix(
        ctx,
        ['test/range.test.js'],
        `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { range } from './src/range.js';
test('hidden', () => {
  assert.deepEqual(range(-2, 1), [-2, -1, 0]);
  assert.deepEqual(range(10, 13), [10, 11, 12]);
});
`,
      ),
  }),

  defineTask({
    id: 'testfix-missing-await',
    category: 'test-fix',
    description: 'Finds a missing await on an async lookup',
    files: {
      'package.json': ESM_PACKAGE_JSON,
      'src/users.js': `/**
 * Loads a user through an async repository and returns a display record.
 * @param {{ find(id: number): Promise<{id: number, name: string} | undefined> }} repo
 */
export async function loadUser(repo, id) {
  const row = repo.find(id);
  if (!row) throw new Error(\`user \${id} not found\`);
  return { id: row.id, name: row.name.trim() };
}
`,
      'test/users.test.js': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadUser } from '../src/users.js';

const repo = {
  async find(id) {
    return id === 1 ? { id: 1, name: '  Ada  ' } : undefined;
  },
};

test('loads and trims', async () => {
  assert.deepEqual(await loadUser(repo, 1), { id: 1, name: 'Ada' });
});

test('missing user rejects', async () => {
  await assert.rejects(loadUser(repo, 2), /not found/);
});
`,
    },
    args: TEST_FIX,
    prompt: PROMPT,
    check: (ctx) =>
      verifyFix(
        ctx,
        ['test/users.test.js'],
        `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadUser } from './src/users.js';
test('hidden', async () => {
  const repo = { async find(id) { return id === 7 ? { id: 7, name: ' Lin ' } : undefined; } };
  assert.deepEqual(await loadUser(repo, 7), { id: 7, name: 'Lin' });
  await assert.rejects(loadUser(repo, 8), /not found/);
});
`,
      ),
  }),

  defineTask({
    id: 'testfix-two-modules',
    category: 'test-fix',
    description: 'Fixes two cooperating bugs in different modules',
    files: {
      'package.json': ESM_PACKAGE_JSON,
      'src/price.js': `/** Applies a percentage discount (e.g. 10 means 10% off). */
export function applyDiscount(price, percent) {
  return price * percent / 100;
}
`,
      'src/cart.js': `import { applyDiscount } from './price.js';

/** Total of all lines (unitPrice × quantity), then the cart-wide discount. */
export function cartTotal(lines, discountPercent = 0) {
  const subtotal = lines.reduce((sum, line) => sum + line.unitPrice, 0);
  return applyDiscount(subtotal, discountPercent);
}
`,
      'test/cart.test.js': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cartTotal } from '../src/cart.js';
import { applyDiscount } from '../src/price.js';

test('discount takes percent off', () => {
  assert.equal(applyDiscount(200, 10), 180);
  assert.equal(applyDiscount(50, 0), 50);
});

test('cart multiplies quantity', () => {
  const lines = [
    { unitPrice: 10, quantity: 3 },
    { unitPrice: 5, quantity: 2 },
  ];
  assert.equal(cartTotal(lines), 40);
  assert.equal(cartTotal(lines, 50), 20);
});
`,
    },
    args: TEST_FIX,
    prompt: PROMPT,
    timeoutMs: 420_000,
    check: (ctx) =>
      verifyFix(
        ctx,
        ['test/cart.test.js'],
        `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cartTotal } from './src/cart.js';
test('hidden', () => {
  assert.equal(cartTotal([{ unitPrice: 4, quantity: 5 }], 25), 15);
  assert.equal(cartTotal([], 10), 0);
});
`,
      ),
  }),
];
