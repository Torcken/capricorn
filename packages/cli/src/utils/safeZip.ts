/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview ZIP extraction that refuses symbolic links and escaping
 * paths before anything is written.
 *
 * Why: `extract-zip` (all versions, up to 2.0.1) follows symbolic-link
 * entries, so a crafted archive can first create a link pointing outside the
 * target directory and then write files through it (GHSA advisories
 * "unvalidated symlink path traversal" and "arbitrary file writes through
 * symlink archive entries"). No fixed release exists. Archives reach this
 * code from extension and skill installs, so they are untrusted: the whole
 * central directory is checked first, and extraction only starts when no
 * entry is a link and no path leaves the target.
 */

import * as path from 'node:path';
import extract from 'extract-zip';
import yauzl from 'yauzl';

/** Unix file-type bits in the upper 16 bits of `externalFileAttributes`. */
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

/**
 * Returns why an entry is refused, or undefined when it is safe.
 *
 * @param fileName Entry name as stored in the archive.
 * @param externalFileAttributes Raw attributes; Unix mode is the upper half.
 */
export function unsafeZipEntryReason(
  fileName: string,
  externalFileAttributes: number,
): string | undefined {
  if (((externalFileAttributes >>> 16) & S_IFMT) === S_IFLNK) {
    return 'is a symbolic link';
  }
  const normalized = fileName.replace(/\\/g, '/');
  if (
    normalized.startsWith('/') ||
    /^[A-Za-z]:/.test(normalized) ||
    path.posix.normalize(normalized).split('/').includes('..')
  ) {
    return 'points outside the extraction directory';
  }
  return undefined;
}

/** Reads every entry of the central directory without extracting. */
function listEntries(
  zipPath: string,
): Promise<Array<{ fileName: string; externalFileAttributes: number }>> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (openErr, zip) => {
      if (openErr || !zip) {
        reject(openErr ?? new Error(`Cannot open ${zipPath}`));
        return;
      }
      const entries: Array<{
        fileName: string;
        externalFileAttributes: number;
      }> = [];
      zip.on('entry', (entry: yauzl.Entry) => {
        entries.push({
          fileName: entry.fileName,
          externalFileAttributes: entry.externalFileAttributes,
        });
        zip.readEntry();
      });
      zip.on('end', () => {
        zip.close();
        resolve(entries);
      });
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

/**
 * Extracts `zipPath` into `dir` (absolute) after checking every entry.
 * Throws, writing nothing, when any entry is a symbolic link or would land
 * outside `dir`.
 */
export async function extractZipSafely(
  zipPath: string,
  dir: string,
): Promise<void> {
  for (const entry of await listEntries(zipPath)) {
    const reason = unsafeZipEntryReason(
      entry.fileName,
      entry.externalFileAttributes,
    );
    if (reason) {
      throw new Error(
        `Refusing to extract ${path.basename(zipPath)}: entry "${entry.fileName}" ${reason}.`,
      );
    }
  }
  await extract(zipPath, { dir });
}
