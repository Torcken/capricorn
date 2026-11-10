/**
 * @license
 * Copyright 2026 Capricorn Contributors
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
