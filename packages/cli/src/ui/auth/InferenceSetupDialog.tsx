/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Shown instead of the upstream Google sign-in dialog when the
 * local inference back-end cannot be initialised (for example the Ollama
 * endpoint is refused by the local-only network policy).
 *
 * There is deliberately no "choose another provider" option: Capricorn has
 * exactly one back-end, and offering alternatives would invite users to
 * route code to a hosted service. The dialog explains the problem and offers
 * a retry (useful after fixing settings or starting Ollama) or exit.
 */

import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
import { useKeypress } from '../hooks/useKeypress.js';

interface InferenceSetupDialogProps {
  /** The error that prevented initialisation (already user-safe text). */
  error: string | null;
  /** Re-attempts initialisation. */
  onRetry: () => void;
  /** Exits the application. */
  onExit: () => void;
}

export const InferenceSetupDialog = ({
  error,
  onRetry,
  onExit,
}: InferenceSetupDialogProps) => {
  useKeypress(
    (key) => {
      if (key.name === 'r') {
        onRetry();
        return true;
      }
      if (key.name === 'escape' || key.name === 'q') {
        onExit();
        return true;
      }
      return false;
    },
    { isActive: true },
  );

  return (
    <Box
      borderStyle="round"
      borderColor={theme.status.error}
      paddingX={1}
      flexDirection="column"
    >
      <Text bold color={theme.status.error}>
        Capricorn cannot start local inference
      </Text>
      {error ? <Text color={theme.text.primary}>{error}</Text> : null}
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.text.secondary}>
          • Make sure Ollama is installed and running (`ollama serve`).
        </Text>
        <Text color={theme.text.secondary}>
          • Run `capricorn doctor` in another terminal for a full diagnosis.
        </Text>
        <Text color={theme.text.secondary}>
          • Capricorn only connects to a local Ollama unless you opt in (see
          docs/OLLAMA.md).
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.text.accent}>Press R to retry, Esc to exit.</Text>
      </Box>
    </Box>
  );
};
