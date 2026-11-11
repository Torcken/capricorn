/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AuthType, ContentGenerator } from '../core/contentGenerator.js';
import {
  CodeAssistNotSupportedError,
  CodeAssistServer,
  type HttpOptions,
} from './server.js';
import type { Config } from '../config/config.js';
import { LoggingContentGenerator } from '../core/loggingContentGenerator.js';
import { ModelMappingContentGenerator } from '../core/modelMappingContentGenerator.js';

/**
 * Capricorn: always rejects. Upstream built a Code Assist content generator
 * from the user's Google sign-in; Capricorn's only generator is Ollama.
 * @throws {CodeAssistNotSupportedError}
 */
export async function createCodeAssistContentGenerator(
  _httpOptions: HttpOptions,
  _authType: AuthType,
  _config: Config,
  _sessionId?: string,
): Promise<ContentGenerator> {
  throw new CodeAssistNotSupportedError();
}

/**
 * Returns the Code Assist server behind the configured generator, if any.
 * In Capricorn the generator is always Ollama, so this returns `undefined`.
 */
export function getCodeAssistServer(
  config: Config,
): CodeAssistServer | undefined {
  let server = config.getContentGenerator();

  // Recursively unwrap LoggingContentGenerator and ModelMappingContentGenerator
  while (true) {
    if (server instanceof LoggingContentGenerator) {
      server = server.getWrapped();
    } else if (server instanceof ModelMappingContentGenerator) {
      server = server.getWrapped();
    } else {
      break;
    }
  }

  if (!(server instanceof CodeAssistServer)) {
    return undefined;
  }
  return server;
}
