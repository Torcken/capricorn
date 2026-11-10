/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Capricorn modification (2026, Capricorn Contributors): headless runs no
// longer look for Google credentials. The back-end is always the local Ollama
// provider; any other configured type is a configuration error.

import {
  AuthType,
  debugLogger,
  OutputFormat,
  ExitCodes,
  type Config,
} from '@google/gemini-cli-core';
import type { LoadedSettings } from './config/settings.js';
import { validateAuthMethod } from './config/auth.js';
import { handleError } from './utils/errors.js';
import { runExitCleanup } from './utils/cleanup.js';

/**
 * Resolves and validates the inference back-end for a non-interactive run.
 *
 * @returns {@link AuthType.OLLAMA}. On failure the process exits with
 *   `FATAL_AUTHENTICATION_ERROR` (or a JSON error in JSON output mode).
 */
export async function validateNonInteractiveAuth(
  configuredAuthType: AuthType | undefined,
  _useExternalAuth: boolean | undefined,
  nonInteractiveConfig: Config,
  _settings: LoadedSettings,
): Promise<AuthType> {
  try {
    const authType = configuredAuthType ?? AuthType.OLLAMA;
    const err = await validateAuthMethod(String(authType));
    if (err != null) {
      throw new Error(err);
    }
    return authType;
  } catch (error) {
    if (nonInteractiveConfig.getOutputFormat() === OutputFormat.JSON) {
      handleError(
        error instanceof Error ? error : new Error(String(error)),
        nonInteractiveConfig,
        ExitCodes.FATAL_AUTHENTICATION_ERROR,
      );
    } else {
      debugLogger.error(error instanceof Error ? error.message : String(error));
      await runExitCleanup();
      process.exit(ExitCodes.FATAL_AUTHENTICATION_ERROR);
    }
    // handleError/process.exit never return; satisfy the type checker.
    throw error;
  }
}
