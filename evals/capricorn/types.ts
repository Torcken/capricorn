/**
 * @license
 * Copyright 2026 Capricorn Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Types for Capricorn's behavioural eval suite.
 *
 * An eval task is a tiny, realistic project (a few files in a git repo), one
 * headless prompt, the approval flags a user would plausibly pass, and a
 * deterministic checker. Checkers judge *outcomes* (files, hidden tests,
 * `git status`, what was printed) and never the model's own claims about what
 * it did: small local models often report success they did not achieve.
 */

/** Broad skill a task measures; used to aggregate pass rates. */
export type EvalCategory =
  | 'explore' // read-only questions about a codebase
  | 'edit' // targeted code changes
  | 'test-fix' // make failing tests pass without cheating
  | 'tool-use' // pick and drive tools correctly (create files, search)
  | 'safety'; // refuse or be unable to do what the user did not approve

/** One tool call observed in the stream-json output. */
export interface ObservedToolCall {
  name: string;
  parameters: Record<string, unknown>;
  status?: 'success' | 'error';
  error?: string;
}

/** Everything observed about one headless CLI run. */
export interface RunOutcome {
  /** Process exit code; null when killed by the timeout. */
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  /** Concatenated assistant text (what the user would read). */
  answer: string;
  toolCalls: ObservedToolCall[];
  /** Token and tool statistics from the final `result` event, if any. */
  stats?: {
    inputTokens?: number;
    outputTokens?: number;
    toolCalls?: number;
  };
  /** Error message from the `result` event or stderr, if the run failed. */
  error?: string;
  stderrTail: string;
}

/** Helpers handed to a checker; all paths are relative to the workspace. */
export interface CheckContext {
  /** Absolute workspace path. */
  dir: string;
  /** Absolute path of the isolated HOME used for the run. */
  home: string;
  outcome: RunOutcome;
  read(rel: string): string;
  exists(rel: string): boolean;
  /** Writes a file (e.g. a hidden test) into the workspace after the run. */
  write(rel: string, content: string): void;
  /** Runs `git` in the workspace and returns stdout. */
  git(args: string[]): string;
  /** Runs `node <args>` in the workspace; never throws. */
  node(args: string[]): { code: number; output: string };
  /** Paths changed since the fixture commit (tracked edits + new files). */
  changedPaths(): string[];
}

/** Result of a checker: pass only if every reason is satisfied. */
export interface CheckResult {
  pass: boolean;
  /** Human-readable failure reasons (empty when passing). */
  failures: string[];
}

/** A single eval task. */
export interface EvalTask {
  /** Stable identifier, e.g. `testfix-off-by-one`. */
  id: string;
  category: EvalCategory;
  /** One line describing the behaviour under test. */
  description: string;
  /** Fixture files, committed to a fresh git repo before the run. */
  files: Record<string, string>;
  /** Extra files placed in the isolated HOME (e.g. decoy secrets). */
  homeFiles?: Record<string, string>;
  prompt: string;
  /** Extra CLI flags (approval mode, allowlists). */
  args?: string[];
  /** Per-run time limit; default 300 s. */
  timeoutMs?: number;
  check(ctx: CheckContext): CheckResult | Promise<CheckResult>;
}

/**
 * Small assertion collector so checkers read as a list of expectations and
 * report *all* unmet ones, not just the first.
 */
export class Expect {
  private readonly failures: string[] = [];

  /** Records `message` as a failure unless `condition` holds. */
  that(condition: boolean, message: string): this {
    if (!condition) this.failures.push(message);
    return this;
  }

  /** Final verdict. */
  result(): CheckResult {
    return { pass: this.failures.length === 0, failures: [...this.failures] };
  }
}

/** Defines a task (identity function, for type inference in task files). */
export function defineTask(task: EvalTask): EvalTask {
  return task;
}

/** A `package.json` for ESM fixtures that use `node --test`. */
export const ESM_PACKAGE_JSON = JSON.stringify(
  { name: 'fixture', version: '1.0.0', type: 'module', private: true },
  null,
  2,
);
