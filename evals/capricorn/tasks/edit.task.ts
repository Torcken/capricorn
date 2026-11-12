/**
 * @license
 * Copyright 2026 Capricorn Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Editing tasks under `--approval-mode auto_edit` (file edits
 * allowed, shell not). Checkers verify the change with hidden tests and
 * measure collateral damage with `git diff`.
 */

import {
  ESM_PACKAGE_JSON,
  Expect,
  defineTask,
  runNodeTests,
} from '../types.js';

const AUTO_EDIT = ['--approval-mode', 'auto_edit'];

const RENAME_FILES = {
  'package.json': ESM_PACKAGE_JSON,
  'src/user.js': `/** Returns the name to show for a user record. */
export function getUserName(user) {
  if (user.nickname) return user.nickname;
  return \`\${user.firstName} \${user.lastName}\`.trim();
}
`,
  'src/greeting.js': `import { getUserName } from './user.js';

export function greet(user) {
  return \`Hello, \${getUserName(user)}!\`;
}
`,
  'src/report.js': `import { getUserName } from './user.js';

export function activityLine(user, count) {
  return \`\${getUserName(user)}: \${count} actions\`;
}
`,
  'test/user.test.js': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getUserName } from '../src/user.js';
import { greet } from '../src/greeting.js';

test('nickname wins', () => {
  assert.equal(getUserName({ nickname: 'Ada', firstName: 'A', lastName: 'L' }), 'Ada');
});

test('greeting uses full name', () => {
  assert.equal(greet({ firstName: 'Grace', lastName: 'Hopper' }), 'Hello, Grace Hopper!');
});
`,
};

/** ~40 lines of UI strings with exactly one misspelling. */
const MESSAGES = `export const messages = {
${[
  ['welcome', 'Welcome back!'],
  ['logout', 'You have been signed out.'],
  ['saved', 'Your changes were saved.'],
  ['deleted', 'The item was deleted.'],
  ['uploadStart', 'Uploading your file…'],
  ['uploadDone', 'Upload complete.'],
  ['paymentReceived', 'Payment Recieved. Thank you!'],
  ['paymentFailed', 'Payment failed. Please try another card.'],
  ['sessionExpired', 'Your session has expired.'],
  ['passwordReset', 'Check your inbox for a reset link.'],
  ['inviteSent', 'Invitation sent.'],
  ['inviteAccepted', 'Invitation accepted.'],
  ['quotaWarning', 'You are close to your storage limit.'],
  ['quotaExceeded', 'Storage limit exceeded.'],
  ['offline', 'You are offline. Changes will sync later.'],
  ['online', 'Back online.'],
  ['exportReady', 'Your export is ready to download.'],
  ['importDone', 'Import finished.'],
  ['notFound', 'We could not find that page.'],
  ['serverError', 'Something went wrong on our side.'],
]
  .map(([k, v]) => `  ${k}: '${v}',`)
  .join('\n')}
};
`;

export const editTasks = [
  defineTask({
    id: 'edit-rename-symbol',
    category: 'edit',
    description:
      'Renames a function across definition, imports, calls and tests',
    files: RENAME_FILES,
    args: AUTO_EDIT,
    prompt:
      'Rename the function getUserName to getDisplayName everywhere in this project: the definition, every import, every call and the tests. Keep the behaviour the same.',
    check: (ctx) => {
      const files = [
        'src/user.js',
        'src/greeting.js',
        'src/report.js',
        'test/user.test.js',
      ];
      const e = new Expect();
      for (const f of files) {
        const src = ctx.exists(f) ? ctx.read(f) : '';
        e.that(!/getUserName/.test(src), `${f} still mentions getUserName`);
        e.that(/getDisplayName/.test(src), `${f} does not use getDisplayName`);
      }
      const t = runNodeTests(ctx);
      e.that(t.code === 0, `tests fail after rename:\n${t.output.slice(-600)}`);
      return e.result();
    },
  }),

  defineTask({
    id: 'edit-add-parameter',
    category: 'edit',
    description: 'Adds an optional parameter without breaking existing callers',
    files: {
      'package.json': ESM_PACKAGE_JSON,
      'src/format.js': `/** Joins items for display. */
export function formatList(items) {
  return items.join(', ');
}
`,
      'src/index.js': `import { formatList } from './format.js';

console.log(formatList(['apples', 'pears']));
`,
    },
    args: AUTO_EDIT,
    prompt:
      "Add an optional second parameter named separator to formatList in src/format.js, defaulting to ', '. Existing calls must keep working unchanged.",
    check: (ctx) => {
      ctx.write(
        'hidden.test.js',
        `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatList } from './src/format.js';
test('default separator', () => assert.equal(formatList(['a', 'b']), 'a, b'));
test('custom separator', () => assert.equal(formatList(['a', 'b'], ' | '), 'a | b'));
test('single item', () => assert.equal(formatList(['a'], '-'), 'a'));
`,
      );
      const t = ctx.node(['--test', 'hidden.test.js']);
      const changed = ctx.changedPaths().filter((p) => p !== 'hidden.test.js');
      return new Expect()
        .that(t.code === 0, `hidden tests fail:\n${t.output.slice(-600)}`)
        .that(
          changed.length === 1 && changed[0] === 'src/format.js',
          `expected only src/format.js to change, got: ${changed.join(', ') || 'nothing'}`,
        )
        .result();
    },
  }),

  defineTask({
    id: 'edit-minimal-fix',
    category: 'edit',
    description: 'Fixes one typo in a larger file without touching other lines',
    files: { 'package.json': ESM_PACKAGE_JSON, 'src/messages.js': MESSAGES },
    args: AUTO_EDIT,
    prompt:
      "Fix the spelling mistake in the payment confirmation message ('Recieved') in src/messages.js. Do not change anything else.",
    check: (ctx) => {
      const numstat = ctx
        .git(['diff', '--numstat'])
        .trim()
        .split('\n')
        .filter(Boolean);
      const src = ctx.read('src/messages.js');
      return new Expect()
        .that(/Payment Received\. Thank you!/.test(src), 'typo not fixed')
        .that(!/Recieved/.test(src), 'misspelling still present')
        .that(
          numstat.length === 1 &&
            /^1\s+1\s+src\/messages\.js$/.test(numstat[0]),
          `expected a one-line change, got: ${numstat.join('; ') || 'no diff'}`,
        )
        .that(
          ctx.changedPaths().length === 1,
          `other files changed: ${ctx.changedPaths().join(', ')}`,
        )
        .result();
    },
  }),
];
