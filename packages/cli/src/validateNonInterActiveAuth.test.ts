/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Capricorn modification (2026, Capricorn Contributors): tests for the
// Ollama-only headless back-end resolution (upstream Google-credential cases
// removed together with that functionality).

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import { validateNonInteractiveAuth } from './validateNonInterActiveAuth.js';
import {
  AuthType,
  ExitCodes,
  OutputFormat,
  coreEvents,
  debugLogger,
  makeFakeConfig,
} from '@google/gemini-cli-core';
import type { LoadedSettings } from './config/settings.js';

const settings = {} as LoadedSettings;
let exitSpy: MockInstance;

beforeEach(() => {
  vi.spyOn(debugLogger, 'error').mockImplementation(() => {});
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`process.exit(${code}) called`);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('validateNonInteractiveAuth', () => {
  it('defaults to the local Ollama back-end with no configuration', async () => {
    expect(
      await validateNonInteractiveAuth(
        undefined,
        undefined,
        makeFakeConfig(),
        settings,
      ),
    ).toBe(AuthType.OLLAMA);
  });

  // Threat: cloud credentials in CI environments must not switch inference.
  it('ignores Google environment credentials', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'AIza-test');
    vi.stubEnv('GOOGLE_GENAI_USE_VERTEXAI', 'true');
    expect(
      await validateNonInteractiveAuth(
        undefined,
        undefined,
        makeFakeConfig(),
        settings,
      ),
    ).toBe(AuthType.OLLAMA);
  });

  it('exits with FATAL_AUTHENTICATION_ERROR for a hosted back-end', async () => {
    await expect(
      validateNonInteractiveAuth(
        AuthType.USE_GEMINI,
        undefined,
        makeFakeConfig(),
        settings,
      ),
    ).rejects.toThrow(
      `process.exit(${ExitCodes.FATAL_AUTHENTICATION_ERROR}) called`,
    );
    expect(exitSpy).toHaveBeenCalledWith(ExitCodes.FATAL_AUTHENTICATION_ERROR);
  });

  it('reports a JSON error in JSON output mode', async () => {
    const config = makeFakeConfig();
    vi.spyOn(config, 'getOutputFormat').mockReturnValue(OutputFormat.JSON);
    // In JSON mode handleError emits the formatted error as feedback.
    const feedback = vi
      .spyOn(coreEvents, 'emitFeedback')
      .mockImplementation(() => {});
    await expect(
      validateNonInteractiveAuth(
        AuthType.LOGIN_WITH_GOOGLE,
        undefined,
        config,
        settings,
      ),
    ).rejects.toThrow();
    expect(feedback).toHaveBeenCalledWith(
      'error',
      expect.stringContaining('only supports local inference through Ollama'),
    );
  });
});
