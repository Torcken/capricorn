/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '../../test-utils/render.js';
import { createMockSettings } from '../../test-utils/settings.js';
import { VoiceModelDialog } from './VoiceModelDialog.js';
import { act } from 'react';
import { waitFor } from '../../test-utils/async.js';
import { SettingScope } from '../../config/settings.js';

vi.mock('@capricorn/core', async () => {
  const actual = await vi.importActual('@capricorn/core');
  return {
    ...actual,
    isBinaryAvailable: vi.fn().mockReturnValue(true),
    WhisperModelManager: vi.fn().mockImplementation(() => ({
      isModelInstalled: vi.fn().mockReturnValue(false),
      on: vi.fn(),
      off: vi.fn(),
      downloadModel: vi.fn(),
    })),
  };
});

// Capricorn: the Gemini Live (Google Cloud) backend was removed; upstream's
// tests for its option, privacy warning and selection are replaced below.
describe('VoiceModelDialog', () => {
  it('offers only local Whisper, with no cloud backend or cloud warning', async () => {
    const onClose = vi.fn();
    const { lastFrame, waitUntilReady } = await renderWithProviders(
      <VoiceModelDialog onClose={onClose} />,
    );

    await waitUntilReady();

    const frame = lastFrame();
    expect(frame).toContain('Whisper (Local)');
    expect(frame).not.toContain('Gemini Live');
    expect(frame).not.toContain('Google Cloud');
  });

  it('opens the Whisper model list on select and never stores a cloud backend', async () => {
    const onClose = vi.fn();
    const settings = createMockSettings();
    const setValueSpy = vi.spyOn(settings, 'setValue');

    const { lastFrame, waitUntilReady, stdin } = await renderWithProviders(
      <VoiceModelDialog onClose={onClose} />,
      { settings },
    );

    await waitUntilReady();

    await act(async () => {
      stdin.write('\r');
    });

    await waitFor(() => {
      expect(lastFrame()).toContain('Select Whisper Model');
    });
    expect(setValueSpy).not.toHaveBeenCalledWith(
      SettingScope.User,
      'experimental.voice.backend',
      'gemini-live',
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
