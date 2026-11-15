/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Builds Capricorn's outbound-network allowlist from settings
 * and installs the process-wide egress guard.
 *
 * Trust boundary: only *user*-scope settings can widen the allowlist.
 * Workspace settings live in the repository being worked on, which may be
 * hostile; letting them add hosts would let a cloned repo exfiltrate data by
 * declaring a "remote MCP server". Remote MCP servers declared in workspace
 * settings are therefore blocked until the user adds the host to their own
 * `security.network.allowedHosts`.
 */

import {
  debugLogger,
  installEgressGuard,
  type BlockedConnection,
} from '@capricorn/core';
import type { LoadedSettings } from '../config/settings.js';

/** Hosts reported once per process, to avoid flooding the UI. */
const reported = new Set<string>();

/**
 * Collects hosts the user explicitly opted into, from user settings only.
 */
export function collectAllowedHosts(settings: LoadedSettings): string[] {
  const user = settings.user.settings;
  const hosts = new Set<string>(user.security?.network?.allowedHosts ?? []);

  // A remote Ollama host is reachable only with the user-scope opt-in.
  if (user.ollama?.allowRemoteHost === true) {
    const endpoint =
      process.env['CAPRICORN_OLLAMA_HOST'] ||
      process.env['OLLAMA_HOST'] ||
      user.ollama?.endpoint;
    const host = hostOf(endpoint);
    if (host) hosts.add(host);
  }

  // Remote MCP servers the user configured themselves.
  for (const server of Object.values(user.mcpServers ?? {})) {
    const url =
      (server as { httpUrl?: string; url?: string }).httpUrl ??
      (server as { url?: string }).url;
    const host = hostOf(url);
    if (host) hosts.add(host);
  }
  return [...hosts];
}

/**
 * Installs the egress guard for this process. Blocked attempts are written
 * to the debug log and, when `CAPRICORN_EGRESS_REPORT=1`, to stderr (used by
 * the offline verification test).
 */
export function installCapricornNetworkPolicy(settings: LoadedSettings): void {
  installEgressGuard({
    allowHosts: collectAllowedHosts(settings),
    onBlocked: (attempt: BlockedConnection) => {
      const key = `${attempt.host}:${attempt.port ?? ''}`;
      if (reported.has(key)) return;
      reported.add(key);
      debugLogger.warn(`[capricorn] blocked outbound connection to ${key}`);
      if (process.env['CAPRICORN_EGRESS_REPORT'] === '1') {
        process.stderr.write(`[capricorn-egress] blocked ${key}\n`);
      }
    },
  });
}

function hostOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const withScheme = /^[a-z]+:\/\//i.test(value) ? value : `http://${value}`;
    return new URL(withScheme).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    return undefined;
  }
}
