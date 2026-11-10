/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { CommandKind, type SlashCommand } from './types.js';
import { MessageType, type HistoryItemHelp } from '../types.js';

export const helpCommand: SlashCommand = {
  name: 'help',
  kind: CommandKind.BUILT_IN,
  description: 'Show Capricorn help',
  autoExecute: true,
  action: async (context) => {
    // Capricorn: upstream's Antigravity CLI install/migration promotion was
    // removed; /help only shows Capricorn's own help.
    const helpItem: Omit<HistoryItemHelp, 'id'> = {
      type: MessageType.HELP,
      timestamp: new Date(),
    };

    context.ui.addItem(helpItem);
  },
};
