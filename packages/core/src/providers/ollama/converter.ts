/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Protocol translation between the upstream Gemini
 * (`@google/genai`) content model used by the agent engine and Ollama's native
 * `/api/chat` message format.
 *
 * The agent loop, tool scheduler, history management and UI inherited from
 * Gemini CLI all speak `Content`/`Part`/`GenerateContentResponse`. Rather than
 * rewrite them, Capricorn translates at the provider boundary (ADR 0001).
 *
 * Semantic mismatches handled here, and why each mapping is correct:
 *
 * | Gemini                                 | Ollama                                   |
 * |----------------------------------------|------------------------------------------|
 * | `systemInstruction` (separate field)   | leading `role: "system"` message         |
 * | role `model`                           | role `assistant`                         |
 * | `functionCall` parts inside a `model`  | `tool_calls[]` on the assistant message  |
 * |   turn, args as an object              |   (Ollama also uses an object, not JSON  |
 * |                                        |   text as in the OpenAI API)             |
 * | `functionResponse` parts inside a      | one `role: "tool"` message *per* result, |
 * |   `user` turn                          |   with `tool_name` + `tool_call_id`      |
 * | `thought: true` text parts             | `thinking` field (assistant only)        |
 * | `inlineData` image parts               | `images[]` base64 on the same message    |
 * | `Schema` with `Type.OBJECT` enums       | lower-case JSON Schema                   |
 * | `finishReason` + `usageMetadata`       | `done_reason` + `*_eval_count`           |
 *
 * Ordering invariant: messages are emitted in exactly the order of the Gemini
 * parts, so a tool result always follows the assistant message that requested
 * it — Gemma's chat template relies on that adjacency.
 *
 * Trust: everything coming *back* from Ollama is model output and therefore
 * untrusted. Tool calls are structurally validated here (name syntax, argument
 * object shape); semantic validation against the tool's schema and the
 * permission decision happen later in the scheduler and policy engine.
 */

import type {
  Candidate,
  Content,
  ContentListUnion,
  ContentUnion,
  FunctionCall,
  FunctionDeclaration,
  GenerateContentConfig,
  Part,
  PartUnion,
  ToolListUnion,
} from '@google/genai';
// Capricorn: runtime values come from genaiRuntime, so the SDK is not bundled.
import {
  FinishReason,
  GenerateContentResponse,
} from '../../core/genaiRuntime.js';
import type {
  OllamaChatMessage,
  OllamaChatOptions,
  OllamaChatResponse,
  OllamaRequestToolCall,
  OllamaResponseToolCall,
  OllamaToolDefinition,
} from './wireTypes.js';

/**
 * Reserved argument key placed on a function call whose arguments could not
 * be parsed into an object. The tool scheduler refuses any call carrying it
 * (see `scheduler.ts`), guaranteeing malformed model output is never executed
 * while still letting the model see an error and self-correct.
 */
export const MALFORMED_ARGS_MARKER = '__capricorn_malformed_arguments__';

/** Tool names the model may legitimately emit (Gemini's own constraint). */
const TOOL_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/;

// ---------------------------------------------------------------------------
// Request direction: Gemini -> Ollama
// ---------------------------------------------------------------------------

/**
 * Normalizes the many shapes `ContentListUnion` allows into `Content[]`,
 * mirroring `@google/genai`'s own `tContents` semantics: bare strings and
 * parts become a single `user` turn.
 */
export function normalizeContents(contents: ContentListUnion): Content[] {
  const items: Array<Content | PartUnion> = Array.isArray(contents)
    ? contents
    : [contents];
  const out: Content[] = [];
  let looseParts: Part[] = [];
  const flushLoose = () => {
    if (looseParts.length > 0) {
      out.push({ role: 'user', parts: looseParts });
      looseParts = [];
    }
  };
  for (const item of items) {
    if (isContent(item)) {
      flushLoose();
      out.push(item);
    } else {
      looseParts.push(toPart(item));
    }
  }
  flushLoose();
  return out;
}

/** Flattens a `systemInstruction` value into plain text. */
export function systemInstructionToText(
  instruction: ContentUnion | undefined,
): string {
  if (instruction === undefined || instruction === null) {
    return '';
  }
  if (typeof instruction === 'string') {
    return instruction;
  }
  const parts: Part[] = isContent(instruction)
    ? (instruction.parts ?? [])
    : Array.isArray(instruction)
      ? instruction.map(toPart)
      : [toPart(instruction)];
  return parts
    .map((p) => p.text ?? '')
    .filter((t) => t.length > 0)
    .join('\n\n');
}

/**
 * Converts Gemini history plus system instruction to Ollama chat messages.
 *
 * @param contents Conversation history in Gemini form.
 * @param systemInstruction Optional system prompt.
 * @param options.includeThinking When true, prior `thought` parts are sent
 *   back in the `thinking` field; when false they are dropped, which keeps
 *   reasoning out of the context budget (the upstream default for history).
 */
export function toOllamaMessages(
  contents: ContentListUnion,
  systemInstruction?: ContentUnion,
  options: { includeThinking?: boolean } = {},
): OllamaChatMessage[] {
  const messages: OllamaChatMessage[] = [];
  const system = systemInstructionToText(systemInstruction);
  if (system) {
    messages.push({ role: 'system', content: system });
  }

  for (const content of normalizeContents(contents)) {
    const parts = content.parts ?? [];
    if (content.role === 'model') {
      messages.push(
        modelTurnToMessage(parts, options.includeThinking ?? false),
      );
      continue;
    }
    // `user` (or unspecified) turns: may interleave text, media and tool
    // results. Consecutive text/media parts are grouped into one user
    // message; each functionResponse becomes its own tool message, in order.
    let pending: OllamaChatMessage | undefined;
    const flush = () => {
      if (pending && (pending.content !== '' || pending.images?.length)) {
        messages.push(pending);
      }
      pending = undefined;
    };
    for (const part of parts) {
      if (part.functionResponse) {
        flush();
        messages.push(functionResponseToMessage(part));
        continue;
      }
      pending ??= { role: 'user', content: '' };
      appendUserPart(pending, part);
    }
    flush();
  }
  return messages;
}

/** Builds one assistant message from a Gemini `model` turn. */
function modelTurnToMessage(
  parts: Part[],
  includeThinking: boolean,
): OllamaChatMessage {
  const text: string[] = [];
  const thinking: string[] = [];
  const toolCalls: OllamaRequestToolCall[] = [];
  for (const part of parts) {
    if (part.functionCall) {
      toolCalls.push({
        ...(part.functionCall.id ? { id: part.functionCall.id } : {}),
        function: {
          name: part.functionCall.name ?? '',
          arguments: stripMarker(part.functionCall.args ?? {}),
        },
      });
    } else if (part.thought) {
      if (includeThinking && part.text) thinking.push(part.text);
    } else if (typeof part.text === 'string') {
      text.push(part.text);
    }
  }
  const message: OllamaChatMessage = {
    role: 'assistant',
    content: text.join(''),
  };
  if (thinking.length > 0) message.thinking = thinking.join('');
  if (toolCalls.length > 0) message.tool_calls = toolCalls;
  return message;
}

/**
 * Converts a `functionResponse` part to a `tool` message.
 *
 * Gemini function responses are structured objects (`{output: "..."}` or
 * `{error: "..."}` by upstream convention). Gemma consumes tool results as
 * text, so we unwrap the common single-field shapes and JSON-encode anything
 * else; no information is discarded.
 */
function functionResponseToMessage(part: Part): OllamaChatMessage {
  const fr = part.functionResponse!;
  const response = fr.response ?? {};
  let content: string;
  const keys = Object.keys(response);
  const output = response['output'];
  const error = response['error'];
  if (keys.length === 1 && keys[0] === 'output' && typeof output === 'string') {
    content = output;
  } else if (
    keys.length === 1 &&
    keys[0] === 'error' &&
    typeof error === 'string'
  ) {
    content = `Error: ${error}`;
  } else {
    content = safeStringify(response);
  }
  // Multimodal tool results (e.g. read_file on an image) carry nested parts.
  const images: string[] = [];
  for (const nested of fr.parts ?? []) {
    const data = nested.inlineData;
    if (data?.data && data.mimeType?.startsWith('image/')) {
      images.push(data.data);
    } else if (data || nested.fileData) {
      content += `\n[Attachment of type ${data?.mimeType ?? nested.fileData?.mimeType ?? 'unknown'} omitted: not supported by the local model]`;
    }
  }
  const message: OllamaChatMessage = {
    role: 'tool',
    content,
    tool_name: fr.name ?? '',
  };
  if (fr.id) message.tool_call_id = fr.id;
  if (images.length > 0) message.images = images;
  return message;
}

/** Appends a non-tool part to a pending user message. */
function appendUserPart(message: OllamaChatMessage, part: Part): void {
  if (typeof part.text === 'string') {
    message.content += message.content ? `\n${part.text}` : part.text;
    return;
  }
  const data = part.inlineData;
  if (data?.data && data.mimeType?.startsWith('image/')) {
    (message.images ??= []).push(data.data);
    return;
  }
  // Non-image media, file URIs and code-execution parts have no Ollama
  // equivalent. Leave an explicit marker instead of silently dropping input
  // the user believes the model saw.
  if (data || part.fileData) {
    const mime = data?.mimeType ?? part.fileData?.mimeType ?? 'unknown';
    message.content += `\n[Attachment of type ${mime} omitted: not supported by the local model]`;
  }
}

/**
 * Converts Gemini tool declarations into Ollama function tools.
 *
 * Only `functionDeclarations` are representable. Gemini built-in tools
 * (`googleSearch`, `urlContext`, `codeExecution`, ...) are hosted services and
 * are intentionally dropped — Capricorn must not depend on them.
 */
export function toOllamaTools(
  tools: ToolListUnion | undefined,
): OllamaToolDefinition[] {
  if (!tools) return [];
  const out: OllamaToolDefinition[] = [];
  const seen = new Set<string>();
  for (const tool of tools) {
    // `ToolUnion` also admits SDK CallableTool objects, which carry no
    // declarations of their own.
    const declarations: FunctionDeclaration[] =
      'functionDeclarations' in tool ? (tool.functionDeclarations ?? []) : [];
    for (const decl of declarations) {
      if (!decl.name || seen.has(decl.name)) continue;
      seen.add(decl.name);
      out.push({
        type: 'function',
        function: {
          name: decl.name,
          ...(decl.description ? { description: decl.description } : {}),
          parameters: declarationParameters(decl),
        },
      });
    }
  }
  return out;
}

function declarationParameters(
  decl: FunctionDeclaration,
): Record<string, unknown> {
  const raw =
    decl.parametersJsonSchema ??
    (decl.parameters ? geminiSchemaToJsonSchema(decl.parameters) : undefined);
  if (isPlainObject(raw)) {
    return raw;
  }
  // Tools without parameters still need an object schema for the template.
  return { type: 'object', properties: {} };
}

/**
 * Converts a Gemini OpenAPI-style `Schema` (upper-case `Type` enum values,
 * `nullable`, `anyOf`) into standard JSON Schema.
 *
 * Gemini's `Type.OBJECT` is the string `"OBJECT"`; JSON Schema requires
 * `"object"`. `nullable: true` maps to a type union with `"null"`. Unknown
 * keys are copied through so `description`, `enum`, `minimum` etc. survive.
 */
export function geminiSchemaToJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map(geminiSchemaToJsonSchema);
  }
  if (!schema || typeof schema !== 'object') {
    return schema;
  }
  if (!isPlainObject(schema)) {
    return schema;
  }
  const input = schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    switch (key) {
      case 'type':
        out['type'] =
          typeof value === 'string' && value !== 'TYPE_UNSPECIFIED'
            ? value.toLowerCase()
            : value;
        break;
      case 'nullable':
        // Folded into `type` below.
        break;
      case 'properties': {
        const props: Record<string, unknown> = {};
        for (const [name, sub] of Object.entries(
          isPlainObject(value) ? value : {},
        )) {
          props[name] = geminiSchemaToJsonSchema(sub);
        }
        out['properties'] = props;
        break;
      }
      case 'items':
      case 'anyOf':
        out[key] = geminiSchemaToJsonSchema(value);
        break;
      case 'propertyOrdering':
        // Gemini-only hint with no JSON Schema meaning.
        break;
      default:
        out[key] = value;
    }
  }
  const outType = out['type'];
  if (input['nullable'] === true && typeof outType === 'string') {
    out['type'] = [outType, 'null'];
  }
  return out;
}

/**
 * Maps Gemini generation config onto Ollama runtime options.
 *
 * @param config Request generation config (may be undefined).
 * @param numCtx The effective context window to allocate. Always set
 *   explicitly: Ollama's implicit default is small (and version-dependent),
 *   which would silently truncate the prompt from the front.
 */
export function toOllamaOptions(
  config: GenerateContentConfig | undefined,
  numCtx: number,
): OllamaChatOptions {
  const options: OllamaChatOptions = { num_ctx: numCtx };
  if (!config) return options;
  if (config.temperature !== undefined)
    options.temperature = config.temperature;
  if (config.topP !== undefined) options.top_p = config.topP;
  if (config.topK !== undefined) options.top_k = config.topK;
  if (config.seed !== undefined) options.seed = config.seed;
  if (config.maxOutputTokens !== undefined)
    options.num_predict = config.maxOutputTokens;
  if (config.stopSequences?.length) options.stop = config.stopSequences;
  if (config.presencePenalty !== undefined)
    options.presence_penalty = config.presencePenalty;
  if (config.frequencyPenalty !== undefined)
    options.frequency_penalty = config.frequencyPenalty;
  return options;
}

/**
 * Maps `responseMimeType`/`responseJsonSchema`/`responseSchema` onto
 * Ollama's `format` (structured outputs). Returns undefined for free text.
 */
export function toOllamaFormat(
  config: GenerateContentConfig | undefined,
): 'json' | Record<string, unknown> | undefined {
  if (!config || config.responseMimeType !== 'application/json') {
    return undefined;
  }
  const schema =
    config.responseJsonSchema ??
    (config.responseSchema
      ? geminiSchemaToJsonSchema(config.responseSchema)
      : undefined);
  if (isPlainObject(schema)) {
    return schema;
  }
  return 'json';
}

// ---------------------------------------------------------------------------
// Response direction: Ollama -> Gemini
// ---------------------------------------------------------------------------

/** Mutable per-request state used while converting a stream. */
export interface ToolCallIdAllocator {
  /** Returns a stable unique id for the n-th tool call of this response. */
  next(): string;
}

/** Creates an id allocator scoped to one model response. */
export function createToolCallIdAllocator(
  prefix = 'ollama',
): ToolCallIdAllocator {
  let n = 0;
  const salt = Date.now().toString(36);
  return { next: () => `${prefix}_${salt}_${n++}` };
}

/**
 * Validates and converts one Ollama tool call into a Gemini `FunctionCall`.
 *
 * Model output is untrusted. This function never throws; instead:
 *  - a syntactically invalid name is replaced by a sanitized placeholder that
 *    cannot match a registered tool, so the scheduler answers "tool not
 *    found" and nothing executes;
 *  - arguments that are not a JSON object (or a string containing one) are
 *    replaced by `{ [MALFORMED_ARGS_MARKER]: reason }`, which the scheduler
 *    rejects before building the tool invocation.
 * Both paths give the model an error result it can recover from.
 */
export function toFunctionCall(
  call: OllamaResponseToolCall,
  ids: ToolCallIdAllocator,
): FunctionCall {
  const rawName = call.function.name.trim();
  const name = TOOL_NAME_PATTERN.test(rawName)
    ? rawName
    : `invalid_tool_name_${rawName.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40)}`;
  const id = call.id && call.id.length <= 128 ? call.id : ids.next();
  return { id, name, args: normalizeArguments(call.function.arguments) };
}

/**
 * Accepts the argument encodings seen in practice — a JSON object (Ollama's
 * documented form), a JSON *string* of an object (OpenAI-style, emitted by
 * some templates), or nothing (zero-argument tools) — and rejects the rest.
 */
export function normalizeArguments(raw: unknown): Record<string, unknown> {
  if (raw === undefined || raw === null || raw === '') {
    return {};
  }
  if (isPlainObject(raw)) {
    return raw;
  }
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isPlainObject(parsed)) return parsed;
      return { [MALFORMED_ARGS_MARKER]: 'Arguments JSON is not an object.' };
    } catch {
      return { [MALFORMED_ARGS_MARKER]: 'Arguments are not valid JSON.' };
    }
  }
  return {
    [MALFORMED_ARGS_MARKER]: `Arguments must be an object, got ${Array.isArray(raw) ? 'array' : typeof raw}.`,
  };
}

/** Maps Ollama's `done_reason` to a Gemini `FinishReason`. */
export function toFinishReason(doneReason: string | undefined): FinishReason {
  switch (doneReason) {
    case 'length':
      return FinishReason.MAX_TOKENS;
    case 'stop':
    case 'unload':
    case undefined:
      // `unload` is reported when keep_alive=0 unloads after completion; the
      // generation itself finished normally.
      return FinishReason.STOP;
    default:
      return FinishReason.OTHER;
  }
}

/** Ollama usage counters mapped onto Gemini's usage metadata. */
function toUsage(
  frame: OllamaChatResponse,
): GenerateContentResponse['usageMetadata'] {
  if (frame.prompt_eval_count === undefined && frame.eval_count === undefined) {
    return undefined;
  }
  const prompt = frame.prompt_eval_count ?? 0;
  const output = frame.eval_count ?? 0;
  return {
    promptTokenCount: prompt,
    candidatesTokenCount: output,
    totalTokenCount: prompt + output,
  };
}

/**
 * Converts one Ollama frame (a whole non-streamed reply, or one streamed
 * delta) into a `GenerateContentResponse` chunk.
 *
 * For streams, each chunk carries only that frame's *delta* — upstream
 * `GeminiChat` concatenates text parts and collects function calls across
 * chunks, exactly as it does for the Gemini API. `finishReason` and usage are
 * attached only to the terminal (`done: true`) frame.
 *
 * @param seenToolCallIds Ids already emitted for this response; used to drop
 *   duplicate tool calls if a daemon repeats a call across frames.
 */
export function frameToResponse(
  frame: OllamaChatResponse,
  ids: ToolCallIdAllocator,
  seenToolCallIds: Set<string> = new Set(),
  sanitizeThinking: (delta: string) => string = (d) => d,
): GenerateContentResponse {
  const parts: Part[] = [];
  const msg = frame.message;
  const thinking = msg?.thinking ? sanitizeThinking(msg.thinking) : '';
  if (thinking) {
    parts.push({ text: thinking, thought: true });
  }
  if (msg?.content) {
    parts.push({ text: msg.content });
  }
  for (const call of msg?.tool_calls ?? []) {
    const fc = toFunctionCall(call, ids);
    if (fc.id && seenToolCallIds.has(fc.id)) continue;
    if (fc.id) seenToolCallIds.add(fc.id);
    parts.push({ functionCall: fc });
  }

  const candidate: Candidate = {
    index: 0,
    content: { role: 'model', parts },
  };
  if (frame.done) {
    candidate.finishReason = toFinishReason(frame.done_reason);
  }

  const response = new GenerateContentResponse();
  response.candidates = [candidate];
  if (frame.model) response.modelVersion = frame.model;
  const usage = frame.done ? toUsage(frame) : undefined;
  if (usage) response.usageMetadata = usage;
  return response;
}

/**
 * Creates a stateful filter for one response's `thinking` deltas that removes
 * Gemma 4 channel control tokens.
 *
 * Gemma 4 opens its reasoning with `<|channel>thought` and closes it with
 * `<channel|>`. Ollama normally consumes these, but in some turns (observed
 * after tool results, Ollama 0.30.11) they arrive verbatim as thinking text,
 * often split across deltas (`"<|channel>"`, then `"thought"`). Left in, they
 * show up in the UI and are sent back to the model in later turns. The filter
 * keeps one bit of state so a channel name in the *next* delta is dropped too.
 * Ordinary prose such as "a thought" is untouched: `thought` is only removed
 * directly after an opener.
 *
 * @returns A function mapping each raw delta to its cleaned text (possibly '').
 */
export function createThinkingSanitizer(): (delta: string) => string {
  let afterOpener = false;
  return (delta: string): string => {
    let out = delta;
    if (afterOpener) {
      afterOpener = false;
      out = out.replace(/^\s*thought\b[ \t]*/, '');
    }
    out = out.replace(/<channel\|>/g, '');
    if (out.includes('<|channel>')) {
      // An opener at the very end means its name arrives in the next delta.
      afterOpener = /<\|channel>\s*$/.test(out);
      out = out.replace(/<\|channel>(\s*thought\b[ \t]*)?/g, '');
    }
    return out;
  };
}

/** Gemma 4's end-of-thinking marker. */
const CHANNEL_CLOSE = '<channel|>';

/**
 * Content held back while waiting for a possible {@link CHANNEL_CLOSE} is
 * released as ordinary content beyond this size, so a long answer given
 * without any thinking still streams. Leaked thinking seen in evals was at
 * most ~4.4K characters.
 */
export const LEAKED_THINKING_BUFFER_CHARS = 8000;

/**
 * Creates a stateful per-response filter that recovers Gemma 4 thinking which
 * Ollama delivered as *content*.
 *
 * Why: with thinking enabled, Ollama (0.30.11) sometimes misses the opening
 * `<|channel>thought` marker, so the model's reasoning streams in the
 * `content` field until the closing `<channel|>`; the user saw raw reasoning
 * ("There are 6 … wait, let me re-count … 5") in front of the answer, and
 * checkers read the wrong number (11 of 431 eval runs, 8 of them failed).
 *
 * Rule: until the response has produced any `thinking`, content is held back.
 * If `<channel|>` arrives, the held text is thinking and only what follows is
 * content; if the response ends, or the held text exceeds
 * {@link LEAKED_THINKING_BUFFER_CHARS}, it is released unchanged. Once
 * thinking arrived normally, frames pass through without delay. Stray markers
 * are removed from content in every case. Only use this when `think: true`
 * was requested; otherwise there is no thinking to recover.
 */
export function createContentChannelSplitter(): (
  frame: OllamaChatResponse,
) => OllamaChatResponse {
  let decided = false;
  let held = '';
  return (frame) => {
    const msg = frame.message;
    if (!msg) {
      if (frame.done && held) {
        const out = { ...frame, message: { role: 'assistant', content: held } };
        held = '';
        decided = true;
        return out;
      }
      return frame;
    }
    let thinking = msg.thinking ?? '';
    let content = msg.content ?? '';
    if (!decided) {
      if (thinking) {
        // Normal case: Ollama separated the channels itself.
        decided = true;
        content = held + content;
        held = '';
      } else {
        held += content;
        content = '';
        const close = held.indexOf(CHANNEL_CLOSE);
        if (close !== -1) {
          thinking = held
            .slice(0, close)
            .replace(/^\s*(<\|channel>\s*(thought\b)?)?\s*/, '');
          content = held
            .slice(close + CHANNEL_CLOSE.length)
            .replace(/^\s+/, '');
          held = '';
          decided = true;
        } else if (frame.done || held.length > LEAKED_THINKING_BUFFER_CHARS) {
          content = held;
          held = '';
          decided = true;
        }
      }
    }
    content = content.split(CHANNEL_CLOSE).join('');
    if (content === msg.content && thinking === (msg.thinking ?? '')) {
      return frame;
    }
    return {
      ...frame,
      message: {
        ...msg,
        content,
        ...(thinking ? { thinking } : { thinking: undefined }),
      },
    };
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isContent(value: unknown): value is Content {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('parts' in value || 'role' in value) &&
    !('text' in value) &&
    !('functionCall' in value) &&
    !('functionResponse' in value)
  );
}

function toPart(value: PartUnion): Part {
  return typeof value === 'string' ? { text: value } : value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Never send our internal marker back to the model as if it had said it. */
function stripMarker(args: Record<string, unknown>): Record<string, unknown> {
  if (!(MALFORMED_ARGS_MARKER in args)) return args;
  const { [MALFORMED_ARGS_MARKER]: _omit, ...rest } = args;
  return rest;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
