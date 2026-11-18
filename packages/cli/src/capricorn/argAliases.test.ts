/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { rewriteCapricornAliases } from './argAliases.js';

describe('rewriteCapricornAliases', () => {
  it.each([
    [
      ['run', '--prompt', 'fix it'],
      ['--prompt', 'fix it'],
    ],
    [
      ['run', 'fix it', '--model', 'gemma4:e4b'],
      ['--prompt', 'fix it', '--model', 'gemma4:e4b'],
    ],
    [['sessions'], ['--list-sessions']],
    [['sessions', 'list'], ['--list-sessions']],
    [
      ['sessions', 'resume', '3'],
      ['--resume', '3'],
    ],
    [
      ['sessions', 'resume'],
      ['--resume', 'latest'],
    ],
    [
      ['sessions', 'delete', 'abc'],
      ['--delete-session', 'abc', '--confirm-delete'],
    ],
    [
      ['sessions', 'delete', 'abc', '--yes'],
      ['--delete-session', 'abc'],
    ],
    // Global options before the alias are kept.
    [
      ['--debug', 'run', 'fix it'],
      ['--debug', '--prompt', 'fix it'],
    ],
    [
      ['-m', 'gemma4:e4b', 'sessions', 'list'],
      ['-m', 'gemma4:e4b', '--list-sessions'],
    ],
    [
      ['--model=gemma4:e4b', '--skip-trust', 'run', 'fix it'],
      ['--model=gemma4:e4b', '--skip-trust', '--prompt', 'fix it'],
    ],
    // An option value or a prompt is never treated as an alias.
    [
      ['-m', 'run'],
      ['-m', 'run'],
    ],
    [
      ['-p', 'go', 'run'],
      ['-p', 'go', 'run'],
    ],
    [
      ['--unknown-flag', 'run', 'x'],
      ['--unknown-flag', 'run', 'x'],
    ],
    [
      ['--', 'run', 'x'],
      ['--', 'run', 'x'],
    ],
  ])('%j -> %j', (input, expected) => {
    expect(rewriteCapricornAliases(input).argv).toEqual(expected);
  });

  // A prompt that merely *contains* a command word must not be rewritten.
  it('only inspects the first token', () => {
    expect(
      rewriteCapricornAliases(['-p', 'run the sessions tests']).argv,
    ).toEqual(['-p', 'run the sessions tests']);
  });

  it('reports usage errors', () => {
    expect(rewriteCapricornAliases(['run']).error).toMatch(/Usage/);
    expect(rewriteCapricornAliases(['sessions', 'delete']).error).toMatch(
      /Usage/,
    );
    expect(rewriteCapricornAliases(['sessions', 'nuke']).error).toMatch(
      /Unknown/,
    );
  });
});
