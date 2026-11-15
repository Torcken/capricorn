/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initializeApp } from './initializer.js';
import { logCliConfiguration, type Config } from '@capricorn/core';
import { performInitialAuth } from './auth.js';
import { validateTheme } from './theme.js';
import { type LoadedSettings } from '../config/settings.js';

vi.mock('@capricorn/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@capricorn/core')>();
  return {
    ...actual,
    logCliConfiguration: vi.fn(),
    StartSessionEvent: vi.fn(),
  };
});

vi.mock('./auth.js', () => ({
  performInitialAuth: vi.fn(),
}));

vi.mock('./theme.js', () => ({
  validateTheme: vi.fn(),
}));

describe('initializer', () => {
  let mockConfig: {
    getToolRegistry: ReturnType<typeof vi.fn>;
    getGeminiMdFileCount: ReturnType<typeof vi.fn>;
  };
  let mockSettings: LoadedSettings;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig = {
      getToolRegistry: vi.fn(),
      getGeminiMdFileCount: vi.fn().mockReturnValue(5),
    };
    mockSettings = {
      merged: {
        security: {
          auth: {
            selectedType: 'oauth',
          },
        },
      },
    } as unknown as LoadedSettings;
    vi.mocked(performInitialAuth).mockResolvedValue({
      authError: null,
      accountSuspensionInfo: null,
    });
    vi.mocked(validateTheme).mockReturnValue(null);
  });

  it('should initialize correctly', async () => {
    const result = await initializeApp(
      mockConfig as unknown as Config,
      mockSettings,
    );

    expect(result).toEqual({
      authError: null,
      accountSuspensionInfo: null,
      themeError: null,
      shouldOpenAuthDialog: false,
      geminiMdFileCount: 5,
    });
    expect(performInitialAuth).toHaveBeenCalledWith(mockConfig, 'oauth');
    expect(validateTheme).toHaveBeenCalledWith(mockSettings);
    expect(logCliConfiguration).toHaveBeenCalled();
  });

  it('should handle auth error', async () => {
    vi.mocked(performInitialAuth).mockResolvedValue({
      authError: 'Auth failed',
      accountSuspensionInfo: null,
    });
    const result = await initializeApp(
      mockConfig as unknown as Config,
      mockSettings,
    );

    expect(result.authError).toBe('Auth failed');
    expect(result.shouldOpenAuthDialog).toBe(true);
  });

  it('should handle undefined auth type', async () => {
    mockSettings.merged.security.auth.selectedType = undefined;
    const result = await initializeApp(
      mockConfig as unknown as Config,
      mockSettings,
    );

    expect(result.shouldOpenAuthDialog).toBe(true);
  });

  it('should handle theme error', async () => {
    vi.mocked(validateTheme).mockReturnValue('Theme not found');
    const result = await initializeApp(
      mockConfig as unknown as Config,
      mockSettings,
    );

    expect(result.themeError).toBe('Theme not found');
  });
});
