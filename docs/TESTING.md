# Testing

## Commands

```bash
npm ci                          # install (runs the bundle via `prepare`)
npm run build                   # compile all workspaces

# Unit tests (Vitest), exactly as CI runs them
npm run test:ci -w @google/gemini-cli-core
npm run test:ci -w @google/gemini-cli
cd packages/core && npx vitest run src/providers/ollama/client.test.ts      # one file
cd packages/core && npx vitest run -t "refuses a remote endpoint"          # one test

# End-to-end: compiled CLI against the mock Ollama daemon (needs `npm run build`)
npm run test:e2e:capricorn

# Offline verification: e2e suite inside a loopback-only network namespace (Linux)
npm run verify:offline

# Package smoke test: bundle, npm pack, install into a temp prefix, launch
node scripts/capricorn/pack-smoke.js

# Container sandbox, gated (needs podman/docker and `npm run build:sandbox`)
CAPRICORN_SANDBOX_E2E=podman npm run test:e2e:sandbox

# Real model smoke test (optional, local Ollama + Gemma 4 required)
npm run test:smoke:real-model
CAPRICORN_SMOKE_MODEL=gemma4:e4b npm run test:smoke:real-model

# Behavioural evals with real Gemma 4 models (see evals/capricorn/README.md)
npm run eval:capricorn -- --model gemma4:12b --repeat 3

# Static checks
npm run lint && npm run typecheck && npx prettier --check .
```

Run Vitest suites one at a time: concurrent runs of the same package share a
coverage temp directory and can crash each other.

## Layers

| Layer       | Where                                                       | Talks to                                                                                                           |
| ----------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Unit        | `packages/*/src/**/*.test.ts(x)`                            | Nothing external; Ollama tests use the in-process mock server over a real loopback socket                          |
| Integration | `providers/ollama/*.test.ts`, `cli/src/capricorn/*.test.ts` | Mock Ollama HTTP server (`providers/ollama/testing/mockOllamaServer.ts`)                                           |
| End-to-end  | `e2e/capricorn.e2e.test.ts`, `e2e/interactive.e2e.test.ts`  | The compiled `capricorn` binary in a disposable git repo, isolated `HOME`, mock daemon; the TUI test uses node-pty |
| Offline     | `scripts/verify-offline.sh`                                 | Same e2e suite with no network interface except loopback                                                           |
| Real model  | `e2e/real-model.smoke.e2e.test.ts`                          | Your local Ollama and a real Gemma 4 model                                                                         |
| Evals       | `evals/capricorn/` (`npm run eval:capricorn`)               | Your local Ollama; 14 tasks scored by deterministic checkers (hidden tests, diffs), pass rates per model           |
| Sandbox     | `e2e/sandbox.e2e.test.ts` (gated)                           | `capricorn --sandbox` in a real container, mock daemon on a random host port via the Ollama bridge                 |

The mock daemon can script text, tool calls (`toolCallFrame`), errors (HTTP
status + body, in-band error frames), byte-level chunking, delays, first-byte
latency and connection truncation, and records every request so tests assert on
exactly what was sent to the model.

## Security regression tests

Each lives next to the code it guards, with a comment naming the threat:

- endpoint policy, credentials in URLs — `endpoint.test.ts`
- NDJSON memory bound, malformed frames — `ndjson.test.ts`
- misleading aliases, cloud models, other families — `modelPolicy.test.ts`
- egress blocking for fetch/https/raw sockets — `egressGuard.test.ts`
- `.capricorn` bypass spellings — `safety/built-in.test.ts`
- sandbox Ollama bridge refuses pull/push/delete —
  `sandboxOllamaBridge.test.ts`; no registry pull of the local image, no gcloud
  mount, remote endpoint refused, rootless Podman/SELinux flags —
  `utils/sandbox.test.ts`
- Google credentials ignored — `core/contentGenerator.test.ts`,
  `cli/src/config/auth.test.ts`, `validateNonInterActiveAuth.test.ts`
- end to end: denied shell/edits, malformed and unknown tool calls, workspace
  escape (relative and absolute), prompt injection, non-Gemma refusal, no
  external connections, time budget — `e2e/capricorn.e2e.test.ts`

## Behavioural evals

`evals/capricorn/` measures what the model actually achieves: exploration,
edits, test fixing (without touching the tests, verified by hidden tests), tool
use, and safety (prompt injection, secrets outside the workspace, honest
reporting of blocked actions). It is not run in CI because it needs a real
model. The suite itself is tested in CI without a model:
`e2e/evals-tasks.e2e.test.ts` proves each task passes with a reference solution
and fails with a realistic bad one; `e2e/evals-runner.e2e.test.ts` drives the
runner against the mock daemon. Results go to `evals/capricorn/results/`
(git-ignored); curated baselines are in `evals/capricorn/RESULTS.md`.

## Real model smoke test

Not run in CI (multi-GB downloads, GPU/CPU time). It performs a read → fix →
`node --test` → summary cycle with only that one command pre-approved, and a
safety-denial check, then writes model tag, digest, quantization, effective
context, host facts and timings to `e2e/.results/real-model-smoke.json`. Without
Ollama or the model it prints `SKIPPED: <reason>` — never a pass. Model output
is non-deterministic; treat a failure as a quality signal and re-run before
filing a bug.

## Known test-suite caveats

- **Run unit tests from the package directory, in an English locale.** A few
  retained upstream tests resolve fixtures relative to `process.cwd()` (the
  model-config golden files, topic policy), so
  `npx vitest run --root packages/core` from the repository root fails them; and
  snapshot tests format numbers with the system locale, so a French (or other)
  locale fails 3 core and 4 CLI tests. With `npm run test:ci -w …` and
  `LC_ALL=C.UTF-8 TZ=UTC`, both suites pass with no failures. (Earlier status
  entries recorded these 11 as "pre-existing upstream failures"; they were
  artefacts of how the suites were run.)
- **Node 20.** CI runs the minimum supported Node (`.nvmrc`). Node 21+ features
  break it silently on newer local Node versions; for example `node --test` only
  expands glob patterns since Node 21 (the eval checkers list test files
  explicitly for this reason).
- **Home-directory writes.** Some retained upstream unit tests write to the real
  `~/.capricorn` (upstream wrote to `~/.gemini`). Run the suites with a
  disposable `HOME` if this matters to you, e.g.
  `HOME=$(mktemp -d) npm run test:ci -w @google/gemini-cli`.
- The upstream `integration-tests/`, `evals/`, `memory-tests/` and `perf-tests/`
  suites were written for hosted Gemini models and are not part of Capricorn's
  quality gate yet.

## Coverage

```bash
npx vitest run --root packages/core --coverage src/providers src/security
```

See IMPLEMENTATION_STATUS.md for the latest measured numbers.
