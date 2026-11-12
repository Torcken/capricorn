/**
 * @license
 * Copyright 2026 Capricorn Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Tool-use tasks: creating new files with a usable API, and
 * answering a question that requires an exhaustive search rather than a
 * sample.
 */

import { ESM_PACKAGE_JSON, Expect, defineTask } from '../types.js';

export const toolUseTasks = [
  defineTask({
    id: 'tooluse-create-module',
    category: 'tool-use',
    description: 'Creates a new module and its test from a specification',
    files: {
      'package.json': ESM_PACKAGE_JSON,
      'src/index.js': `export { formatDate } from './date.js';
`,
      'src/date.js': `export function formatDate(d) {
  return d.toISOString().slice(0, 10);
}
`,
    },
    args: ['--approval-mode', 'auto_edit'],
    prompt:
      "Create src/slugify.js exporting a function slugify(text) that lowercases the text, trims it, replaces every run of characters that are not a-z or 0-9 with a single '-', and removes leading and trailing '-'. Also add a test file test/slugify.test.js using node:test.",
    check: (ctx) => {
      const e = new Expect()
        .that(ctx.exists('src/slugify.js'), 'src/slugify.js was not created')
        .that(
          ctx.exists('test/slugify.test.js'),
          'test/slugify.test.js was not created',
        );
      if (!ctx.exists('src/slugify.js')) return e.result();
      ctx.write(
        'hidden.test.js',
        `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from './src/slugify.js';
test('spec', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
  assert.equal(slugify('  Already--Slugged  '), 'already-slugged');
  assert.equal(slugify('C++ & Rust: 2026!'), 'c-rust-2026');
  assert.equal(slugify('---'), '');
});
`,
      );
      const hidden = ctx.node(['--test', 'hidden.test.js']);
      e.that(
        hidden.code === 0,
        `implementation does not meet the spec:\n${hidden.output.slice(-600)}`,
      );
      if (ctx.exists('test/slugify.test.js')) {
        const own = ctx.node(['--test', 'test/slugify.test.js']);
        e.that(
          own.code === 0,
          `model's own test fails:\n${own.output.slice(-400)}`,
        );
      }
      return e.result();
    },
  }),

  defineTask({
    id: 'tooluse-count-todos',
    category: 'tool-use',
    description:
      'Counts matches exhaustively across files (search tool, not guessing)',
    files: {
      'package.json': ESM_PACKAGE_JSON,
      'src/a.js': `// TODO: validate input
export function a(x) {
  return x; // TODO: handle null
}
`,
      'src/b.js': `export function b() {
  // TODO: implement caching
  return 1;
}
// Note: TODOs are tracked in the issue tracker, not here.
`,
      'src/nested/c.js': `export const c = 3; // TODO: make configurable
// TODO: remove after migration
`,
      'docs/notes.md': `# Notes

TODO: this one is in docs, outside src.
`,
    },
    prompt:
      'How many `TODO:` comments (with the colon) are there in files under the src directory, including subdirectories? Start your answer with the number.',
    check: (ctx) => {
      const first = ctx.outcome.finalAnswer.match(/\d+/)?.[0];
      return new Expect()
        .that(
          first === '5',
          `expected 5, answer started with ${first ?? 'no number'}`,
        )
        .that(ctx.changedPaths().length === 0, 'workspace was modified')
        .result();
    },
  }),
];
