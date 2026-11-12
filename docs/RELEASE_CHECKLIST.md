# Release checklist

Every item must be independently verifiable. Record the command output (or a
link to the CI run) next to each box in the release PR.

## Legal and identity

- [ ] `LICENSE` is the unmodified Apache-2.0 text.
- [ ] `NOTICE` names the fork base commit that matches `docs/UPSTREAM.md`.
- [ ] `npm pack --dry-run` lists only `bundle/`, `README.md`, `LICENSE`,
      `NOTICE`, `package.json`.
- [ ] Package name availability and ownership confirmed (`npm view <name>`);
      repository URL added to the root `package.json`.
- [ ] No Google logos or Gemini product branding in user-facing output:
      `capricorn --help`, startup screen, `/help`, `doctor` (manual review).
- [ ] GitHub private vulnerability reporting enabled (SECURITY.md relies on it).

## Build and tests

- [ ] `npm ci` on a clean clone succeeds.
- [ ] `npm run build`, `npm run lint`, `npm run typecheck`,
      `npx prettier --check .` pass.
- [ ] Unit tests: `npm run test:ci -w` for core and cli pass with no failures
      (CI, Node 20).
- [ ] `npm run test:e2e:capricorn` passes on Linux and macOS (CI).
- [ ] `npm run verify:offline` passes (Linux).
- [ ] `node scripts/capricorn/pack-smoke.js` passes.
- [ ] Real-model smoke test passes with `gemma4:12b` and `gemma4:e4b` on at
      least one machine; results JSON attached.

## Security and privacy

- [ ] `npm audit --omit=dev` reviewed; no unaddressed critical/high issues.
- [ ] `grep -rnE "https?://" packages/*/src --include=*.ts | grep -v test`
      reviewed for new runtime endpoints since the last release.
- [ ] Egress report during a real-model session shows no blocked attempts
      (`CAPRICORN_EGRESS_REPORT=1`).
- [ ] docs/SECURITY.md "Known limits" still accurate.

## Documentation

- [ ] README quickstart executed verbatim on a clean machine.
- [ ] Every documented command in docs/COMMANDS.md runs as described.
- [ ] CHANGELOG.md updated; IMPLEMENTATION_STATUS.md reflects this release.
- [ ] Comment-quality audit of new/changed modules done (module overview,
      exported-API TSDoc, protocol/security comments current).
