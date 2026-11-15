/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
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
 *
 * First run (no verified Gemma 4 model installed): the preflight describes
 * the machine, recommends a preset that fits it (see `recommend.ts`) and,
 * interactively, offers to download it. The offer defaults to "no": it is a
 * multi-GB download by the Ollama daemon, so it needs an explicit "y". After
 * the download the model is loaded once, so a model this Ollama cannot run is
 * reported before the session starts.
 */

import {
  OllamaClient,
  OllamaError,
  createWorkingStdio,
  discoverModels,
  selectModel,
  writeToStderr,
  type Config,
} from '@capricorn/core';
import { detectHardware, type HardwareProfile } from './hardware.js';
import { pullAndVerify, testLoad } from './modelPull.js';
import { recommendModel } from './recommend.js';
import { formatGiB } from './runtime.js';
import {
  fetchMemoryProfile,
  formatTokens,
  suggestContext,
  type ContextSuggestion,
} from './contextSize.js';

/** Outcome of the preflight. */
export type PreflightResult =
  | { ok: true; model: string; switched: boolean }
  | { ok: false; message: string; exitCode: number };

/**
 * Asks a yes/no question; resolves true for "yes". An empty answer means
 * `defaultYes` (true unless stated). Injected for tests.
 */
export type Confirm = (
  question: string,
  options?: { defaultYes?: boolean },
) => Promise<boolean>;

/**
 * Runs the preflight against the session config.
 *
 * @param config The loaded session config (model + Ollama settings).
 * @param options.interactive Whether a human can answer questions.
 * @param options.confirm Prompt implementation (readline in production).
 * @param options.client Injected client for tests.
 * @param options.detectHardware Injected hardware detection for tests.
 * @param options.log Progress and notices (stderr in production).
 */
export async function runPreflight(
  config: Config,
  options: {
    interactive: boolean;
    confirm?: Confirm;
    client?: OllamaClient;
    detectHardware?: () => Promise<HardwareProfile>;
    log?: (line: string) => void;
    /**
     * Whether the user set `ollama.numCtx` themselves; onboarding then never
     * changes it.
     */
    numCtxConfigured?: boolean;
  },
): Promise<PreflightResult> {
  // writeToStderr, not process.stderr: startup has already patched stdio
  // (patchStdio in gemini.tsx), and patched writes never reach the terminal.
  const log = options.log ?? ((line: string) => writeToStderr(`${line}\n`));
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
    return firstRun(config, client, requested, selection.reason, {
      ...options,
      log,
    });
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

/**
 * No verified Gemma 4 model is installed: recommend one for this machine
 * and, interactively and only with consent, pull it for this session.
 */
async function firstRun(
  config: Config,
  client: OllamaClient,
  requested: string,
  reason: string,
  options: {
    interactive: boolean;
    confirm?: Confirm;
    detectHardware?: () => Promise<HardwareProfile>;
    log: (line: string) => void;
    numCtxConfigured?: boolean;
  },
): Promise<PreflightResult> {
  const hw = await (options.detectHardware ?? detectHardware)();
  const rec = recommendModel(hw);
  const intro =
    `${reason}\nNo verified Gemma 4 model is installed in Ollama at ${client.baseUrl}.\n` +
    `This machine: ${rec.hardware}.\n`;
  if (!rec.tag) {
    return {
      ok: false,
      exitCode: 1,
      message:
        intro +
        `${rec.reason}\nYou can still try: capricorn models pull gemma4:e2b`,
    };
  }
  const where = rec.placement === 'gpu' ? 'on the GPU' : 'on the CPU';
  const recommendation =
    `Recommended: ${rec.tag} (runs ${where}). ${rec.reason}` +
    (rec.alsoFits.length
      ? `\nAlso fits, not yet evaluated with Capricorn: ${rec.alsoFits.join(', ')}.`
      : '');

  if (!options.interactive || !options.confirm) {
    return {
      ok: false,
      exitCode: 1,
      message:
        intro +
        recommendation +
        `\nInstall it with:  capricorn models pull ${rec.tag}\nThen run:  capricorn doctor`,
    };
  }

  const yes = await options.confirm(
    intro +
      recommendation +
      `\nDownload ${rec.tag} now? The Ollama daemon fetches it from the Ollama registry (several GB). [y/N] `,
    { defaultYes: false },
  );
  if (!yes) {
    return {
      ok: false,
      exitCode: 1,
      message: `No model downloaded. Install one with:  capricorn models pull ${rec.tag}`,
    };
  }
  let verdict;
  try {
    verdict = await pullAndVerify(client, rec.tag, options.log);
  } catch (e) {
    return fail(e, 1);
  }
  if (!verdict.allowed) {
    return {
      ok: false,
      exitCode: 1,
      message: `Pulled ${rec.tag}, but it is NOT usable: ${verdict.detail}`,
    };
  }
  const settings = config.getOllamaSettings();
  let numCtx = verdict.maxContextLength
    ? Math.min(settings.numCtx, verdict.maxContextLength)
    : settings.numCtx;

  // Size the context window for this machine, unless the user chose one.
  // Only for this session, like the model itself; the log says how to keep
  // it. Any failure here just keeps the configured window.
  let loaded = false;
  if (!options.numCtxConfigured) {
    const suggestion = await suggestionFor(
      client,
      rec.tag,
      hw,
      verdict.maxContextLength,
    );
    if (suggestion && suggestion.numCtx !== numCtx) {
      options.log(
        `Checking that Ollama can load ${rec.tag} with a ${formatTokens(suggestion.numCtx)} context...`,
      );
      if ((await testLoad(client, rec.tag, suggestion.numCtx)) === undefined) {
        options.log(contextNote(suggestion, numCtx));
        settings.numCtx = suggestion.numCtx;
        numCtx = suggestion.numCtx;
        loaded = true;
      } else {
        options.log(
          `It did not load with ${formatTokens(suggestion.numCtx)}; keeping ${formatTokens(numCtx)}.`,
        );
      }
    }
  }

  if (!loaded) options.log(`Checking that Ollama can load ${rec.tag}...`);
  const loadError = loaded
    ? undefined
    : await testLoad(client, rec.tag, numCtx);
  if (loadError) {
    return {
      ok: false,
      exitCode: 1,
      message:
        `Downloaded ${rec.tag}, but Ollama could not load it (num_ctx ${numCtx}): ${loadError}\n` +
        '→ Update Ollama (newer Gemma 4 builds may need a newer daemon), lower `ollama.numCtx`, ' +
        'or try another model: `capricorn models list` shows the presets.',
    };
  }
  config.setModel(rec.tag, true);
  if (rec.tag !== requested) {
    options.log(
      `Using ${rec.tag} for this session. Make it the default with:  capricorn models use ${rec.tag}`,
    );
  }
  return { ok: true, model: rec.tag, switched: rec.tag !== requested };
}

/** The window suggestion for a freshly pulled tag; undefined on any error. */
async function suggestionFor(
  client: OllamaClient,
  tag: string,
  hw: HardwareProfile,
  maxContextLength: number | undefined,
): Promise<ContextSuggestion | undefined> {
  try {
    const profile = await fetchMemoryProfile(client, tag);
    const s = profile && suggestContext(profile, hw, maxContextLength);
    // Nothing fits: a smaller window would not help; keep the configured one.
    return s && s.placement !== 'none' ? s : undefined;
  } catch {
    return undefined;
  }
}

/** One line explaining the window chosen for this session. */
function contextNote(s: ContextSuggestion, previous: number): string {
  const where =
    s.placement === 'gpu'
      ? `keeps the model on the GPU, ≈${formatGiB(s.estimateBytes)} of ${formatGiB(s.budgetBytes)}`
      : `fits in RAM, ≈${formatGiB(s.estimateBytes)} of ${formatGiB(s.budgetBytes)}`;
  return (
    `Context window for this session: ${formatTokens(s.numCtx)} tokens instead of ${formatTokens(previous)} (${where}; approximate).
` + `Keep it with:  capricorn config set ollama.numCtx ${s.numCtx}`
  );
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

/**
 * Readline-based confirmation on stderr (keeps stdout clean). Uses the real
 * stderr: by the time the preflight runs, process.stderr is patched and the
 * question would otherwise be invisible (as upstream's auth consent prompt).
 */
export const readlineConfirm: Confirm = async (question, options) => {
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({
    input: process.stdin,
    output: createWorkingStdio().stderr,
  });
  try {
    const answer = (await rl.question(question)).trim();
    if (answer === '') return options?.defaultYes ?? true;
    return /^y(es)?$/i.test(answer);
  } finally {
    rl.close();
  }
};
