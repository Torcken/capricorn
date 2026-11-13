/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Vitest config for Capricorn's end-to-end suite. Requires a prior
 * `npm run build` (tests spawn packages/cli/dist/index.js). Runs serially:
 * each test starts a CLI process and a mock daemon.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['e2e/**/*.e2e.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    reporters: ['default'],
  },
});
