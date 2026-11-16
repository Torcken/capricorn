/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Tasks where the project's *own* commands are the only correct
 * way to verify the work, to measure the "Project commands" session-context
 * hint (`core/src/utils/projectCommands.ts`).
 *
 * Unlike the other test-fix tasks, the prompt never names a command. The
 * fixtures are built so that the obvious guess is wrong: specs live in
 * `spec/*.spec.js`, which a bare `node --test` does not pick up (it then
 * reports success with zero tests), and a custom lint script enforces a rule
 * that only running it reveals. Checkers still judge outcomes: the provided
 * specs and the lint script must pass afterwards, and a hidden test guards
 * against special-casing.
 */

import { Expect, defineTask, type CheckContext } from '../types.js';

/** Commands a careful user would pre-approve for "run the project's checks". */
const PROJECT_ARGS = [
  '--approval-mode',
  'auto_edit',
  '--allowed-tools',
  'run_shell_command(npm test)',
  '--allowed-tools',
  'run_shell_command(npm run)',
  '--allowed-tools',
  'run_shell_command(node --test)',
  '--allowed-tools',
  'run_shell_command(node scripts/lint.js)',
];

/** Whether a shell command was run whose text matches `pattern`. */
function ran(ctx: CheckContext, pattern: RegExp): boolean {
  return ctx.outcome.toolCalls.some(
    (c) =>
      c.name === 'run_shell_command' &&
      pattern.test(String(c.parameters['command'] ?? '')),
  );
}

/** `npm test`, `npm run test` or `npm t`, possibly after `cd … &&`. */
const NPM_TEST = /(^|&&\s*|;\s*)npm (run )?t(est)?\b/;

const DURATION_SPEC = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration } from '../src/duration.js';

test('single units', () => {
  assert.equal(parseDuration('45m'), 2700);
  assert.equal(parseDuration('2h'), 7200);
});

test('multi-digit and combined', () => {
  assert.equal(parseDuration('90s'), 90);
  assert.equal(parseDuration('1h30m'), 5400);
});
`;

/** Checks every `export function` in src/ has a JSDoc block right above it. */
const LINT_SCRIPT = `import fs from 'node:fs';
import path from 'node:path';

// House rule: every exported function is documented with a /** … */ block
// directly above it.
let problems = 0;
for (const file of fs.readdirSync('src').filter((f) => f.endsWith('.js'))) {
  const lines = fs.readFileSync(path.join('src', file), 'utf8').split('\\n');
  lines.forEach((line, i) => {
    if (/^export (async )?function /.test(line) && !/\\*\\/\\s*$/.test(lines[i - 1] ?? '')) {
      console.error(\`src/\${file}:\${i + 1}: exported function needs a JSDoc comment\`);
      problems++;
    }
  });
}
if (problems > 0) process.exit(1);
console.log('lint: ok');
`;

const MONEY_SOURCE = `/** Formats an amount with two decimals and the currency, e.g. "12.50 EUR". */
export function formatPrice(amount) {
  return \`\${amount.toFixed(2)} EUR\`;
}
`;

const MONEY_SPEC = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPrice } from '../src/money.js';

test('two decimals', () => {
  assert.equal(formatPrice(12.5), '12.50 EUR');
});
`;

export const projectTasks = [
  defineTask({
    id: 'testfix-project-script',
    category: 'test-fix',
    description:
      "Fixes a bug and verifies with the project's own test script (spec/, not test/)",
    files: {
      'package.json': JSON.stringify(
        {
          name: 'fixture',
          version: '1.0.0',
          type: 'module',
          private: true,
          scripts: { test: 'node --test spec/duration.spec.js' },
        },
        null,
        2,
      ),
      'src/duration.js': `/** Parses durations such as "1h30m", "45m", "2h" or "90s" into seconds. */
export function parseDuration(text) {
  const units = { h: 3600, m: 60, s: 1 };
  let total = 0;
  for (const [, n, unit] of text.matchAll(/(\\d)([hms])/g)) {
    total += Number(n) * units[unit];
  }
  return total;
}
`,
      'spec/duration.spec.js': DURATION_SPEC,
    },
    args: PROJECT_ARGS,
    prompt:
      "Some of this project's tests are failing. Find the bug in src/ and fix it, then run the project's tests to confirm they pass. Do not modify the tests.",
    check: (ctx) => {
      const e = new Expect();
      const spec = 'spec/duration.spec.js';
      e.that(
        !ctx.changedPaths().includes(spec),
        `${spec} was modified (tests must not change)`,
      );
      e.that(ctx.exists(spec), `${spec} was deleted`);
      const visible = ctx.node(['--test', spec]);
      e.that(
        visible.code === 0,
        `provided tests still fail:\n${visible.output.slice(-600)}`,
      );
      ctx.write(
        'hidden.test.js',
        `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration } from './src/duration.js';
test('hidden', () => {
  assert.equal(parseDuration('12h5m7s'), 43507);
  assert.equal(parseDuration('120m'), 7200);
});
`,
      );
      const hidden = ctx.node(['--test', 'hidden.test.js']);
      e.that(
        hidden.code === 0,
        `hidden test fails (fix may be special-cased):\n${hidden.output.slice(-600)}`,
      );
      // A bare `node --test` finds no files in spec/ and "passes" with zero
      // tests, so only the project's script (or naming the spec) verifies.
      e.that(
        ran(ctx, NPM_TEST) || ran(ctx, /node --test\s+\S*spec\//),
        "never ran the project's tests (`npm test`) to verify",
      );
      return e.result();
    },
  }),

  defineTask({
    id: 'edit-project-checks',
    category: 'edit',
    description:
      "Adds a function and makes the project's own lint and test scripts pass",
    files: {
      'package.json': JSON.stringify(
        {
          name: 'fixture',
          version: '1.0.0',
          type: 'module',
          private: true,
          scripts: {
            test: 'node --test spec/money.spec.js',
            lint: 'node scripts/lint.js',
          },
        },
        null,
        2,
      ),
      'scripts/lint.js': LINT_SCRIPT,
      'src/money.js': MONEY_SOURCE,
      'spec/money.spec.js': MONEY_SPEC,
    },
    args: PROJECT_ARGS,
    prompt:
      "Add an exported function `formatTotal(lines)` to src/money.js that returns the formatted total of `lines` (each `{ price, quantity }`) using formatPrice, so `formatTotal([{ price: 2.5, quantity: 2 }])` returns '5.00 EUR'. Then make sure all of the project's checks pass.",
    check: (ctx) => {
      const e = new Expect();
      e.that(
        !ctx.changedPaths().includes('scripts/lint.js') &&
          ctx.exists('scripts/lint.js'),
        'scripts/lint.js was modified or deleted (checks must not change)',
      );
      const lint = ctx.node(['scripts/lint.js']);
      e.that(lint.code === 0, `lint fails:\n${lint.output.slice(-600)}`);
      const visible = ctx.node(['--test', 'spec/money.spec.js']);
      e.that(
        visible.code === 0,
        `project tests fail:\n${visible.output.slice(-600)}`,
      );
      ctx.write(
        'hidden.test.js',
        `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTotal, formatPrice } from './src/money.js';
test('hidden', () => {
  assert.equal(formatTotal([{ price: 2.5, quantity: 2 }]), '5.00 EUR');
  assert.equal(formatTotal([{ price: 1, quantity: 3 }, { price: 0.25, quantity: 4 }]), '4.00 EUR');
  assert.equal(formatTotal([]), '0.00 EUR');
  assert.equal(formatPrice(3), '3.00 EUR');
});
`,
      );
      const hidden = ctx.node(['--test', 'hidden.test.js']);
      e.that(
        hidden.code === 0,
        `hidden test fails:\n${hidden.output.slice(-600)}`,
      );
      e.that(
        ran(ctx, /npm run lint\b/) || ran(ctx, /node scripts\/lint\.js/),
        "never ran the project's lint script (`npm run lint`)",
      );
      return e.result();
    },
  }),
];
