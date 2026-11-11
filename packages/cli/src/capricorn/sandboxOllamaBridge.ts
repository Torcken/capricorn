/**
 * @license
 * Copyright 2026 Capricorn Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Host-side Ollama bridge for the container sandbox.
 *
 * Upstream's Docker/Podman sandbox re-launches the whole CLI *inside* the
 * container. For Capricorn that breaks inference twice over:
 *
 *  1. `127.0.0.1:11434` inside the container is the container's own loopback,
 *     not the host's Ollama daemon; and
 *  2. the sandbox network is `--internal` by default (network off), so the host
 *     is not reachable at all.
 *
 * Opening the network would defeat the sandbox. Instead the host process (which
 * stays outside the container for the whole session and is covered by the
 * egress guard) listens on a Unix socket inside the per-session sandbox temp
 * directory, which is bind-mounted into the container. Inside the container,
 * `socat` re-exposes that socket as `127.0.0.1:11434` (see `entrypoint()` in
 * `utils/sandboxUtils.ts`), so the in-container CLI sees an ordinary loopback
 * endpoint and still performs full Gemma 4 model verification.
 *
 * The bridge is deliberately an HTTP *filter*, not a byte pipe: anything that
 * runs in the container (including shell commands the user approves) can reach
 * it, and a raw pipe would expose `/api/pull`, `/api/push`, `/api/delete` and
 * `/api/create`. Pull/push make the *host* daemon talk to the internet, which
 * would silently turn a network-off sandbox into a network-on one. Only the
 * read-only and inference endpoints the agent uses are forwarded.
 */

import * as fs from 'node:fs';
import * as http from 'node:http';

/**
 * Method + path pairs the bridge forwards. Mirrors the calls made by
 * `OllamaClient` (packages/core/src/providers/ollama/client.ts); keep the two
 * in sync. Paths are matched exactly (no prefix matching), after stripping any
 * query string.
 */
export const BRIDGE_ALLOWED_ROUTES: ReadonlyArray<readonly [string, string]> = [
  ['GET', '/api/version'],
  ['GET', '/api/tags'],
  ['GET', '/api/ps'],
  ['POST', '/api/show'],
  ['POST', '/api/chat'],
];

/**
 * Hop-by-hop headers that must not be forwarded (RFC 9110 §7.6.1), plus
 * `host`, which is rewritten for the real upstream.
 */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
  'host',
]);

/**
 * Returns true when the bridge may forward a request with this method and
 * request target.
 *
 * @param method HTTP method as received (case-insensitive).
 * @param target Request target, e.g. `/api/chat` or `/api/tags?x=1`.
 */
export function isBridgeRouteAllowed(
  method: string | undefined,
  target: string | undefined,
): boolean {
  if (!method || !target) return false;
  // Only origin-form targets ("/path"); reject absolute-form
  // ("http://evil/...") and authority-form, which would turn the bridge into a
  // general forward proxy if mishandled.
  if (!target.startsWith('/')) return false;
  const path = target.split('?', 1)[0];
  const m = method.toUpperCase();
  return BRIDGE_ALLOWED_ROUTES.some(([am, ap]) => am === m && ap === path);
}

/** A running bridge. */
export interface OllamaBridge {
  /** Absolute path of the listening Unix socket on the host. */
  socketPath: string;
  /** Stops listening, aborts in-flight requests and removes the socket file. */
  close(): Promise<void>;
}

/** Options for {@link startOllamaBridge}. */
export interface OllamaBridgeOptions {
  /** Host path of the Unix socket to create (must not exist). */
  socketPath: string;
  /**
   * Verified Ollama base URL on the host, e.g. `http://127.0.0.1:11434`.
   * Callers must only pass an endpoint that already passed
   * `resolveOllamaEndpoint` and is loopback; the bridge re-checks the scheme.
   */
  upstreamBaseUrl: string;
}

/**
 * Starts the bridge.
 *
 * @returns Once the socket is listening.
 * @throws If the upstream URL is not plain HTTP or the socket cannot be bound.
 */
export async function startOllamaBridge(
  options: OllamaBridgeOptions,
): Promise<OllamaBridge> {
  const upstream = new URL(options.upstreamBaseUrl);
  if (upstream.protocol !== 'http:') {
    // Loopback Ollama is plain HTTP; HTTPS only appears with a remote host,
    // which the container sandbox refuses before getting here.
    throw new Error(
      `Ollama bridge supports only http:// upstreams, got ${upstream.protocol}`,
    );
  }
  // URL keeps IPv6 literals bracketed; http.request wants them bare.
  const upstreamHost = upstream.hostname.replace(/^\[|\]$/g, '');
  const upstreamPort = Number(upstream.port || 80);

  const inflight = new Set<http.ClientRequest>();

  const server = http.createServer((req, res) => {
    if (!isBridgeRouteAllowed(req.method, req.url)) {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          error:
            'Capricorn sandbox: this Ollama endpoint is not available inside ' +
            'the sandbox. Manage models (pull/delete) on the host.',
        }),
      );
      // Drain any request body so the connection can be reused cleanly.
      req.resume();
      return;
    }

    const headers: http.OutgoingHttpHeaders = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (value !== undefined && !HOP_BY_HOP.has(name)) headers[name] = value;
    }
    headers['host'] = upstream.host;

    const proxied = http.request(
      {
        host: upstreamHost,
        port: upstreamPort,
        method: req.method,
        path: req.url,
        headers,
      },
      (upstreamRes) => {
        const outHeaders: http.OutgoingHttpHeaders = {};
        for (const [name, value] of Object.entries(upstreamRes.headers)) {
          if (value !== undefined && !HOP_BY_HOP.has(name)) {
            outHeaders[name] = value;
          }
        }
        res.writeHead(upstreamRes.statusCode ?? 502, outHeaders);
        // pipe() preserves Ollama's NDJSON streaming chunk by chunk.
        upstreamRes.pipe(res);
      },
    );
    inflight.add(proxied);
    proxied.on('close', () => inflight.delete(proxied));
    proxied.on('error', (err) => {
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            error: `Capricorn sandbox bridge: Ollama unreachable (${err.message})`,
          }),
        );
      } else {
        // Mid-stream failure: cut the connection so the client sees a
        // truncated stream (classified retryable) instead of a hang.
        res.destroy(err);
      }
    });
    // If the in-container client disconnects (e.g. user cancelled), stop
    // generation upstream instead of letting the model run on.
    res.on('close', () => {
      if (!res.writableFinished) proxied.destroy();
    });
    req.pipe(proxied);
  });

  // Each HTTP request is short-lived or a single stream; no keep-alive pooling
  // concerns, but don't let idle sockets hold the session open at close().
  server.keepAliveTimeout = 5_000;

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.socketPath, () => {
      server.off('error', reject);
      resolve();
    });
  });

  return {
    socketPath: options.socketPath,
    close: () =>
      new Promise<void>((resolve) => {
        for (const r of inflight) r.destroy();
        server.closeAllConnections();
        server.close(() => {
          try {
            fs.rmSync(options.socketPath, { force: true });
          } catch {
            // The temp dir is removed by the sandbox cleanup anyway.
          }
          resolve();
        });
      }),
  };
}
