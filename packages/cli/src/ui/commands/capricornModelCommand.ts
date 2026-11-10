/**
 * @license
 * Copyright 2026 Capricorn Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview In-session `/model` command for Capricorn.
 *
 * Replaces the upstream Gemini model dialog. Switching is restricted to
 * models that are (a) installed in the local Ollama daemon and (b) verified
 * as Gemma 4 from their metadata, using the same `discoverModels`/
 * `selectModel` logic as `capricorn doctor` — so the UI can never offer a
 * model the content generator would refuse.
 *
 *   /model                 list usable models (current marked)
 *   /model <tag>           switch for this session
 *   /model <tag> --persist switch and save as the user default
 */

import {
  OllamaClient,
  discoverModels,
  normalizeTag,
  selectModel,
} from '@google/gemini-cli-core';
import { SettingScope } from '../../config/settings.js';
import { MessageType } from '../types.js';
import {
  CommandKind,
  type CommandContext,
  type SlashCommand,
} from './types.js';

function clientFor(context: CommandContext): OllamaClient | undefined {
  const config = context.services.agentContext?.config;
  if (!config) return undefined;
  const s = config.getOllamaSettings();
  return new OllamaClient({
    endpoint: s.endpoint,
    allowRemoteHost: s.allowRemoteHost,
  });
}

async function listModels(context: CommandContext): Promise<void> {
  const config = context.services.agentContext?.config;
  const client = clientFor(context);
  if (!config || !client) return;
  try {
    const models = (await discoverModels(client)).filter((m) => m.allowed);
    const current = normalizeTag(config.getModel());
    const lines = models.length
      ? models.map(
          (m) =>
            `${normalizeTag(m.model) === current ? '●' : '○'} ${m.model}  ${[m.parameterSize, m.quantization].filter(Boolean).join(', ')}`,
        )
      : [
          'No verified Gemma 4 models installed. Run `capricorn models pull gemma4:e4b` in a terminal.',
        ];
    context.ui.addItem({
      type: MessageType.INFO,
      text: `Local Gemma 4 models (Ollama at ${client.baseUrl}):\n${lines.join('\n')}\n\nSwitch with /model <tag> (add --persist to save as default).`,
    });
  } catch (e) {
    context.ui.addItem({
      type: MessageType.ERROR,
      text: `Could not list models: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
}

async function switchModel(
  context: CommandContext,
  args: string,
): Promise<void> {
  const config = context.services.agentContext?.config;
  const client = clientFor(context);
  if (!config || !client) return;
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const tag = parts.find((p) => !p.startsWith('--'));
  const persist = parts.includes('--persist');
  if (!tag) {
    return listModels(context);
  }
  try {
    const selection = selectModel(await discoverModels(client), tag);
    if (selection.kind !== 'selected') {
      const alt = selection.alternatives.map((a) => a.model).join(', ');
      context.ui.addItem({
        type: MessageType.ERROR,
        text: `Cannot switch to "${tag}": ${selection.reason}${alt ? `\nInstalled Gemma 4 models: ${alt}` : ''}`,
      });
      return;
    }
    const model = selection.model.model;
    config.setModel(model, true);
    if (persist) {
      context.services.settings.setValue(
        SettingScope.User,
        'model.name',
        model,
      );
    }
    context.ui.addItem({
      type: MessageType.INFO,
      text: `Model set to ${model}${persist ? ' (saved as default)' : ' for this session'}.`,
    });
  } catch (e) {
    context.ui.addItem({
      type: MessageType.ERROR,
      text: `Could not switch model: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
}

export const capricornModelCommand: SlashCommand = {
  name: 'model',
  description:
    'List or switch local Gemma 4 models. Usage: /model [<tag> [--persist]]',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  subCommands: [
    {
      name: 'list',
      description: 'List installed, verified Gemma 4 models',
      kind: CommandKind.BUILT_IN,
      autoExecute: true,
      action: async (context) => listModels(context),
    },
    {
      name: 'set',
      description: 'Switch model. Usage: /model set <tag> [--persist]',
      kind: CommandKind.BUILT_IN,
      autoExecute: false,
      action: async (context, args) => switchModel(context, args),
    },
  ],
  action: async (context: CommandContext, args: string) =>
    switchModel(context, args),
};
