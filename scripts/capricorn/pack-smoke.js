/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Package smoke test (spec §9): builds the bundle, runs `npm pack`, installs
 * the tarball into a throwaway prefix and launches the *installed*
 * `capricorn` binary — exactly what a user gets from npm, minus publishing.
 *
 * Checks: package contents (no source maps of secrets, required legal files
 * present), no Google SDK code in the installed bundle, `capricorn --version`,
 * and `capricorn doctor --json` against the mock Ollama daemon. Never
 * publishes anything.
 *
 * Usage: node scripts/capricorn/pack-smoke.js   (after `npm run build`)
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'capricorn-pack-'));

function step(name, fn) {
  process.stdout.write(`- ${name}... `);
  const result = fn();
  process.stdout.write('ok\n');
  return result;
}

function fail(message) {
  process.stderr.write(`\nPACK SMOKE FAILED: ${message}\n`);
  process.exit(1);
}

try {
  step('bundle', () =>
    execFileSync(npm, ['run', 'bundle'], {
      cwd: root,
      stdio: 'pipe',
      shell: process.platform === 'win32',
    }),
  );

  const tarball = step('npm pack', () => {
    // --ignore-scripts: the bundle was built above; `prepare` would rebuild
    // it and print to stdout, corrupting the JSON report.
    const out = execFileSync(
      npm,
      ['pack', '--json', '--ignore-scripts', '--pack-destination', work],
      {
        cwd: root,
        encoding: 'utf8',
        shell: process.platform === 'win32',
      },
    );
    // Build steps triggered by npm may print before the JSON report; parse
    // from the first line that starts the JSON array.
    const jsonStart = out.search(/^\[/m);
    if (jsonStart === -1) fail(`npm pack produced no JSON report:\n${out}`);
    const [info] = JSON.parse(out.slice(jsonStart));
    const files = info.files.map((f) => f.path);
    for (const required of [
      'bundle/capricorn.js',
      'LICENSE',
      'NOTICE',
      'README.md',
    ]) {
      if (!files.includes(required)) fail(`package is missing ${required}`);
    }
    // Only these may ship. npm adds every root file whose name starts with
    // README (e.g. a local README draft) whatever `files` says, so an
    // allowlist catches what the `files` field alone cannot.
    const allowed = /^(bundle\/.+|LICENSE|NOTICE|README\.md|package\.json)$/;
    const unexpected = files.filter((f) => !allowed.test(f));
    if (unexpected.length > 0) {
      fail(`package contains unexpected files: ${unexpected.join(', ')}`);
    }
    if (
      files.some((f) => /(^|\/)\.env($|\.)|\.pem$|credentials\.json$/.test(f))
    ) {
      fail('package contains a credentials-looking file');
    }
    if (info.name !== 'capricorn-code')
      fail(`unexpected package name ${info.name}`);
    process.stdout.write(
      `(${files.length} files, ${(info.size / 1024 / 1024).toFixed(1)} MiB) `,
    );
    return path.join(work, info.filename);
  });

  const prefix = path.join(work, 'prefix');
  step('install tarball into a clean prefix', () =>
    execFileSync(
      npm,
      [
        'install',
        '--global',
        '--prefix',
        prefix,
        '--no-audit',
        '--no-fund',
        tarball,
      ],
      {
        stdio: 'pipe',
        shell: process.platform === 'win32',
      },
    ),
  );

  step('no Google SDK code in the installed package', () => {
    // The internal data model uses only @google/genai *types*; its runtime
    // (hosted Gemini/Vertex clients, google-auth-library) must not ship.
    // These markers only occur in that SDK code (checked when introduced).
    const pkgDir = [
      path.join(prefix, 'lib', 'node_modules', 'capricorn-code'),
      path.join(prefix, 'node_modules', 'capricorn-code'),
    ].find((d) => fs.existsSync(d));
    if (!pkgDir) fail('installed package directory not found');
    for (const dep of ['@google/genai', 'google-auth-library']) {
      if (fs.existsSync(path.join(pkgDir, 'node_modules', dep))) {
        fail(`installed package depends on ${dep}`);
      }
    }
    const markers = [
      'generativelanguage.googleapis.com',
      'aiplatform.googleapis.com',
      'google-auth-library',
    ];
    const bundleDir = path.join(pkgDir, 'bundle');
    for (const name of fs.readdirSync(bundleDir)) {
      if (!name.endsWith('.js')) continue;
      const text = fs.readFileSync(path.join(bundleDir, name), 'utf8');
      const hit = markers.find((m) => text.includes(m));
      if (hit) fail(`bundle/${name} contains "${hit}" (Google SDK code)`);
    }
  });

  const bin =
    process.platform === 'win32'
      ? path.join(prefix, 'capricorn.cmd')
      : path.join(prefix, 'bin', 'capricorn');
  const run = (args, env = {}) =>
    spawnSync(bin, args, {
      encoding: 'utf8',
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        HOME: work,
        USERPROFILE: work,
        GEMINI_CLI_NO_RELAUNCH: 'true',
        ...env,
      },
      timeout: 120_000,
    });

  step('capricorn --version', () => {
    const r = run(['--version']);
    const expected = JSON.parse(
      fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
    ).version;
    if (r.status !== 0 || r.stdout.trim() !== expected) {
      fail(`--version returned ${r.status}: ${r.stdout}${r.stderr}`);
    }
  });

  await (async () => {
    process.stdout.write('- capricorn doctor --json against mock Ollama... ');
    const { startMockOllama } = await import(
      path.join(
        root,
        'packages/core/dist/src/providers/ollama/testing/mockOllamaServer.js',
      )
    );
    const mock = await startMockOllama();
    try {
      // spawnSync would block the mock's event loop; run asynchronously.
      const { spawn } = await import('node:child_process');
      const result = await new Promise((resolve) => {
        const child = spawn(bin, ['doctor', '--json'], {
          shell: process.platform === 'win32',
          env: {
            ...process.env,
            HOME: work,
            USERPROFILE: work,
            GEMINI_CLI_NO_RELAUNCH: 'true',
            CAPRICORN_OLLAMA_HOST: mock.url,
          },
        });
        let stdout = '';
        child.stdout.on('data', (d) => (stdout += d));
        child.on('close', (code) => resolve({ code, stdout }));
      });
      const report = JSON.parse(result.stdout);
      if (result.code !== 0 || !report.ok)
        fail(`doctor failed: ${result.stdout}`);
    } finally {
      await mock.close();
    }
    process.stdout.write('ok\n');
  })();

  process.stdout.write('Package smoke test passed.\n');
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
