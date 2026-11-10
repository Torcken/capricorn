/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Capricorn modification (2026, Capricorn Contributors): upstream validated
// Google login, Gemini API key and Vertex AI credentials here. Capricorn has
// no hosted back-end, so the only valid method is the local Ollama provider
// and no credential is ever read from the environment or keychain.

import { AuthType } from '@google/gemini-cli-core';

/**
 * Validates the selected inference back-end.
 *
 * @returns `null` when valid, otherwise a user-facing error message.
 */
export async function validateAuthMethod(
  authMethod: string,
): Promise<string | null> {
  if (authMethod === AuthType.OLLAMA) {
    return null;
  }
  return (
    `Capricorn only supports local inference through Ollama (got "${authMethod}"). ` +
    'Google sign-in and API keys are not used.'
  );
}
