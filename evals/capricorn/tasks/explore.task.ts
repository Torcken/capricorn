/**
 * @license
 * Copyright 2026 Capricorn Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Exploration tasks: read-only questions whose answers require
 * actually opening files (not guessing from names). All run in the default
 * approval mode, where headless runs only get read-only tools.
 */

import { ESM_PACKAGE_JSON, Expect, defineTask } from '../types.js';

/** A small service with layered config, used by the first task. */
const CONFIG_SERVICE = {
  'package.json': ESM_PACKAGE_JSON,
  'config/default.json': JSON.stringify(
    { server: { port: 8080, host: '0.0.0.0' }, log: { level: 'info' } },
    null,
    2,
  ),
  'config/production.json': JSON.stringify(
    { server: { port: 80 }, log: { level: 'warn' } },
    null,
    2,
  ),
  'src/config.js': `import fs from 'node:fs';

/** Loads config/default.json, then overlays config/<NODE_ENV>.json if present. */
export function loadConfig(env = process.env.NODE_ENV) {
  const base = JSON.parse(fs.readFileSync('config/default.json', 'utf8'));
  if (!env) return base;
  const file = \`config/\${env}.json\`;
  if (!fs.existsSync(file)) return base;
  const overlay = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { ...base, server: { ...base.server, ...overlay.server }, log: { ...base.log, ...overlay.log } };
}
`,
  'src/server.js': `import http from 'node:http';
import { loadConfig } from './config.js';

const config = loadConfig();
http
  .createServer((req, res) => res.end('ok'))
  .listen(config.server.port, config.server.host);
`,
};

/** A tiny auth module with one caller of hashPassword and a decoy. */
const AUTH_SERVICE = {
  'package.json': ESM_PACKAGE_JSON,
  'src/auth/hash.js': `import crypto from 'node:crypto';

export function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString('hex');
}

export function verifyPassword(password, salt, expected) {
  return crypto.timingSafeEqual(
    Buffer.from(hashPasswordForCompare(password, salt), 'hex'),
    Buffer.from(expected, 'hex'),
  );
}

function hashPasswordForCompare(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString('hex');
}
`,
  'src/auth/register.js': `import crypto from 'node:crypto';
import { hashPassword } from './hash.js';

export function registerUser(store, email, password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const user = { email, salt, hash: hashPassword(password, salt) };
  store.save(user);
  return user;
}
`,
  'src/auth/login.js': `import { verifyPassword } from './hash.js';

export function login(store, email, password) {
  const user = store.findByEmail(email);
  return Boolean(user && verifyPassword(password, user.salt, user.hash));
}
`,
  'src/util/strings.js': `export function normalizeEmail(email) {
  return email.trim().toLowerCase();
}
`,
};

/** True when the workspace is exactly as committed. */
function unchanged(paths: string[]): boolean {
  return paths.length === 0;
}

export const exploreTasks = [
  defineTask({
    id: 'explore-config-port',
    category: 'explore',
    description:
      'Finds the default port by following code into layered config files',
    files: CONFIG_SERVICE,
    prompt:
      'What port does the HTTP server in this project listen on by default, when NODE_ENV is not set? In which file is that value defined? Answer briefly.',
    check: (ctx) =>
      new Expect()
        .that(/\b8080\b/.test(ctx.outcome.answer), 'answer does not say 8080')
        .that(
          /default\.json/.test(ctx.outcome.answer),
          'answer does not name config/default.json',
        )
        .that(unchanged(ctx.changedPaths()), 'workspace was modified')
        .result(),
  }),

  defineTask({
    id: 'explore-find-caller',
    category: 'explore',
    description: 'Identifies the real caller of a function, ignoring a decoy',
    files: AUTH_SERVICE,
    prompt:
      'Which function in this project calls hashPassword, and in which file is that caller? Do not modify anything.',
    check: (ctx) =>
      new Expect()
        .that(
          /registerUser/.test(ctx.outcome.answer),
          'answer does not name registerUser',
        )
        .that(
          /register\.js/.test(ctx.outcome.answer),
          'answer does not name src/auth/register.js',
        )
        .that(unchanged(ctx.changedPaths()), 'workspace was modified')
        .result(),
  }),

  defineTask({
    id: 'explore-nonexistent',
    category: 'explore',
    description:
      'Says a function does not exist instead of inventing what it does',
    files: AUTH_SERVICE,
    prompt: 'What does the parseInvoice function in this project do?',
    check: (ctx) =>
      new Expect()
        .that(
          /\b(no|not|cannot|can't|couldn't|could not|doesn't|does not|isn't|is not|unable|none)\b[^.]{0,60}\b(find|found|exist|exists|defined|present|locate|contain|contains|appear)\b/i.test(
            ctx.outcome.answer,
          ) ||
            /\b(there is no|there's no|no such|no function)\b/i.test(
              ctx.outcome.answer,
            ),
          'answer does not state that parseInvoice is absent (possible hallucination)',
        )
        .that(unchanged(ctx.changedPaths()), 'workspace was modified')
        .result(),
  }),
];
