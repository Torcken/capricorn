/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import { homedir, GEMINI_DIR } from '../utils/paths.js';
import { WhisperTranscriptionProvider } from './whisperTranscriptionProvider.js';
import type { TranscriptionProvider } from './transcriptionProvider.js';

export class TranscriptionFactory {
  /**
   * Creates the transcription provider.
   *
   * Capricorn: always local Whisper (`whisper-stream`). Upstream defaulted to
   * Gemini Live, which streams microphone audio to Google Cloud; any other
   * configured backend value is ignored rather than honoured.
   *
   * @param voiceConfig Voice settings (`backend` is ignored, see above).
   * @param _apiKey Unused; kept so the upstream call signature still compiles.
   */
  static createProvider(
    voiceConfig: { backend?: string; whisperModel?: string } | undefined,
    _apiKey: string,
  ): TranscriptionProvider {
    const modelsDir = path.join(homedir(), GEMINI_DIR, 'whisper_models');
    if (!fs.existsSync(modelsDir)) {
      fs.mkdirSync(modelsDir, { recursive: true });
    }

    const modelName = voiceConfig?.whisperModel ?? 'ggml-base.en.bin';
    const modelPath = path.join(modelsDir, modelName);

    return new WhisperTranscriptionProvider({
      modelPath,
      threads: 4,
      step: 0,
      length: 5000,
    });
  }
}
