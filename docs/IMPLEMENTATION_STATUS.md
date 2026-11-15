# Implementation status

Legend: **done** = implemented and tested · **unverified** = implemented, not
fully tested · **deferred** · **blocked**.

| Area                                                                                | Status                                 | Evidence                                                         |
| ----------------------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------- |
| Fork of Gemini CLI v0.67.0, attribution, ADR                                        | done                                   | docs/UPSTREAM.md, NOTICE, docs/adr/0001-foundation.md            |
| Ollama provider (stream/non-stream, tools, thinking, errors, retries, cancellation) | done                                   | `providers/ollama/*.test.ts` (105 tests)                         |
| Gemma 4 verification from metadata; cloud/alias rejection                           | done                                   | `modelPolicy.test.ts`, e2e                                       |
| Google back-ends removed; credentials ignored                                       | done                                   | `contentGenerator.test.ts`, `auth.test.ts`                       |
| Egress guard (loopback + user allowlist)                                            | done                                   | `egressGuard.test.ts`, e2e, `verify:offline`                     |
| Gemma 4 system prompt                                                               | done                                   | `capricornSnippets.test.ts`, real-model smoke                    |
| CLI commands: doctor, status, models, config, init, run, sessions                   | done                                   | unit tests, e2e, manual runs against real Ollama                 |
| Startup preflight, no silent model switch                                           | done                                   | `preflight.test.ts`, e2e                                         |
| `/model` + model dialog restricted to Gemma 4                                       | done (dialog: unit/gradient test only) | `BuiltinCommandLoader.test.ts`                                   |
| Malformed/unknown tool calls never executed; workspace escape refused               | done                                   | e2e security suite                                               |
| `.capricorn` self-config protection incl. NTFS/8.3 spellings                        | done                                   | `safety/built-in.test.ts`                                        |
| Per-prompt time budget                                                              | done                                   | e2e "time budget"                                                |
| Interactive TUI start → answer → Ctrl+C                                             | done                                   | `e2e/interactive.e2e.test.ts`                                    |
| Package smoke (bundle, pack, install, launch)                                       | done                                   | `scripts/capricorn/pack-smoke.js` (Linux)                        |
| Real-model smoke (`gemma4:12b`, read→fix→test→summary + denial)                     | done (Linux, 1 run)                    | `e2e/.results/real-model-smoke.json`                             |
| macOS                                                                               | done (CI: unit subset, e2e)            | CI `Smoke (macos-latest)`; no real-model run yet                 |
| Windows                                                                             | not supported                          | dropped from CI (decision 2026-11-12)                            |
| Container sandbox (`capricorn-sandbox:local`, Ollama bridge, network off)           | done (Linux: rootless Podman, Docker)  | `sandbox*.test.ts`, gated `e2e/sandbox.e2e.test.ts`              |
| Container sandbox on Docker Desktop (macOS/Windows), runsc, LXC; macOS Seatbelt     | unverified                             | not run; see docs/SECURITY.md#sandbox                            |
| README quickstart in a fresh clone                                                  | done (Linux)                           | clone → `npm ci` → build → bundle → doctor → `run`               |
| Behavioural eval suite (15 tasks, outcome-based checkers)                           | done                                   | `evals/capricorn/`, `e2e/evals-*.e2e.test.ts`                    |
| Prompt tuning from evals (`gemma4:12b`: 74% → 95%)                                  | in progress                            | `evals/capricorn/RESULTS.md`                                     |
| Settings-reachable Google paths (voice, telemetry, MCP/agent auth) closed           | done                                   | unit tests per path                                              |
| Hardware-aware onboarding (recommend, offer download, test load)                    | done (Linux/NVIDIA verified)           | `recommend.test.ts`, `preflight.test.ts`, pty e2e                |
| Context management for small windows (mid-task compression, scaled limits)          | done (8K/32K evals)                    | `evals/capricorn/RESULTS.md`, `chatCompressionService.test.ts`   |
| Local web fetch                                                                     | deferred                               | docs/ROADMAP.md                                                  |
| Removal of Google network code (OAuth, Code Assist, Clearcut, GCP export) and deps  | done (see UPSTREAM.md for leftovers)   | docs/UPSTREAM.md                                                 |
| npm publication                                                                     | blocked                                | name chosen: `capricorn-code` (free); needs maintainer npm login |

## Test results

Measured on Linux x64, Node 22.22.2, Ollama 0.30.11.

- **Baseline at the fork base (before any change):** core 7 failing / 8589; cli
  5 failing / 7539 (chat compression truncation, model-config golden, topic
  policy, fileUtils truncation; StatsDisplay, SessionSummaryDisplay, models
  list).
- **Capricorn suites:** provider/security/generator 129/129; CLI Capricorn
  modules 23/23 + config/settings suites passing; e2e 25/25 (also 23/23 inside a
  loopback-only network namespace); real-model smoke 2/2.
- **Final full run (2026-11-11, commit after docs cleanup):** core 7 failed /
  8618 and cli 4 failed / 7448 — exactly the pre-existing upstream failures
  listed above (the fifth baseline CLI failure belonged to the removed upstream
  `models list` command). `npm run typecheck`, `npm run lint` and
  `npx prettier --check .` pass. E2E 25/25 (the real-model smoke file is skipped
  unless `CAPRICORN_REAL_MODEL=1`).

- **After removing Google network code (2026-11-11, `7188c8c`):** core 7 failed
  / 8389 (fewer tests: the deleted Google modules' tests went with them) and cli
  4 failed / 7466, the same upstream failures; typecheck, lint, prettier pass;
  e2e 65 passed, 3 gated skips; fresh bundle passes `doctor` and a real
  `gemma4:12b` fix. `packages/a2a-server` (not part of the quality gate, not in
  the `capricorn` package) has 3 failing tests that stem from the Ollama-only
  back-end and workspace `.env` handling; not verified against the fork base.
- **After closing Google paths, eval suite, prompt v2 (2026-11-11):** core 7
  failed / 8630 and cli 4 failed / 7466 (the same upstream failures); typecheck,
  lint and prettier pass; e2e 65 passed, 3 gated skips. Evals: see
  `evals/capricorn/RESULTS.md`. `gemma4:latest` could not be evaluated: Ollama
  0.30.11 fails to load it on the test machine.
- **After the sandbox fixes (2026-11-11):** cli 4 failed / 7467 (the same four
  upstream failures; +19 new tests), core unchanged; typecheck, lint and
  prettier pass; e2e 25 passed, 3 gated skips.
- **Sandbox and quickstart (2026-11-11):** a fresh clone passed `npm ci` (31 s),
  `npm run build`, `npm run bundle`; `capricorn doctor` reported "ready" against
  Ollama 0.30.11 and `capricorn run` answered correctly with `gemma4:12b`.
  `npm run build:sandbox` built `capricorn-sandbox:local` with rootless Podman
  5.8.1 (SELinux enforcing); `capricorn --sandbox` answered a prompt from inside
  the container, and probes from inside the running container confirmed: no
  internet, no route to the host's Ollama port, `/api/pull` and `/api/delete`
  refused by the bridge, only the project and session settings mounted. The same
  checks passed with rootful Docker 29. Gated sandbox e2e 1/1 with each of
  Podman and Docker.
- **Correction (2026-11-12): the "7 core / 4 cli upstream failures" were local
  artefacts.** Run as CI runs them (`npm run test:ci -w …` from the package
  directory) with `LC_ALL=C.UTF-8 TZ=UTC`, core passes 8377/8434 (57 skipped)
  and cli 7467/7471 (4 skipped) with 0 failures, on Node 22 and on Node 20. The
  failures came from running Vitest from the repository root (cwd-relative
  fixtures: model-config golden, topic policy) and from the development
  machine's French locale (number formatting). The entries below that list those
  failures describe that local setup.
- **CI was red on every push (2026-11-12).** On Node 20 (`.nvmrc`),
  `node --test 'test/**/*.test.js'` does not expand the glob, so 5 eval-suite
  e2e tests failed (they passed locally on Node 22). The eval checkers now list
  test files explicitly; on Node 20 in a fresh clone, every CI step of the Linux
  jobs passes (`npm ci`, prettier, build, lint, typecheck, core and cli unit
  tests, e2e 71 + 3 gated skips, package smoke). CI run #1 predates the eval
  suite and failed for a reason not yet known (no access to the logs); macOS and
  Windows not verified locally.
- **CI logs read (2026-11-12, after the fix above).** macOS and the Linux e2e
  job passed; two causes remained, present since run #1: (1) the retained
  SandboxManager integration tests (19) need `bwrap`, which the runner lacks and
  Ubuntu 24.04's AppArmor blocks — CI now installs bubblewrap and lifts the
  restriction, as upstream's CI does; (2) on Windows `node-pty` (an optional
  native build) is not installed, so the interactive e2e test now uses the
  prebuilt `@lydell/node-pty`. Also found: the e2e job's offline verification
  had never actually run in CI (skipped with a warning for the same AppArmor
  reason); it now lifts the restriction and fails instead of skipping.
- **CI follow-ups (2026-11-12).** The CLI unit suite (~110 min on a 4-CPU hosted
  runner) hit the 60-minute job limit; it now runs as 4 parallel shards with
  coverage off. A flaky dialog test made a real call to the Ollama daemon; it is
  now stubbed. On Windows the interactive e2e test needed `SystemRoot` & co.
  passed to `node-pty`; with that, startup and a streamed answer pass. **Known
  gap:** on Windows CI the TUI never reported an exit (neither Ctrl+C nor
  `/quit`; undiagnosed), so the exit is asserted on Linux and macOS only.
  Windows was then declared unsupported and removed from CI.
- **After removing `packages/a2a-server` (2026-11-12):** core 7 failed / 8421
  and cli 4 failed / 7471 (the same upstream failures); typecheck, lint and
  prettier pass; build and bundle succeed; e2e and `verify:offline` 71 passed, 3
  gated skips; package smoke test passes. The 3 A2A server test failures noted
  above went with the package.

## Known limitations

- Headless runs offer only read-only tools unless `--approval-mode auto_edit` or
  an allowlist is given.
- Approved shell commands and local MCP processes are outside the egress guard.
- `web_fetch` and web search are unavailable.
- `gemma4:e4b` (also `gemma4:latest`) fails to load on Ollama 0.30.11
  (`Gemma4Assistant requires ctx_other to be set`), at any context size. The
  onboarding still recommends E4B for GPUs under ≈11 GiB; its test load reports
  the failure right after the download. AMD and Apple GPU detection are
  unit-tested only.
- Some retained upstream unit tests write to the real `~/.capricorn`.
- Upstream integration/eval/perf suites are not part of the quality gate.
- Internal package names remain `@google/gemini-cli-*` (private, bundled).
