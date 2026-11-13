/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Command-line entry for the Capricorn eval suite.
 *
 *   npm run build
 *   npm run eval:capricorn -- --model gemma4:12b --repeat 3
 *   npm run eval:capricorn -- --model gemma4:12b,gemma4:e4b --category test-fix
 *   npm run eval:capricorn -- --task testfix-off-by-one --keep
 *   npm run eval:capricorn -- --num-ctx 8192   (context pressure: forces compression)
 *
 * Writes `evals/capricorn/results/<timestamp>.{json,md}` and prints the
 * Markdown summary. Exit codes: 0 = suite ran (whatever the pass rate),
 * 2 = could not run (Ollama unreachable, model missing, bad arguments).
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ALL_TASKS } from './tasks/index.js';
import { renderMarkdown, summarize, type ReportMeta } from './report.js';
import { runTaskOnce, type TaskRunResult } from './runner.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

const { values } = parseArgs({
  options: {
    model: { type: 'string', default: 'gemma4:12b' },
    repeat: { type: 'string', default: '1' },
    task: { type: 'string' },
    category: { type: 'string' },
    host: { type: 'string', default: '127.0.0.1:11434' },
    cli: {
      type: 'string',
      default: path.join(repoRoot, 'packages/cli/dist/index.js'),
    },
    out: { type: 'string', default: path.join(here, 'results') },
    keep: { type: 'boolean', default: false },
    'num-ctx': { type: 'string' },
    list: { type: 'boolean', default: false },
  },
});

function fail(message: string): never {
  process.stderr.write(`eval: ${message}\n`);
  process.exit(2);
}

/** Splits a comma-separated flag into trimmed, non-empty values. */
function list(v: string | undefined): string[] {
  return (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const taskFilter = list(values.task);
const categoryFilter = list(values.category);
const tasks = ALL_TASKS.filter(
  (t) =>
    (taskFilter.length === 0 || taskFilter.some((f) => t.id.includes(f))) &&
    (categoryFilter.length === 0 || categoryFilter.includes(t.category)),
);

if (values.list) {
  for (const t of tasks) {
    process.stdout.write(
      `${t.id.padEnd(34)} ${t.category.padEnd(9)} ${t.description}\n`,
    );
  }
  process.exit(0);
}

const repeat = Number(values.repeat);
const numCtx =
  values['num-ctx'] === undefined ? undefined : Number(values['num-ctx']);
if (numCtx !== undefined && (!Number.isInteger(numCtx) || numCtx < 8192))
  fail('--num-ctx must be an integer >= 8192 (Capricorn minimum)');
if (!Number.isInteger(repeat) || repeat < 1) fail('--repeat must be >= 1');
if (tasks.length === 0) fail('no tasks match the filters (try --list)');
if (!fs.existsSync(values.cli)) {
  fail(`CLI entry not found: ${values.cli} (run \`npm run build\` first)`);
}
const models = list(values.model);
const ollamaBase = values.host.startsWith('http')
  ? values.host
  : `http://${values.host}`;

/** Shape of the parts of `/api/tags` the runner reads. */
interface TagsModel {
  name: string;
  digest?: string;
  details?: { parameter_size?: string; quantization_level?: string };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Extracts installed models from an `/api/tags` body, ignoring junk. */
function parseTags(body: unknown): TagsModel[] {
  if (!isRecord(body) || !Array.isArray(body['models'])) return [];
  const out: TagsModel[] = [];
  for (const m of body['models']) {
    if (!isRecord(m) || typeof m['name'] !== 'string') continue;
    const d = isRecord(m['details']) ? m['details'] : {};
    out.push({
      name: m['name'],
      digest: typeof m['digest'] === 'string' ? m['digest'] : undefined,
      details: {
        parameter_size:
          typeof d['parameter_size'] === 'string'
            ? d['parameter_size']
            : undefined,
        quantization_level:
          typeof d['quantization_level'] === 'string'
            ? d['quantization_level']
            : undefined,
      },
    });
  }
  return out;
}

/** Confirms the daemon is up and every model is installed; records facts. */
async function probe(): Promise<Pick<ReportMeta, 'ollamaVersion' | 'models'>> {
  let installed: TagsModel[] = [];
  let version: string | undefined;
  try {
    installed = parseTags(await (await fetch(`${ollamaBase}/api/tags`)).json());
    const v: unknown = await (await fetch(`${ollamaBase}/api/version`)).json();
    version =
      isRecord(v) && typeof v['version'] === 'string'
        ? v['version']
        : undefined;
  } catch (e) {
    fail(
      `Ollama not reachable at ${ollamaBase}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const facts: ReportMeta['models'] = {};
  for (const m of models) {
    const found = installed.find((x) => x.name === m);
    if (!found) fail(`model ${m} is not installed (ollama pull ${m})`);
    facts[m] = {
      digest: found.digest,
      parameterSize: found.details?.parameter_size,
      quantization: found.details?.quantization_level,
    };
  }
  return { ollamaVersion: version, models: facts };
}

function gitCommit(): string {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();
    return dirty ? `${sha}+dirty` : sha;
  } catch {
    return 'unknown';
  }
}

const probed = await probe();
const startedAt = new Date().toISOString();
const results: TaskRunResult[] = [];
const total = models.length * tasks.length * repeat;
let n = 0;

for (const model of models) {
  for (const task of tasks) {
    for (let attempt = 1; attempt <= repeat; attempt++) {
      n++;
      process.stderr.write(
        `[${n}/${total}] ${model} ${task.id} #${attempt} … `,
      );
      const r = await runTaskOnce(
        task,
        {
          cliEntry: values.cli,
          model,
          ollamaHost: ollamaBase,
          keepWorkspaces: values.keep,
          numCtx,
        },
        attempt,
      );
      results.push(r);
      process.stderr.write(
        `${r.pass ? 'PASS' : 'FAIL'} (${(r.outcome.durationMs / 1000).toFixed(1)}s, ${r.outcome.toolCalls.length} tool calls)` +
          `${r.pass ? '' : `\n    ${r.failures.map((f) => f.split('\n')[0]).join('\n    ')}`}` +
          `${r.workspace ? `\n    workspace: ${r.workspace}` : ''}\n`,
      );
    }
  }
}

const pkg = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
) as { version: string };
const meta: ReportMeta = {
  startedAt,
  finishedAt: new Date().toISOString(),
  capricornVersion: pkg.version,
  gitCommit: gitCommit(),
  repeat,
  numCtx,
  host: {
    platform: os.platform(),
    arch: os.arch(),
    cpus: os.cpus().length,
    totalMemGiB: Math.round(os.totalmem() / 1024 ** 3),
  },
  ...probed,
};
const summaries = summarize(results);
const markdown = renderMarkdown(meta, summaries);

fs.mkdirSync(values.out, { recursive: true });
const stamp = startedAt.replace(/[:.]/g, '-');
fs.writeFileSync(
  path.join(values.out, `${stamp}.json`),
  JSON.stringify({ meta, summaries, results }, null, 2),
);
fs.writeFileSync(path.join(values.out, `${stamp}.md`), markdown);
process.stdout.write(
  `\n${markdown}\nSaved to ${values.out}/${stamp}.{json,md}\n`,
);
