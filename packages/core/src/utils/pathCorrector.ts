/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Config } from '../config/config.js';
import { bfsFileSearchSync } from './bfsFileSearch.js';
import {
  resolveDefensiveToolPath,
  resolveToRealPath,
  toPathKey,
} from './paths.js';

function resolveToRealPathSafe(pathStr: string): string {
  try {
    return resolveToRealPath(pathStr);
  } catch {
    return path.resolve(pathStr);
  }
}

type SuccessfulPathCorrection = {
  success: true;
  correctedPath: string;
};

type FailedPathCorrection = {
  success: false;
  error: string;
};

/**
 * Returns the directory relative file paths resolve against.
 *
 * Capricorn: upstream picked the workspace of the file open in the IDE
 * companion; without the companion this is always the target directory.
 */
export function resolveActiveWorkspaceDir(
  config: Config,
  _relativeFilePath?: string,
): string {
  return config.getTargetDir();
}

/**
 * Attempts to correct a relative or ambiguous file path to a single, absolute path
 * within the workspace.
 *
 * @param filePath The file path to correct.
 * @param config The application configuration.
 * @returns A `PathCorrectionResult` object with either a `correctedPath` or an `error`.
 */
export type PathCorrectionResult =
  | SuccessfulPathCorrection
  | FailedPathCorrection;
export function correctPath(
  filePath: string,
  config: Config,
): PathCorrectionResult {
  const targetDir = resolveToRealPathSafe(
    resolveActiveWorkspaceDir(config, filePath),
  );
  const sanitizedPath = resolveDefensiveToolPath(filePath, targetDir);

  // Check for direct path relative to the active target directory.
  const directPath = resolveToRealPathSafe(path.join(targetDir, sanitizedPath));
  if (fs.existsSync(directPath)) {
    return { success: true, correctedPath: directPath };
  }

  const fallbackTargetDir = resolveToRealPathSafe(config.getTargetDir());
  if (toPathKey(targetDir) !== toPathKey(fallbackTargetDir)) {
    const fallbackDirectPath = resolveToRealPathSafe(
      path.join(fallbackTargetDir, sanitizedPath),
    );
    if (fs.existsSync(fallbackDirectPath)) {
      return { success: true, correctedPath: fallbackDirectPath };
    }
  }

  // If not found directly, search across workspace directories for ambiguous matches.
  const workspaceContext = config.getWorkspaceContext();
  const searchPaths = workspaceContext.getDirectories();
  const basename = path.basename(sanitizedPath);
  const normalizedTarget = sanitizedPath.replace(/\\/g, '/');

  if (toPathKey(targetDir) !== toPathKey(fallbackTargetDir)) {
    const activeFoundFiles = bfsFileSearchSync(targetDir, {
      fileName: basename,
      maxDirs: 50,
      fileService: config.getFileService(),
      fileFilteringOptions: config.getFileFilteringOptions(),
    }).filter((f) => f.replace(/\\/g, '/').endsWith(normalizedTarget));

    if (activeFoundFiles.length === 1) {
      return { success: true, correctedPath: activeFoundFiles[0] };
    }
  }

  // Normalize path for matching and check if it ends with the provided relative path
  const foundFiles = searchPaths
    .flatMap((searchPath) =>
      bfsFileSearchSync(searchPath, {
        fileName: basename,
        maxDirs: 50, // Capped to avoid deep hangs
        fileService: config.getFileService(),
        fileFilteringOptions: config.getFileFilteringOptions(),
      }),
    )
    .filter((f) => f.replace(/\\/g, '/').endsWith(normalizedTarget));

  if (foundFiles.length === 0) {
    return {
      success: false,
      error: `File not found for '${filePath}' and path is not absolute.`,
    };
  }

  if (foundFiles.length > 1) {
    return {
      success: false,
      error: `The file path '${filePath}' is ambiguous and matches multiple files. Please provide a more specific path. Matches: ${foundFiles.join(', ')}`,
    };
  }

  return { success: true, correctedPath: foundFiles[0] };
}
