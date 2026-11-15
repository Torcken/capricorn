/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview JSON Schema from zod 4 schemas, matching what
 * `zod-to-json-schema` produced under zod 3.
 *
 * Why: tool parameter schemas are sent to the model. zod 4's built-in
 * `z.toJSONSchema` in `input` mode (needed so fields with defaults stay
 * optional) leaves objects open, whereas the old converter closed them with
 * `additionalProperties: false`. Closed objects tell the model not to invent
 * parameters, so plain (non-passthrough) objects are closed again here.
 */

import { z } from 'zod';

/** Output dialect: draft-7 for tool declarations, OpenAPI 3.0 for responses. */
export type ZodJsonSchemaTarget = 'draft-7' | 'openapi-3.0';

/**
 * Converts a zod schema to JSON Schema with input semantics and closed
 * objects (unless the schema has a catchall, e.g. `.passthrough()`).
 */
export function zodToToolJsonSchema(
  schema: z.ZodType,
  target: ZodJsonSchemaTarget = 'draft-7',
): Record<string, unknown> {
  return z.toJSONSchema(schema, {
    target,
    io: 'input',
    override: ({ zodSchema, jsonSchema }) => {
      const def = zodSchema._zod.def;
      if (
        def.type === 'object' &&
        def.catchall === undefined &&
        jsonSchema.additionalProperties === undefined
      ) {
        jsonSchema.additionalProperties = false;
      }
    },
  }) as Record<string, unknown>;
}
