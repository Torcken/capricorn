/**
 * @license
 * Copyright 2026 Capricorn Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Session preflight: confirms the local Ollama daemon is
 * reachable and the selected model is an installed, verified Gemma 4 model
 * *before* the interactive UI or a headless run starts.
 *
 * Failing early with a specific message ("Ollama is not running at …",
 * "gemma4:12b is not installed; installed: …") is far more useful than a
 * generic stream error on the first prompt.
 *
 * Model substitution is never silent (spec §4.1): interactively the user is
 * asked; headless runs fail and print the alternatives.
 */

import {
  OllamaClient,
  OllamaError,
  discoverModels,
  selectModel,
  type Config,
} from '@google/gemini-cli-core';

/** Outcome of the preflight. */
export type PreflightResult =
  | { ok: true; model: string; switched: boolean }
  | { ok: false; message: string; exitCode: number };

/** Asks a yes/no question; resolves true for "yes". Injected for tests. */
export type Confirm = (question: string) => Promise<boolean>;

/**
 * Runs the preflight against the session config.
 *
 * @param config The loaded session config (model + Ollama settings).
 * @param options.interactive Whether a human can answer questions.
 * @param options.confirm Prompt implementation (readline in production).
 * @param options.client Injected client for tests.
 */
export async function runPreflight(
  config: Config,
  options: { interactive: boolean; confirm?: Confirm; client?: OllamaClient },
): Promise<PreflightResult> {
  const s = config.getOllamaSettings();
  let client: OllamaClient;
  try {
    client =
      options.client ??
      new OllamaClient({
        endpoint: s.endpoint,
        allowRemoteHost: s.allowRemoteHost,
        metadataTimeoutMs: 5000,
      });
  } catch (e) {
    return fail(e, 2);
  }

  let models;
  try {
    models = await discoverModels(client);
  } catch (e) {
    return fail(e, 1);
  }

  const requested = config.getModel();
  const selection = selectModel(models, requested);
  if (selection.kind === 'selected') {
    // Use the installed spelling (e.g. "gemma4" -> "gemma4:latest").
    if (selection.model.model !== requested)
      config.setModel(selection.model.model, true);
    return { ok: true, model: selection.model.model, switched: false };
  }

  const alternatives = selection.alternatives.map((a) => a.model);
  if (alternatives.length === 0) {
    return {
      ok: false,
      exitCode: 1,
      message:
        `${selection.reason}\nNo verified Gemma 4 model is installed in Ollama at ${client.baseUrl}.\n` +
        'Install one, e.g.:  capricorn models pull gemma4:e4b   (or gemma4:12b)\nThen run:  capricorn doctor',
    };
  }

  if (options.interactive && options.confirm) {
    const candidate = alternatives[0];
    const yes = await options.confirm(
      `${selection.reason}\nUse the installed model "${candidate}" for this session instead? [Y/n] `,
    );
    if (yes) {
      config.setModel(candidate, true);
      return { ok: true, model: candidate, switched: true };
    }
  }
  return {
    ok: false,
    exitCode: 1,
    message:
      `${selection.reason}\nInstalled Gemma 4 models: ${alternatives.join(', ')}\n` +
      `Choose one with --model <tag> or \`capricorn models use <tag>\`.`,
  };
}

function fail(e: unknown, exitCode: number): PreflightResult {
  if (e instanceof OllamaError) {
    return { ok: false, exitCode, message: `${e.message}\n→ ${e.remediation}` };
  }
  return {
    ok: false,
    exitCode,
    message: e instanceof Error ? e.message : String(e),
  };
}

/** Readline-based confirmation on stderr (keeps stdout clean). */
export const readlineConfirm: Confirm = async (question) => {
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = (await rl.question(question)).trim();
    return answer === '' || /^y(es)?$/i.test(answer);
  } finally {
    rl.close();
  }
};
