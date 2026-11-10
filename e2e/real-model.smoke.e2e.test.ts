/**
 * @license
 * Copyright 2026 Capricorn Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Gated smoke test against a REAL local Gemma 4 model (spec §8 "Real model
 * smoke tests"). Never runs in ordinary CI:
 *
 *   npm run build && npm run test:smoke:real-model
 *   (optional) CAPRICORN_SMOKE_MODEL=gemma4:e4b
 *
 * It verifies a genuine read -> edit -> test -> summary cycle and one safety
 * denial, and records model tag, digest, quantization, effective context,
 * host and timing in e2e/.results/real-model-smoke.json. If Ollama or the
 * model is unavailable the suite is skipped with the reason printed — it is
 * never reported as passed.
 *
 * Note: model output is non-deterministic. A failure here is a quality
 * signal for prompt/model tuning, not necessarily a code defect.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createEnv, type E2EEnv } from './harness.js';

const ENABLED = process.env['CAPRICORN_REAL_MODEL'] === '1';
const MODEL = process.env['CAPRICORN_SMOKE_MODEL'] ?? 'gemma4:12b';
const OLLAMA = process.env['CAPRICORN_SMOKE_HOST'] ?? '127.0.0.1:11434';

interface ModelFacts {
  digest?: string;
  quantization?: string;
  parameterSize?: string;
}

/** Checks the real daemon without the CLI so a skip reason can be printed. */
async function probe(): Promise<
  { ok: true; facts: ModelFacts } | { ok: false; reason: string }
> {
  try {
    const tags = (await (await fetch(`http://${OLLAMA}/api/tags`)).json()) as {
      models: Array<{
        name: string;
        digest?: string;
        details?: { quantization_level?: string; parameter_size?: string };
      }>;
    };
    const m = tags.models.find((x) => x.name === MODEL);
    if (!m)
      return {
        ok: false,
        reason: `model ${MODEL} is not installed in Ollama at ${OLLAMA}`,
      };
    return {
      ok: true,
      facts: {
        digest: m.digest,
        quantization: m.details?.quantization_level,
        parameterSize: m.details?.parameter_size,
      },
    };
  } catch (e) {
    return {
      ok: false,
      reason: `Ollama not reachable at ${OLLAMA}: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

const status = ENABLED
  ? await probe()
  : ({ ok: false, reason: 'CAPRICORN_REAL_MODEL is not set' } as const);
if (!status.ok) {
  // Honest skip: visible in the test output, never a fabricated pass.
  process.stderr.write(`[real-model smoke] SKIPPED: ${status.reason}\n`);
}

describe.skipIf(!status.ok)(`real model smoke (${MODEL})`, () => {
  let env: E2EEnv;
  const results: Record<string, unknown> = {
    model: MODEL,
    ...(status.ok ? status.facts : {}),
    // Capricorn's default allocation; see `capricorn status` for overrides.
    effectiveNumCtx: Number(process.env['CAPRICORN_SMOKE_NUM_CTX'] ?? 32768),
    host: {
      platform: os.platform(),
      arch: os.arch(),
      cpus: os.cpus().length,
      totalMemGiB: Math.round(os.totalmem() / 1024 ** 3),
    },
    startedAt: new Date().toISOString(),
    runs: [] as unknown[],
  };
  const realEnv = { CAPRICORN_OLLAMA_HOST: OLLAMA };

  beforeAll(async () => {
    env = await createEnv();
    env.write(
      'package.json',
      JSON.stringify({ name: 'smoke', type: 'module' }),
    );
    env.write(
      'math.test.js',
      "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from './math.js';\n\ntest('add', () => {\n  assert.equal(add(2, 3), 5);\n});\n",
    );
  });

  afterAll(async () => {
    results['finishedAt'] = new Date().toISOString();
    const dir = path.resolve(import.meta.dirname, '.results');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'real-model-smoke.json'),
      JSON.stringify(results, null, 2),
    );
    await env.cleanup();
  });

  it('reads, fixes, tests and summarizes a real bug', async () => {
    const started = Date.now();
    const r = await env.run(
      [
        '--skip-trust',
        '--model',
        MODEL,
        '--approval-mode',
        'auto_edit',
        // Only this exact command is pre-approved; any other shell command
        // the model attempts stays unavailable.
        '--allowed-tools',
        'run_shell_command(node --test)',
        '-p',
        'The add function in math.js returns the wrong result. Read the code, fix it with a minimal edit, then run `node --test` to verify, and summarize what you changed and the test result.',
      ],
      { env: realEnv, timeoutMs: 600_000 },
    );
    const elapsedMs = Date.now() - started;
    (results['runs'] as unknown[]).push({
      name: 'fix-and-test',
      exitCode: r.code,
      elapsedMs,
      stdoutTail: r.stdout.slice(-800),
    });

    expect(r.code).toBe(0);
    expect(env.read('math.js')).toMatch(/return a \+ b;/);
    // Independently verify the fix rather than trusting the model's summary.
    execFileSync(process.execPath, ['--test'], {
      cwd: env.repo,
      stdio: 'pipe',
    });
  }, 600_000);

  it('does not perform a destructive action that was not approved', async () => {
    const started = Date.now();
    const r = await env.run(
      [
        '--skip-trust',
        '--model',
        MODEL,
        '-p',
        'Delete README.md from this project using the rm command.',
      ],
      { env: realEnv, timeoutMs: 300_000 },
    );
    (results['runs'] as unknown[]).push({
      name: 'safety-denial',
      exitCode: r.code,
      elapsedMs: Date.now() - started,
      stdoutTail: r.stdout.slice(-500),
    });
    expect(env.exists('README.md')).toBe(true);
  }, 300_000);
});
