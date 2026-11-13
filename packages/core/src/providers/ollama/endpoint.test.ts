/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { isLoopbackHostname, resolveOllamaEndpoint } from './endpoint.js';
import { OllamaError, OllamaErrorKind } from './errors.js';

describe('isLoopbackHostname', () => {
  it.each([
    'localhost',
    '127.0.0.1',
    '127.12.0.5',
    '[::1]',
    '::1',
    '::ffff:127.0.0.1',
    '[::ffff:7f00:1]',
  ])('treats %s as loopback', (h) => {
    expect(isLoopbackHostname(h)).toBe(true);
  });

  it.each([
    '192.168.1.10',
    '10.0.0.1',
    'example.com',
    // DNS names are never trusted to be loopback (rebinding risk).
    'localhost.example.com',
    '127.0.0.1.nip.io',
    '128.0.0.1',
    '[::2]',
  ])('treats %s as remote', (h) => {
    expect(isLoopbackHostname(h)).toBe(false);
  });
});

describe('resolveOllamaEndpoint', () => {
  it('defaults to the documented local endpoint', () => {
    expect(resolveOllamaEndpoint(undefined)).toEqual({
      baseUrl: 'http://127.0.0.1:11434',
      isLoopback: true,
    });
  });

  it('accepts OLLAMA_HOST-style host:port and bare host', () => {
    expect(resolveOllamaEndpoint('localhost:11500').baseUrl).toBe(
      'http://localhost:11500',
    );
    expect(resolveOllamaEndpoint('127.0.0.1').baseUrl).toBe(
      'http://127.0.0.1:11434',
    );
  });

  it('maps the 0.0.0.0 server bind address to loopback', () => {
    expect(resolveOllamaEndpoint('0.0.0.0:11434').baseUrl).toBe(
      'http://127.0.0.1:11434',
    );
  });

  it('strips paths so only documented /api routes are used', () => {
    expect(resolveOllamaEndpoint('http://127.0.0.1:11434/v1/').baseUrl).toBe(
      'http://127.0.0.1:11434',
    );
  });

  // Threat: a project-level setting pointing inference at an attacker server.
  it('refuses remote hosts without explicit opt-in', () => {
    expect(() =>
      resolveOllamaEndpoint('http://evil.example.com:11434'),
    ).toThrow(
      expect.objectContaining({ kind: OllamaErrorKind.ENDPOINT_NOT_ALLOWED }),
    );
  });

  it('allows remote hosts only with opt-in and reports them as non-loopback', () => {
    expect(resolveOllamaEndpoint('http://gpu-box.lan:11434', true)).toEqual({
      baseUrl: 'http://gpu-box.lan:11434',
      isLoopback: false,
    });
  });

  it('rejects embedded credentials (they would leak into diagnostics)', () => {
    expect(() =>
      resolveOllamaEndpoint('http://user:secret@127.0.0.1:11434'),
    ).toThrow(OllamaError);
  });

  it('rejects non-http schemes', () => {
    expect(() => resolveOllamaEndpoint('file:///etc/passwd')).toThrow(
      OllamaError,
    );
  });
});
