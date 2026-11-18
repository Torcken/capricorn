/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { loadPoliciesFromToml } from './toml-loader.js';
import { PolicyEngine } from './policy-engine.js';
import { ApprovalMode, PolicyDecision } from './types.js';

// Capricorn: a headless `--approval-mode plan` run must stay read-only.
// Upstream allowed exit_plan_mode there and switched to YOLO, so gemma4:e4b
// edited files and ran a shell command without any approval.
describe('plan mode in a non-interactive run', () => {
  async function engine(nonInteractive: boolean) {
    const policiesDir = path.resolve(process.cwd(), 'src/policy/policies');
    const { rules } = await loadPoliciesFromToml([policiesDir], () => 1);
    return new PolicyEngine({
      rules,
      approvalMode: ApprovalMode.PLAN,
      nonInteractive,
    });
  }

  it('denies exit_plan_mode with a message saying how to implement', async () => {
    const result = await (
      await engine(true)
    ).check({ name: 'exit_plan_mode' }, undefined);
    expect(result.decision).toBe(PolicyDecision.DENY);
    expect(result.rule?.denyMessage).toContain('read-only');
    expect(result.rule?.denyMessage).toContain('--approval-mode');
  });

  it('still asks the user interactively', async () => {
    const result = await (
      await engine(false)
    ).check({ name: 'exit_plan_mode' }, undefined);
    expect(result.decision).toBe(PolicyDecision.ASK_USER);
  });
});
