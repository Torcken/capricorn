/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Interactive model picker for Capricorn (replaces the
 * upstream Gemini model dialog). It lists only installed models that pass
 * Gemma 4 verification, using the shared `discoverModels` logic, so the user
 * cannot pick a model the inference layer would refuse.
 */

import { useContext, useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import {
  OllamaClient,
  discoverModels,
  normalizeTag,
  type DiscoveredModel,
} from '@google/gemini-cli-core';
import { theme } from '../semantic-colors.js';
import { useKeypress } from '../hooks/useKeypress.js';
import { ConfigContext } from '../contexts/ConfigContext.js';
import { RadioButtonSelect } from './shared/RadioButtonSelect.js';

interface CapricornModelDialogProps {
  onClose: () => void;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; models: DiscoveredModel[] };

export const CapricornModelDialog = ({
  onClose,
}: CapricornModelDialogProps) => {
  const config = useContext(ConfigContext);
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    if (!config) return;
    let cancelled = false;
    const s = config.getOllamaSettings();
    const client = new OllamaClient({
      endpoint: s.endpoint,
      allowRemoteHost: s.allowRemoteHost,
    });
    discoverModels(client)
      .then((all) => {
        if (!cancelled)
          setState({ kind: 'ready', models: all.filter((m) => m.allowed) });
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setState({
            kind: 'error',
            message: e instanceof Error ? e.message : String(e),
          });
      });
    return () => {
      cancelled = true;
    };
  }, [config]);

  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        onClose();
        return true;
      }
      return false;
    },
    { isActive: true },
  );

  const current = config ? normalizeTag(config.getModel()) : '';

  return (
    <Box
      borderStyle="round"
      borderColor={theme.border.default}
      flexDirection="column"
      paddingX={1}
    >
      <Text bold>Select a local Gemma 4 model</Text>
      {state.kind === 'loading' && (
        <Text color={theme.text.secondary}>Querying Ollama…</Text>
      )}
      {state.kind === 'error' && (
        <Text color={theme.status.error}>{state.message}</Text>
      )}
      {state.kind === 'ready' && state.models.length === 0 && (
        <Text color={theme.status.warning}>
          No verified Gemma 4 models installed. Run `capricorn models pull
          gemma4:e4b` in a terminal.
        </Text>
      )}
      {state.kind === 'ready' && state.models.length > 0 && (
        <RadioButtonSelect
          items={state.models.map((m) => ({
            key: m.model,
            value: m.model,
            label: `${m.model}${normalizeTag(m.model) === current ? ' (current)' : ''}`,
            sublabel: [m.parameterSize, m.quantization]
              .filter(Boolean)
              .join(', '),
          }))}
          initialIndex={Math.max(
            0,
            state.models.findIndex((m) => normalizeTag(m.model) === current),
          )}
          onSelect={(model) => {
            config?.setModel(model, true);
            onClose();
          }}
        />
      )}
      <Text color={theme.text.secondary}>
        Enter to select · Esc to close · /model &lt;tag&gt; --persist to save a
        default
      </Text>
    </Box>
  );
};
