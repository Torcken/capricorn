/**
 * @license
 * Copyright 2026 Capricorn Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Gated end-to-end test of the container sandbox (`--sandbox`) with the mock
 * Ollama daemon. Needs a container runtime and the locally built image, so it
 * never runs in ordinary CI:
 *
 *   npm run build && npm run build:sandbox
 *   CAPRICORN_SANDBOX_E2E=podman npm run test:e2e:sandbox   (or =docker)
 *
 * It proves the whole chain: the host CLI starts the filtered Ollama bridge,
 * re-launches itself in the container on the internal (network-off) network,
 * and the in-container CLI verifies the model and streams a reply through the
 * bridge from a daemon on a *random* host port, i.e. not by accident via a
 * default-port daemon.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { createEnv, type E2EEnv } from './harness.js';
import {
  doneFrame,
  textFrame,
} from '../packages/core/src/providers/ollama/testing/mockOllamaServer.js';

const RUNTIME = process.env['CAPRICORN_SANDBOX_E2E'];
const IMAGE = 'capricorn-sandbox:local';

/** Returns a skip reason, or undefined when the test can run. */
function skipReason(): string | undefined {
  if (!RUNTIME) return 'set CAPRICORN_SANDBOX_E2E=podman|docker to run';
  try {
    const id = execFileSync(RUNTIME, ['images', '-q', IMAGE], {
      encoding: 'utf8',
    }).trim();
    if (!id) return `${IMAGE} not built (npm run build:sandbox)`;
  } catch (e) {
    return `${RUNTIME} unavailable: ${(e as Error).message}`;
  }
  return undefined;
}

const reason = skipReason();
if (reason) {
  // Make the skip visible instead of silently "passing".
  console.warn(`[sandbox e2e] skipped: ${reason}`);
}

describe.skipIf(reason !== undefined)('container sandbox (gated)', () => {
  let env: E2EEnv;

  beforeEach(async () => {
    env = await createEnv();
  });
  afterEach(async () => {
    await env.cleanup();
  });

  it('runs a prompt inside the sandbox through the host Ollama bridge', async () => {
    env.mock.enqueueChat({
      frames: [textFrame('reply from inside the sandbox'), doneFrame()],
    });
    const res = await env.run(['--sandbox', '--skip-trust', '-p', 'hello'], {
      timeoutMs: 180_000,
      env: {
        GEMINI_SANDBOX: RUNTIME!,
        // Rootless container runtimes keep their image store under the real
        // HOME, so keep it and isolate Capricorn's own state instead.
        HOME: os.homedir(),
        CAPRICORN_HOME: env.home,
        XDG_RUNTIME_DIR: process.env['XDG_RUNTIME_DIR'] ?? '',
        // The sandbox re-launch must happen for this test.
        GEMINI_CLI_NO_RELAUNCH: '',
      },
    });

    expect(res.stderr).not.toMatch(/EACCES|Fatal/);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('reply from inside the sandbox');
    // The in-container CLI reached the random-port mock: verification and the
    // chat went through the bridge.
    const paths = env.mock.requests.map((r) => r.path);
    expect(paths).toContain('/api/show');
    expect(env.mock.chatRequests().length).toBeGreaterThan(0);
    // Nothing tried model management through the bridge.
    expect(paths.some((p) => /pull|push|delete|create/.test(p))).toBe(false);
  }, 240_000);
});
