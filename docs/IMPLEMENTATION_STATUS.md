# Implementation status

Legend: **done** = implemented and tested · **unverified** = implemented, not
fully tested · **deferred** · **blocked**.

| Area                                                                                | Status                                 | Evidence                                                |
| ----------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------- |
| Fork of Gemini CLI v0.67.0, attribution, ADR                                        | done                                   | docs/UPSTREAM.md, NOTICE, docs/adr/0001-foundation.md   |
| Ollama provider (stream/non-stream, tools, thinking, errors, retries, cancellation) | done                                   | `providers/ollama/*.test.ts` (105 tests)                |
| Gemma 4 verification from metadata; cloud/alias rejection                           | done                                   | `modelPolicy.test.ts`, e2e                              |
| Google back-ends removed; credentials ignored                                       | done                                   | `contentGenerator.test.ts`, `auth.test.ts`              |
| Egress guard (loopback + user allowlist)                                            | done                                   | `egressGuard.test.ts`, e2e, `verify:offline`            |
| Gemma 4 system prompt                                                               | done                                   | `capricornSnippets.test.ts`, real-model smoke           |
| CLI commands: doctor, status, models, config, init, run, sessions                   | done                                   | unit tests, e2e, manual runs against real Ollama        |
| Startup preflight, no silent model switch                                           | done                                   | `preflight.test.ts`, e2e                                |
| `/model` + model dialog restricted to Gemma 4                                       | done (dialog: unit/gradient test only) | `BuiltinCommandLoader.test.ts`                          |
| Malformed/unknown tool calls never executed; workspace escape refused               | done                                   | e2e security suite                                      |
| `.capricorn` self-config protection incl. NTFS/8.3 spellings                        | done                                   | `safety/built-in.test.ts`                               |
| Per-prompt time budget                                                              | done                                   | e2e "time budget"                                       |
| Interactive TUI start → answer → Ctrl+C                                             | done                                   | `e2e/interactive.e2e.test.ts`                           |
| Package smoke (bundle, pack, install, launch)                                       | done                                   | `scripts/capricorn/pack-smoke.js` (Linux)               |
| Real-model smoke (`gemma4:12b`, read→fix→test→summary + denial)                     | done (Linux, 1 run)                    | `e2e/.results/real-model-smoke.json`                    |
| macOS / Windows                                                                     | unverified                             | CI matrix written, not yet run                          |
| Container sandbox (`capricorn-sandbox:local`, Ollama bridge, network off)           | done (Linux: rootless Podman, Docker)  | `sandbox*.test.ts`, gated `e2e/sandbox.e2e.test.ts`     |
| Container sandbox on Docker Desktop (macOS/Windows), runsc, LXC; macOS Seatbelt     | unverified                             | not run; see docs/SECURITY.md#sandbox                   |
| README quickstart in a fresh clone                                                  | done (Linux)                           | clone → `npm ci` → build → bundle → doctor → `run`      |
| Behavioural eval suite (14 tasks, outcome-based checkers)                           | done                                   | `evals/capricorn/`, `e2e/evals-*.e2e.test.ts`           |
| Prompt tuning from evals (`gemma4:12b`: 74% → 95%)                                  | in progress                            | `evals/capricorn/RESULTS.md`                            |
| Settings-reachable Google paths (voice, telemetry, MCP/agent auth) closed           | done                                   | unit tests per path                                     |
| Hardware-aware onboarding, local web fetch                                          | deferred                               | docs/ROADMAP.md                                         |
| Removal of unreachable Google code (code_assist, OAuth, Clearcut)                   | deferred                               | docs/UPSTREAM.md                                        |
| npm publication                                                                     | blocked                                | needs package-name ownership and maintainer credentials |

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

## Known limitations

- Headless runs offer only read-only tools unless `--approval-mode auto_edit` or
  an allowlist is given.
- Approved shell commands and local MCP processes are outside the egress guard.
- `web_fetch` and web search are unavailable.
- Some retained upstream unit tests write to the real `~/.capricorn`.
- Upstream integration/eval/perf suites are not part of the quality gate.
- Internal package names remain `@google/gemini-cli-*` (private, bundled).
