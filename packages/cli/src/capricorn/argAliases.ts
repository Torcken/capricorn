/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Maps Capricorn's documented command spellings onto the
 * retained upstream flags, before yargs parses the command line:
 *
 *   capricorn run --prompt "..."     ->  --prompt "..."
 *   capricorn run "..."              ->  --prompt "..."
 *   capricorn sessions list          ->  --list-sessions
 *   capricorn sessions resume <id>   ->  --resume <id>
 *   capricorn sessions delete <id>   ->  --delete-session <id> --confirm-delete
 *   capricorn sessions delete <id> --yes -> --delete-session <id>
 *
 * Reusing the upstream code paths (instead of re-implementing session
 * storage) keeps one implementation of session loading, ordering and
 * deletion. Only the *first* positional token is inspected, so a prompt such
 * as `capricorn "run the tests"` is never rewritten. Global options may come
 * before the alias (`capricorn --debug run "..."`); they are kept as is.
 */

/**
 * Global options that take a value as the next token (with their short
 * aliases). `--worktree` and `--resume` accept an optional value; treating
 * them as value-taking is the safe reading: the next token is then never
 * mistaken for an alias.
 */
const VALUE_OPTIONS = new Set([
  '--model',
  '-m',
  '--prompt',
  '-p',
  '--prompt-interactive',
  '-i',
  '--worktree',
  '-w',
  '--approval-mode',
  '--policy',
  '--admin-policy',
  '--allowed-mcp-server-names',
  '--allowed-tools',
  '--extensions',
  '-e',
  '--resume',
  '-r',
  '--session-file',
  '--session-id',
  '--delete-session',
  '--include-directories',
  '--output-format',
  '-o',
  '--fake-responses',
  '--fake-responses-non-strict',
  '--record-responses',
]);

/** Global boolean options that may precede an alias. */
const BOOLEAN_OPTIONS = new Set([
  '--debug',
  '-d',
  '--skip-trust',
  '--sandbox',
  '-s',
  '--yolo',
  '-y',
  '--acp',
  '--experimental-acp',
  '--list-extensions',
  '-l',
  '--list-sessions',
  '--confirm-delete',
  '--screen-reader',
  '--raw-output',
  '--accept-raw-output-risk',
]);

/** Options whose value is the user's prompt: an alias after them is text. */
const PROMPT_OPTIONS = new Set([
  '--prompt',
  '-p',
  '--prompt-interactive',
  '-i',
]);

/**
 * Returns the index of the first positional token, skipping the leading
 * global options, or -1 when there is none or when an unknown option (or a
 * prompt option) comes first. Unknown options stop the scan because their
 * arity is unknown: rewriting is skipped rather than guessed.
 */
function firstPositionalIndex(argv: readonly string[]): number {
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--') return -1;
    if (!token.startsWith('-') || token === '-') return i;
    const name = token.split('=', 1)[0];
    if (PROMPT_OPTIONS.has(name)) return -1;
    if (token.includes('=')) {
      if (VALUE_OPTIONS.has(name) || BOOLEAN_OPTIONS.has(name)) continue;
      return -1;
    }
    if (VALUE_OPTIONS.has(token)) {
      i++;
      continue;
    }
    if (BOOLEAN_OPTIONS.has(token)) continue;
    return -1;
  }
  return -1;
}

/** Result of alias rewriting. */
export interface AliasRewrite {
  argv: string[];
  /** Usage error to print instead of running (exit code 2). */
  error?: string;
}

/**
 * Rewrites `rawArgv` (already stripped of `node` and the script path).
 */
export function rewriteCapricornAliases(
  rawArgv: readonly string[],
): AliasRewrite {
  const index = firstPositionalIndex(rawArgv);
  if (index <= 0) {
    return rewriteAt(rawArgv);
  }
  const rewritten = rewriteAt(rawArgv.slice(index));
  return rewritten.error
    ? rewritten
    : { argv: [...rawArgv.slice(0, index), ...rewritten.argv] };
}

/** Rewrites an argument list whose first token may be an alias. */
function rewriteAt(rawArgv: readonly string[]): AliasRewrite {
  const [first, ...rest] = rawArgv;
  if (first === 'run') {
    if (
      rest.some(
        (a) => a === '--prompt' || a === '-p' || a.startsWith('--prompt='),
      )
    ) {
      return { argv: rest };
    }
    const positional = rest.findIndex((a) => !a.startsWith('-'));
    if (positional === -1) {
      return {
        argv: [],
        error:
          'Usage: capricorn run --prompt "<task>"  (or: capricorn run "<task>")',
      };
    }
    const copy = [...rest];
    const [prompt] = copy.splice(positional, 1);
    return { argv: ['--prompt', prompt, ...copy] };
  }

  if (first === 'sessions') {
    const [sub, ...args] = rest;
    switch (sub) {
      case undefined:
      case 'list':
        return { argv: ['--list-sessions', ...args] };
      case 'resume': {
        const [id, ...more] = args;
        return {
          argv:
            id && !id.startsWith('-')
              ? ['--resume', id, ...more]
              : ['--resume', 'latest', ...args],
        };
      }
      case 'delete': {
        const [id, ...more] = args;
        if (!id || id.startsWith('-')) {
          return {
            argv: [],
            error: 'Usage: capricorn sessions delete <id|index> [--yes]',
          };
        }
        const yes = more.includes('--yes') || more.includes('-y');
        const remaining = more.filter((a) => a !== '--yes' && a !== '-y');
        return {
          argv: [
            '--delete-session',
            id,
            ...(yes ? [] : ['--confirm-delete']),
            ...remaining,
          ],
        };
      }
      default:
        return {
          argv: [],
          error: `Unknown sessions command "${sub}". Use: list, resume <id>, delete <id>.`,
        };
    }
  }
  return { argv: [...rawArgv] };
}
