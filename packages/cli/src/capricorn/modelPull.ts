/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Pull a Gemma 4 model through the local Ollama daemon, with
 * progress and Ctrl+C cancellation, then verify what was installed. Shared by
 * `capricorn models pull` and the first-run offer in the session preflight.
 *
 * The download is done by the Ollama daemon from its registry; Capricorn
 * itself only talks to the (loopback) daemon. Callers must have the user's
 * explicit consent before calling this: it can transfer several GB.
 */

import {
  OllamaError,
  prefilterTagModel,
  verifyGemma4Model,
  type ModelVerdict,
  type OllamaClient,
} from '@google/gemini-cli-core';

/**
 * Whether a tag may be pulled at all. Refuses cloud tags and non-Gemma-4
 * names *before* triggering a download; the authoritative check still runs
 * on the installed metadata afterwards.
 */
export function isPullableTag(tag: string): boolean {
  return (
    !prefilterTagModel({ name: tag }) &&
    /^gemma4[:/]?/i.test(tag.split('/').pop() ?? '')
  );
}

/**
 * Pulls `tag`, reporting de-duplicated progress lines to `log`, and returns
 * the verification verdict of the installed model. Ctrl+C (SIGINT) cancels
 * the download. Throws Ollama errors (unreachable daemon, unknown tag,
 * cancellation) to the caller.
 *
 * @param client Client for the configured local daemon.
 * @param tag A tag accepted by {@link isPullableTag}.
 * @param log Receives human-readable progress lines (e.g. stderr).
 */
export async function pullAndVerify(
  client: OllamaClient,
  tag: string,
  log: (line: string) => void,
): Promise<ModelVerdict> {
  if (!isPullableTag(tag)) {
    throw new Error(
      `Refusing to pull "${tag}": Capricorn only runs local Gemma 4 models.`,
    );
  }
  const ac = new AbortController();
  const onSigint = () => ac.abort();
  process.once('SIGINT', onSigint);
  try {
    log(`Pulling ${tag} via Ollama at ${client.baseUrl} (Ctrl+C to cancel)...`);
    let lastLine = '';
    for await (const p of client.pullModel(tag, ac.signal)) {
      const pct =
        p.total && p.completed !== undefined
          ? ` ${Math.floor((p.completed / p.total) * 100)}%`
          : '';
      const line = `${p.status ?? ''}${pct}`;
      // Ollama repeats a status line for every chunk; show changes only.
      if (line !== lastLine) {
        log(`  ${line}`);
        lastLine = line;
      }
    }
    return verifyGemma4Model(tag, await client.showModel(tag));
  } finally {
    process.off('SIGINT', onSigint);
  }
}

/**
 * Asks Ollama to load `tag` (a chat request with no messages loads the model
 * without generating anything) at the context size the session will use.
 *
 * Why: a model can download and pass verification yet still fail to load,
 * e.g. a Gemma 4 build that needs a newer Ollama, or a context too large for
 * memory. Checking right after a first-run download reports that at once,
 * instead of as an error on the user's first prompt.
 *
 * @returns undefined when the model loaded, otherwise Ollama's error text.
 */
export async function testLoad(
  client: OllamaClient,
  tag: string,
  numCtx: number,
): Promise<string | undefined> {
  try {
    await client.chat({
      model: tag,
      messages: [],
      stream: false,
      options: { num_ctx: numCtx },
    });
    return undefined;
  } catch (e) {
    return e instanceof OllamaError || e instanceof Error
      ? e.message
      : String(e);
  }
}
