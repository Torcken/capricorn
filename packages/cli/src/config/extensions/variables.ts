/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { type VariableSchema, VARIABLE_SCHEMA } from './variableSchema.js';
import { GEMINI_DIR } from '@capricorn/core';

/**
 * Represents a set of keys that will be considered invalid while unmarshalling
 * JSON in recursivelyHydrateStrings.
 */
const UNMARSHALL_KEY_IGNORE_LIST: Set<string> = new Set<string>([
  '__proto__',
  'constructor',
  'prototype',
]);

export const EXTENSIONS_DIRECTORY_NAME = path.join(GEMINI_DIR, 'extensions');
// Capricorn: extensions are described by `capricorn-extension.json`. The
// upstream name `gemini-extension.json` is still read, so extensions written
// for Gemini CLI keep working; when both exist, the Capricorn name wins.
export const EXTENSIONS_CONFIG_FILENAME = 'capricorn-extension.json';
/** Upstream manifest name, accepted when `capricorn-extension.json` is absent. */
export const LEGACY_EXTENSIONS_CONFIG_FILENAME = 'gemini-extension.json';
export const INSTALL_METADATA_FILENAME = '.gemini-extension-install.json';
export const EXTENSION_SETTINGS_FILENAME = '.env';

/**
 * Returns the path of the extension manifest in `extensionDir`:
 * `capricorn-extension.json` if present, else `gemini-extension.json` if
 * present, else undefined.
 */
export function findExtensionConfigFile(
  extensionDir: string,
): string | undefined {
  for (const name of [
    EXTENSIONS_CONFIG_FILENAME,
    LEGACY_EXTENSIONS_CONFIG_FILENAME,
  ]) {
    const candidate = path.join(extensionDir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

export type JsonObject = { [key: string]: JsonValue };
export type JsonArray = JsonValue[];
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonObject
  | JsonArray;

export type VariableContext = {
  [key: string]: string | undefined;
};

export function validateVariables(
  variables: VariableContext,
  schema: VariableSchema,
) {
  for (const key in schema) {
    const definition = schema[key];
    if (definition.required && !variables[key]) {
      throw new Error(`Missing required variable: ${key}`);
    }
  }
}

export function hydrateString(str: string, context: VariableContext): string {
  validateVariables(context, VARIABLE_SCHEMA);
  const regex = /\${(.*?)}/g;
  return str.replace(regex, (match, key) => {
    const val = context[key];
    return val == null ? match : String(val);
  });
}

export function recursivelyHydrateStrings<T>(
  obj: T,
  values: VariableContext,
): T {
  if (typeof obj === 'string') {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return hydrateString(obj, values) as unknown as T;
  }
  if (Array.isArray(obj)) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return (obj as unknown[]).map((item) =>
      recursivelyHydrateStrings(item, values),
    ) as unknown as T;
  }
  if (typeof obj === 'object' && obj !== null) {
    const newObj: Record<string, unknown> = {};
    for (const key in obj) {
      if (
        !UNMARSHALL_KEY_IGNORE_LIST.has(key) &&
        Object.prototype.hasOwnProperty.call(obj, key)
      ) {
        newObj[key] = recursivelyHydrateStrings(
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          (obj as Record<string, unknown>)[key],
          values,
        );
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return newObj as T;
  }
  return obj;
}
