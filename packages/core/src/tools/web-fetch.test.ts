/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Capricorn: web_fetch is a local, allowlisted download (the hosted
// URL-context and summarizing paths were removed), so these tests replace
// upstream's.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  WebFetchTool,
  isUrlAllowedForWebFetch,
  convertGithubUrlToRaw,
  resetWebFetchRateLimitForTesting,
  MAX_REDIRECTS,
} from './web-fetch.js';
import type { Config } from '../config/config.js';
import { ApprovalMode } from '../policy/types.js';
import { ToolErrorType } from './tool-error.js';
import { createMockMessageBus } from '../test-utils/mock-message-bus.js';
import * as fetchUtils from '../utils/fetch.js';

vi.mock('../utils/fetch.js', async (importOriginal) => {
  const actual = await importOriginal<typeof fetchUtils>();
  return {
    ...actual,
    fetchWithTimeout: vi.fn(),
    isPrivateIp: vi.fn().mockResolvedValue(false),
  };
});

const fetchMock = vi.mocked(fetchUtils.fetchWithTimeout);

function response(
  body: string,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: init.headers ?? { 'content-type': 'text/plain' },
  });
}

function makeTool(allowedHosts: string[]) {
  const config = {
    getWebFetchAllowedHosts: () => allowedHosts,
    getApprovalMode: () => ApprovalMode.DEFAULT,
    isContextManagementEnabled: () => false,
  } as unknown as Config;
  return new WebFetchTool(
    { config } as unknown as ConstructorParameters<typeof WebFetchTool>[0],
    createMockMessageBus(),
  );
}

async function run(tool: WebFetchTool, url: string) {
  return tool.build({ url }).execute({
    abortSignal: new AbortController().signal,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchUtils.isPrivateIp).mockResolvedValue(false);
  resetWebFetchRateLimitForTesting();
});

describe('isUrlAllowedForWebFetch', () => {
  it('matches hosts exactly and case-insensitively', () => {
    expect(
      isUrlAllowedForWebFetch('https://Docs.Python.org/3/', [
        'docs.python.org',
      ]),
    ).toBe(true);
    expect(
      isUrlAllowedForWebFetch('https://evil.docs.python.org/', [
        'docs.python.org',
      ]),
    ).toBe(false);
    expect(
      isUrlAllowedForWebFetch('https://python.org/', ['docs.python.org']),
    ).toBe(false);
  });

  it('accepts full URLs as list entries and refuses other protocols', () => {
    expect(
      isUrlAllowedForWebFetch('https://example.org/a', ['https://example.org']),
    ).toBe(true);
    expect(isUrlAllowedForWebFetch('file:///etc/passwd', ['example.org'])).toBe(
      false,
    );
    expect(isUrlAllowedForWebFetch('not a url', ['example.org'])).toBe(false);
  });
});

describe('WebFetchTool', () => {
  it('lists the allowed hosts in its description and takes one url', () => {
    const tool = makeTool(['docs.python.org']);
    const schema = tool.getSchema();
    expect(schema.description).toContain('Allowed hosts: docs.python.org');
    expect(schema.parametersJsonSchema).toMatchObject({ required: ['url'] });
  });

  it('rejects non-http URLs at validation', () => {
    const tool = makeTool(['example.org']);
    expect(() => tool.build({ url: 'ftp://example.org/x' })).toThrow(
      'Only http and https URLs can be fetched.',
    );
    expect(() => tool.build({ url: 'nope' })).toThrow('Invalid URL');
  });

  it('fetches an allowed host and wraps the text as untrusted', async () => {
    fetchMock.mockResolvedValue(response('hello'));
    const result = await run(makeTool(['example.org']), 'https://example.org/');
    expect(result.error).toBeUndefined();
    expect(String(result.llmContent)).toContain('hello');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.org/',
      expect.any(Number),
      expect.objectContaining({ redirect: 'manual' }),
    );
  });

  it('refuses a host that is not allowed, without any request', async () => {
    const result = await run(makeTool(['example.org']), 'https://other.org/');
    expect(result.error?.type).toBe(ToolErrorType.WEB_FETCH_PROCESSING_ERROR);
    expect(result.error?.message).toContain(
      'other.org is not in tools.webFetch.allowedHosts',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses private addresses even when the host is listed', async () => {
    vi.mocked(fetchUtils.isPrivateIp).mockResolvedValue(true);
    const result = await run(
      makeTool(['intranet.example']),
      'http://intranet.example/',
    );
    expect(result.error?.message).toContain('private host');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('follows redirects within allowed hosts', async () => {
    fetchMock
      .mockResolvedValueOnce(
        response('', { status: 301, headers: { location: '/new' } }),
      )
      .mockResolvedValueOnce(response('moved here'));
    const result = await run(
      makeTool(['example.org']),
      'https://example.org/old',
    );
    expect(String(result.llmContent)).toContain('moved here');
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://example.org/new',
      expect.any(Number),
      expect.anything(),
    );
  });

  it('stops at a redirect to a host that is not allowed', async () => {
    fetchMock.mockResolvedValueOnce(
      response('', {
        status: 302,
        headers: { location: 'https://attacker.example/steal' },
      }),
    );
    const result = await run(makeTool(['example.org']), 'https://example.org/');
    expect(result.error?.message).toContain('attacker.example is not in');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after too many redirects', async () => {
    fetchMock.mockImplementation(async () =>
      response('', { status: 302, headers: { location: '/loop' } }),
    );
    const result = await run(makeTool(['example.org']), 'https://example.org/');
    expect(result.error?.message).toContain('Too many redirects');
    expect(fetchMock).toHaveBeenCalledTimes(MAX_REDIRECTS + 1);
  });

  it('converts HTML to text', async () => {
    fetchMock.mockResolvedValue(
      response('<html><body><h1>Title</h1><p>Body</p></body></html>', {
        headers: { 'content-type': 'text/html' },
      }),
    );
    const result = await run(makeTool(['example.org']), 'https://example.org/');
    expect(String(result.llmContent)).toMatch(/TITLE[\s\S]*Body/);
  });

  it('reports HTTP errors to the model', async () => {
    fetchMock.mockResolvedValue(response('missing', { status: 404 }));
    const result = await run(
      makeTool(['example.org']),
      'https://example.org/x',
    );
    expect(String(result.llmContent)).toContain('status 404');
    expect(result.returnDisplay).toContain('Status: 404');
  });

  it('rate limits requests per host', async () => {
    fetchMock.mockImplementation(async () => response('ok'));
    const tool = makeTool(['example.org']);
    for (let i = 0; i < 10; i++) await run(tool, 'https://example.org/');
    const result = await run(tool, 'https://example.org/');
    expect(result.error?.message).toContain('Too many requests');
  });

  it('asks for confirmation naming the URL', async () => {
    const invocation = makeTool(['example.org']).build({
      url: 'https://example.org/page',
    }) as unknown as {
      getConfirmationDetails(signal: AbortSignal): Promise<unknown>;
    };
    // The policy engine decides *whether* to ask (write.toml: always, in
    // interactive sessions); these are the details the user is shown.
    const details = await invocation.getConfirmationDetails(
      new AbortController().signal,
    );
    expect(details).toMatchObject({
      type: 'info',
      urls: ['https://example.org/page'],
    });
  });

  it('still asks for approval in auto-edit mode', async () => {
    const config = {
      getWebFetchAllowedHosts: () => ['example.org'],
      getApprovalMode: () => ApprovalMode.AUTO_EDIT,
      isContextManagementEnabled: () => false,
    } as unknown as Config;
    const tool = new WebFetchTool(
      { config } as unknown as ConstructorParameters<typeof WebFetchTool>[0],
      createMockMessageBus(),
    );
    const invocation = tool.build({ url: 'https://example.org/' });
    expect(
      (invocation as unknown as { respectsAutoEdit: boolean }).respectsAutoEdit,
    ).toBe(false);
  });

  it('rewrites GitHub blob links only when the raw host is allowed', async () => {
    fetchMock.mockResolvedValue(response('code'));
    const blob = 'https://github.com/o/r/blob/main/a.ts';
    await run(makeTool(['github.com']), blob);
    expect(fetchMock).toHaveBeenLastCalledWith(
      blob,
      expect.any(Number),
      expect.anything(),
    );
    await run(makeTool(['github.com', 'raw.githubusercontent.com']), blob);
    expect(fetchMock).toHaveBeenLastCalledWith(
      convertGithubUrlToRaw(blob),
      expect.any(Number),
      expect.anything(),
    );
  });
});
