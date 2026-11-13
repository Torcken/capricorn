/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression guard: Capricorn's own source must not reintroduce Google
 * sign-in, Code Assist, usage statistics, Gemini/Vertex API clients or Google
 * Cloud telemetry (e.g. through an upstream merge).
 *
 * Scope is first-party, non-test source of the core and CLI packages.
 * `@google/genai` may only be imported for its *types* (Capricorn's internal
 * message model); its runtime values come from `core/genaiRuntime.ts`. Any
 * value import (or an `import { type X }` form, which `verbatimModuleSyntax`
 * keeps as a side-effect import) would put the SDK's hosted clients and
 * `google-auth-library` back into the bundle.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const packagesDir = path.resolve(here, '../../..');
const ROOTS = [
  path.join(packagesDir, 'core', 'src'),
  path.join(packagesDir, 'cli', 'src'),
];

/** Imports that would bring Google auth or Google Cloud clients back. */
const FORBIDDEN_IMPORTS =
  /from\s+['"](google-auth-library|@google-cloud\/[\w-]+)['"]|import\(\s*['"](google-auth-library|@google-cloud\/[\w-]+)['"]/;

/** Google service hosts that Capricorn code must never address. */
const FORBIDDEN_HOSTS = [
  'oauth2.googleapis.com',
  'accounts.google.com',
  'cloudcode-pa.googleapis.com',
  'play.googleapis.com',
  'generativelanguage.googleapis.com',
  'aiplatform.googleapis.com',
  'cloudtrace.googleapis.com',
  'monitoring.googleapis.com',
  'logging.googleapis.com',
];

/**
 * Remaining, reviewed exceptions: string data only, no network code.
 * Each entry names the hosts it may mention and why.
 */
const HOST_EXCEPTIONS: Record<string, { hosts: string[]; reason: string }> = {
  'core/src/utils/googleQuotaErrors.ts': {
    hosts: ['cloudcode-pa.googleapis.com'],
    reason:
      'domain names used to recognise the shape of Google error payloads (string matching, retained upstream retry classification)',
  },
  'core/src/utils/googleErrors.ts': {
    hosts: ['cloudcode-pa.googleapis.com'],
    reason: 'example error payload in a doc comment',
  },
  'core/src/billing/billing.ts': {
    hosts: ['accounts.google.com'],
    reason:
      'unreachable upstream "buy credits" link builder (no Code Assist server exists); slated for removal',
  },
  // Capricorn's own explanatory comments about what was removed.
  'core/src/code_assist/server.ts': {
    hosts: ['cloudcode-pa.googleapis.com'],
    reason: 'file overview comment',
  },
  'core/src/telemetry/clearcut-logger/clearcut-logger.ts': {
    hosts: ['play.googleapis.com'],
    reason: 'file overview comment',
  },
};

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__snapshots__' || entry.name === 'test-utils') {
        continue;
      }
      yield* sourceFiles(full);
    } else if (
      /\.(ts|tsx)$/.test(entry.name) &&
      !/\.test\.tsx?$|\.test\.circular\.ts$|\.d\.ts$/.test(entry.name)
    ) {
      yield full;
    }
  }
}

/**
 * Returns the `@google/genai` imports/exports in `file` that are not erased at
 * build time (anything but `import type { … }` / `export type { … }`).
 */
function genaiRuntimeImports(file: string): string[] {
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes('@google/genai')) return [];
  const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    const spec =
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
        ? node.moduleSpecifier.text
        : undefined;
    if (spec === '@google/genai') {
      const erased = ts.isImportDeclaration(node)
        ? node.importClause?.isTypeOnly === true
        : ts.isExportDeclaration(node) && node.isTypeOnly;
      if (!erased) found.push(node.getText(src).replace(/\s+/g, ' '));
    }
    // Dynamic import('@google/genai') and require('@google/genai').
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === 'require')) &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === '@google/genai'
    ) {
      found.push(node.getText(src));
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
  return found;
}

function rel(file: string): string {
  return path.relative(packagesDir, file).split(path.sep).join('/');
}

describe('no Google services in Capricorn source', () => {
  const files = ROOTS.flatMap((r) => [...sourceFiles(r)]);

  it('scans a meaningful number of files', () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it('does not import google-auth-library or @google-cloud/*', () => {
    const offenders = files.filter((f) =>
      FORBIDDEN_IMPORTS.test(fs.readFileSync(f, 'utf8')),
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it('imports @google/genai for types only (no SDK code in the bundle)', () => {
    const offenders = files.flatMap((f) =>
      genaiRuntimeImports(f).map((imp) => `${rel(f)}: ${imp}`),
    );
    expect(offenders).toEqual([]);
  });

  it('does not address Google sign-in, Code Assist, Gemini or Cloud telemetry hosts', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8');
      const allowed = HOST_EXCEPTIONS[rel(f)]?.hosts ?? [];
      for (const host of FORBIDDEN_HOSTS) {
        if (text.includes(host) && !allowed.includes(host)) {
          offenders.push(`${rel(f)}: ${host}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the exception list honest (every exception still applies)', () => {
    for (const [file, { hosts }] of Object.entries(HOST_EXCEPTIONS)) {
      const abs = path.join(packagesDir, file);
      expect(fs.existsSync(abs), `${file} no longer exists`).toBe(true);
      const text = fs.readFileSync(abs, 'utf8');
      for (const host of hosts) {
        expect(text.includes(host), `${file} no longer mentions ${host}`).toBe(
          true,
        );
      }
    }
  });
});
