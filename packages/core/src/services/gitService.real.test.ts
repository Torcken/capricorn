/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { GitService } from './gitService.js';
import type { Storage } from '../config/storage.js';

const hasGit = spawnSync('git', ['--version']).status === 0;

// Capricorn: gitService.test.ts mocks simple-git, so it did not notice that
// simple-git 4.0.2's environment guard rejected every checkpointing call
// ("Use of GIT_TERMINAL_PROMPT is blocked by the environment guard"), which
// broke startup whenever general.checkpointing.enabled was on. This runs the
// real git binary end to end.
describe.skipIf(!hasGit)('GitService with real git (checkpointing)', () => {
  let root: string;
  let project: string;
  let history: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'capricorn-gitsvc-'));
    project = path.join(root, 'project');
    history = path.join(root, 'history');
    fs.mkdirSync(project);
    fs.writeFileSync(path.join(project, 'math.js'), 'return a - b;\n');
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('initializes, snapshots and restores a project', async () => {
    const storage = {
      initialize: async () => {},
      getHistoryDir: () => history,
    } as unknown as Storage;
    const git = new GitService(project, storage);

    await git.initialize();
    const snapshot = await git.createFileSnapshot('before edit');
    expect(snapshot).toMatch(/^[0-9a-f]{7,40}$/);

    fs.writeFileSync(path.join(project, 'math.js'), 'return a + b;\n');
    await git.restoreProjectFromSnapshot(snapshot);

    expect(fs.readFileSync(path.join(project, 'math.js'), 'utf8')).toBe(
      'return a - b;\n',
    );
    // The user's project is not turned into a git repository.
    expect(fs.existsSync(path.join(project, '.git'))).toBe(false);
  });
});
