/**
 * @license
 * Copyright 2026 Capricorn Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Capricorn: "cited but never opened" check for final answers.
 *
 * Why: the eval suite showed Gemma 4 naming the file that holds an answer
 * (`config/default.json`) and then stating a guessed value without opening
 * it, in about half of all runs. Prompt rules ("open the file that contains
 * the answer") and a hint in `read_file` results did not change this. What
 * the model does reliably is follow a direct, specific instruction, so when a
 * final answer cites a small number of existing workspace files that were not
 * opened during the request, the agent loop sends one follow-up asking it to
 * open them and correct the answer if needed.
 *
 * This module is pure bookkeeping; `GeminiClient` decides when to send the
 * follow-up (once per user prompt) and owns the conversation.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  EDIT_TOOL_NAME,
  GREP_TOOL_NAME,
  READ_FILE_TOOL_NAME,
  READ_MANY_FILES_TOOL_NAME,
  WRITE_FILE_TOOL_NAME,
} from '../tools/tool-names.js';

/**
 * Answers that cite more unread files than this are treated as listings
 * ("these files exist") rather than claims about their contents.
 */
export const MAX_CITED_UNREAD_FILES = 3;

/**
 * Relative file paths with an extension, as they appear in prose or inline
 * code: `config/default.json`, `./src/a.ts`, `register.js`. Not preceded by
 * a URL scheme or another path character.
 */
const CITED_PATH =
  /(?<![\w:/.@-])((?:\.{1,2}\/)?[\w@-][\w@.-]*(?:\/[\w@.-]+)*\.[A-Za-z0-9]{1,10})(?![\w/-])/g;

/** Tools whose calls count as having opened (or produced) a file. */
const OPENING_TOOLS = new Set<string>([
  READ_FILE_TOOL_NAME,
  READ_MANY_FILES_TOOL_NAME,
  WRITE_FILE_TOOL_NAME,
  EDIT_TOOL_NAME,
]);

/**
 * Tracks which files were opened during one user prompt.
 */
export class OpenedFiles {
  private readonly files = new Set<string>();
  /** Directories read as a whole (read_many_files `["docs/"]`). */
  private readonly dirs: string[] = [];
  /** Directories passed to grep_search, to resolve its relative paths. */
  private readonly searchDirs: string[] = [];
  /** True while some opened path could not be resolved to concrete files. */
  private sawGlob = false;

  constructor(private readonly root: string) {}

  /** Records a tool call; calls of other tools are ignored. */
  record(toolName: string, args: Record<string, unknown> | undefined): void {
    if (toolName === GREP_TOOL_NAME) {
      const dir = args?.['dir_path'];
      if (typeof dir === 'string') {
        this.searchDirs.push(path.resolve(this.root, dir));
      }
      return;
    }
    if (!OPENING_TOOLS.has(toolName) || !args) return;
    // Non-string values are skipped below (model arguments are untrusted).
    const paths: unknown[] = [args['file_path']];
    // read_many_files takes include patterns; only literal paths can be
    // matched, so patterns make the check fall back to "assume opened".
    for (const key of ['include', 'paths']) {
      const v = args[key];
      if (Array.isArray(v)) paths.push(...v);
    }
    for (const p of paths) {
      if (typeof p !== 'string' || p === '') continue;
      if (/[*?[\]{}]/.test(p)) {
        this.sawGlob = true;
        continue;
      }
      const abs = path.resolve(this.root, p);
      if (isDirectory(abs)) this.dirs.push(abs + path.sep);
      else this.files.add(abs);
    }
  }

  /**
   * Records the files whose lines a `grep_search` result showed (its
   * `File: <path>` headers). Matching lines with context are a legitimate
   * source (e.g. counting matches); the eval showed that asking the model to
   * re-open them only produced a second, reformatted answer. Files-only
   * listings have no such headers and are not recorded.
   */
  recordSearchOutput(output: string): void {
    for (const m of output.matchAll(/^File: (.+)$/gm)) {
      const rel = m[1].trim();
      this.files.add(path.resolve(this.root, rel));
      for (const dir of this.searchDirs) this.files.add(path.resolve(dir, rel));
    }
  }

  /** Whether `absPath` (or, after a glob read, anything) counts as opened. */
  has(absPath: string): boolean {
    return (
      this.sawGlob ||
      this.files.has(absPath) ||
      this.dirs.some((d) => absPath.startsWith(d))
    );
  }
}

/**
 * Returns the workspace-relative paths of existing files that `answer`
 * cites but that were not opened, or `[]` when the check should not fire.
 *
 * @param answer The model's final answer text for the prompt.
 * @param userPrompt The user's prompt text; files it names are exempt (the
 *   user may have asked about a file without wanting it opened).
 * @param opened Files opened during the prompt.
 * @param root Workspace root used to resolve relative paths.
 * @param canRead Read-policy check; rejected files are never cited back.
 */
export function findCitedUnreadFiles(
  answer: string,
  userPrompt: string,
  opened: OpenedFiles,
  root: string,
  canRead: (absPath: string) => boolean,
): string[] {
  const promptPaths = new Set(
    [...userPrompt.matchAll(CITED_PATH)].map((m) => path.resolve(root, m[1])),
  );
  const result: string[] = [];
  const seen = new Set<string>();
  for (const m of answer.matchAll(CITED_PATH)) {
    const abs = path.resolve(root, m[1]);
    if (seen.has(abs)) continue;
    seen.add(abs);
    const rel = path.relative(root, abs);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) continue;
    if (promptPaths.has(abs) || opened.has(abs)) continue;
    if (!isFile(abs) || !canRead(abs)) continue;
    result.push(rel.split(path.sep).join('/'));
  }
  return result.length > MAX_CITED_UNREAD_FILES ? [] : result;
}

/** The follow-up sent to the model for {@link findCitedUnreadFiles}. */
export function citedFilesFollowUp(files: string[]): string {
  const list = files.map((f) => `\`${f}\``).join(', ');
  return `Check before finishing: your answer cites ${list}, which you have not opened in this request. If your answer relies on what ${files.length === 1 ? 'that file contains' : 'those files contain'}, open ${files.length === 1 ? 'it' : 'them'} now with ${READ_FILE_TOOL_NAME} and give the corrected final answer. If it does not, give your final answer again.`;
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}
