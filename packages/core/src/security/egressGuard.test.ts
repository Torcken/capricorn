/**
 * @license
 * Copyright 2026 Capricorn Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import {
  getBlockedConnections,
  installEgressGuard,
  isAllowed,
  uninstallEgressGuard,
  type BlockedConnection,
} from './egressGuard.js';

afterEach(() => uninstallEgressGuard());

async function withLocalServer<T>(fn: (port: number) => Promise<T>): Promise<T> {
  const server = http.createServer((_req, res) => res.end('ok'));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    return await fn((server.address() as AddressInfo).port);
  } finally {
    server.close();
  }
}

describe('egress guard', () => {
  it('allows loopback connections through fetch', async () => {
    installEgressGuard();
    await withLocalServer(async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      expect(await res.text()).toBe('ok');
    });
  });

  // Threat: a retained dependency or tool phoning home (telemetry, update
  // checks, data exfiltration by a prompt-injected web request).
  it('blocks fetch to an external host before any DNS lookup', async () => {
    const seen: BlockedConnection[] = [];
    installEgressGuard({ onBlocked: (b) => seen.push(b) });
    await expect(fetch('https://telemetry.example.com/collect')).rejects.toThrow();
    expect(seen.map((b) => b.host)).toContain('telemetry.example.com');
    expect(getBlockedConnections().length).toBeGreaterThan(0);
  });

  it('blocks node:https requests', async () => {
    installEgressGuard();
    const err = await new Promise<Error>((resolve) => {
      https.get('https://www.googleapis.com/', () => resolve(new Error('connected'))).on('error', resolve);
    });
    expect(err.message).toContain('blocked an outbound connection');
  });

  it('blocks raw net sockets to IP literals', async () => {
    installEgressGuard();
    const err = await new Promise<Error>((resolve) => {
      const s = net.connect(443, '93.184.216.34');
      s.on('error', resolve);
      s.on('connect', () => resolve(new Error('connected')));
    });
    expect((err as { code?: string }).code).toBe('EACCES');
  });

  it('honours explicit allowlist entries and wildcards', () => {
    installEgressGuard({ allowHosts: ['mcp.example.org', '*.corp.internal'] });
    expect(isAllowed('mcp.example.org')).toBe(true);
    expect(isAllowed('MCP.EXAMPLE.ORG')).toBe(true);
    expect(isAllowed('api.corp.internal')).toBe(true);
    expect(isAllowed('corp.internal.evil.com')).toBe(false);
    expect(isAllowed('example.org')).toBe(false);
    expect(isAllowed('::1')).toBe(true);
  });

  it('is idempotent and can update its allowlist', () => {
    installEgressGuard();
    installEgressGuard({ allowHosts: ['a.example'] });
    expect(isAllowed('a.example')).toBe(true);
    uninstallEgressGuard();
    // After uninstall the prototype is restored.
    expect(net.Socket.prototype.connect.name).not.toBe('guarded');
  });

  it('a throwing reporter cannot turn a block into an allow', async () => {
    installEgressGuard({
      onBlocked: () => {
        throw new Error('reporter bug');
      },
    });
    await expect(fetch('http://example.com/')).rejects.toThrow();
  });
});
