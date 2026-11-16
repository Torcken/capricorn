#!/usr/bin/env node

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn } from 'node:child_process';
import os from 'node:os';
import v8 from 'node:v8';
import {
  RELAUNCH_EXIT_CODE,
  getSpawnConfig,
  getScriptArgs,
  setupSignalForwarding,
  handleChildProcessClose,
} from './src/utils/relaunchSupervisor.js';

// --- Global Entry Point ---

async function getMemoryNodeArgs(): Promise<string[]> {
  let autoConfigureMemory = true;
  try {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    // Capricorn: user settings live in ~/.capricorn (CAPRICORN_HOME, or the
    // upstream GEMINI_CLI_HOME, overrides the home directory as in
    // core/src/utils/paths.ts). Upstream read ~/.gemini here, so the
    // advanced.autoConfigureMemory setting was silently ignored.
    const home =
      process.env['CAPRICORN_HOME'] ||
      process.env['GEMINI_CLI_HOME'] ||
      os.homedir();
    const settingsPath = join(home, '.capricorn', 'settings.json');
    const rawSettings = readFileSync(settingsPath, 'utf8');
    const settings = JSON.parse(rawSettings);
    if (settings?.advanced?.autoConfigureMemory === false) {
      autoConfigureMemory = false;
    }
  } catch {
    // ignore
  }

  if (autoConfigureMemory) {
    const totalMemoryMB = os.totalmem() / (1024 * 1024);
    const heapStats = v8.getHeapStatistics();
    const currentMaxOldSpaceSizeMb = Math.floor(
      heapStats.heap_size_limit / 1024 / 1024,
    );
    const targetMaxOldSpaceSizeInMB = Math.floor(totalMemoryMB * 0.5);

    if (targetMaxOldSpaceSizeInMB > currentMaxOldSpaceSizeMb) {
      return [`--max-old-space-size=${targetMaxOldSpaceSizeInMB}`];
    }
  }

  return [];
}

/**
 * Capricorn: answers a bare `--version` / `-v` without relaunching or loading
 * the app (it took ~1.9 s, as the parent and child each loaded the bundle).
 * Only in the bundle, where the build inlines CLI_VERSION; source runs fall
 * through to yargs.
 */
function printVersionFastPath(): boolean {
  const version = process.env['CLI_VERSION'];
  const args = getScriptArgs();
  if (
    version &&
    args.length === 1 &&
    (args[0] === '--version' || args[0] === '-v')
  ) {
    process.stdout.write(`${version}\n`);
    return true;
  }
  return false;
}

/**
 * Capricorn: caches V8's compiled code on disk (Node >= 22.1; skipped on
 * older Node). Compiling the ~16 MB bundle took ~0.4 s of every start.
 *
 * The cache holds only bytecode for Capricorn's own code, never user data.
 * It lives in a private (0700) directory under ~/.capricorn rather than
 * Node's default shared `/tmp/node-compile-cache`, so another local account
 * cannot plant cache entries this process would load.
 * NODE_DISABLE_COMPILE_CACHE=1 turns it off.
 */
async function enableCompileCache(): Promise<void> {
  try {
    const nodeModule = (await import('node:module')) as {
      enableCompileCache?: (directory?: string) => unknown;
    };
    if (typeof nodeModule.enableCompileCache !== 'function') return;
    const { mkdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const home =
      process.env['CAPRICORN_HOME'] ||
      process.env['GEMINI_CLI_HOME'] ||
      os.homedir();
    const directory = join(home, '.capricorn', 'cache', 'compile');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    nodeModule.enableCompileCache(directory);
  } catch {
    // A missing cache only costs startup time.
  }
}

async function run() {
  if (printVersionFastPath()) {
    return;
  }
  if (!process.env['GEMINI_CLI_NO_RELAUNCH'] && !process.env['SANDBOX']) {
    // --- Lightweight Parent Process / Daemon ---
    // We avoid importing heavy dependencies here to save ~1.5s of startup time.

    const scriptArgs = getScriptArgs();
    const memoryArgs = await getMemoryNodeArgs();
    const { spawnArgs, env: newEnv } = getSpawnConfig(memoryArgs, scriptArgs);

    let latestAdminSettings: unknown = undefined;

    const runner = () => {
      process.stdin.pause();

      const child = spawn(process.execPath, spawnArgs, {
        stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
        env: newEnv,
      });

      // Clear one-time auth override from supervisor environment after passing to child
      delete process.env['GEMINI_CLI_AUTH_OVERRIDE'];
      delete newEnv['GEMINI_CLI_AUTH_OVERRIDE'];

      if (latestAdminSettings) {
        child.send({ type: 'admin-settings', settings: latestAdminSettings });
      }

      child.on(
        'message',
        (msg: { type?: string; settings?: unknown; authType?: string }) => {
          if (msg.type === 'admin-settings-update' && msg.settings) {
            latestAdminSettings = msg.settings;
          }
          if (msg.type === 'auth-selected-type' && msg.authType) {
            process.env['GEMINI_CLI_AUTH_OVERRIDE'] = msg.authType;
            newEnv['GEMINI_CLI_AUTH_OVERRIDE'] = msg.authType;
          }
        },
      );

      const removeForwarders = setupSignalForwarding(child);

      return new Promise<number>((resolve) => {
        child.on('error', (err) => {
          removeForwarders();
          process.stderr.write(
            'Error: Failed to start child process: ' + err.message + '\n',
          );
          resolve(1);
        });
        child.on('close', (code, signal) => {
          handleChildProcessClose(code, signal, removeForwarders, resolve);
        });
      });
    };

    while (true) {
      try {
        const exitCode = await runner();
        if (process.platform === 'android' || exitCode !== RELAUNCH_EXIT_CODE) {
          process.exit(exitCode);
        }
      } catch (error: unknown) {
        process.stdin.resume();
        process.stderr.write(
          `Fatal error: Failed to relaunch the CLI process.\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
        );
        process.exit(1);
      }
    }
  } else {
    // --- Heavy Child Process ---
    await enableCompileCache();
    // Now we can safely import everything.
    const { main } = await import('./src/main.js');
    const { FatalError, writeToStderr } = await import('@capricorn/core');
    const { runExitCleanup } = await import('./src/utils/cleanup.js');

    main().catch(async (error: unknown) => {
      // Set a timeout to force exit if cleanup hangs
      const cleanupTimeout = setTimeout(() => {
        writeToStderr('Cleanup timed out, forcing exit...\n');
        process.exit(1);
      }, 5000);

      try {
        await runExitCleanup();
      } catch (cleanupError: unknown) {
        writeToStderr(
          `Error during final cleanup: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}\n`,
        );
      } finally {
        clearTimeout(cleanupTimeout);
      }

      if (error instanceof FatalError) {
        let errorMessage = error.message;
        if (!process.env['NO_COLOR']) {
          errorMessage = `\x1b[31m${errorMessage}\x1b[0m`;
        }
        writeToStderr(errorMessage + '\n');
        process.exit(error.exitCode);
      }

      writeToStderr('An unexpected critical error occurred:');
      if (error instanceof Error) {
        writeToStderr(error.stack + '\n');
      } else {
        writeToStderr(String(error) + '\n');
      }
      process.exit(1);
    });
  }
}

run();
