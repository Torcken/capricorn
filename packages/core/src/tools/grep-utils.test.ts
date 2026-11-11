/**
 * @license
 * Copyright 2026 Capricorn Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { autoContextLines } from './grep-utils.js';

describe('autoContextLines', () => {
  it.each([
    [0, undefined],
    [1, 50],
    [2, 15],
    [3, 15],
    [4, 2],
    [20, 2],
    [21, undefined],
  ])('%i matches -> %s lines', (matches, expected) => {
    expect(autoContextLines(matches)).toBe(expected);
  });
});
