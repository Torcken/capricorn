/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Capricorn-specific CLI subcommands: `doctor`, `status`,
 * `models`, `config` and `init`. (`run` and `sessions` are argument aliases
 * handled in `capricornAliases.ts` because they reuse upstream flags.)
 *
 * Output conventions (spec §5.2):
 *  - human output goes to stdout as plain text;
 *  - `--json` output is a single JSON document on stdout with no ANSI codes
 *    or log lines mixed in; diagnostics/logging go to stderr;
 *  - exit code 0 = success, 1 = check failure / operation failed,
 *    2 = usage or configuration error.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Argv, CommandModule } from 'yargs';
import {
  discoverModels,
  GEMMA4_PRESETS,
  OllamaError,
  normalizeTag,
  verifyGemma4Model,
  prefilterTagModel,
  getVersion,
  type DiscoveredModel,
  type OllamaClient,
  type OllamaPsResponse,
} from '@google/gemini-cli-core';
import { initializeOutputListenersAndFlush } from '../gemini.js';
import {
  loadSettings,
  SettingScope,
  type LoadedSettings,
} from '../config/settings.js';
import {
  getSettingsSchema,
  type SettingDefinition,
  type SettingsSchema,
} from '../config/settingsSchema.js';
import { isWorkspaceTrusted } from '../config/trustedFolders.js';
import { exitCli } from './utils.js';
import { defer } from '../deferred.js';
import {
  createRuntimeClient,
  formatGiB,
  resolveRuntime,
  type CapricornRuntime,
} from '../capricorn/runtime.js';
import { renderReport, runDiagnostics } from '../capricorn/diagnostics.js';

/** Exit codes used by Capricorn subcommands. */
export const CapricornExit = { OK: 0, FAILED: 1, USAGE: 2 } as const;

const out = (text: string) =>
  process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
const err = (text: string) =>
  process.stderr.write(text.endsWith('\n') ? text : `${text}\n`);

/** Shared middleware: mark as command so the interactive app never starts. */
function asCommand(y: Argv): Argv {
  return y.middleware((argv) => {
    initializeOutputListenersAndFlush();
    argv['isCommand'] = true;
  });
}

/** Builds the runtime and client, reporting policy errors uniformly. */
function openRuntime(
  settings: LoadedSettings,
  modelFlag?: string,
): { runtime: CapricornRuntime; client?: OllamaClient; clientError?: unknown } {
  const runtime = resolveRuntime(settings, modelFlag);
  try {
    return { runtime, client: createRuntimeClient(runtime) };
  } catch (e) {
    return { runtime, clientError: e };
  }
}

function describeError(e: unknown): string {
  if (e instanceof OllamaError) return `${e.message}\n  → ${e.remediation}`;
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// doctor
// ---------------------------------------------------------------------------

export const doctorCommand: CommandModule<
  object,
  { json?: boolean; model?: string; load?: boolean }
> = {
  command: 'doctor',
  describe:
    'Diagnose Node.js, Ollama, Gemma 4 models, context window and security settings.',
  builder: (y) =>
    asCommand(y)
      .option('json', {
        type: 'boolean',
        description: 'Machine-readable output.',
      })
      .option('model', {
        alias: 'm',
        type: 'string',
        description: 'Check this model instead of the configured one.',
      })
      .option('load', {
        type: 'boolean',
        description:
          'Also load the model in Ollama to prove it runs (can take minutes and several GB of memory).',
      })
      .version(false) as Argv<{
      json?: boolean;
      model?: string;
      load?: boolean;
    }>,
  handler: async (argv) => {
    const settings = loadSettings();
    const { runtime, client, clientError } = openRuntime(settings, argv.model);
    const report = await runDiagnostics({
      runtime,
      client,
      clientError,
      version: await getVersion(),
      cwd: process.cwd(),
      workspaceTrusted: isWorkspaceTrusted(settings.merged).isTrusted,
      loadModel: argv.load === true,
    });
    out(argv.json ? JSON.stringify(report, null, 2) : renderReport(report));
    await exitCli(report.ok ? CapricornExit.OK : CapricornExit.FAILED);
  },
};

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

export const statusCommand: CommandModule<
  object,
  { json?: boolean; model?: string }
> = {
  command: 'status',
  describe: 'Show the effective model, endpoint, project and safety settings.',
  builder: (y) =>
    asCommand(y)
      .option('json', {
        type: 'boolean',
        description: 'Machine-readable output.',
      })
      .option('model', {
        alias: 'm',
        type: 'string',
        description: 'Check this model instead of the configured one.',
      })
      .version(false) as Argv<{ json?: boolean; model?: string }>,
  handler: async (argv) => {
    const settings = loadSettings();
    const { runtime, client, clientError } = openRuntime(settings, argv.model);
    let daemon: string;
    let loaded: OllamaPsResponse['models'] = [];
    if (client) {
      try {
        daemon = `Ollama ${await client.version()} at ${client.baseUrl}${client.isLoopback ? '' : ' (REMOTE)'}`;
        loaded = (await client.listRunning()).models;
      } catch (e) {
        daemon = `unreachable: ${e instanceof Error ? e.message : String(e)}`;
      }
    } else {
      daemon = `endpoint refused by policy: ${describeError(clientError)}`;
    }
    const status = {
      version: await getVersion(),
      model: runtime.settings.model,
      modelSource: runtime.modelSource,
      ollama: daemon,
      endpointSource: runtime.endpointSource,
      numCtx: runtime.settings.numCtx,
      think: runtime.settings.think,
      project: process.cwd(),
      trusted: isWorkspaceTrusted(settings.merged).isTrusted ?? null,
      approvalMode: settings.merged.general?.defaultApprovalMode ?? 'default',
      sandbox: settings.merged.tools?.sandbox ? 'enabled' : 'disabled',
      loadedModels: loaded,
    };
    if (argv.json) {
      out(JSON.stringify(status, null, 2));
    } else {
      out(
        [
          `Capricorn ${status.version}`,
          `  Model:        ${status.model} (from ${status.modelSource})`,
          `  Ollama:       ${status.ollama}`,
          `  Context:      num_ctx ${status.numCtx}, thinking ${status.think}`,
          `  Project:      ${status.project} (${status.trusted === true ? 'trusted' : status.trusted === false ? 'not trusted' : 'trust unknown'})`,
          `  Approvals:    ${status.approvalMode}`,
          `  Sandbox:      ${status.sandbox}`,
          `  Loaded now:   ${
            loaded.length
              ? loaded
                  .map(
                    (m) =>
                      `${m.name} (${formatGiB(m.size)} resident, ${formatGiB(m.size_vram)} in VRAM${m.context_length ? `, ctx ${m.context_length}` : ''})`,
                  )
                  .join('; ')
              : 'none'
          }`,
        ].join('\n'),
      );
    }
    await exitCli(CapricornExit.OK);
  },
};

// ---------------------------------------------------------------------------
// models
// ---------------------------------------------------------------------------

function renderModelRow(m: DiscoveredModel, current: string): string {
  const mark = normalizeTag(m.model) === normalizeTag(current) ? '*' : ' ';
  const info = [
    m.parameterSize,
    m.quantization,
    m.sizeBytes ? `${formatGiB(m.sizeBytes)} download` : undefined,
  ]
    .filter(Boolean)
    .join(', ');
  return `${mark} ${m.model.padEnd(28)} ${info}`;
}

const modelsListCommand: CommandModule<
  object,
  { json?: boolean; all?: boolean }
> = {
  command: ['list', '$0'],
  describe: 'List installed, verified Gemma 4 models.',
  builder: (y) =>
    y
      .option('json', {
        type: 'boolean',
        description: 'Machine-readable output.',
      })
      .option('all', {
        type: 'boolean',
        description:
          'Also show rejected (non-Gemma-4 or cloud) models and why.',
      }) as Argv<{ json?: boolean; all?: boolean }>,
  handler: async (argv) => {
    const settings = loadSettings();
    const { runtime, client, clientError } = openRuntime(settings);
    if (!client) {
      err(describeError(clientError));
      return exitCli(CapricornExit.USAGE);
    }
    let models: DiscoveredModel[];
    try {
      models = await discoverModels(client);
    } catch (e) {
      err(describeError(e));
      return exitCli(CapricornExit.FAILED);
    }
    const allowed = models.filter((m) => m.allowed);
    if (argv.json) {
      out(
        JSON.stringify(
          {
            current: runtime.settings.model,
            models: argv.all ? models : allowed,
          },
          null,
          2,
        ),
      );
      return exitCli(CapricornExit.OK);
    }
    if (allowed.length === 0) {
      out('No verified Gemma 4 models are installed.');
      out(`Pull one with: capricorn models pull ${GEMMA4_PRESETS[1].tag}`);
    } else {
      out('Installed Gemma 4 models (* = selected):');
      for (const m of allowed) out(renderModelRow(m, runtime.settings.model));
    }
    if (argv.all) {
      const rejected = models.filter((m) => !m.allowed);
      if (rejected.length) {
        out('\nNot usable with Capricorn:');
        for (const m of rejected) out(`  ${m.model.padEnd(28)} ${m.detail}`);
      }
    }
    out(
      '\nKnown Gemma 4 presets: ' +
        GEMMA4_PRESETS.map((p) => `${p.tag} (${p.tier})`).join(', '),
    );
    return exitCli(CapricornExit.OK);
  },
};

const modelsInfoCommand: CommandModule<
  object,
  { model: string; json?: boolean }
> = {
  command: 'info <model>',
  describe: 'Show metadata, capabilities and verification result for a model.',
  builder: (y) =>
    y
      .positional('model', { type: 'string', demandOption: true })
      .option('json', { type: 'boolean' }) as Argv<{
      model: string;
      json?: boolean;
    }>,
  handler: async (argv) => {
    const { client, clientError } = openRuntime(loadSettings());
    if (!client) {
      err(describeError(clientError));
      return exitCli(CapricornExit.USAGE);
    }
    try {
      const pre = prefilterTagModel({ name: argv.model });
      const verdict =
        pre ??
        verifyGemma4Model(argv.model, await client.showModel(argv.model));
      if (argv.json) {
        out(JSON.stringify(verdict, null, 2));
      } else {
        out(
          [
            `${verdict.model}`,
            `  Verdict:       ${verdict.allowed ? 'usable' : 'NOT usable'} — ${verdict.detail}`,
            `  Architecture:  ${verdict.architecture ?? 'unknown'}`,
            `  Parameters:    ${verdict.parameterSize ?? 'unknown'}`,
            `  Quantization:  ${verdict.quantization ?? 'unknown'}`,
            `  Max context:   ${verdict.maxContextLength?.toLocaleString('en-US') ?? 'unknown'} tokens`,
            `  Capabilities:  ${verdict.capabilities?.join(', ') ?? 'not reported'}`,
            `  Note: loaded memory depends on num_ctx (KV cache) and is shown by \`capricorn status\` once loaded.`,
          ].join('\n'),
        );
      }
      return await exitCli(
        verdict.allowed ? CapricornExit.OK : CapricornExit.FAILED,
      );
    } catch (e) {
      err(describeError(e));
      return exitCli(CapricornExit.FAILED);
    }
  },
};

const modelsPullCommand: CommandModule<object, { model: string }> = {
  command: 'pull <model>',
  describe:
    'Download a Gemma 4 model through Ollama (requires internet access by the Ollama daemon).',
  builder: (y) =>
    y.positional('model', { type: 'string', demandOption: true }) as Argv<{
      model: string;
    }>,
  handler: async (argv) => {
    const tag = argv.model;
    // Refuse obviously disallowed tags before triggering a multi-GB download.
    // Final verification still happens after the pull, from real metadata.
    const pre = prefilterTagModel({ name: tag });
    if (pre || !/^gemma4[:/]?/i.test(tag.split('/').pop() ?? '')) {
      err(
        `Refusing to pull "${tag}": Capricorn only runs local Gemma 4 models (e.g. ${GEMMA4_PRESETS.map((p) => p.tag).join(', ')}).`,
      );
      return exitCli(CapricornExit.USAGE);
    }
    const { client, clientError } = openRuntime(loadSettings());
    if (!client) {
      err(describeError(clientError));
      return exitCli(CapricornExit.USAGE);
    }
    const ac = new AbortController();
    const onSigint = () => ac.abort();
    process.once('SIGINT', onSigint);
    err(`Pulling ${tag} via Ollama at ${client.baseUrl} (Ctrl+C to cancel)...`);
    let lastLine = '';
    try {
      for await (const p of client.pullModel(tag, ac.signal)) {
        const pct =
          p.total && p.completed !== undefined
            ? ` ${Math.floor((p.completed / p.total) * 100)}%`
            : '';
        const line = `${p.status ?? ''}${pct}`;
        if (line !== lastLine) {
          err(`  ${line}`);
          lastLine = line;
        }
      }
      const verdict = verifyGemma4Model(tag, await client.showModel(tag));
      out(
        verdict.allowed
          ? `Pulled ${tag}: ${verdict.detail}`
          : `Pulled ${tag}, but it is NOT usable: ${verdict.detail}`,
      );
      return await exitCli(
        verdict.allowed ? CapricornExit.OK : CapricornExit.FAILED,
      );
    } catch (e) {
      err(describeError(e));
      return await exitCli(CapricornExit.FAILED);
    } finally {
      process.off('SIGINT', onSigint);
    }
  },
};

const modelsUseCommand: CommandModule<object, { model: string }> = {
  command: 'use <model>',
  describe:
    'Set the default model (user settings) after verifying it is an installed Gemma 4 model.',
  builder: (y) =>
    y.positional('model', { type: 'string', demandOption: true }) as Argv<{
      model: string;
    }>,
  handler: async (argv) => {
    const settings = loadSettings();
    const { client, clientError } = openRuntime(settings);
    if (!client) {
      err(describeError(clientError));
      return exitCli(CapricornExit.USAGE);
    }
    try {
      const pre = prefilterTagModel({ name: argv.model });
      const verdict =
        pre ??
        verifyGemma4Model(argv.model, await client.showModel(argv.model));
      if (!verdict.allowed) {
        err(`Cannot use "${argv.model}": ${verdict.detail}`);
        return await exitCli(CapricornExit.FAILED);
      }
      settings.setValue(SettingScope.User, 'model.name', argv.model);
      out(`Default model set to ${argv.model} (user settings).`);
      return await exitCli(CapricornExit.OK);
    } catch (e) {
      err(describeError(e));
      return exitCli(CapricornExit.FAILED);
    }
  },
};

export const capricornModelsCommand: CommandModule = {
  command: 'models [command]',
  describe: 'List, inspect, pull and select local Gemma 4 models.',
  builder: (y) =>
    asCommand(y)
      .command(defer(modelsListCommand, 'models'))
      .command(defer(modelsInfoCommand, 'models'))
      .command(defer(modelsPullCommand, 'models'))
      .command(defer(modelsUseCommand, 'models'))
      .version(false),
  handler: () => {},
};

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------

/** Type guard for plain (non-array) objects. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads a dotted key from a nested object (undefined if any segment is missing). */
function getByPath(root: unknown, key: string): unknown {
  let node: unknown = root;
  for (const part of key.split('.')) {
    if (!isRecord(node)) return undefined;
    node = node[part];
  }
  return node;
}

/** Keys whose values are redacted in `config list/get` output. */
const SECRET_KEY =
  /(key|token|secret|password|credential|authorization|header)/i;

/** Flattens a nested settings object into dotted keys. */
export function flattenSettings(
  obj: unknown,
  prefix = '',
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (isRecord(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (isRecord(v) && Object.keys(v).length > 0) {
        Object.assign(result, flattenSettings(v, key));
      } else {
        result[key] = v;
      }
    }
  }
  return result;
}

/** Redacts secret-looking keys and MCP env/headers. */
export function redact(key: string, value: unknown): unknown {
  if (value === undefined || value === null || value === '') return value;
  if (
    SECRET_KEY.test(key.split('.').pop() ?? '') ||
    /\.(env|headers)\./.test(`${key}.`)
  ) {
    return '<redacted>';
  }
  return value;
}

/** Finds the schema definition for a dotted key. */
export function findSettingDefinition(
  key: string,
): SettingDefinition | undefined {
  let node: SettingsSchema | undefined = getSettingsSchema();
  let def: SettingDefinition | undefined;
  for (const part of key.split('.')) {
    def = node?.[part];
    if (!def) return undefined;
    node = def.properties;
  }
  return def;
}

/**
 * Parses and validates a CLI string value against the setting's schema type.
 * @throws {Error} With a user-facing message if the value is invalid.
 */
export function parseSettingValue(
  def: SettingDefinition,
  raw: string,
): unknown {
  switch (def.type) {
    case 'boolean':
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      throw new Error('Expected true or false.');
    case 'number': {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new Error('Expected a number.');
      return n;
    }
    case 'enum': {
      const values = (def.options ?? []).map((o) => String(o.value));
      if (!values.includes(raw))
        throw new Error(`Expected one of: ${values.join(', ')}.`);
      return raw;
    }
    case 'string':
      return raw;
    case 'array':
    case 'object': {
      const parsed: unknown = JSON.parse(raw);
      if (def.type === 'array' && !Array.isArray(parsed))
        throw new Error('Expected a JSON array.');
      if (
        def.type === 'object' &&
        (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      ) {
        throw new Error('Expected a JSON object.');
      }
      return parsed;
    }
    default:
      throw new Error(`Unsupported setting type ${String(def.type)}.`);
  }
}

/**
 * Settings that must never be changed through `config set --scope workspace`
 * because a repository could ship them (see networkPolicy.ts / endpoint.ts).
 */
const USER_SCOPE_ONLY = new Set([
  'ollama.allowRemoteHost',
  'security.network.allowedHosts',
]);

export const configCommand: CommandModule = {
  command: 'config <command>',
  describe:
    'Show or change Capricorn settings (values are schema-validated; secrets are redacted).',
  builder: (y) =>
    asCommand(y)
      .command(
        defer(
          {
            command: 'list',
            describe: 'Show the effective (merged) settings.',
            builder: (yy) => yy.option('json', { type: 'boolean' }),
            handler: async (argv) => {
              const flat = flattenSettings(loadSettings().merged);
              const entries = Object.entries(flat)
                .filter(([, v]) => v !== undefined)
                .map(([k, v]) => [k, redact(k, v)] as const)
                .sort(([a], [b]) => a.localeCompare(b));
              out(
                argv['json']
                  ? JSON.stringify(Object.fromEntries(entries), null, 2)
                  : entries
                      .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
                      .join('\n'),
              );
              await exitCli(CapricornExit.OK);
            },
          },
          'config',
        ),
      )
      .command(
        defer(
          {
            command: 'get <key>',
            describe: 'Read one effective setting.',
            builder: (yy) =>
              yy.positional('key', { type: 'string', demandOption: true }),
            handler: async (argv) => {
              const key = String(argv['key']);
              const flat = flattenSettings(loadSettings().merged);
              const direct = getByPath(loadSettings().merged, key);
              if (
                !(key in flat) &&
                direct === undefined &&
                !findSettingDefinition(key)
              ) {
                err(`Unknown setting "${key}".`);
                return exitCli(CapricornExit.USAGE);
              }
              out(JSON.stringify(redact(key, direct), null, 2) ?? 'undefined');
              return exitCli(CapricornExit.OK);
            },
          },
          'config',
        ),
      )
      .command(
        defer(
          {
            command: 'set <key> <value>',
            describe: 'Validate and write a setting (default scope: user).',
            builder: (yy) =>
              yy
                .positional('key', { type: 'string', demandOption: true })
                .positional('value', { type: 'string', demandOption: true })
                .option('scope', {
                  choices: ['user', 'workspace'] as const,
                  default: 'user',
                }),
            handler: async (argv) => {
              const key = String(argv['key']);
              const scope =
                argv['scope'] === 'workspace'
                  ? SettingScope.Workspace
                  : SettingScope.User;
              const def = findSettingDefinition(key);
              if (!def || def.type === 'object') {
                err(
                  def
                    ? `"${key}" is a group; set one of its fields instead.`
                    : `Unknown setting "${key}".`,
                );
                return exitCli(CapricornExit.USAGE);
              }
              if (
                scope === SettingScope.Workspace &&
                USER_SCOPE_ONLY.has(key)
              ) {
                err(
                  `"${key}" is security-sensitive and can only be set in user settings.`,
                );
                return exitCli(CapricornExit.USAGE);
              }
              let value: unknown;
              try {
                value = parseSettingValue(def, String(argv['value']));
              } catch (e) {
                err(
                  `Invalid value for ${key}: ${e instanceof Error ? e.message : String(e)}`,
                );
                return exitCli(CapricornExit.USAGE);
              }
              loadSettings().setValue(scope, key, value);
              out(
                `${key} = ${JSON.stringify(redact(key, value))} (${scope === SettingScope.User ? 'user' : 'workspace'} settings)`,
              );
              return exitCli(CapricornExit.OK);
            },
          },
          'config',
        ),
      )
      .demandCommand(1)
      .version(false),
  handler: () => {},
};

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

/** Starter project instructions; deliberately short and editable. */
export const CAPRICORN_MD_TEMPLATE = `# Project instructions for Capricorn

<!-- Capricorn reads this file at the start of every session in this project.
     Keep it short and factual. It is guidance for the agent, not a security
     boundary: permissions are enforced by Capricorn itself. -->

## Overview
- What this project does:
- Main language(s) / framework(s):

## Commands
- Build:
- Test (all):
- Test (single file):
- Lint / format:

## Conventions
- Code style notes:
- Directories the agent should not modify:
`;

export const initCommand: CommandModule<object, { force?: boolean }> = {
  command: 'init',
  describe:
    'Create CAPRICORN.md and .capricorn/settings.json in the current project (never overwrites).',
  builder: (y) =>
    asCommand(y)
      .option('force', {
        type: 'boolean',
        description:
          'Overwrite CAPRICORN.md if it exists (a .bak copy is kept).',
      })
      .version(false) as Argv<{ force?: boolean }>,
  handler: async (argv) => {
    const cwd = process.cwd();
    const created: string[] = [];
    const skipped: string[] = [];

    const mdPath = path.join(cwd, 'CAPRICORN.md');
    if (fs.existsSync(mdPath) && !argv.force) {
      skipped.push(
        'CAPRICORN.md (exists; use --force to replace, a backup is kept)',
      );
    } else {
      if (fs.existsSync(mdPath)) fs.copyFileSync(mdPath, `${mdPath}.bak`);
      // 'wx' (exclusive create) when not forcing guards against a race with
      // another process creating the file between the check and the write.
      fs.writeFileSync(mdPath, CAPRICORN_MD_TEMPLATE, {
        flag: argv.force ? 'w' : 'wx',
      });
      created.push('CAPRICORN.md');
    }

    const dir = path.join(cwd, '.capricorn');
    const settingsPath = path.join(dir, 'settings.json');
    if (fs.existsSync(settingsPath)) {
      skipped.push('.capricorn/settings.json (exists)');
    } else {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        settingsPath,
        '{\n  // Project-level Capricorn settings (JSON with comments).\n  // See docs/CONFIGURATION.md. Security-sensitive keys such as\n  // ollama.allowRemoteHost are ignored here and honoured only in user settings.\n}\n',
        { flag: 'wx' },
      );
      created.push('.capricorn/settings.json');
    }

    if (fs.existsSync(path.join(cwd, 'GEMINI.md'))) {
      out(
        'Note: GEMINI.md exists but is not read by Capricorn. Copy relevant content into CAPRICORN.md if you want it used.',
      );
    }
    if (created.length) out(`Created: ${created.join(', ')}`);
    if (skipped.length) out(`Skipped: ${skipped.join(', ')}`);
    await exitCli(CapricornExit.OK);
  },
};
