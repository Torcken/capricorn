# Contributing to Capricorn

Thanks for helping. Capricorn is a fork of Gemini CLI; most of the code base is
inherited, so please read [docs/UPSTREAM.md](docs/UPSTREAM.md) and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first.

## Ground rules

1. **Local-only, Gemma-4-only.** Changes must not add hosted inference, other
   model families, telemetry, update checks or any unapproved network call. New
   runtime network endpoints need an explicit opt-in and a security review note
   in the PR.
2. **Security in code, not prompts.** Permission, path and network decisions
   belong in the policy/safety/egress layers, with tests.
3. **Comments are part of done.** New modules need a module overview and TSDoc
   on exported APIs; protocol translations, stream handling, security branches
   and fallbacks need comments explaining _why_. Tests for subtle bugs say which
   regression or threat they guard. Keep comments accurate when you refactor.
4. **Honest status.** Do not mark features complete in
   `docs/IMPLEMENTATION_STATUS.md` unless they are implemented and tested.
5. **Small, reviewable PRs** with Conventional Commit titles (`feat:`, `fix:`,
   `docs:`, `test:`, `refactor:`, `chore:`).

## Licensing and headers

Contributions are accepted under the Apache License 2.0 (inbound = outbound); no
CLA is required. By submitting a PR you confirm you have the right to license
your contribution this way.

- New files:
  `Copyright (C) <year> Guillaume S. Condamine & all awesome contributors.`
  license header (ESLint enforces the format).
- Modified upstream files: keep the `Google LLC` header and mark your change
  with a `Capricorn:` comment.

## Development

```bash
npm ci
npm run build
npm run lint && npm run typecheck
npx vitest run --root packages/core     # and --root packages/cli
npm run test:e2e:capricorn              # after build
```

See [docs/TESTING.md](docs/TESTING.md) for single-test commands, the mock Ollama
server and the real-model smoke test. Run the CLI from source with
`node packages/cli/dist/index.js` after `npm run build`.

## Pull request checklist

- [ ] Tests added or updated (including a regression test for bug fixes).
- [ ] `npm run lint`, `npm run typecheck`, `npx prettier --check .` pass.
- [ ] Relevant unit suites and `npm run test:e2e:capricorn` pass.
- [ ] Docs updated (`docs/`, README, CHANGELOG "Unreleased").
- [ ] No new network endpoint, or it is opt-in and documented.

## Reporting security issues

Privately, see [SECURITY.md](SECURITY.md). Please do not open public issues for
vulnerabilities.
