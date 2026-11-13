/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Context-management tasks: work that needs more context than a
 * small window holds, so history compression must keep what matters.
 *
 * Run with `--num-ctx 8192` to force compression: the files the task asks the
 * model to read are ≈7K tokens on top of the ≈3K fixed prompt. At the default
 * 32K window the same task checks ordinary behaviour.
 */

import { ESM_PACKAGE_JSON, Expect, defineTask } from '../types.js';

/** One catalog module of `count` products; ≈30 tokens per product line. */
function catalog(category: string, prefix: string, count: number): string {
  const lines = [
    `// Product catalog: ${category}. Prices are in EUR, before tax.`,
    `export const ${category} = [`,
  ];
  for (let i = 1; i <= count; i++) {
    const sku = `${prefix}-${String(i).padStart(3, '0')}`;
    const price = ((i * 7.31) % 90) + 4.99;
    lines.push(
      `  { sku: '${sku}', name: '${category} item ${i}', price: ${price.toFixed(2)}, category: '${category}' },`,
    );
  }
  lines.push('];', '');
  return lines.join('\n');
}

/** The policy the model must remember after reading everything else. */
const POLICY_FILE = (() => {
  const body = catalog('books', 'B', 44).split('\n');
  // Mentioned once, in the middle of a long file, as real projects do.
  body.splice(
    18,
    0,
    '  // Tax policy (legal, 2026): products in the categories books and medicine are tax-exempt; every other category is taxed at the given rate.',
  );
  return body.join('\n');
})();

const PROMPT =
  'Requirements first: add to src/pricing.js an exported function priceWithTax(item, rate) that returns the price including tax, rounded to 2 decimals with Math.round(x * 100) / 100. ' +
  'Before writing it, read every file in src/catalog/ with read_file, one by one: one of them states which categories are tax-exempt, and exempt items must get no tax. ' +
  'Then run `node --test` to confirm nothing broke.';

export const contextTasks = [
  defineTask({
    id: 'context-long-read',
    category: 'context',
    description:
      'Keeps an early requirement and a detail from a long read through compression',
    files: {
      'package.json': ESM_PACKAGE_JSON,
      'src/pricing.js': `export function price(item) {
  return item.price;
}
`,
      'src/catalog/electronics.js': catalog('electronics', 'E', 44),
      'src/catalog/garden.js': catalog('garden', 'G', 44),
      'src/catalog/books.js': POLICY_FILE,
      'src/catalog/toys.js': catalog('toys', 'T', 44),
      'src/catalog/medicine.js': catalog('medicine', 'M', 44),
      'src/catalog/kitchen.js': catalog('kitchen', 'K', 44),
      'test/pricing.test.js': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { price } from '../src/pricing.js';
test('price', () => {
  assert.equal(price({ price: 10 }), 10);
});
`,
    },
    args: [
      '--approval-mode',
      'auto_edit',
      '--allowed-tools',
      'run_shell_command(node --test)',
    ],
    prompt: PROMPT,
    timeoutMs: 480_000,
    check: (ctx) => {
      const e = new Expect();
      const visible = ctx.node(['--test', 'test/pricing.test.js']);
      e.that(visible.code === 0, `existing test broke:\n${visible.output}`);
      ctx.write(
        'hidden.test.js',
        `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceWithTax } from './src/pricing.js';
test('taxed category', () => {
  assert.equal(priceWithTax({ price: 10, category: 'toys' }, 0.2), 12);
  assert.equal(priceWithTax({ price: 9.99, category: 'garden' }, 0.055), 10.54);
});
test('exempt categories get no tax', () => {
  assert.equal(priceWithTax({ price: 10, category: 'books' }, 0.2), 10);
  assert.equal(priceWithTax({ price: 4.5, category: 'medicine' }, 0.2), 4.5);
});
`,
      );
      const hidden = ctx.node(['--test', 'hidden.test.js']);
      e.that(
        hidden.code === 0,
        `priceWithTax does not meet the requirements:\n${hidden.output.slice(-700)}`,
      );
      return e.result();
    },
  }),
];
