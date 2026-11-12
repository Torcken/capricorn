/**
 * @license
 * Copyright 2026 Capricorn Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Portions adapted from @google/genai 1.30.0 (Copyright 2025 Google LLC,
 * Apache-2.0): enum values, `createUserContent`, and the
 * `GenerateContentResponse` convenience getters.
 */

/**
 * @fileoverview Capricorn: local runtime values for the `@google/genai` data
 * model.
 *
 * Why: Capricorn keeps the `@google/genai` *types* as its internal message
 * model (so the upstream agent loop stays mergeable), but importing any
 * *value* from that package makes the bundle include the whole SDK: the
 * hosted Gemini / Vertex AI clients, their endpoint URLs and
 * `google-auth-library`. None of that code can run in Capricorn, so it should
 * not ship. This module supplies the few values the code base uses. All
 * imports from `@google/genai` here are type-only and erased at build time.
 *
 * The enum stand-ins are typed as the SDK's enums, so they stay assignable to
 * every SDK-typed field; `enumValues` makes the compiler check that keys and
 * values match the SDK exactly, and `genaiRuntime.test.ts` compares them with
 * the real SDK at runtime.
 *
 * Non-test source must import these values from here, never from
 * `@google/genai`; `security/noGoogleServices.test.ts` enforces this.
 */

import type * as genai from '@google/genai';

/**
 * Returns a checker that accepts exactly the members of enum `E` (same keys,
 * same string values) and returns them typed as `E`.
 */
function enumValues<E extends Record<string, string>>() {
  function check<const T extends { [K in keyof E]: `${E[K]}` }>(
    values: T & Record<Exclude<keyof T, keyof E>, never>,
  ): E {
    // The constraint above already proved `values` has exactly E's members;
    // the cast only re-labels the plain object as the enum type.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return values as unknown as E;
  }
  return check;
}

/** Runtime values of the SDK's `Type` (JSON-schema type names). */
export const Type = enumValues<typeof genai.Type>()({
  TYPE_UNSPECIFIED: 'TYPE_UNSPECIFIED',
  STRING: 'STRING',
  NUMBER: 'NUMBER',
  INTEGER: 'INTEGER',
  BOOLEAN: 'BOOLEAN',
  ARRAY: 'ARRAY',
  OBJECT: 'OBJECT',
  NULL: 'NULL',
});
export type Type = genai.Type;

/** Runtime values of the SDK's `FinishReason`. */
export const FinishReason = enumValues<typeof genai.FinishReason>()({
  FINISH_REASON_UNSPECIFIED: 'FINISH_REASON_UNSPECIFIED',
  STOP: 'STOP',
  MAX_TOKENS: 'MAX_TOKENS',
  SAFETY: 'SAFETY',
  RECITATION: 'RECITATION',
  LANGUAGE: 'LANGUAGE',
  OTHER: 'OTHER',
  BLOCKLIST: 'BLOCKLIST',
  PROHIBITED_CONTENT: 'PROHIBITED_CONTENT',
  SPII: 'SPII',
  MALFORMED_FUNCTION_CALL: 'MALFORMED_FUNCTION_CALL',
  IMAGE_SAFETY: 'IMAGE_SAFETY',
  UNEXPECTED_TOOL_CALL: 'UNEXPECTED_TOOL_CALL',
  IMAGE_PROHIBITED_CONTENT: 'IMAGE_PROHIBITED_CONTENT',
  NO_IMAGE: 'NO_IMAGE',
});
export type FinishReason = genai.FinishReason;

/** Runtime values of the SDK's `ThinkingLevel`. */
export const ThinkingLevel = enumValues<typeof genai.ThinkingLevel>()({
  THINKING_LEVEL_UNSPECIFIED: 'THINKING_LEVEL_UNSPECIFIED',
  LOW: 'LOW',
  HIGH: 'HIGH',
});
export type ThinkingLevel = genai.ThinkingLevel;

/** Runtime values of the SDK's `Environment` (computer-use environment). */
export const Environment = enumValues<typeof genai.Environment>()({
  ENVIRONMENT_UNSPECIFIED: 'ENVIRONMENT_UNSPECIFIED',
  ENVIRONMENT_BROWSER: 'ENVIRONMENT_BROWSER',
});
export type Environment = genai.Environment;

/** Runtime values of the SDK's `FunctionCallingConfigMode`. */
export const FunctionCallingConfigMode = enumValues<
  typeof genai.FunctionCallingConfigMode
>()({
  MODE_UNSPECIFIED: 'MODE_UNSPECIFIED',
  AUTO: 'AUTO',
  ANY: 'ANY',
  NONE: 'NONE',
  VALIDATED: 'VALIDATED',
});
export type FunctionCallingConfigMode = genai.FunctionCallingConfigMode;

/**
 * Error with an HTTP status, as thrown by the SDK's clients. Nothing in
 * Capricorn throws the SDK's own class any more (there is no SDK client);
 * this keeps `instanceof ApiError` checks meaningful for local code.
 */
export class ApiError extends Error {
  status: number;

  constructor(options: { message: string; status: number }) {
    super(options.message);
    this.name = 'ApiError';
    this.status = options.status;
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

function isPart(value: unknown): value is genai.Part {
  // Same test as the SDK: any object that has one of the Part fields.
  if (typeof value !== 'object' || value === null) return false;
  return [
    'fileData',
    'text',
    'functionCall',
    'functionResponse',
    'inlineData',
    'videoMetadata',
    'codeExecutionResult',
    'executableCode',
  ].some((key) => key in value);
}

/**
 * Builds a user turn from a string, a part, or a list of either. Same
 * behaviour and errors as the SDK function of the same name.
 */
export function createUserContent(
  partOrString: genai.PartListUnion | string,
): genai.Content {
  const toPart = (p: unknown): genai.Part => {
    if (typeof p === 'string') return { text: p };
    if (isPart(p)) return p;
    throw new Error('element in PartUnion must be a Part object or string');
  };
  let parts: genai.Part[];
  if (typeof partOrString === 'string' || isPart(partOrString)) {
    parts = [toPart(partOrString)];
  } else if (Array.isArray(partOrString)) {
    if (partOrString.length === 0) {
      throw new Error('partOrString cannot be an empty array');
    }
    parts = partOrString.map(toPart);
  } else {
    throw new Error('partOrString must be a Part object, string, or array');
  }
  return { role: 'user', parts };
}

// A free function, not a private method: private members would make the
// class nominal, and SDK-typed responses must stay assignable to it.
function firstParts(
  response: genai.GenerateContentResponse,
): genai.Part[] | undefined {
  return response.candidates?.[0]?.content?.parts;
}

/**
 * A model response with the SDK's convenience getters. Structurally the same
 * as the SDK class, so it can be used wherever its type is expected.
 *
 * Unlike the SDK, the getters do not `console.warn` about multiple candidates
 * or non-text parts: in a terminal UI those warnings were noise, and the
 * callers read the parts they need directly.
 */
export class GenerateContentResponse implements genai.GenerateContentResponse {
  sdkHttpResponse?: genai.HttpResponse;
  candidates?: genai.Candidate[];
  createTime?: string;
  automaticFunctionCallingHistory?: genai.Content[];
  modelVersion?: string;
  promptFeedback?: genai.GenerateContentResponsePromptFeedback;
  responseId?: string;
  usageMetadata?: genai.GenerateContentResponseUsageMetadata;

  /** Concatenated non-thought text of the first candidate, if any. */
  get text(): string | undefined {
    const parts = firstParts(this);
    if (parts?.length === 0) return undefined;
    let text = '';
    let anyText = false;
    for (const part of parts ?? []) {
      if (typeof part.text !== 'string' || part.thought === true) continue;
      anyText = true;
      text += part.text;
    }
    // An empty text part ('') is still text; no text part at all is not.
    return anyText ? text : undefined;
  }

  /** Concatenated inline data (base64) of the first candidate, if any. */
  get data(): string | undefined {
    const parts = firstParts(this);
    if (parts?.length === 0) return undefined;
    let data = '';
    for (const part of parts ?? []) {
      if (typeof part.inlineData?.data === 'string') {
        data += atob(part.inlineData.data);
      }
    }
    return data.length > 0 ? btoa(data) : undefined;
  }

  /** Function calls of the first candidate, or undefined when there are none. */
  get functionCalls(): genai.FunctionCall[] | undefined {
    const calls = firstParts(this)
      ?.map((part) => part.functionCall)
      .filter((call): call is genai.FunctionCall => call !== undefined);
    return calls && calls.length > 0 ? calls : undefined;
  }

  /** Code of the first executable-code part of the first candidate. */
  get executableCode(): string | undefined {
    return firstParts(this)?.find((part) => part.executableCode)?.executableCode
      ?.code;
  }

  /** Output of the first code-execution-result part of the first candidate. */
  get codeExecutionResult(): string | undefined {
    return firstParts(this)?.find((part) => part.codeExecutionResult)
      ?.codeExecutionResult?.output;
  }
}

/** Embedding response; a plain data holder, as in the SDK. */
export class EmbedContentResponse implements genai.EmbedContentResponse {
  sdkHttpResponse?: genai.HttpResponse;
  embeddings?: genai.ContentEmbedding[];
  metadata?: genai.EmbedContentMetadata;
}
