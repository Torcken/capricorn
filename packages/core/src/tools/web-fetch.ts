/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview `web_fetch`: downloads one URL on this machine and returns
 * its text to the model.
 *
 * Capricorn: rewritten from upstream's tool, whose primary path handed the
 * URL to Gemini's hosted URL-context service (and whose "fallback" asked the
 * model to summarize). Only the direct download remains, and it is the first
 * Capricorn feature that reaches the internet on purpose, so it is fenced in:
 *
 * - Off unless the user enables `tools.webFetch` in their *user* settings
 *   with a non-empty `allowedHosts` (a project's settings cannot enable it);
 *   the tool is not even registered otherwise (config.ts).
 * - Only hosts in that list are fetched (exact host match). Redirects are
 *   followed by hand and every hop is checked again, so an allowed host
 *   cannot bounce the request elsewhere. The process-wide egress guard opens
 *   exactly these hosts too (cli/src/capricorn/networkPolicy.ts), as a second
 *   line of defence.
 * - Private, loopback and link-local addresses are refused (DNS is resolved
 *   first, see utils/fetch.ts), so a fetch cannot reach the LAN or Ollama.
 * - Every fetch asks for approval (policy/policies/write.toml; denied in
 *   non-interactive mode unless the policy allows it), and requests per host
 *   are rate limited.
 * - Content is size-limited and returned wrapped as untrusted data.
 */

import {
  type ToolConfirmationOutcome,
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolCallConfirmationDetails,
  type ToolInvocation,
  type ToolResult,
  type PolicyUpdateOptions,
  type ExecuteOptions,
} from './tools.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import { ToolErrorType } from './tool-error.js';
import { getErrorMessage } from '../utils/errors.js';
import { fetchWithTimeout, isPrivateIp } from '../utils/fetch.js';
import { truncateString, wrapUntrusted } from '../utils/textUtils.js';
import { convert } from 'html-to-text';
import { WEB_FETCH_TOOL_NAME, WEB_FETCH_DISPLAY_NAME } from './tool-names.js';
import { debugLogger } from '../utils/debugLogger.js';
import { WEB_FETCH_DEFINITION } from './definitions/coreTools.js';
import { resolveToolDeclaration } from './definitions/resolver.js';
import { LRUCache } from 'mnemonist';
import type { AgentLoopContext } from '../config/agent-loop-context.js';

const URL_FETCH_TIMEOUT_MS = 10000;
const MAX_CONTENT_LENGTH = 250000;
const MAX_FETCH_SIZE = 10 * 1024 * 1024; // 10MB
/** Redirect hops followed (each one re-checked against the allowlist). */
export const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const USER_AGENT =
  // Capricorn: identify as Capricorn, not as Google's Gemini CLI.
  'Mozilla/5.0 (compatible; Capricorn/1.0; +https://github.com/Torcken/capricorn)';
const TRUNCATION_WARNING = '\n\n... [Content truncated due to size limit] ...';

// Rate limiting configuration
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 10;
const hostRequestHistory = new LRUCache<string, number[]>(1000);

function checkRateLimit(url: string): {
  allowed: boolean;
  waitTimeMs?: number;
} {
  try {
    const hostname = new URL(url).hostname;
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW_MS;

    let history = hostRequestHistory.get(hostname) || [];
    // Clean up old timestamps
    history = history.filter((timestamp) => timestamp > windowStart);

    if (history.length >= MAX_REQUESTS_PER_WINDOW) {
      // Calculate wait time based on the oldest timestamp in the current window
      const oldestTimestamp = history[0];
      const waitTimeMs = oldestTimestamp + RATE_LIMIT_WINDOW_MS - now;
      hostRequestHistory.set(hostname, history); // Update cleaned history
      return { allowed: false, waitTimeMs: Math.max(0, waitTimeMs) };
    }

    history.push(now);
    hostRequestHistory.set(hostname, history);
    return { allowed: true };
  } catch {
    return { allowed: false };
  }
}

/** Clears the per-host rate limit history (tests only). */
export function resetWebFetchRateLimitForTesting(): void {
  hostRequestHistory.clear();
}

/**
 * Lower-cases a host and drops a trailing dot, so `Example.COM.` and
 * `example.com` compare equal. `URL` already converts IDNs to punycode.
 */
function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '');
}

/**
 * Whether `url` is an http(s) URL whose host is in `allowedHosts` (exact,
 * case-insensitive match; no wildcards, so `example.com` does not allow
 * `evil.example.com`). Entries may be bare hosts or full URLs.
 */
export function isUrlAllowedForWebFetch(
  url: string,
  allowedHosts: readonly string[],
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }
  const host = normalizeHost(parsed.hostname);
  return allowedHosts.some((entry) => {
    let allowed = entry;
    try {
      allowed = entry.includes('://') ? new URL(entry).hostname : entry;
    } catch {
      return false;
    }
    return normalizeHost(allowed) === host;
  });
}

/**
 * Safely converts a GitHub blob URL to a raw content URL.
 */
export function convertGithubUrlToRaw(urlStr: string): string {
  try {
    const url = new URL(urlStr);
    if (url.hostname === 'github.com' && url.pathname.includes('/blob/')) {
      url.hostname = 'raw.githubusercontent.com';
      url.pathname = url.pathname.replace(/^\/([^/]+\/[^/]+)\/blob\//, '/$1/');
      return url.href;
    }
  } catch {
    // Ignore invalid URLs
  }
  return urlStr;
}

/**
 * Parameters for the WebFetch tool
 */
export interface WebFetchToolParams {
  /** The http(s) URL to fetch; its host must be allowed. */
  url: string;
}

class WebFetchToolInvocation extends BaseToolInvocation<
  WebFetchToolParams,
  ToolResult
> {
  constructor(
    private readonly context: AgentLoopContext,
    params: WebFetchToolParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ) {
    super(
      params,
      messageBus,
      _toolName,
      _toolDisplayName,
      undefined,
      undefined,
      // Capricorn: false, so auto-edit mode does not skip the approval
      // (upstream's `true` auto-approved fetches there). Every download is
      // confirmed unless the user picks "allow" for the session or YOLO.
      false,
      () => this.context.config.getApprovalMode(),
    );
  }

  private get allowedHosts(): readonly string[] {
    return this.context.config.getWebFetchAllowedHosts();
  }

  /**
   * The URL actually requested first: GitHub blob links become raw links
   * when (and only when) raw.githubusercontent.com is allowed too.
   */
  private startUrl(): string {
    const raw = convertGithubUrlToRaw(this.params.url);
    return raw !== this.params.url &&
      isUrlAllowedForWebFetch(raw, this.allowedHosts)
      ? raw
      : this.params.url;
  }

  /** Why `url` may not be fetched, or undefined when it may. */
  private async refusal(url: string): Promise<string | undefined> {
    if (!isUrlAllowedForWebFetch(url, this.allowedHosts)) {
      let host = url;
      try {
        host = new URL(url).hostname;
      } catch {
        // keep the raw string
      }
      return `${host} is not in tools.webFetch.allowedHosts (allowed: ${this.allowedHosts.join(', ')}).`;
    }
    if (await isPrivateIp(url)) {
      return `Access to blocked or private host ${url} is not allowed.`;
    }
    return undefined;
  }

  private async readResponseWithLimit(
    response: Response,
    limit: number,
  ): Promise<Buffer> {
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > limit) {
      throw new Error(`Content exceeds size limit of ${limit} bytes`);
    }

    if (!response.body) {
      return Buffer.alloc(0);
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalLength = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalLength += value.length;
        if (totalLength > limit) {
          // Attempt to cancel the reader to stop the stream
          await reader.cancel().catch(() => {});
          throw new Error(`Content exceeds size limit of ${limit} bytes`);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks);
  }

  private error(message: string, type: ToolErrorType): ToolResult {
    return {
      llmContent: `Error: ${message}`,
      returnDisplay: `Error: ${message}`,
      error: { message, type },
    };
  }

  getDescription(): string {
    return `Fetch ${this.params.url}`;
  }

  override getPolicyUpdateOptions(
    _outcome: ToolConfirmationOutcome,
  ): PolicyUpdateOptions | undefined {
    return {};
  }

  protected override async getConfirmationDetails(
    _abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    const url = this.startUrl();
    return {
      type: 'info',
      title: `Confirm Web Fetch`,
      prompt: `Fetch ${url}`,
      urls: [url],
      onConfirm: async (_outcome: ToolConfirmationOutcome) => {
        // Mode transitions and policy updates are handled by the scheduler.
      },
    };
  }

  async execute({ abortSignal: signal }: ExecuteOptions): Promise<ToolResult> {
    let url = this.startUrl();
    const rate = checkRateLimit(url);
    if (!rate.allowed) {
      const wait = Math.ceil((rate.waitTimeMs ?? RATE_LIMIT_WINDOW_MS) / 1000);
      return this.error(
        `Too many requests to this host; try again in ${wait} s.`,
        ToolErrorType.WEB_FETCH_PROCESSING_ERROR,
      );
    }

    try {
      let response: Response | undefined;
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const refused = await this.refusal(url);
        if (refused) {
          debugLogger.warn(`[WebFetchTool] Refused ${url}: ${refused}`);
          return this.error(refused, ToolErrorType.WEB_FETCH_PROCESSING_ERROR);
        }
        const res = await fetchWithTimeout(url, URL_FETCH_TIMEOUT_MS, {
          signal,
          // Followed by hand below so every hop is checked against the list.
          redirect: 'manual',
          headers: {
            Accept:
              'text/markdown, text/plain;q=0.9, application/json;q=0.9, text/html;q=0.8, application/pdf;q=0.7, */*;q=0.5',
            'User-Agent': USER_AGENT,
          },
        });
        const location = res.headers.get('location');
        if (REDIRECT_STATUSES.has(res.status) && location) {
          await res.body?.cancel().catch(() => {});
          url = new URL(location, url).href;
          continue;
        }
        response = res;
        break;
      }
      if (!response) {
        return this.error(
          `Too many redirects (more than ${MAX_REDIRECTS}).`,
          ToolErrorType.WEB_FETCH_PROCESSING_ERROR,
        );
      }

      return await this.toResult(url, response);
    } catch (e) {
      const errorMessage = `Error fetching ${url}: ${getErrorMessage(e)}`;
      debugLogger.error(`[WebFetchTool] ${errorMessage}`);
      return this.error(errorMessage, ToolErrorType.WEB_FETCH_FALLBACK_FAILED);
    }
  }

  /** Converts a final (non-redirect) response into the tool result. */
  private async toResult(url: string, response: Response): Promise<ToolResult> {
    const contentType = response.headers.get('content-type') || '';
    const status = response.status;
    const bodyBuffer = await this.readResponseWithLimit(
      response,
      MAX_FETCH_SIZE,
    );
    const limitText = (text: string) =>
      this.context.config.isContextManagementEnabled()
        ? text
        : truncateString(text, MAX_CONTENT_LENGTH, TRUNCATION_WARNING);

    if (status >= 400) {
      const body = truncateString(
        bodyBuffer.toString('utf8'),
        10000,
        '\n\n... [Error response truncated] ...',
      );
      return {
        llmContent: wrapUntrusted(
          `Request failed with status ${status}\nResponse: ${body}`,
        ),
        returnDisplay: `Failed to fetch ${url} (Status: ${status})`,
      };
    }

    const lowContentType = contentType.toLowerCase();
    if (lowContentType.includes('text/html')) {
      const textContent = convert(bodyBuffer.toString('utf8'), {
        wordwrap: false,
        selectors: [
          { selector: 'a', options: { ignoreHref: false, baseUrl: url } },
        ],
      });
      return {
        llmContent: wrapUntrusted(limitText(textContent)),
        returnDisplay: `Fetched and converted HTML content from ${url}`,
      };
    }

    if (
      lowContentType.startsWith('image/') ||
      lowContentType === 'application/pdf'
    ) {
      return {
        llmContent: {
          inlineData: {
            data: bodyBuffer.toString('base64'),
            mimeType: contentType.split(';')[0],
          },
        },
        returnDisplay: `Fetched ${contentType} from ${url}`,
      };
    }

    // Markdown, plain text, JSON and unknown types: as text.
    return {
      llmContent: wrapUntrusted(limitText(bodyBuffer.toString('utf8'))),
      returnDisplay: `Fetched ${contentType || 'unknown'} content from ${url}`,
    };
  }
}

/** Parameter schema: a single URL. */
const URL_PARAMETERS = {
  type: 'object',
  properties: {
    url: {
      type: 'string',
      description: 'The http or https URL to fetch.',
    },
  },
  required: ['url'],
};

export class WebFetchTool extends BaseDeclarativeTool<
  WebFetchToolParams,
  ToolResult
> {
  static readonly Name = WEB_FETCH_TOOL_NAME;

  constructor(
    private readonly context: AgentLoopContext,
    messageBus: MessageBus,
  ) {
    super(
      WebFetchTool.Name,
      WEB_FETCH_DISPLAY_NAME,
      describe(context),
      Kind.Fetch,
      URL_PARAMETERS,
      messageBus,
      true, // isOutputMarkdown
      false, // canUpdateOutput
    );
  }

  protected override validateToolParamValues(
    params: WebFetchToolParams,
  ): string | null {
    if (!params.url) {
      return "The 'url' parameter is required.";
    }
    let parsed: URL;
    try {
      parsed = new URL(params.url);
    } catch {
      return `Invalid URL: "${params.url}"`;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return 'Only http and https URLs can be fetched.';
    }
    return null;
  }

  protected createInvocation(
    params: WebFetchToolParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ): ToolInvocation<WebFetchToolParams, ToolResult> {
    return new WebFetchToolInvocation(
      this.context,
      params,
      messageBus,
      _toolName,
      _toolDisplayName,
    );
  }

  override getSchema(modelId?: string) {
    const schema = resolveToolDeclaration(WEB_FETCH_DEFINITION, modelId);
    return {
      ...schema,
      description: describe(this.context),
      parametersJsonSchema: URL_PARAMETERS,
    };
  }
}

/** Tool description, naming the hosts the model may fetch from. */
function describe(context: AgentLoopContext): string {
  const hosts = context.config.getWebFetchAllowedHosts();
  return (
    'Download one web page or file from an allowed host and return its text ' +
    '(HTML is converted to text). One URL per call; the user approves each ' +
    `fetch. Allowed hosts: ${hosts.length > 0 ? hosts.join(', ') : 'none'}. ` +
    'Other hosts, and private or local addresses, are refused.'
  );
}
