/**
 * @license
 * Copyright 2026 Capricorn Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview End-to-end harness: runs the *compiled* `capricorn` CLI as a
 * child process against the in-process mock Ollama server, inside a
 * disposable git repository with an isolated HOME.
 *
 * Nothing here talks to a real model or the network: the mock listens on
 * 127.0.0.1 and the CLI's egress guard is active, with blocked attempts
 * reported on stderr (`CAPRICORN_EGRESS_REPORT=1`) so tests can assert that
 * no external connection was even attempted.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  startMockOllama,
  type MockOllama,
  type MockModel,
} from '../packages/core/dist/src/providers/ollama/testing/mockOllamaServer.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Entry point under test. Override with CAPRICORN_E2E_BIN (e.g. the bundle). */
export const CLI_ENTRY =
  process.env['CAPRICORN_E2E_BIN'] ??
  path.resolve(here, '../packages/cli/dist/index.js');

/** Result of one CLI invocation. */
export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** A disposable workspace + home + mock daemon. */
export interface E2EEnv {
  repo: string;
  home: string;
  mock: MockOllama;
  run(
    args: string[],
    options?: {
      env?: Record<string, string>;
      input?: string;
      timeoutMs?: number;
    },
  ): Promise<RunResult>;
  write(rel: string, content: string): void;
  read(rel: string): string;
  exists(rel: string): boolean;
  cleanup(): Promise<void>;
}

/**
 * Creates the environment. The repo is a real git repository with one
 * commit so git-aware features behave as in a user project.
 */
export async function createEnv(
  options: { models?: MockModel[] } = {},
): Promise<E2EEnv> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capricorn-e2e-'));
  const repo = path.join(root, 'repo');
  const home = path.join(root, 'home');
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(repo, 'README.md'), '# Demo project\n');
  fs.writeFileSync(
    path.join(repo, 'math.js'),
    'export function add(a, b) {\n  return a - b;\n}\n',
  );
  await git(repo, ['init', '-q']);
  await git(repo, [
    '-c',
    'user.email=e2e@example.invalid',
    '-c',
    'user.name=e2e',
    'add',
    '.',
  ]);
  await git(repo, [
    '-c',
    'user.email=e2e@example.invalid',
    '-c',
    'user.name=e2e',
    'commit',
    '-qm',
    'init',
  ]);

  const mock = await startMockOllama({ models: options.models });

  const run: E2EEnv['run'] = (args, runOptions = {}) =>
    new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        ['--no-deprecation', CLI_ENTRY, ...args],
        {
          cwd: repo,
          env: {
            // Minimal, explicit environment: no inherited cloud credentials.
            PATH: process.env['PATH'] ?? '',
            HOME: home,
            USERPROFILE: home,
            CAPRICORN_OLLAMA_HOST: mock.url,
            CAPRICORN_EGRESS_REPORT: '1',
            GEMINI_CLI_NO_RELAUNCH: 'true',
            NO_COLOR: '1',
            TERM: 'dumb',
            ...runOptions.env,
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
      child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
      const timer = setTimeout(
        () => child.kill('SIGKILL'),
        runOptions.timeoutMs ?? 90_000,
      );
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
      child.stdin.end(runOptions.input ?? '');
    });

  return {
    repo,
    home,
    mock,
    run,
    write: (rel, content) => {
      fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
      fs.writeFileSync(path.join(repo, rel), content);
    },
    read: (rel) => fs.readFileSync(path.join(repo, rel), 'utf8'),
    exists: (rel) => fs.existsSync(path.join(repo, rel)),
    cleanup: async () => {
      await mock.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function git(cwd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: 'ignore' });
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`git ${args.join(' ')} failed`)),
    );
  });
}

/** Messages the CLI sent to the model in the n-th chat request. */
export function chatMessages(
  mock: MockOllama,
  index: number,
): Array<Record<string, unknown>> {
  const req = mock.chatRequests()[index];
  const body = req?.body as
    | { messages?: Array<Record<string, unknown>> }
    | undefined;
  return body?.messages ?? [];
}

/** All `role: tool` messages sent across every chat request. */
export function toolResults(mock: MockOllama): Array<Record<string, unknown>> {
  const seen = new Map<string, Record<string, unknown>>();
  for (const req of mock.chatRequests()) {
    const body = req.body as { messages?: Array<Record<string, unknown>> };
    for (const m of body.messages ?? []) {
      if (m['role'] === 'tool')
        seen.set(
          `${String(m['tool_call_id'])}:${String(m['content']).slice(0, 40)}`,
          m,
        );
    }
  }
  return [...seen.values()];
}

/** Lines the egress guard printed for blocked connections. */
export function blockedEgress(stderr: string): string[] {
  return stderr
    .split('\n')
    .filter((l) => l.startsWith('[capricorn-egress] blocked'));
}
