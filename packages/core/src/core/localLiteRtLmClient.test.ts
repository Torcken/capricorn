/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { LocalLiteRtLmClient } from './localLiteRtLmClient.js';
import type { Config } from '../config/config.js';

// Capricorn: the upstream tests exercised the SDK-backed client; the client is
// now an inert stand-in (no LiteRT-LM back-end, no SDK client in the bundle).
describe('LocalLiteRtLmClient (Capricorn stand-in)', () => {
  it('refuses every request without contacting a server', async () => {
    const client = new LocalLiteRtLmClient({} as Config);
    await expect(
      client.generateJson([{ role: 'user', parts: [{ text: 'hi' }] }], 'sys'),
    ).rejects.toThrow(/not available in Capricorn/);
  });
});
