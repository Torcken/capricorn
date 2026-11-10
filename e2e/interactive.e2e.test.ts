/**
 * @license
 * Copyright 2026 Capricorn Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Drives the interactive terminal UI through a pseudo-terminal (node-pty),
 * against the mock Ollama daemon: startup screen, a streamed answer, and a
 * clean exit on Ctrl+C. This is the only test that exercises the real Ink
 * render loop end to end.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as pty from 'node-pty';
import {
  doneFrame,
  textFrame,
} from '../packages/core/dist/src/providers/ollama/testing/mockOllamaServer.js';
import { CLI_ENTRY, createEnv, type E2EEnv } from './harness.js';

let env: E2EEnv;

beforeEach(async () => {
  env = await createEnv();
});
afterEach(async () => {
  await env.cleanup();
});

/** Escape and bell characters, kept out of regex literals for readability. */
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
/** CSI sequences, OSC strings and charset selections. */
const ANSI = new RegExp(
  `${ESC}\\[[0-9;?]*[ -/]*[@-~]|${ESC}\\][^${BEL}]*${BEL}|${ESC}[()][A-Z0-9]`,
  'g',
);

/** Strips ANSI escape sequences so screen text can be matched. */
function plain(s: string): string {
  return s.replace(ANSI, '');
}

function spawnTui() {
  const term = pty.spawn(process.execPath, ['--no-deprecation', CLI_ENTRY], {
    name: 'xterm-256color',
    cols: 120,
    rows: 40,
    cwd: env.repo,
    env: {
      PATH: process.env['PATH'] ?? '',
      HOME: env.home,
      CAPRICORN_OLLAMA_HOST: env.mock.url,
      GEMINI_CLI_NO_RELAUNCH: 'true',
      GEMINI_CLI_TRUST_WORKSPACE: 'true',
      TERM: 'xterm-256color',
    },
  });
  let screen = '';
  term.onData((d) => (screen += d));
  let exitCode: number | undefined;
  const exited = new Promise<number>((resolve) =>
    term.onExit(({ exitCode: c }) => {
      exitCode = c;
      resolve(c);
    }),
  );
  const waitFor = async (re: RegExp, timeoutMs = 30_000) => {
    const start = Date.now();
    while (!re.test(plain(screen))) {
      if (exitCode !== undefined)
        throw new Error(
          `TUI exited (${exitCode}) before ${re}:\n${plain(screen).slice(-1500)}`,
        );
      if (Date.now() - start > timeoutMs)
        throw new Error(
          `Timed out waiting for ${re}:\n${plain(screen).slice(-1500)}`,
        );
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  return { term, waitFor, exited, screen: () => plain(screen) };
}

describe('interactive UI', () => {
  it('starts, answers a prompt from the local model, and exits on Ctrl+C', async () => {
    env.mock.enqueueChat({
      frames: [
        textFrame('Greetings from '),
        textFrame('local Gemma.'),
        doneFrame(),
      ],
    });
    const tui = spawnTui();
    // Startup: the input prompt is ready.
    await tui.waitFor(/Type your message/i);
    expect(tui.screen()).not.toMatch(
      /Gemini CLI|Sign in with Google|GEMINI_API_KEY/,
    );

    tui.term.write('hello there');
    await new Promise((r) => setTimeout(r, 300));
    tui.term.write('\r');
    await tui.waitFor(/Greetings from local Gemma\./);
    const chat = env.mock
      .chatRequests()
      .find((r) => JSON.stringify(r.body).includes('hello there'));
    expect(chat).toBeDefined();

    // Ctrl+C twice is the documented exit gesture.
    tui.term.write('\x03');
    await new Promise((r) => setTimeout(r, 300));
    tui.term.write('\x03');
    const code = await Promise.race([
      tui.exited,
      new Promise<number>((r) => setTimeout(() => r(-1), 15_000)),
    ]);
    expect(code).not.toBe(-1);
  }, 90_000);
});
