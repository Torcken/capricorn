/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { statsCommand } from './statsCommand.js';
import { type CommandContext } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { MessageType } from '../types.js';
import { formatDuration } from '../utils/formatters.js';
import type { Config } from '@capricorn/core';

vi.mock('@capricorn/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@capricorn/core')>();
  return {
    ...actual,
    UserAccountManager: vi.fn().mockImplementation(() => ({
      getCachedGoogleAccount: vi.fn().mockReturnValue('mock@example.com'),
    })),
    getG1CreditBalance: vi.fn().mockReturnValue(undefined),
  };
});

describe('statsCommand', () => {
  let mockContext: CommandContext;
  const startTime = new Date('2025-07-14T10:00:00.000Z');
  const endTime = new Date('2025-07-14T10:00:30.000Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(endTime);

    // 1. Create the mock context with all default values
    mockContext = createMockCommandContext();

    // 2. Directly set the property on the created mock context
    mockContext.session.stats.sessionStartTime = startTime;
  });

  it('should display general session stats when run with no subcommand', async () => {
    if (!statsCommand.action) throw new Error('Command has no action');

    mockContext.services.agentContext = {
      refreshUserQuota: vi.fn(),
      refreshAvailableCredits: vi.fn(),
      getUserTierName: vi.fn(),
      getUserPaidTier: vi.fn(),
      getModel: vi.fn(),
      get config() {
        return this;
      },
    } as unknown as Config;

    await statsCommand.action(mockContext, '');

    const expectedDuration = formatDuration(
      endTime.getTime() - startTime.getTime(),
    );
    expect(mockContext.ui.addItem).toHaveBeenCalledWith({
      type: MessageType.STATS,
      duration: expectedDuration,
      selectedAuthType: 'ollama-local', // Capricorn: always the local Ollama back-end
      tier: undefined,
      userEmail: 'mock@example.com',
      currentModel: undefined,
      creditBalance: undefined,
    });
  });

  // Capricorn: no Google quota lookup; the stats item carries no quota.
  it('shows tier and model without fetching any quota', async () => {
    if (!statsCommand.action) throw new Error('Command has no action');

    mockContext.services.agentContext = {
      getUserTierName: vi.fn().mockReturnValue('Basic'),
      getModel: vi.fn().mockReturnValue('gemma4:12b'),
      get config() {
        return this;
      },
    } as unknown as Config;

    await statsCommand.action(mockContext, '');

    const item = vi.mocked(mockContext.ui.addItem).mock.calls[0][0];
    expect(item).toEqual(
      expect.objectContaining({ tier: 'Basic', currentModel: 'gemma4:12b' }),
    );
    expect(item).not.toHaveProperty('quotas');
    expect(item).not.toHaveProperty('pooledRemaining');
  });

  it('should display model stats when using the "model" subcommand', () => {
    const modelSubCommand = statsCommand.subCommands?.find(
      (sc) => sc.name === 'model',
    );
    if (!modelSubCommand?.action) throw new Error('Subcommand has no action');

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    modelSubCommand.action(mockContext, '');

    expect(mockContext.ui.addItem).toHaveBeenCalledWith({
      type: MessageType.MODEL_STATS,
      selectedAuthType: 'ollama-local', // Capricorn: always the local Ollama back-end
      tier: undefined,
      userEmail: 'mock@example.com',
      currentModel: undefined,
      pooledRemaining: undefined,
      pooledLimit: undefined,
    });
  });

  it('should display tool stats when using the "tools" subcommand', () => {
    const toolsSubCommand = statsCommand.subCommands?.find(
      (sc) => sc.name === 'tools',
    );
    if (!toolsSubCommand?.action) throw new Error('Subcommand has no action');

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    toolsSubCommand.action(mockContext, '');

    expect(mockContext.ui.addItem).toHaveBeenCalledWith({
      type: MessageType.TOOL_STATS,
    });
  });
});
