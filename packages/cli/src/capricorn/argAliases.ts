/**
 * @license
 * Copyright 2026 Capricorn Contributors
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
 * as `capricorn "run the tests"` is never rewritten.
 */

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
