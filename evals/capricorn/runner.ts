/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Runs one eval task once: builds a fresh git workspace and an
 * isolated HOME, invokes the compiled CLI headlessly with
 * `--output-format stream-json`, parses the event stream and calls the task's
 * checker.
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  CheckContext,
  CheckResult,
  EvalTask,
  ObservedToolCall,
  RunOutcome,
} from './types.js';

/** How to invoke the CLI under evaluation. */
export interface RunnerOptions {
  /** Path to the CLI entry (`packages/cli/dist/index.js` or the bundle). */
  cliEntry: string;
  /** Gemma 4 tag to evaluate. */
  model: string;
  /** Ollama endpoint (loopback). */
  ollamaHost: string;
  /** Keep workspaces for inspection instead of deleting them. */
  keepWorkspaces?: boolean;
  /** Extra environment for the CLI (tests inject a mock daemon here). */
  extraEnv?: Record<string, string>;
}

/** Result of one task run. */
export interface TaskRunResult {
  taskId: string;
  category: EvalTask['category'];
  model: string;
  attempt: number;
  pass: boolean;
  failures: string[];
  /**
   * True when the run never reached the model's behaviour: the daemon failed
   * (HTTP 5xx, model could not load, connection refused) before any answer or
   * tool call. Errored runs are reported separately and excluded from pass
   * rates, so an infrastructure problem is not mistaken for model quality.
   */
  errored?: boolean;
  outcome: RunOutcome;
  /** Workspace path when kept. */
  workspace?: string;
}

/** Daemon/infrastructure failures, as surfaced by the CLI's Ollama errors. */
const INFRA_ERROR =
  /Ollama returned HTTP 5\d\d|Cannot connect to Ollama|ECONNREFUSED|llama-server process has terminated/;

/**
 * Classifies a run as errored (see {@link TaskRunResult.errored}). Only runs
 * that produced nothing at all qualify: a daemon error after real work is a
 * genuine (if unlucky) failure of that run.
 */
export function isInfrastructureError(outcome: RunOutcome): boolean {
  return (
    outcome.exitCode !== 0 &&
    outcome.answer.trim() === '' &&
    outcome.toolCalls.length === 0 &&
    INFRA_ERROR.test(`${outcome.error ?? ''}\n${outcome.stderrTail}`)
  );
}

const GIT_IDENTITY = [
  '-c',
  'user.email=eval@example.invalid',
  '-c',
  'user.name=eval',
];

function writeTree(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

/**
 * Parses stream-json output. Unknown or malformed lines are ignored: the CLI
 * may print non-JSON diagnostics, and the checker should judge behaviour, not
 * formatting.
 */
export function parseStreamJson(
  stdout: string,
): Omit<RunOutcome, 'exitCode' | 'timedOut' | 'durationMs' | 'stderrTail'> {
  let answer = '';
  let finalAnswer = '';
  const calls = new Map<string, ObservedToolCall>();
  const order: ObservedToolCall[] = [];
  let stats: RunOutcome['stats'];
  let error: string | undefined;

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    switch (ev['type']) {
      case 'message':
        if (ev['role'] === 'assistant' && typeof ev['content'] === 'string') {
          answer += ev['content'];
          finalAnswer += ev['content'];
        }
        break;
      case 'tool_use': {
        const call: ObservedToolCall = {
          name: String(ev['tool_name'] ?? ''),
          parameters:
            ev['parameters'] && typeof ev['parameters'] === 'object'
              ? (ev['parameters'] as Record<string, unknown>)
              : {},
        };
        calls.set(String(ev['tool_id'] ?? order.length), call);
        order.push(call);
        finalAnswer = '';
        break;
      }
      case 'tool_result': {
        const call = calls.get(String(ev['tool_id'] ?? ''));
        if (call) {
          call.status = ev['status'] === 'error' ? 'error' : 'success';
          const err = ev['error'] as { message?: string } | undefined;
          if (err?.message) call.error = err.message;
        }
        break;
      }
      case 'result': {
        const s = ev['stats'] as Record<string, unknown> | undefined;
        if (s) {
          stats = {
            inputTokens: Number(s['input_tokens'] ?? 0) || undefined,
            outputTokens: Number(s['output_tokens'] ?? 0) || undefined,
            toolCalls: Number(s['tool_calls'] ?? 0),
          };
        }
        const err = ev['error'] as { message?: string } | undefined;
        if (ev['status'] === 'error') error = err?.message ?? 'error';
        break;
      }
      case 'error':
        if (ev['severity'] === 'error' && typeof ev['message'] === 'string') {
          error ??= ev['message'];
        }
        break;
      default:
        break;
    }
  }
  return { answer, finalAnswer, toolCalls: order, stats, error };
}

/** A fixture workspace: git repo with the task files, plus isolated HOME. */
interface Workspace {
  root: string;
  dir: string;
  home: string;
  git(args: string[]): string;
}

/** Creates the fixture repo (one commit) and the isolated HOME. */
function createWorkspace(task: EvalTask): Workspace {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `capricorn-eval-`));
  const dir = path.join(root, 'repo');
  const home = path.join(root, 'home');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  writeTree(dir, task.files);
  writeTree(home, task.homeFiles ?? {});
  const git = (args: string[]) =>
    execFileSync('git', [...GIT_IDENTITY, ...args], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  git(['init', '-q']);
  git(['add', '-A']);
  git(['commit', '-qm', 'fixture']);
  return { root, dir, home, git };
}

/** Builds the checker helpers for a workspace and an observed outcome. */
function buildContext(ws: Workspace, outcome: RunOutcome): CheckContext {
  const { dir, home, git } = ws;
  return {
    dir,
    home,
    outcome,
    read: (rel) => fs.readFileSync(path.join(dir, rel), 'utf8'),
    exists: (rel) => fs.existsSync(path.join(dir, rel)),
    write: (rel, content) => writeTree(dir, { [rel]: content }),
    git,
    node: (args) => {
      const r = spawnSync(process.execPath, args, {
        cwd: dir,
        encoding: 'utf8',
        timeout: 60_000,
        // Hidden tests must not inherit anything from the evaluator either.
        env: { PATH: process.env['PATH'] ?? '', HOME: home },
      });
      return {
        code: r.status ?? 1,
        output: `${r.stdout ?? ''}${r.stderr ?? ''}`,
      };
    },
    changedPaths: () =>
      git(['status', '--porcelain', '-uall'])
        .split('\n')
        .filter(Boolean)
        .map((l) => l.slice(3).trim()),
  };
}

/** Runs the checker; a throwing checker counts as a failure, not a crash. */
async function judge(task: EvalTask, ctx: CheckContext): Promise<CheckResult> {
  try {
    return await task.check(ctx);
  } catch (e) {
    return {
      pass: false,
      failures: [
        `checker threw: ${e instanceof Error ? e.message : String(e)}`,
      ],
    };
  }
}

/** Runs `task` once against the CLI and checks the outcome. */
export async function runTaskOnce(
  task: EvalTask,
  options: RunnerOptions,
  attempt = 1,
): Promise<TaskRunResult> {
  const ws = createWorkspace(task);
  const { root, dir, home } = ws;
  const started = Date.now();
  const timeoutMs = task.timeoutMs ?? 300_000;
  const { stdout, stderr, code, timedOut } = await new Promise<{
    stdout: string;
    stderr: string;
    code: number | null;
    timedOut: boolean;
  }>((resolve) => {
    const child = spawn(
      process.execPath,
      [
        '--no-deprecation',
        options.cliEntry,
        '--skip-trust',
        '--model',
        options.model,
        '--output-format',
        'stream-json',
        ...(task.args ?? []),
        '-p',
        task.prompt,
      ],
      {
        cwd: dir,
        env: {
          // Minimal, explicit environment: nothing from the evaluator's own
          // Capricorn settings, history or credentials leaks into a run.
          PATH: process.env['PATH'] ?? '',
          HOME: home,
          USERPROFILE: home,
          CAPRICORN_OLLAMA_HOST: options.ollamaHost,
          GEMINI_CLI_NO_RELAUNCH: 'true',
          NO_COLOR: '1',
          TERM: 'dumb',
          ...options.extraEnv,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    let out = '';
    let err = '';
    let killed = false;
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.on('close', (c) => {
      clearTimeout(timer);
      resolve({ stdout: out, stderr: err, code: c, timedOut: killed });
    });
    child.stdin.end();
  });

  const parsed = parseStreamJson(stdout);
  const outcome: RunOutcome = {
    exitCode: code,
    timedOut,
    durationMs: Date.now() - started,
    ...parsed,
    error:
      parsed.error ??
      (code !== 0 ? stderr.trim().split('\n').slice(-3).join(' ') : undefined),
    stderrTail: stderr.slice(-1500),
  };

  let verdict = await judge(task, buildContext(ws, outcome));
  if (timedOut) {
    verdict = {
      pass: false,
      failures: [`timed out after ${timeoutMs / 1000}s`, ...verdict.failures],
    };
  }

  if (!options.keepWorkspaces) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  return {
    taskId: task.id,
    category: task.category,
    model: options.model,
    attempt,
    pass: verdict.pass,
    failures: verdict.failures,
    errored: isInfrastructureError(outcome),
    outcome,
    workspace: options.keepWorkspaces ? dir : undefined,
  };
}

/** A known-good result for a task, used to validate the task itself. */
export interface ReferenceSolution {
  /** Files to write over the fixture (what a correct agent would produce). */
  files?: Record<string, string>;
  /** The assistant's final answer. */
  answer?: string;
  /** Text after the last tool call; defaults to {@link answer}. */
  finalAnswer?: string;
  /** Tool calls a correct agent would make (for checkers that look). */
  toolCalls?: ObservedToolCall[];
}

/**
 * Applies `solution` to a fresh fixture *without* the CLI or a model and runs
 * the task's checker. Used by the task-validity tests: every task must pass
 * with its reference solution and fail on the untouched fixture, otherwise it
 * measures nothing.
 */
export async function checkReference(
  task: EvalTask,
  solution: ReferenceSolution,
): Promise<CheckResult> {
  const ws = createWorkspace(task);
  try {
    writeTree(ws.dir, solution.files ?? {});
    const outcome: RunOutcome = {
      exitCode: 0,
      timedOut: false,
      durationMs: 0,
      answer: solution.answer ?? '',
      finalAnswer: solution.finalAnswer ?? solution.answer ?? '',
      toolCalls: solution.toolCalls ?? [],
      stderrTail: '',
    };
    return await judge(task, buildContext(ws, outcome));
  } finally {
    fs.rmSync(ws.root, { recursive: true, force: true });
  }
}
