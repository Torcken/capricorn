/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getCoreSystemPrompt } from './prompts.js';
import { isGitRepository } from '../utils/gitUtils.js';
import os from 'node:os';
import type { Config } from '../config/config.js';
import {
  DEFAULT_GEMINI_MODEL_AUTO,
  DEFAULT_GEMINI_MODEL,
} from '../config/models.js';
import { ApprovalMode } from '../policy/types.js';

// Mock tool names if they are dynamically generated or complex
vi.mock('../tools/ls', () => ({ LSTool: { Name: 'list_directory' } }));
vi.mock('../tools/edit', () => ({ EditTool: { Name: 'replace' } }));
vi.mock('../tools/glob', () => ({ GlobTool: { Name: 'glob' } }));
vi.mock('../tools/grep', () => ({ GrepTool: { Name: 'grep_search' } }));
vi.mock('../tools/read-file', () => ({ ReadFileTool: { Name: 'read_file' } }));
vi.mock('../tools/read-many-files', () => ({
  ReadManyFilesTool: { Name: 'read_many_files' },
}));
vi.mock('../tools/shell', () => ({
  ShellTool: class {
    static readonly Name = 'run_shell_command';
    name = 'run_shell_command';
  },
}));
vi.mock('../tools/write-file', () => ({
  WriteFileTool: { Name: 'write_file' },
}));
vi.mock('../agents/codebase-investigator.js', () => ({
  CodebaseInvestigatorAgent: { name: 'codebase_investigator' },
}));
vi.mock('../utils/gitUtils', () => ({
  isGitRepository: vi.fn().mockReturnValue(false),
}));
vi.mock('node:fs');
vi.mock('../config/models.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
  };
});

describe('Core System Prompt (prompts.ts)', () => {
  const mockPlatform = (platform: string) => {
    vi.stubGlobal(
      'process',
      Object.create(process, {
        platform: {
          get: () => platform,
        },
      }),
    );
  };

  let mockConfig: Config;
  beforeEach(() => {
    vi.resetAllMocks();
    // Stub process.platform to 'linux' by default for deterministic snapshots across OSes
    mockPlatform('linux');
    vi.spyOn(os, 'homedir').mockReturnValue('/tmp/test-home');

    vi.stubEnv('SANDBOX', undefined);
    vi.stubEnv('GEMINI_SYSTEM_MD', undefined);
    vi.stubEnv('GEMINI_WRITE_SYSTEM_MD', undefined);
    const mockRegistry = {
      getAllToolNames: vi
        .fn()
        .mockReturnValue(['grep_search', 'glob', 'invoke_agent']),
      getAllTools: vi.fn().mockReturnValue([]),
    };
    mockConfig = {
      getToolRegistry: vi.fn().mockReturnValue(mockRegistry),
      getEnableShellOutputEfficiency: vi.fn().mockReturnValue(true),
      getSandboxEnabled: vi.fn().mockReturnValue(false),
      getProjectRoot: vi.fn().mockReturnValue('/tmp/project-temp'),
      storage: {
        getProjectTempDir: vi.fn().mockReturnValue('/tmp/project-temp'),
        getPlansDir: vi.fn().mockReturnValue('/tmp/project-temp/plans'),
        getProjectMemoryDir: vi
          .fn()
          .mockReturnValue('/tmp/project-temp/memory'),
        getProjectTempTrackerDir: vi
          .fn()
          .mockReturnValue('/mock/.gemini/tmp/session/tracker'),
      },
      isInteractive: vi.fn().mockReturnValue(true),
      isInteractiveShellEnabled: vi.fn().mockReturnValue(true),
      isTopicUpdateNarrationEnabled: vi.fn().mockReturnValue(false),
      isAgentsEnabled: vi.fn().mockReturnValue(false),
      getPreviewFeatures: vi.fn().mockReturnValue(true),
      getModel: vi.fn().mockReturnValue(DEFAULT_GEMINI_MODEL_AUTO),
      getActiveModel: vi.fn().mockReturnValue(DEFAULT_GEMINI_MODEL),
      getMessageBus: vi.fn(),
      getAgentRegistry: vi.fn().mockReturnValue({
        getDirectoryContext: vi.fn().mockReturnValue('Mock Agent Directory'),
        getAllDefinitions: vi.fn().mockReturnValue([
          {
            name: 'mock-agent',
            description: 'Mock Agent Description',
          },
        ]),
        getDefinition: vi.fn().mockReturnValue(undefined),
      }),
      getSkillManager: vi.fn().mockReturnValue({
        getSkills: vi.fn().mockReturnValue([]),
      }),
      getApprovalMode: vi.fn().mockReturnValue(ApprovalMode.DEFAULT),
      getApprovedPlanPath: vi.fn().mockReturnValue(undefined),
      isTrackerEnabled: vi.fn().mockReturnValue(false),
      get config() {
        return this;
      },
      get toolRegistry() {
        return mockRegistry;
      },
    } as unknown as Config;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Capricorn: the upstream assertions about the Gemini prompt wording were
  // replaced (the system prompt is now composed by capricornSnippets.ts).
  // These tests exercise the real PromptProvider wiring end to end.

  it('uses the Capricorn prompt through the PromptProvider', () => {
    const prompt = getCoreSystemPrompt(mockConfig);
    expect(prompt).toContain('You are Capricorn, an interactive coding agent');
    expect(prompt).not.toContain('You are Gemini CLI');
  });

  it('uses the headless wording in non-interactive mode', () => {
    vi.mocked(mockConfig.isInteractive).mockReturnValue(false);
    expect(getCoreSystemPrompt(mockConfig)).toContain('No user is available');
  });

  it('appends user memory (project CAPRICORN.md instructions)', () => {
    const prompt = getCoreSystemPrompt(mockConfig, 'Always run npm test.');
    expect(prompt).toContain('Always run npm test.');
  });

  it('includes plan-mode instructions in PLAN mode', () => {
    vi.mocked(mockConfig.getApprovalMode).mockReturnValue(ApprovalMode.PLAN);
    const prompt = getCoreSystemPrompt(mockConfig);
    expect(prompt).toContain('**Plan**');
    expect(prompt).toContain('exit_plan_mode');
  });

  it('includes git guidance only inside a git repository', () => {
    expect(getCoreSystemPrompt(mockConfig)).not.toContain('# Git Repository');
    vi.mocked(isGitRepository).mockReturnValue(true);
    expect(getCoreSystemPrompt(mockConfig)).toContain('# Git Repository');
  });

  it('lists skills when available', () => {
    vi.mocked(mockConfig.getSkillManager().getSkills).mockReturnValue([
      {
        name: 'release-notes',
        description: 'Write release notes',
        location: '/x/SKILL.md',
      },
    ] as never);
    expect(getCoreSystemPrompt(mockConfig)).toContain('release-notes');
  });
});
