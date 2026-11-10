/**
 * @license
 * Copyright 2026 Capricorn Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Public surface of Capricorn's Ollama provider. The CLI
 * package imports from here (via the core package index) for model commands,
 * diagnostics and session startup.
 */

export * from './errors.js';
export * from './endpoint.js';
export * from './client.js';
export * from './wireTypes.js';
export * from './modelPolicy.js';
export * from './modelDiscovery.js';
export * from './settings.js';
export {
  MALFORMED_ARGS_MARKER,
  geminiSchemaToJsonSchema,
  toOllamaMessages,
  toOllamaTools,
} from './converter.js';
export {
  OllamaContentGenerator,
  type OllamaGeneratorSettings,
  type OllamaThinkMode,
} from './ollamaContentGenerator.js';
