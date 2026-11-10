/**
 * @license
 * Copyright 2026 Capricorn Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Process-wide outbound network guard.
 *
 * Capricorn promises "no unapproved external network calls" (spec §0, §6).
 * Disabling known telemetry/update code paths is necessary but not
 * sufficient: Capricorn inherits a large dependency tree, and any retained
 * library could open a connection we did not anticipate. This module enforces
 * the promise mechanically, in code, at the lowest common chokepoint:
 * `net.Socket.prototype.connect`.
 *
 * Why that chokepoint: in Node.js every TCP connection — `http`, `https`,
 * `tls`, undici-based global `fetch`, WebSocket clients, gRPC — is ultimately
 * opened via `Socket#connect`. Guarding it once covers all of them.
 * Hostnames are checked *before* DNS resolution, so a blocked destination is
 * never even looked up (no DNS leak of e.g. a telemetry hostname).
 *
 * Policy:
 *  - loopback destinations (Ollama, IDE companion, local MCP servers) and
 *    Unix-domain / named-pipe sockets are always allowed;
 *  - any other host is allowed only if it is on the explicit allowlist built
 *    from user opt-ins (remote Ollama host, configured remote MCP servers,
 *    `security.network.allowedHosts`);
 *  - everything else fails with an `EACCES`-style error and is reported to a
 *    callback so the UI can tell the user what was blocked.
 *
 * Limits (documented in docs/SECURITY.md): child processes (e.g. approved
 * shell commands, local MCP server processes) are separate OS processes and
 * are not covered; shell commands are gated by the approval engine and
 * optional sandbox instead. UDP (`dgram`) is not used by Capricorn and is not
 * guarded.
 */

import net from 'node:net';
import { isLoopbackHostname } from '../providers/ollama/endpoint.js';

/** Information about a blocked connection attempt. */
export interface BlockedConnection {
  host: string;
  port?: number;
  /** Wall-clock time of the attempt. */
  at: Date;
}

/** Options for {@link installEgressGuard}. */
export interface EgressGuardOptions {
  /**
   * Additional hosts (exact hostnames or IP literals, case-insensitive) that
   * may be contacted. A leading `*.` matches any subdomain.
   */
  allowHosts?: readonly string[];
  /** Called (synchronously) for each blocked attempt. */
  onBlocked?: (attempt: BlockedConnection) => void;
}

/** Error raised on a blocked socket. */
export class EgressBlockedError extends Error {
  readonly code = 'EACCES';
  constructor(
    readonly host: string,
    readonly port?: number,
  ) {
    super(
      `Capricorn blocked an outbound connection to ${host}${port ? `:${port}` : ''}. ` +
        'Only local connections are allowed by default; see `security.network.allowedHosts` in docs/SECURITY.md.',
    );
    this.name = 'EgressBlockedError';
  }
}

interface GuardState {
  originalConnect: typeof net.Socket.prototype.connect;
  allow: Set<string>;
  wildcard: string[];
  onBlocked?: (attempt: BlockedConnection) => void;
  blocked: BlockedConnection[];
}

let state: GuardState | undefined;

/**
 * Installs the guard. Idempotent: calling again replaces the policy (the
 * allowlist can grow at runtime when the user approves a remote MCP server)
 * without wrapping `connect` twice.
 */
export function installEgressGuard(options: EgressGuardOptions = {}): void {
  const hosts = (options.allowHosts ?? [])
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  const allow = new Set(hosts.filter((h) => !h.startsWith('*.')));
  const wildcard = hosts
    .filter((h) => h.startsWith('*.'))
    .map((h) => h.slice(1));
  if (state) {
    state.allow = allow;
    state.wildcard = wildcard;
    state.onBlocked = options.onBlocked;
    return;
  }
  const originalConnect = net.Socket.prototype.connect;
  state = {
    originalConnect,
    allow,
    wildcard,
    onBlocked: options.onBlocked,
    blocked: [],
  };

  // `connect` has many overloads: (options[, cb]), (port[, host][, cb]),
  // (path[, cb]). We only need to *read* the destination; the original
  // implementation still parses arguments itself.
  const guarded = function (this: net.Socket, ...args: unknown[]) {
    const dest = extractDestination(args);
    if (dest && !isAllowed(dest.host)) {
      const attempt = { host: dest.host, port: dest.port, at: new Date() };
      state?.blocked.push(attempt);
      try {
        state?.onBlocked?.(attempt);
      } catch {
        // A faulty reporter must never turn a block into an allow.
      }
      const err = new EgressBlockedError(dest.host, dest.port);
      // Fail asynchronously, as a real connection error would, so callers'
      // 'error' handlers attached after connect() still receive it.
      process.nextTick(() => this.destroy(err));
      return this;
    }
    // Re-applying an overloaded method with its original arguments cannot be
    // expressed without widening its type; the arguments are passed through
    // unchanged, so this is type-safe at runtime.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return (originalConnect as (...a: unknown[]) => net.Socket).apply(
      this,
      args,
    );
  };
  net.Socket.prototype.connect = guarded as typeof net.Socket.prototype.connect;
}

/** Removes the guard (tests only). */
export function uninstallEgressGuard(): void {
  if (state) {
    net.Socket.prototype.connect = state.originalConnect;
    state = undefined;
  }
}

/** Connection attempts blocked so far in this process (for `/status`, tests). */
export function getBlockedConnections(): readonly BlockedConnection[] {
  return state?.blocked ?? [];
}

/** Whether the guard is active. */
export function isEgressGuardInstalled(): boolean {
  return state !== undefined;
}

/**
 * Policy decision for one host. Exported for unit tests and for callers that
 * want to pre-check (e.g. warn before configuring a remote MCP server).
 */
export function isAllowed(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (isLoopbackHostname(h)) return true;
  if (!state) return true;
  if (state.allow.has(h)) return true;
  return state.wildcard.some(
    (suffix) => h.endsWith(suffix) && h.length > suffix.length,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Extracts `{host, port}` from `Socket#connect` arguments. Returns undefined
 * for IPC (Unix socket / Windows named pipe) connections, which are local by
 * construction.
 */
function extractDestination(
  args: unknown[],
): { host: string; port?: number } | undefined {
  let first = args[0];
  // Node's internal `normalizeArgs` passes an array [options, cb] in some paths.
  if (Array.isArray(first) && first.length > 0) {
    const inner: unknown = first[0];
    if (typeof inner === 'object') first = inner;
  }
  if (isRecord(first)) {
    const ipcPath = first['path'];
    if (typeof ipcPath === 'string' && ipcPath) return undefined;
    const hostValue = first['host'];
    const portValue = first['port'];
    const host =
      typeof hostValue === 'string' && hostValue ? hostValue : 'localhost';
    const port = portValue === undefined ? undefined : Number(portValue);
    return { host, port };
  }
  if (typeof first === 'string' && !/^\d+$/.test(first)) {
    // connect(path[, cb]) — IPC.
    return undefined;
  }
  if (typeof first === 'number' || typeof first === 'string') {
    const second: unknown = args[1];
    const host = typeof second === 'string' && second ? second : 'localhost';
    return { host, port: Number(first) };
  }
  return undefined;
}
