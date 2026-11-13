/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Capricorn modification (2026, Guillaume S. Condamine & all awesome
// contributors): the header shows inference location and approval mode instead
// of a Google account.

import { renderWithProviders } from '../../test-utils/render.js';
import { UserIdentity } from './UserIdentity.js';
import { describe, it, expect, vi } from 'vitest';
import {
  ApprovalMode,
  makeFakeConfig,
  resolveOllamaSettings,
} from '@google/gemini-cli-core';

describe('<UserIdentity />', () => {
  it('states that inference is local and shows the endpoint', async () => {
    const config = makeFakeConfig();
    const { lastFrame, unmount } = await renderWithProviders(
      <UserIdentity config={config} />,
    );
    const out = lastFrame();
    expect(out).toContain('Local inference');
    expect(out).toContain('http://127.0.0.1:11434');
    expect(out).not.toMatch(/Google|\/auth|\/upgrade/);
    unmount();
  });

  // The remote opt-in must be impossible to miss.
  it('flags an opted-in remote host as not local-only', async () => {
    const config = makeFakeConfig();
    vi.spyOn(config, 'getOllamaSettings').mockReturnValue(
      resolveOllamaSettings({
        endpoint: 'http://gpu-box.lan:11434',
        allowRemoteHost: true,
      }),
    );
    const { lastFrame, unmount } = await renderWithProviders(
      <UserIdentity config={config} />,
    );
    expect(lastFrame()).toContain('REMOTE inference (not local-only)');
    unmount();
  });

  it.each([
    [ApprovalMode.DEFAULT, 'ask before edits and commands'],
    [ApprovalMode.AUTO_EDIT, 'edits auto-approved'],
    [ApprovalMode.YOLO, 'YOLO'],
  ])('shows the safety mode %s', async (mode, text) => {
    const config = makeFakeConfig();
    vi.spyOn(config, 'getApprovalMode').mockReturnValue(mode);
    const { lastFrame, unmount } = await renderWithProviders(
      <UserIdentity config={config} />,
    );
    expect(lastFrame()).toContain(text);
    unmount();
  });
});
