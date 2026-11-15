/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Environment diagnostics behind `capricorn doctor` and the
 * interactive startup check.
 *
 * Each check returns a structured {@link DiagnosticCheck} rather than
 * printing, so the same results feed human output, `--json` output and tests.
 * Checks never throw: an unexpected exception becomes a failed check with the
 * error message, because a diagnostic tool that crashes is useless exactly
 * when the user needs it.
 *
 * Privacy: diagnostics only contact the configured Ollama endpoint (loopback
 * by default) and read local hardware facts (RAM, `nvidia-smi`, sysfs).
 * Nothing is uploaded; output never includes prompt or file contents.
 */

import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  GEMINI_DIR,
  OllamaError,
  discoverModels,
  homedir,
  isEgressGuardInstalled,
  selectModel,
  GEMMA4_PRESETS,
  type DiscoveredModel,
  type OllamaClient,
} from '@google/gemini-cli-core';
import type { CapricornRuntime } from './runtime.js';
import { detectHardware, type HardwareProfile } from './hardware.js';
import { placementFor, recommendModel } from './recommend.js';
import { formatGiB } from './runtime.js';
import {
  estimateMemoryBytes,
  fetchMemoryProfile,
  formatTokens,
  suggestContext,
} from './contextSize.js';

/** Outcome severity. `fail` makes `doctor` exit non-zero. */
export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

/** One diagnostic result. `id` values are a stable public contract. */
export interface DiagnosticCheck {
  id: string;
  title: string;
  status: CheckStatus;
  message: string;
  remediation?: string;
  data?: Record<string, unknown>;
}

/** Complete report as emitted by `doctor --json`. */
export interface DiagnosticReport {
  ok: boolean;
  capricornVersion: string;
  checks: DiagnosticCheck[];
  models: DiscoveredModel[];
}

/** Minimum Node.js major version (matches `engines.node`). */
export const MIN_NODE_MAJOR = 20;

/**
 * Minimum Ollama version Capricorn is tested against. Older daemons may lack
 * Gemma 4 support or streamed tool calls; this is a warning, not a failure,
 * because the authoritative test is model verification.
 */
export const MIN_OLLAMA_VERSION = '0.12.0';

/** Inputs for {@link runDiagnostics}; injectable for tests. */
export interface DiagnosticsInput {
  runtime: CapricornRuntime;
  client: OllamaClient | undefined;
  /** Error from constructing the client (endpoint policy violation). */
  clientError?: unknown;
  version: string;
  cwd: string;
  /** Whether the current folder is trusted, if known. */
  workspaceTrusted?: boolean;
  /**
   * Also load the selected model in Ollama (`doctor --load`). Opt-in: it can
   * take minutes and several GB of memory.
   */
  loadModel?: boolean;
  signal?: AbortSignal;
  /** Hardware profile; detected from the system when omitted. */
  hardware?: HardwareProfile;
}

/**
 * Runs every check in dependency order (model checks only run if the daemon
 * answered).
 */
export async function runDiagnostics(
  input: DiagnosticsInput,
): Promise<DiagnosticReport> {
  const checks: DiagnosticCheck[] = [];
  let models: DiscoveredModel[] = [];

  checks.push(checkNode());
  checks.push(checkSystemMemory());
  // Detected once: the hardware and context-window checks both use it.
  let hw: HardwareProfile | undefined = input.hardware;
  checks.push(
    await safe('runtime.hardware', 'Hardware & model fit', async () => {
      hw ??= await detectHardware();
      return checkHardware(hw, input.runtime);
    }),
  );
  checks.push(checkEndpointPolicy(input));

  let daemonOk = false;
  if (input.client) {
    const daemon = await safe('ollama.daemon', 'Ollama daemon', () =>
      checkDaemon(input.client!, input.signal),
    );
    checks.push(daemon);
    daemonOk = daemon.status === 'pass' || daemon.status === 'warn';
  }

  if (daemonOk && input.client) {
    let discoveryError: unknown;
    try {
      models = await discoverModels(input.client, input.signal);
    } catch (e) {
      discoveryError = e;
    }
    checks.push(checkInstalledModels(models, discoveryError));
    checks.push(checkSelectedModel(models, input.runtime, discoveryError));
    checks.push(
      await safe('models.context', 'Context window', () =>
        checkContextWindow(
          models,
          input.runtime,
          hw,
          input.client!,
          input.signal,
        ),
      ),
    );
    if (input.loadModel) {
      checks.push(
        await safe('models.load', 'Model load', () =>
          checkModelLoad(input.client!, models, input.runtime, input.signal),
        ),
      );
    }
  } else {
    for (const [id, title] of [
      ['models.installed', 'Gemma 4 models'],
      ['models.selected', 'Selected model'],
      ['models.context', 'Context window'],
      ...(input.loadModel ? [['models.load', 'Model load'] as const] : []),
    ] as const) {
      checks.push({
        id,
        title,
        status: 'skip',
        message: 'Skipped: Ollama is not reachable.',
      });
    }
  }

  checks.push(checkEgressGuard());
  checks.push(checkStateDir());
  checks.push(checkWorkspace(input));
  checks.push(
    checkTool(
      'tools.git',
      'git',
      ['--version'],
      'Git integration (status/diff/checkpoints) is unavailable.',
    ),
  );
  checks.push(
    checkTool(
      'tools.ripgrep',
      'rg',
      ['--version'],
      'Search falls back to the slower built-in grep.',
    ),
  );

  return {
    ok: !checks.some((c) => c.status === 'fail'),
    capricornVersion: input.version,
    checks,
    models,
  };
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

function checkNode(): DiagnosticCheck {
  const major = Number(process.versions.node.split('.')[0]);
  return major >= MIN_NODE_MAJOR
    ? {
        id: 'runtime.node',
        title: 'Node.js',
        status: 'pass',
        message: `Node.js ${process.versions.node}`,
      }
    : {
        id: 'runtime.node',
        title: 'Node.js',
        status: 'fail',
        message: `Node.js ${process.versions.node} is too old.`,
        remediation: `Install Node.js ${MIN_NODE_MAJOR} or newer.`,
      };
}

function checkSystemMemory(): DiagnosticCheck {
  const total = os.totalmem();
  const free = os.freemem();
  return {
    id: 'runtime.memory',
    title: 'System memory',
    status: total < 8 * 1024 ** 3 ? 'warn' : 'pass',
    message: `${formatGiB(total)} total, ${formatGiB(free)} free (${os.platform()} ${os.arch()}, ${os.cpus().length} CPUs)`,
    remediation:
      total < 8 * 1024 ** 3
        ? 'Less than 8 GiB RAM: use gemma4:e2b or gemma4:e4b with a small ollama.numCtx.'
        : undefined,
    data: {
      totalBytes: total,
      freeBytes: free,
      platform: os.platform(),
      arch: os.arch(),
    },
  };
}

/**
 * Recommends a model for this machine and warns when the selected preset
 * will not fit in GPU memory. Never fails: sizes are approximate, and a
 * model that does not fit still runs, only more slowly.
 */
function checkHardware(
  hw: HardwareProfile,
  runtime: CapricornRuntime,
): DiagnosticCheck {
  const rec = recommendModel(hw);
  const selected = runtime.settings.model;
  const fit = placementFor(hw, selected);
  const recText = rec.tag
    ? `recommended model: ${rec.tag} (${rec.placement === 'gpu' ? 'GPU' : 'CPU'})`
    : 'no Gemma 4 preset fits comfortably';
  const data = { hardware: hw, recommendation: rec, selectedFit: fit };
  if (fit && fit.placement !== 'gpu' && rec.placement === 'gpu') {
    return {
      id: 'runtime.hardware',
      title: 'Hardware & model fit',
      status: 'warn',
      message: `${rec.hardware}; ${recText}.`,
      remediation:
        fit.placement === 'cpu'
          ? `${selected} needs ≈${fit.approxMemoryGiB} GiB (approximate), more than GPU memory: it will run partly on the CPU and answer slowly. Consider ${rec.tag}.`
          : `${selected} needs ≈${fit.approxMemoryGiB} GiB (approximate), more than this machine has: it may fail to load. Consider ${rec.tag}.`,
      data,
    };
  }
  if (fit?.placement === 'none' || !rec.tag) {
    return {
      id: 'runtime.hardware',
      title: 'Hardware & model fit',
      status: 'warn',
      message: `${rec.hardware}; ${recText}.`,
      remediation:
        fit?.placement === 'none'
          ? `${selected} needs ≈${fit.approxMemoryGiB} GiB (approximate), more than this machine has: it may fail to load.${rec.tag ? ` Consider ${rec.tag}.` : ''}`
          : rec.reason,
      data,
    };
  }
  return {
    id: 'runtime.hardware',
    title: 'Hardware & model fit',
    status: 'pass',
    message: `${rec.hardware}; ${recText}.`,
    data,
  };
}

function checkEndpointPolicy(input: DiagnosticsInput): DiagnosticCheck {
  const { runtime } = input;
  if (input.clientError) {
    const msg =
      input.clientError instanceof Error
        ? input.clientError.message
        : String(input.clientError);
    return {
      id: 'ollama.endpoint',
      title: 'Ollama endpoint',
      status: 'fail',
      message: msg,
      remediation:
        input.clientError instanceof OllamaError
          ? input.clientError.remediation
          : undefined,
      data: {
        endpoint: runtime.settings.endpoint,
        source: runtime.endpointSource,
      },
    };
  }
  const client = input.client!;
  return {
    id: 'ollama.endpoint',
    title: 'Ollama endpoint',
    status: client.isLoopback ? 'pass' : 'warn',
    message: client.isLoopback
      ? `${client.baseUrl} (local, from ${runtime.endpointSource})`
      : `${client.baseUrl} — REMOTE HOST: prompts and code leave this machine (opted in via user settings).`,
    data: {
      endpoint: client.baseUrl,
      local: client.isLoopback,
      source: runtime.endpointSource,
    },
  };
}

async function checkDaemon(
  client: OllamaClient,
  signal?: AbortSignal,
): Promise<DiagnosticCheck> {
  try {
    const version = await client.version(signal);
    const old = compareVersions(version, MIN_OLLAMA_VERSION) < 0;
    return {
      id: 'ollama.daemon',
      title: 'Ollama daemon',
      status: old ? 'warn' : 'pass',
      message: `Ollama ${version} is running.`,
      remediation: old
        ? `Capricorn is tested with Ollama >= ${MIN_OLLAMA_VERSION}; update Ollama.`
        : undefined,
      data: { version },
    };
  } catch (e) {
    const err = e instanceof OllamaError ? e : undefined;
    return {
      id: 'ollama.daemon',
      title: 'Ollama daemon',
      status: 'fail',
      message: e instanceof Error ? e.message : String(e),
      remediation:
        err?.remediation ??
        'Install Ollama from https://ollama.com/download and start it.',
      data: { kind: err?.kind },
    };
  }
}

function checkInstalledModels(
  models: DiscoveredModel[],
  error: unknown,
): DiagnosticCheck {
  if (error) {
    return {
      id: 'models.installed',
      title: 'Gemma 4 models',
      status: 'fail',
      message: `Could not list models: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const allowed = models.filter((m) => m.allowed);
  const rejected = models.length - allowed.length;
  if (allowed.length === 0) {
    return {
      id: 'models.installed',
      title: 'Gemma 4 models',
      status: 'fail',
      message: `No verified Gemma 4 model is installed (${models.length} other model(s) found).`,
      remediation: `Pull one, e.g. \`capricorn models pull gemma4:e4b\` (smaller) or \`capricorn models pull gemma4:12b\`.`,
    };
  }
  return {
    id: 'models.installed',
    title: 'Gemma 4 models',
    status: 'pass',
    message:
      `${allowed.map((m) => m.model).join(', ')}` +
      (rejected ? ` (${rejected} non-Gemma-4 or cloud model(s) ignored)` : ''),
    data: { allowed: allowed.map((m) => m.model) },
  };
}

function checkSelectedModel(
  models: DiscoveredModel[],
  runtime: CapricornRuntime,
  error: unknown,
): DiagnosticCheck {
  if (error) {
    return {
      id: 'models.selected',
      title: 'Selected model',
      status: 'skip',
      message: 'Skipped: model listing failed.',
    };
  }
  const selection = selectModel(models, runtime.settings.model);
  if (selection.kind === 'selected') {
    const m = selection.model;
    return {
      id: 'models.selected',
      title: 'Selected model',
      status: 'pass',
      message: `${m.model} (${[m.parameterSize, m.quantization].filter(Boolean).join(', ')}; from ${runtime.modelSource}) — ${m.detail}`,
      data: {
        model: m.model,
        source: runtime.modelSource,
        capabilities: m.capabilities,
      },
    };
  }
  return {
    id: 'models.selected',
    title: 'Selected model',
    status: 'fail',
    message: `${selection.reason}`,
    remediation: selection.alternatives.length
      ? `Use an installed model: \`capricorn models use ${selection.alternatives[0].model}\` (or pass --model).`
      : `Pull it: \`capricorn models pull ${selection.requested}\`.`,
    data: {
      requested: selection.requested,
      alternatives: selection.alternatives.map((a) => a.model),
    },
  };
}

/**
 * Loads the selected model once with the configured `num_ctx`.
 *
 * Metadata verification (`/api/show`) proves a tag *is* Gemma 4, not that this
 * Ollama build can *run* it: a newer GGUF layout can fail to load on an older
 * daemon (seen: "Gemma4Assistant requires ctx_other" on 0.30.11), and a large
 * `num_ctx` can exceed memory. A chat request with no messages makes Ollama
 * load the model without generating, which surfaces both failures here
 * instead of at the first prompt. The model stays loaded for the daemon's
 * normal keep-alive, so a session started right after does not reload it.
 */
async function checkModelLoad(
  client: OllamaClient,
  models: DiscoveredModel[],
  runtime: CapricornRuntime,
  signal?: AbortSignal,
): Promise<DiagnosticCheck> {
  const selection = selectModel(models, runtime.settings.model);
  if (selection.kind !== 'selected') {
    return {
      id: 'models.load',
      title: 'Model load',
      status: 'skip',
      message: 'Skipped: no usable model selected.',
    };
  }
  const tag = selection.model.model;
  const max = selection.model.maxContextLength;
  const numCtx = max
    ? Math.min(runtime.settings.numCtx, max)
    : runtime.settings.numCtx;
  const started = Date.now();
  try {
    await client.chat(
      {
        model: tag,
        messages: [],
        stream: false,
        options: { num_ctx: numCtx },
        ...(runtime.settings.keepAlive
          ? { keep_alive: runtime.settings.keepAlive }
          : {}),
      },
      signal,
    );
  } catch (e) {
    return {
      id: 'models.load',
      title: 'Model load',
      status: 'fail',
      message: `Ollama could not load ${tag} with num_ctx ${numCtx}: ${
        e instanceof OllamaError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e)
      }`,
      remediation:
        'Update Ollama (newer Gemma 4 builds may need a newer daemon), lower `ollama.numCtx`, or choose a smaller model with `capricorn models use <tag>`.',
      data: { model: tag, numCtx },
    };
  }
  const seconds = (Date.now() - started) / 1000;
  // /api/ps is informational only: a failure here must not fail the check.
  let footprint = '';
  let size: number | undefined;
  let sizeVram: number | undefined;
  try {
    const ps = await client.listRunning(signal);
    const entry = ps.models.find((m) => m.name === tag);
    size = entry?.size;
    sizeVram = entry?.size_vram;
    if (size) {
      const gpu = sizeVram ? Math.round((sizeVram / size) * 100) : 0;
      // Reported as Ollama's own figure: some builds report less than the
      // model's real footprint (seen on 0.30.11).
      footprint = `; Ollama reports ${formatGiB(size)} in use, ${gpu === 0 ? 'on CPU' : `${gpu}% on GPU`}`;
    }
  } catch {
    // ignore
  }
  return {
    id: 'models.load',
    title: 'Model load',
    status: 'pass',
    message: `${tag} loaded with num_ctx ${numCtx} in ${seconds.toFixed(1)} s${footprint}`,
    data: { model: tag, numCtx, seconds, size, sizeVram },
  };
}

async function checkContextWindow(
  models: DiscoveredModel[],
  runtime: CapricornRuntime,
  hw: HardwareProfile | undefined,
  client: OllamaClient,
  signal?: AbortSignal,
): Promise<DiagnosticCheck> {
  const selection = selectModel(models, runtime.settings.model);
  const numCtx = runtime.settings.numCtx;
  if (selection.kind !== 'selected') {
    return {
      id: 'models.context',
      title: 'Context window',
      status: 'skip',
      message: `num_ctx ${numCtx} (model not available).`,
    };
  }
  const max = selection.model.maxContextLength;
  const effective = max ? Math.min(numCtx, max) : numCtx;
  const preset = GEMMA4_PRESETS.find((p) => p.tag === selection.model.model);
  const parts = [
    `num_ctx ${effective.toLocaleString('en-US')} tokens allocated` +
      (max ? ` (model maximum ${max.toLocaleString('en-US')})` : ''),
  ];
  const overMax = numCtx > (max ?? Infinity);

  // Capricorn: size the window for this machine from the model's metadata
  // (see contextSize.ts). Without it, fall back to the preset estimate.
  const profile = hw
    ? await fetchMemoryProfile(client, selection.model.model, signal).catch(
        () => undefined,
      )
    : undefined;
  if (!profile || !hw) {
    if (preset)
      parts.push(
        `≈${preset.approxMemoryGiB} GiB resident at 32K (approximate)`,
      );
    return {
      id: 'models.context',
      title: 'Context window',
      status: overMax ? 'warn' : 'pass',
      message: parts.join('; '),
      remediation: overMax
        ? `ollama.numCtx exceeds the model maximum; ${max} will be used.`
        : undefined,
      data: { numCtx, effective, modelMax: max },
    };
  }

  const estimate = estimateMemoryBytes(profile, effective);
  const suggestion = suggestContext(profile, hw, max);
  const gpuBudget = suggestion.placement === 'gpu' ? suggestion.budgetBytes : 0;
  parts.push(`≈${formatGiB(estimate)} at this window (approximate)`);
  const data = {
    numCtx,
    effective,
    modelMax: max,
    estimateBytes: estimate,
    suggestion,
  };
  const setIt = `capricorn config set ollama.numCtx ${suggestion.numCtx}`;

  // The model would stay on the GPU with a smaller window, but not this one.
  if (gpuBudget > 0 && estimate > gpuBudget) {
    return {
      id: 'models.context',
      title: 'Context window',
      status: 'warn',
      message: parts.join('; '),
      remediation:
        `At this window the model needs more than the GPU's ${formatGiB(gpuBudget)} and runs partly on the CPU (slower). ` +
        `${formatTokens(suggestion.numCtx)} keeps it on the GPU:  ${setIt}`,
      data,
    };
  }
  if (overMax) {
    return {
      id: 'models.context',
      title: 'Context window',
      status: 'warn',
      message: parts.join('; '),
      remediation: `ollama.numCtx exceeds the model maximum; ${max} will be used.`,
      data,
    };
  }
  if (suggestion.placement !== 'none' && suggestion.numCtx > effective) {
    parts.push(
      `${formatTokens(suggestion.numCtx)} would also fit ${suggestion.placement === 'gpu' ? 'on the GPU' : 'in RAM'} (fewer history compressions; ${setIt})`,
    );
  }
  return {
    id: 'models.context',
    title: 'Context window',
    status: 'pass',
    message: parts.join('; '),
    data,
  };
}

function checkEgressGuard(): DiagnosticCheck {
  const installed = isEgressGuardInstalled();
  return {
    id: 'security.network',
    title: 'Network policy',
    status: installed ? 'pass' : 'warn',
    message: installed
      ? 'Outbound connections are limited to loopback and explicitly allowed hosts.'
      : 'Egress guard is not active in this process.',
  };
}

function checkStateDir(): DiagnosticCheck {
  const dir = path.join(homedir(), GEMINI_DIR);
  try {
    const st = fs.statSync(dir);
    // World/group-writable state dirs let other local users tamper with
    // settings, sessions and trust decisions.
    const loose = process.platform !== 'win32' && (st.mode & 0o022) !== 0;
    return {
      id: 'state.dir',
      title: 'State directory',
      status: loose ? 'warn' : 'pass',
      message: `${dir}${loose ? ' is writable by other users' : ''}`,
      remediation: loose ? `Run: chmod go-w ${dir}` : undefined,
    };
  } catch {
    return {
      id: 'state.dir',
      title: 'State directory',
      status: 'pass',
      message: `${dir} (will be created on first run)`,
    };
  }
}

function checkWorkspace(input: DiagnosticsInput): DiagnosticCheck {
  const instructions = fs.existsSync(path.join(input.cwd, 'CAPRICORN.md'));
  const legacy = fs.existsSync(path.join(input.cwd, 'GEMINI.md'));
  const notes = [
    input.cwd,
    instructions
      ? 'CAPRICORN.md found'
      : 'no CAPRICORN.md (run `capricorn init`)',
  ];
  if (legacy && !instructions)
    notes.push('GEMINI.md present but not read (see docs/CONFIGURATION.md)');
  if (input.workspaceTrusted === false) notes.push('folder not trusted');
  return {
    id: 'workspace',
    title: 'Workspace',
    status: input.workspaceTrusted === false ? 'warn' : 'pass',
    message: notes.join('; '),
  };
}

function checkTool(
  id: string,
  cmd: string,
  args: string[],
  missing: string,
): DiagnosticCheck {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 5000 });
  if (r.status === 0) {
    return {
      id,
      title: cmd,
      status: 'pass',
      message: (r.stdout || '').split('\n')[0].trim(),
    };
  }
  return {
    id,
    title: cmd,
    status: 'warn',
    message: `${cmd} not found.`,
    remediation: missing,
  };
}

/** Runs a check, converting unexpected exceptions into a failed result. */
async function safe(
  id: string,
  title: string,
  fn: () => Promise<DiagnosticCheck>,
): Promise<DiagnosticCheck> {
  try {
    return await fn();
  } catch (e) {
    return {
      id,
      title,
      status: 'fail',
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Numeric dotted-version comparison; non-numeric suffixes are ignored. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const ICON: Record<CheckStatus, string> = {
  pass: '✓',
  warn: '!',
  fail: '✗',
  skip: '-',
};

/** Plain-text rendering (no ANSI so it is safe in logs and pipes). */
export function renderReport(report: DiagnosticReport): string {
  const lines = [
    `Capricorn ${report.capricornVersion} — environment check`,
    '',
  ];
  for (const c of report.checks) {
    lines.push(`${ICON[c.status]} ${c.title}: ${c.message}`);
    if (c.remediation && c.status !== 'pass')
      lines.push(`    → ${c.remediation}`);
  }
  lines.push('');
  lines.push(
    report.ok ? 'Result: ready.' : 'Result: problems found (see ✗ above).',
  );
  return lines.join('\n');
}
