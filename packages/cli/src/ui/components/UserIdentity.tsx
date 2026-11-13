/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Capricorn modification (2026, Guillaume S. Condamine & all awesome
// contributors): upstream showed the signed-in Google account and subscription
// tier here. Capricorn has no account; the header instead states where
// inference runs (local Ollama, or a clearly flagged remote host the user opted
// into) and the approval mode, so the safety-relevant runtime facts are visible
// at startup (spec §5.1).

import type React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
import {
  type Config,
  ApprovalMode,
  resolveOllamaEndpoint,
} from '@google/gemini-cli-core';

interface UserIdentityProps {
  config: Config;
}

const MODE_LABEL: Record<string, string> = {
  [ApprovalMode.DEFAULT]: 'ask before edits and commands',
  [ApprovalMode.AUTO_EDIT]: 'edits auto-approved, commands ask',
  [ApprovalMode.PLAN]: 'plan mode (read-only)',
  [ApprovalMode.YOLO]: 'YOLO — everything auto-approved',
};

export const UserIdentity: React.FC<UserIdentityProps> = ({ config }) => {
  const settings = config.getOllamaSettings?.();
  if (!settings) {
    return null;
  }
  let endpoint = settings.endpoint;
  let isLocal = true;
  try {
    const resolved = resolveOllamaEndpoint(
      settings.endpoint,
      settings.allowRemoteHost,
    );
    endpoint = resolved.baseUrl;
    isLocal = resolved.isLoopback;
  } catch {
    // An invalid endpoint is reported by the inference setup dialog.
  }
  const mode = config.getApprovalMode?.() ?? ApprovalMode.DEFAULT;

  return (
    <Box flexDirection="column">
      <Box>
        <Text
          color={isLocal ? theme.text.primary : theme.status.warning}
          wrap="truncate-end"
        >
          {isLocal ? (
            <Text>
              <Text bold>Local inference</Text> · Ollama {endpoint}
            </Text>
          ) : (
            <Text bold>REMOTE inference (not local-only): {endpoint}</Text>
          )}
        </Text>
      </Box>
      <Box>
        <Text
          color={
            mode === ApprovalMode.YOLO
              ? theme.status.warning
              : theme.text.secondary
          }
          wrap="truncate-end"
        >
          Safety: {MODE_LABEL[mode] ?? mode}
        </Text>
        <Text color={theme.text.secondary}> /permissions</Text>
      </Box>
    </Box>
  );
};
