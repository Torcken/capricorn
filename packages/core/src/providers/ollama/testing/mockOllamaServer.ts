/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Deterministic in-process mock of the Ollama HTTP API for
 * unit, integration and E2E tests.
 *
 * It listens on a real loopback socket (port 0 = ephemeral), so the code under
 * test exercises the genuine `fetch` + NDJSON streaming path, including
 * chunk boundaries, slow streams, truncation and mid-stream failures, without
 * a GPU or a multi-GB model. Every request body is recorded for assertions.
 *
 * It can also be started as a standalone process (see
 * `scripts/mock-ollama.js`) for end-to-end tests of the compiled CLI.
 */

import http from 'node:http';

/** A model the mock reports as installed. */
export interface MockModel {
  name: string;
  family: string;
  architecture?: string;
  capabilities?: string[];
  contextLength?: number;
  remoteHost?: string;
  parameterSize?: string;
  quantization?: string;
  size?: number;
  /**
   * Extra `model_info` keys returned only for `"verbose": true`, as Ollama
   * does for per-layer arrays (used by context-window sizing).
   */
  verboseModelInfo?: Record<string, unknown>;
}

/**
 * One scripted `/api/chat` reply. `frames` are serialized as NDJSON (or the
 * last frame is returned as a single JSON body for non-streamed requests).
 */
export interface MockChatScript {
  frames: Array<Record<string, unknown>>;
  /** HTTP status to return instead of streaming (e.g. 404, 500). */
  status?: number;
  /** Body for a non-2xx status. */
  errorBody?: Record<string, unknown>;
  /** Split each NDJSON line into chunks of at most this many bytes. */
  chunkBytes?: number;
  /** Delay between written chunks, in ms. */
  delayMs?: number;
  /** Destroy the socket after N frames (simulates a crashed runner). */
  truncateAfterFrames?: number;
  /** Wait this long before sending headers (first-byte latency). */
  headerDelayMs?: number;
}

/** A request the mock received. */
export interface RecordedRequest {
  method: string;
  path: string;
  body: unknown;
}

/** Handle returned by {@link startMockOllama}. */
export interface MockOllama {
  /** Base URL such as `http://127.0.0.1:54321`. */
  url: string;
  requests: RecordedRequest[];
  /** Queues chat replies, consumed in FIFO order. */
  enqueueChat(...scripts: MockChatScript[]): void;
  /** Requests to /api/chat only. */
  chatRequests(): RecordedRequest[];
  close(): Promise<void>;
}

/** The mock's default installed models: two Gemma 4 plus decoys. */
export const DEFAULT_MOCK_MODELS: MockModel[] = [
  {
    name: 'gemma4:12b',
    family: 'gemma4',
    capabilities: ['completion', 'tools', 'thinking'],
    contextLength: 262144,
    parameterSize: '11.9B',
    quantization: 'Q4_K_M',
    size: 8_021_618_941,
  },
  {
    name: 'gemma4:e4b',
    family: 'gemma4',
    capabilities: ['completion', 'tools'],
    contextLength: 131072,
    parameterSize: '7.5B',
    quantization: 'Q4_K_M',
    size: 6_583_656_505,
  },
  {
    name: 'qwen3:8b',
    family: 'qwen3',
    capabilities: ['completion', 'tools'],
    contextLength: 40960,
  },
  // A misleading alias: tag says gemma4, weights say otherwise.
  {
    name: 'gemma4:fake',
    family: 'qwen3',
    architecture: 'qwen3',
    capabilities: ['completion', 'tools'],
  },
  {
    name: 'gemma4:31b-cloud',
    family: 'gemma4',
    capabilities: ['completion', 'tools'],
    remoteHost: 'https://ollama.com:443',
  },
];

/**
 * Starts the mock server on 127.0.0.1.
 *
 * When the chat queue is empty, `/api/chat` answers with a short plain-text
 * reply so incidental background calls (e.g. title generation) do not fail.
 */
export async function startMockOllama(
  options: {
    models?: MockModel[];
    version?: string;
    defaultReply?: string;
    /**
     * Models `/api/pull` can "download": pulling one adds it to the installed
     * list, so pull-then-verify flows can be tested. Pulling any other name
     * still reports success without installing anything.
     */
    pullable?: MockModel[];
  } = {},
): Promise<MockOllama> {
  // Copied: pulls add to this list, and callers' arrays must not change.
  const models = [...(options.models ?? DEFAULT_MOCK_MODELS)];
  const version = options.version ?? '0.30.11';
  const queue: MockChatScript[] = [];
  const requests: RecordedRequest[] = [];

  const server = http.createServer((req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (c: string) => (raw += c));
    req.on('end', () => {
      let body: unknown = undefined;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        body = raw;
      }
      const path = (req.url ?? '/').split('?')[0];
      requests.push({ method: req.method ?? 'GET', path, body });
      void route(path, body, res);
    });
  });

  const json = (res: http.ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(value));
  };

  const route = async (
    path: string,
    body: unknown,
    res: http.ServerResponse,
  ): Promise<void> => {
    const model = stringField(body, 'model');
    switch (path) {
      case '/api/version':
        return json(res, 200, { version });
      case '/api/tags':
        return json(res, 200, {
          models: models.map((m) => ({
            name: m.name,
            model: m.name,
            size: m.size ?? 1_000_000,
            digest: `sha256:${m.name.replace(/\W/g, '')}`,
            details: {
              family: m.family,
              families: [m.family],
              parameter_size: m.parameterSize,
              quantization_level: m.quantization,
            },
            ...(m.remoteHost
              ? { remote_host: m.remoteHost, remote_model: m.name }
              : {}),
          })),
        });
      case '/api/show': {
        const m = models.find((x) => x.name === model);
        if (!m) return json(res, 404, { error: `model '${model}' not found` });
        const arch = m.architecture ?? m.family;
        return json(res, 200, {
          details: {
            family: m.family,
            families: [m.family],
            parameter_size: m.parameterSize,
            quantization_level: m.quantization,
          },
          model_info: {
            'general.architecture': arch,
            [`${arch}.context_length`]: m.contextLength ?? 8192,
            ...(isRecord(body) && body['verbose'] === true
              ? m.verboseModelInfo
              : {}),
          },
          capabilities: m.capabilities,
          ...(m.remoteHost
            ? { remote_host: m.remoteHost, remote_model: m.name }
            : {}),
        });
      }
      case '/api/ps':
        return json(res, 200, { models: [] });
      case '/api/pull': {
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        res.write(JSON.stringify({ status: 'pulling manifest' }) + '\n');
        res.write(
          JSON.stringify({
            status: 'downloading',
            digest: 'sha256:x',
            total: 100,
            completed: 100,
          }) + '\n',
        );
        const pulled = options.pullable?.find((m) => m.name === model);
        if (pulled && !models.some((m) => m.name === pulled.name)) {
          models.push(pulled);
        }
        res.end(JSON.stringify({ status: 'success' }) + '\n');
        return;
      }
      case '/api/chat':
        return chat(body, res);
      default:
        return json(res, 404, { error: 'not found' });
    }
  };

  const chat = async (body: unknown, res: http.ServerResponse) => {
    const requestedModel = stringField(body, 'model');
    if (!models.some((m) => m.name === requestedModel)) {
      return json(res, 404, {
        error: `model "${requestedModel}" not found, try pulling it first`,
      });
    }
    const script: MockChatScript = queue.shift() ?? {
      frames: [
        {
          message: { role: 'assistant', content: options.defaultReply ?? 'OK' },
          done: false,
        },
        {
          message: { role: 'assistant', content: '' },
          done: true,
          done_reason: 'stop',
          prompt_eval_count: 10,
          eval_count: 2,
        },
      ],
    };
    if (script.headerDelayMs) await sleep(script.headerDelayMs);
    if (script.status && script.status >= 400) {
      return json(
        res,
        script.status,
        script.errorBody ?? { error: 'mock failure' },
      );
    }
    const stream = field(body, 'stream') !== false;
    if (!stream) {
      // Non-streamed: merge frames the way Ollama does (concatenate content).
      const merged = mergeFrames(script.frames);
      return json(res, 200, merged);
    }
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    let n = 0;
    for (const frame of script.frames) {
      if (
        script.truncateAfterFrames !== undefined &&
        n >= script.truncateAfterFrames
      ) {
        res.socket?.destroy();
        return;
      }
      const line = Buffer.from(JSON.stringify(frame) + '\n');
      const size = script.chunkBytes ?? line.length;
      for (let i = 0; i < line.length; i += size) {
        if (res.destroyed) return;
        res.write(line.subarray(i, i + size));
        if (script.delayMs) await sleep(script.delayMs);
      }
      n++;
    }
    res.end();
  };

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    enqueueChat: (...scripts) => queue.push(...scripts),
    chatRequests: () => requests.filter((r) => r.path === '/api/chat'),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function mergeFrames(
  frames: Array<Record<string, unknown>>,
): Record<string, unknown> {
  let content = '';
  let thinking = '';
  const toolCalls: unknown[] = [];
  let last: Record<string, unknown> = {};
  for (const f of frames) {
    const m = (f['message'] ?? {}) as {
      content?: string;
      thinking?: string;
      tool_calls?: unknown[];
    };
    content += m.content ?? '';
    thinking += m.thinking ?? '';
    toolCalls.push(...(m.tool_calls ?? []));
    last = f;
  }
  return {
    ...last,
    message: {
      role: 'assistant',
      content,
      ...(thinking ? { thinking } : {}),
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    },
    done: true,
  };
}

/** Reads a property of an untrusted JSON body. */
function field(body: unknown, key: string): unknown {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (Object.getOwnPropertyDescriptor(body, key)?.value as unknown)
    : undefined;
}

function stringField(body: unknown, key: string): string | undefined {
  const v = field(body, key);
  return typeof v === 'string' ? v : undefined;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Frame builders for concise test scripts
// ---------------------------------------------------------------------------

/** A streamed text delta frame. */
export function textFrame(content: string): Record<string, unknown> {
  return {
    model: 'gemma4:12b',
    message: { role: 'assistant', content },
    done: false,
  };
}

/** A frame carrying complete tool calls (Ollama sends them whole). */
export function toolCallFrame(
  ...calls: Array<{ id?: string; name: string; args: unknown }>
): Record<string, unknown> {
  return {
    model: 'gemma4:12b',
    message: {
      role: 'assistant',
      content: '',
      tool_calls: calls.map((c, i) => ({
        ...(c.id ? { id: c.id } : {}),
        function: { index: i, name: c.name, arguments: c.args },
      })),
    },
    done: false,
  };
}

/** The terminal frame with usage counters. */
export function doneFrame(
  usage: { prompt?: number; output?: number; reason?: string } = {},
): Record<string, unknown> {
  return {
    model: 'gemma4:12b',
    message: { role: 'assistant', content: '' },
    done: true,
    done_reason: usage.reason ?? 'stop',
    prompt_eval_count: usage.prompt ?? 42,
    eval_count: usage.output ?? 7,
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
