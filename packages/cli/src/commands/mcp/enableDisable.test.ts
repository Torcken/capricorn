/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Argv } from 'yargs';

const { enable, disable, exitCli, log, getServers } = vi.hoisted(() => ({
  enable: vi.fn(async () => {}),
  disable: vi.fn(async () => {}),
  exitCli: vi.fn(async () => {}),
  log: vi.fn(),
  getServers: vi.fn(),
}));

vi.mock('@capricorn/core', () => ({ debugLogger: { log } }));
vi.mock('../../config/mcp/mcpServerEnablement.js', () => ({
  McpServerEnablementManager: {
    getInstance: () => ({
      enable,
      disable,
      clearSessionDisable: vi.fn(),
      disableForSession: vi.fn(),
    }),
  },
  canLoadServer: vi.fn(async () => ({ allowed: true })),
  normalizeServerId: (id: string) => id.toLowerCase().trim(),
}));
vi.mock('../../config/settings.js', () => ({
  loadSettings: () => ({ merged: {} }),
}));
vi.mock('../utils.js', () => ({ exitCli }));
vi.mock('./list.js', () => ({ getMcpServersFromConfig: getServers }));

import { disableCommand, enableCommand } from './enableDisable.js';

const run = async (
  cmd: typeof enableCommand | typeof disableCommand,
  name: string,
) => {
  await cmd.handler({ name, session: false, _: [], $0: 'capricorn' });
};

// Capricorn: regression for an upstream bug. getMcpServersFromConfig()
// returns { mcpServers, blockedServerNames }, and enable/disable read the
// keys of that wrapper, so every configured server was "not found".
describe('mcp enable/disable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    getServers.mockResolvedValue({
      mcpServers: { demo: { command: 'node' } },
      blockedServerNames: [],
    });
  });

  it('enables and disables a configured server', async () => {
    await run(disableCommand, 'demo');
    expect(disable).toHaveBeenCalledWith('demo');
    await run(enableCommand, 'demo');
    expect(enable).toHaveBeenCalledWith('demo');
    expect(exitCli).toHaveBeenLastCalledWith(0);
  });

  it('exits non-zero for an unknown server', async () => {
    await run(enableCommand, 'missing');
    expect(enable).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('not found'));
    expect(exitCli).toHaveBeenLastCalledWith(1);
    process.exitCode = undefined;
  });

  it('declares its positional name argument', () => {
    const yargs = {
      positional: vi.fn().mockReturnThis(),
      option: vi.fn().mockReturnThis(),
    };
    (enableCommand.builder as (y: Argv) => Argv)(yargs as unknown as Argv);
    expect(yargs.positional).toHaveBeenCalledWith(
      'name',
      expect.objectContaining({ demandOption: true }),
    );
  });
});
