/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  doneFrame,
  startMockOllama,
  textFrame,
  type MockOllama,
} from '@google/gemini-cli-core/dist/src/providers/ollama/testing/mockOllamaServer.js';
import {
  isBridgeRouteAllowed,
  startOllamaBridge,
  type OllamaBridge,
} from './sandboxOllamaBridge.js';

/** Minimal HTTP-over-Unix-socket request, as socat would relay it. */
function request(
  socketPath: string,
  method: string,
  target: string,
  body?: unknown,
): Promise<{ status: number; text: string; chunks: number }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath,
        method,
        path: target,
        headers: body ? { 'content-type': 'application/json' } : {},
      },
      (res) => {
        let text = '';
        let chunks = 0;
        res.setEncoding('utf8');
        res.on('data', (c: string) => {
          text += c;
          chunks++;
        });
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, text, chunks }),
        );
      },
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('isBridgeRouteAllowed', () => {
  it('allows exactly the inference and read-only routes', () => {
    expect(isBridgeRouteAllowed('POST', '/api/chat')).toBe(true);
    expect(isBridgeRouteAllowed('post', '/api/show')).toBe(true);
    expect(isBridgeRouteAllowed('GET', '/api/tags?x=1')).toBe(true);
    expect(isBridgeRouteAllowed('GET', '/api/version')).toBe(true);
    expect(isBridgeRouteAllowed('GET', '/api/ps')).toBe(true);
  });

  it('blocks model management, which makes the host daemon use the network', () => {
    for (const p of [
      '/api/pull',
      '/api/push',
      '/api/delete',
      '/api/create',
      '/api/copy',
      '/api/blobs/sha256:00',
    ]) {
      expect(isBridgeRouteAllowed('POST', p)).toBe(false);
      expect(isBridgeRouteAllowed('DELETE', p)).toBe(false);
    }
  });

  it('blocks wrong methods, prefix tricks and non-origin-form targets', () => {
    expect(isBridgeRouteAllowed('GET', '/api/chat')).toBe(false);
    expect(isBridgeRouteAllowed('POST', '/api/chat/../pull')).toBe(false);
    expect(isBridgeRouteAllowed('POST', '/api/chatx')).toBe(false);
    expect(isBridgeRouteAllowed('GET', 'http://example.com/api/tags')).toBe(
      false,
    );
    expect(isBridgeRouteAllowed('CONNECT', 'example.com:443')).toBe(false);
    expect(isBridgeRouteAllowed(undefined, '/api/tags')).toBe(false);
  });
});

describe('startOllamaBridge', () => {
  let mock: MockOllama;
  let dir: string;
  let bridge: OllamaBridge;

  beforeEach(async () => {
    mock = await startMockOllama();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-bridge-'));
    bridge = await startOllamaBridge({
      socketPath: path.join(dir, 'ollama.sock'),
      upstreamBaseUrl: mock.url,
    });
  });

  afterEach(async () => {
    await bridge.close();
    await mock.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('forwards allowed reads to the upstream daemon', async () => {
    const res = await request(bridge.socketPath, 'GET', '/api/tags');
    expect(res.status).toBe(200);
    expect(
      JSON.parse(res.text).models.map((m: { name: string }) => m.name),
    ).toContain('gemma4:12b');
    const show = await request(bridge.socketPath, 'POST', '/api/show', {
      model: 'gemma4:12b',
    });
    expect(show.status).toBe(200);
    expect(mock.requests.at(-1)?.body).toEqual({ model: 'gemma4:12b' });
  });

  it('streams /api/chat NDJSON through without buffering it into one chunk', async () => {
    mock.enqueueChat({
      frames: [textFrame('Hel'), textFrame('lo'), doneFrame()],
      delayMs: 30,
    });
    const res = await request(bridge.socketPath, 'POST', '/api/chat', {
      model: 'gemma4:12b',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    });
    expect(res.status).toBe(200);
    const lines = res.text.trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(res.chunks).toBeGreaterThan(1);
  });

  it('refuses /api/pull with 403 and never contacts the daemon', async () => {
    const before = mock.requests.length;
    const res = await request(bridge.socketPath, 'POST', '/api/pull', {
      model: 'attacker/model',
    });
    expect(res.status).toBe(403);
    expect(res.text).toMatch(/not available inside the sandbox/);
    expect(mock.requests.length).toBe(before);
  });

  it('answers 502 when the daemon is down', async () => {
    await mock.close();
    const res = await request(bridge.socketPath, 'GET', '/api/version');
    expect(res.status).toBe(502);
    expect(res.text).toMatch(/Ollama unreachable/);
    // Restart so afterEach's close() has something to close.
    mock = await startMockOllama();
  });

  it('removes the socket file on close', async () => {
    expect(fs.existsSync(bridge.socketPath)).toBe(true);
    await bridge.close();
    expect(fs.existsSync(bridge.socketPath)).toBe(false);
    // Re-create so afterEach can close again harmlessly.
    bridge = await startOllamaBridge({
      socketPath: bridge.socketPath,
      upstreamBaseUrl: mock.url,
    });
  });

  it('rejects non-http upstreams', async () => {
    await expect(
      startOllamaBridge({
        socketPath: path.join(dir, 'other.sock'),
        upstreamBaseUrl: 'https://example.com',
      }),
    ).rejects.toThrow(/only http/);
  });
});
