/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Aggregates task runs into pass rates and renders a Markdown
 * report. Pure functions, unit-tested in `e2e/evals-report.e2e.test.ts`.
 */

import type { TaskRunResult } from './runner.js';
import type { EvalCategory } from './types.js';

/** Facts recorded with each report so results are reproducible. */
export interface ReportMeta {
  startedAt: string;
  finishedAt: string;
  capricornVersion: string;
  gitCommit: string;
  repeat: number;
  host: { platform: string; arch: string; cpus: number; totalMemGiB: number };
  ollamaVersion?: string;
  models: Record<
    string,
    { digest?: string; parameterSize?: string; quantization?: string }
  >;
}

/** Per-task aggregate for one model. */
export interface TaskSummary {
  taskId: string;
  category: EvalCategory;
  passes: number;
  /** Valid runs (errored runs excluded). */
  runs: number;
  /** Runs lost to daemon/infrastructure errors; not in `runs`. */
  errored: number;
  medianSeconds: number;
  meanToolCalls: number;
  toolErrors: number;
  /** Distinct failure reasons with counts, most frequent first. */
  failures: Array<{ reason: string; count: number }>;
}

/** Aggregate for one model. */
export interface ModelSummary {
  model: string;
  passes: number;
  runs: number;
  errored: number;
  byCategory: Record<string, { passes: number; runs: number }>;
  tasks: TaskSummary[];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** First line of a failure reason (hidden-test output follows on later lines). */
function headline(reason: string): string {
  return reason.split('\n')[0].slice(0, 160);
}

/** Groups runs by model, then by task, preserving first-seen order. */
export function summarize(results: TaskRunResult[]): ModelSummary[] {
  const models = new Map<string, TaskRunResult[]>();
  for (const r of results) {
    const list = models.get(r.model) ?? [];
    list.push(r);
    models.set(r.model, list);
  }

  return [...models.entries()].map(([model, runs]) => {
    const byTask = new Map<string, TaskRunResult[]>();
    for (const r of runs) {
      const list = byTask.get(r.taskId) ?? [];
      list.push(r);
      byTask.set(r.taskId, list);
    }
    const tasks: TaskSummary[] = [...byTask.entries()].map(([taskId, all]) => {
      // Errored runs say nothing about the model; aggregate valid runs only.
      const rs = all.filter((r) => !r.errored);
      const reasons = new Map<string, number>();
      for (const r of rs) {
        for (const f of r.failures) {
          const h = headline(f);
          reasons.set(h, (reasons.get(h) ?? 0) + 1);
        }
      }
      return {
        taskId,
        category: all[0].category,
        passes: rs.filter((r) => r.pass).length,
        runs: rs.length,
        errored: all.length - rs.length,
        medianSeconds:
          Math.round(median(rs.map((r) => r.outcome.durationMs)) / 100) / 10,
        meanToolCalls:
          rs.length === 0
            ? 0
            : Math.round(
                (rs.reduce((n, r) => n + r.outcome.toolCalls.length, 0) /
                  rs.length) *
                  10,
              ) / 10,
        toolErrors: rs.reduce(
          (n, r) =>
            n + r.outcome.toolCalls.filter((c) => c.status === 'error').length,
          0,
        ),
        failures: [...reasons.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([reason, count]) => ({ reason, count })),
      };
    });
    const byCategory: ModelSummary['byCategory'] = {};
    for (const t of tasks) {
      const c = (byCategory[t.category] ??= { passes: 0, runs: 0 });
      c.passes += t.passes;
      c.runs += t.runs;
    }
    return {
      model,
      passes: tasks.reduce((n, t) => n + t.passes, 0),
      runs: tasks.reduce((n, t) => n + t.runs, 0),
      errored: tasks.reduce((n, t) => n + t.errored, 0),
      byCategory,
      tasks,
    };
  });
}

function pct(passes: number, runs: number): string {
  return runs === 0 ? '–' : `${Math.round((passes / runs) * 100)}%`;
}

/** Renders the report as GitHub-flavoured Markdown. */
export function renderMarkdown(
  meta: ReportMeta,
  summaries: ModelSummary[],
): string {
  const lines: string[] = [];
  lines.push('# Capricorn eval results', '');
  lines.push(
    `Run ${meta.startedAt} → ${meta.finishedAt} · Capricorn ${meta.capricornVersion} (${meta.gitCommit}) · ` +
      `${meta.repeat} run(s) per task · ${meta.host.platform} ${meta.host.arch}, ${meta.host.cpus} CPUs, ` +
      `${meta.host.totalMemGiB} GiB RAM${meta.ollamaVersion ? ` · Ollama ${meta.ollamaVersion}` : ''}`,
    '',
  );

  const categories = [
    ...new Set(summaries.flatMap((s) => Object.keys(s.byCategory))),
  ];
  lines.push(
    `| Model | Overall | ${categories.join(' | ')} | Errored |`,
    `| --- | --- | ${categories.map(() => '---').join(' | ')} | --- |`,
  );
  for (const s of summaries) {
    const facts = meta.models[s.model];
    const label = facts?.parameterSize
      ? `${s.model} (${facts.parameterSize}, ${facts.quantization ?? '?'})`
      : s.model;
    lines.push(
      `| ${label} | ${pct(s.passes, s.runs)} (${s.passes}/${s.runs}) | ${categories
        .map((c) => {
          const v = s.byCategory[c];
          return v ? `${pct(v.passes, v.runs)} (${v.passes}/${v.runs})` : '–';
        })
        .join(' | ')} | ${s.errored} |`,
    );
  }
  lines.push('');
  if (summaries.some((s) => s.errored > 0)) {
    lines.push(
      '_Errored runs failed in the daemon before the model did anything (e.g. the model could not be loaded); they are excluded from pass rates._',
      '',
    );
  }

  for (const s of summaries) {
    lines.push(`## ${s.model}`, '');
    lines.push(
      '| Task | Category | Pass | Median s | Tool calls | Tool errors | Errored |',
      '| --- | --- | --- | --- | --- | --- | --- |',
    );
    for (const t of s.tasks) {
      const pass = t.runs === 0 ? '–' : `${t.passes}/${t.runs}`;
      lines.push(
        `| ${t.taskId} | ${t.category} | ${pass} | ${t.medianSeconds} | ${t.meanToolCalls} | ${t.toolErrors} | ${t.errored} |`,
      );
    }
    const failing = s.tasks.filter((t) => t.failures.length > 0);
    if (failing.length > 0) {
      lines.push('', '**Failure reasons**', '');
      for (const t of failing) {
        for (const f of t.failures) {
          lines.push(`- \`${t.taskId}\` (×${f.count}): ${f.reason}`);
        }
      }
    }
    lines.push('');
  }
  lines.push(
    '_Model output is non-deterministic: compare pass rates over several runs, not single results._',
    '',
  );
  return lines.join('\n');
}
