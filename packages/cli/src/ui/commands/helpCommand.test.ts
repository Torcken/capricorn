/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { helpCommand } from './helpCommand.js';
import { CommandKind, type CommandContext } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { MessageType } from '../types.js';

describe('helpCommand', () => {
  let mockContext: CommandContext;
  const originalPlatform = process.platform;
  const action = helpCommand.action;

  if (!action) {
    throw new Error('Help command has no action');
  }

  beforeEach(() => {
    mockContext = createMockCommandContext({
      ui: {
        addItem: vi.fn(),
      },
    } as unknown as CommandContext);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('should add a help message to the UI history by default', async () => {
    await action(mockContext, '');

    expect(mockContext.ui.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.HELP,
        timestamp: expect.any(Date),
      }),
    );
  });

  it('should have the correct command properties', () => {
    expect(helpCommand.name).toBe('help');
    expect(helpCommand.kind).toBe(CommandKind.BUILT_IN);
    expect(helpCommand.description).toBe('Show Capricorn help');
  });

  // Capricorn: upstream's Antigravity installer help was removed.
});
