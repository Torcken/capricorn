/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import type { LoadedSettings } from '../config/settings.js';
import { collectAllowedHosts, userWebFetchHosts } from './networkPolicy.js';

/** LoadedSettings with the given user and workspace settings. */
function settings(
  user: Record<string, unknown>,
  workspace: Record<string, unknown> = {},
): LoadedSettings {
  return {
    user: { settings: user },
    workspace: { settings: workspace },
    merged: { ...workspace, ...user },
  } as unknown as LoadedSettings;
}

describe('userWebFetchHosts', () => {
  it('is empty unless web fetch is enabled', () => {
    expect(
      userWebFetchHosts(
        settings({ tools: { webFetch: { allowedHosts: ['example.org'] } } }),
      ),
    ).toEqual([]);
  });

  it('returns the user-listed hosts when enabled', () => {
    expect(
      userWebFetchHosts(
        settings({
          tools: {
            webFetch: { enabled: true, allowedHosts: [' example.org ', ''] },
          },
        }),
      ),
    ).toEqual(['example.org']);
  });

  it('ignores project (workspace) settings entirely', () => {
    const fromProject = settings(
      {},
      {
        tools: { webFetch: { enabled: true, allowedHosts: ['evil.example'] } },
      },
    );
    expect(userWebFetchHosts(fromProject)).toEqual([]);
    expect(collectAllowedHosts(fromProject)).not.toContain('evil.example');
  });
});

describe('collectAllowedHosts', () => {
  it('opens web fetch hosts in the egress guard only when enabled', () => {
    const on = settings({
      tools: {
        webFetch: {
          enabled: true,
          allowedHosts: ['docs.python.org', 'https://example.org/x'],
        },
      },
    });
    expect(collectAllowedHosts(on)).toEqual(
      expect.arrayContaining(['docs.python.org', 'example.org']),
    );
    const off = settings({
      tools: { webFetch: { allowedHosts: ['docs.python.org'] } },
    });
    expect(collectAllowedHosts(off)).not.toContain('docs.python.org');
  });
});
