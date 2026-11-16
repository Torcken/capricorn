/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { runExitCleanup } from './cleanup.js';
import { waitForUpdateCompletion } from './handleAutoUpdate.js';

// Capricorn: the supervisor helpers live in relaunchSupervisor.ts (kept free
// of heavy imports for startup time); re-exported here for existing callers.
export {
  FORWARDED_SIGNALS,
  setupSignalForwarding,
  handleChildProcessClose,
  RELAUNCH_EXIT_CODE,
  isStandardSea,
  getScriptArgs,
  isSeaEnvironment,
  getSpawnConfig,
  type ProcessWithSea,
} from './relaunchSupervisor.js';
import { RELAUNCH_EXIT_CODE } from './relaunchSupervisor.js';

/**
 * Exits the process with a special code to signal that the parent process should relaunch it.
 */
let isRelaunching = false;

/** @internal only for testing */
export function _resetRelaunchStateForTesting(): void {
  isRelaunching = false;
}

export async function relaunchApp(options?: {
  overrideAuthType?: string;
}): Promise<void> {
  if (isRelaunching) return;
  isRelaunching = true;
  await waitForUpdateCompletion();

  if (process.send && !process.env['VITEST'] && options?.overrideAuthType) {
    await new Promise<void>((resolve) => {
      let resolved = false;
      const done = () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };
      const timeout = setTimeout(done, 500);
      try {
        process.send!(
          {
            type: 'auth-selected-type',
            authType: options.overrideAuthType,
          },
          () => {
            clearTimeout(timeout);
            done();
          },
        );
      } catch {
        clearTimeout(timeout);
        done();
      }
    });
  }

  await runExitCleanup();

  process.exit(RELAUNCH_EXIT_CODE);
}
