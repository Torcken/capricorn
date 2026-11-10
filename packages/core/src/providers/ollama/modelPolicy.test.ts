/**
 * @license
 * Copyright 2026 Capricorn Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  isCloudModel,
  prefilterTagModel,
  verifyGemma4Model,
} from './modelPolicy.js';
import type { OllamaShowResponse } from './wireTypes.js';

/** Metadata as reported by Ollama 0.30 for a real gemma4:12b install. */
const GEMMA4_SHOW: OllamaShowResponse = {
  details: {
    family: 'gemma4',
    families: ['gemma4'],
    parameter_size: '11.9B',
    quantization_level: 'Q4_K_M',
  },
  model_info: {
    'general.architecture': 'gemma4',
    'gemma4.context_length': 262144,
  },
  capabilities: ['completion', 'vision', 'tools', 'thinking'],
};

describe('verifyGemma4Model', () => {
  it('accepts a model whose GGUF architecture is gemma4', () => {
    const v = verifyGemma4Model('gemma4:12b', GEMMA4_SHOW);
    expect(v).toMatchObject({
      allowed: true,
      reason: 'verified-architecture',
      maxContextLength: 262144,
      parameterSize: '11.9B',
    });
  });

  it('accepts a re-tagged Gemma 4 (names are not trusted either way)', () => {
    expect(verifyGemma4Model('my-coder:latest', GEMMA4_SHOW).allowed).toBe(
      true,
    );
  });

  // Threat: `ollama cp qwen3:8b gemma4:fake` — a misleading alias.
  it('rejects a non-Gemma model even when its tag says gemma4', () => {
    const v = verifyGemma4Model('gemma4:fake', {
      details: { family: 'qwen3' },
      model_info: { 'general.architecture': 'qwen3' },
      capabilities: ['completion', 'tools'],
    });
    expect(v).toMatchObject({ allowed: false, reason: 'wrong-architecture' });
  });

  it('rejects earlier Gemma generations', () => {
    const v = verifyGemma4Model('gemma3:12b', {
      model_info: { 'general.architecture': 'gemma3' },
    });
    expect(v.allowed).toBe(false);
  });

  it('falls back to family metadata on older daemons without model_info', () => {
    const v = verifyGemma4Model('gemma4:e4b', {
      details: { family: 'gemma4' },
    });
    expect(v).toMatchObject({ allowed: true, reason: 'verified-family' });
  });

  it('rejects models with no verifiable metadata', () => {
    expect(verifyGemma4Model('mystery', {})).toMatchObject({
      allowed: false,
      reason: 'unverifiable',
    });
  });

  it('rejects cloud-backed models even if their architecture is gemma4', () => {
    expect(verifyGemma4Model('gemma4:31b-cloud', GEMMA4_SHOW).reason).toBe(
      'cloud-model',
    );
    expect(
      verifyGemma4Model('gemma4:31b', {
        ...GEMMA4_SHOW,
        remote_host: 'https://ollama.com:443',
      }).reason,
    ).toBe('cloud-model');
  });

  it('rejects a Gemma 4 build that lacks tool calling', () => {
    expect(
      verifyGemma4Model('gemma4:odd', {
        ...GEMMA4_SHOW,
        capabilities: ['completion'],
      }).reason,
    ).toBe('no-tool-support');
  });
});

describe('prefilterTagModel', () => {
  it('rejects other families without an /api/show round trip', () => {
    expect(
      prefilterTagModel({
        name: 'qwen3:8b',
        details: { family: 'qwen3', families: ['qwen3'] },
      }),
    ).toMatchObject({ allowed: false, reason: 'wrong-architecture' });
  });

  it('never accepts on its own', () => {
    expect(
      prefilterTagModel({ name: 'gemma4:12b', details: { family: 'gemma4' } }),
    ).toBeUndefined();
  });
});

describe('isCloudModel', () => {
  it.each([
    ['gemma4:cloud', {}, true],
    ['gemma4:31b-cloud', {}, true],
    ['gemma4:12b', { remote_model: 'x' }, true],
    ['gemma4:12b', {}, false],
    ['library/cloudy:latest', {}, false],
  ])('%s %j -> %s', (name, meta, expected) => {
    expect(isCloudModel(name, meta)).toBe(expected);
  });
});
