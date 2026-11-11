/**
 * @license
 * Copyright 2026 Capricorn Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TranscriptionFactory } from './transcriptionFactory.js';
import { WhisperTranscriptionProvider } from './whisperTranscriptionProvider.js';

describe('TranscriptionFactory (Capricorn: local Whisper only)', () => {
  let home: string;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-voice-'));
    // The factory creates its models dir under the Capricorn home.
    vi.stubEnv('CAPRICORN_HOME', home);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it.each([undefined, 'whisper', 'gemini-live', 'anything-else'])(
    'returns the local Whisper provider for backend %s',
    (backend) => {
      const provider = TranscriptionFactory.createProvider(
        backend ? { backend } : undefined,
        'a-gemini-api-key-that-must-be-ignored',
      );
      expect(provider).toBeInstanceOf(WhisperTranscriptionProvider);
    },
  );
});
