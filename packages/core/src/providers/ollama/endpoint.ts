/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Validation of the Ollama endpoint against Capricorn's
 * local-only inference policy.
 *
 * Trust boundary: the endpoint URL may come from user settings, a *project*
 * `.capricorn/settings.json` (i.e. a cloned repository the user does not
 * control), or the `OLLAMA_HOST` / `CAPRICORN_OLLAMA_HOST` environment. A
 * malicious repository could otherwise point inference — and therefore every
 * prompt, including file contents — at an attacker's server. We therefore
 * accept only loopback hosts unless the user has explicitly opted into a
 * remote host, and the caller is responsible for surfacing that opt-in as
 * "not local-only" in the UI.
 */

import { OllamaError, OllamaErrorKind } from './errors.js';

/** The documented default Ollama endpoint. */
export const DEFAULT_OLLAMA_ENDPOINT = 'http://127.0.0.1:11434';

/** Result of resolving and validating an endpoint. */
export interface ResolvedOllamaEndpoint {
  /** Normalized base URL with no trailing slash, e.g. `http://127.0.0.1:11434`. */
  baseUrl: string;
  /** True when the host is a loopback address; false only with explicit opt-in. */
  isLoopback: boolean;
}

/**
 * Returns true when `hostname` (as parsed by WHATWG `URL`) denotes the local
 * loopback interface.
 *
 * Deliberately conservative: only the literal name `localhost`, the IPv4
 * 127.0.0.0/8 block and IPv6 `::1` qualify. Any other DNS name is treated as
 * remote even if it currently resolves to 127.0.0.1, because DNS answers can
 * change between validation and connection (DNS rebinding).
 */
export function isLoopbackHostname(hostname: string): boolean {
  // URL keeps IPv6 literals bracketed: "[::1]".
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '::1' || h === '0:0:0:0:0:0:0:1') {
    return true;
  }
  // IPv4-mapped IPv6 loopback, e.g. ::ffff:127.0.0.1 (URL normalizes it to hex).
  if (h.startsWith('::ffff:')) {
    const tail = h.slice('::ffff:'.length);
    if (/^7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(tail)) {
      return true;
    }
    return isLoopbackHostname(tail);
  }
  const parts = h.split('.');
  if (
    parts.length === 4 &&
    parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
  ) {
    return parts[0] === '127';
  }
  return false;
}

/**
 * Parses the endpoint the way `OLLAMA_HOST` is conventionally written
 * (`host`, `host:port`, or a full URL) and enforces the network policy.
 *
 * @param raw Endpoint text; `undefined`/empty means the default endpoint.
 * @param allowRemoteHost Explicit user opt-in to a non-loopback daemon.
 * @returns The normalized endpoint.
 * @throws {OllamaError} `ENDPOINT_NOT_ALLOWED` for a remote host without
 *   opt-in, for credentials embedded in the URL, or for non-HTTP schemes.
 */
export function resolveOllamaEndpoint(
  raw: string | undefined,
  allowRemoteHost = false,
): ResolvedOllamaEndpoint {
  const text = (raw ?? '').trim() || DEFAULT_OLLAMA_ENDPOINT;
  // OLLAMA_HOST commonly omits the scheme ("0.0.0.0:11434"); default to http.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text)
    ? text
    : `http://${text}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new OllamaError(
      OllamaErrorKind.ENDPOINT_NOT_ALLOWED,
      `Invalid Ollama endpoint: ${JSON.stringify(text)}.`,
    );
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new OllamaError(
      OllamaErrorKind.ENDPOINT_NOT_ALLOWED,
      `Unsupported Ollama endpoint scheme "${url.protocol}". Use http:// or https://.`,
    );
  }
  // Credentials in the URL would end up in logs and diagnostics output.
  if (url.username || url.password) {
    throw new OllamaError(
      OllamaErrorKind.ENDPOINT_NOT_ALLOWED,
      'Ollama endpoint must not embed credentials.',
    );
  }

  // A bind address of 0.0.0.0 is how `OLLAMA_HOST` is often set for the
  // *server*; as a client destination it means "this host", so map it to
  // loopback rather than rejecting a common configuration.
  if (url.hostname === '0.0.0.0') {
    url.hostname = '127.0.0.1';
  } else if (url.hostname === '[::]') {
    url.hostname = '[::1]';
  }
  if (!url.port && url.protocol === 'http:' && !/:\d+$/.test(url.host)) {
    url.port = '11434';
  }

  const isLoopback = isLoopbackHostname(url.hostname);
  if (!isLoopback && !allowRemoteHost) {
    throw new OllamaError(
      OllamaErrorKind.ENDPOINT_NOT_ALLOWED,
      `Refusing non-local Ollama endpoint ${url.origin}. Capricorn is local-only by default; ` +
        'set `ollama.allowRemoteHost: true` in your *user* settings to opt in.',
    );
  }

  // Drop any path/query: Capricorn appends documented /api/* paths itself.
  return { baseUrl: url.origin, isLoopback };
}
