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
| Sandbox with `capricorn-sandbox:local` image                                        | unverified                             | defaults changed; image build not run                   |
| Hardware-aware onboarding, local web fetch, eval suite                              | deferred                               | docs/ROADMAP.md                                         |
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
- **Last full-suite run** before the final documentation/link cleanup: core only
  the 7 pre-existing failures; cli 4 pre-existing failures. A final full run of
  core, cli, typecheck and lint after the last commit was **started but its
  results are not recorded here** — rerun before relying on this table (see
  docs/TESTING.md).

## Known limitations

- Headless runs offer only read-only tools unless `--approval-mode auto_edit` or
  an allowlist is given.
- Approved shell commands and local MCP processes are outside the egress guard.
- `web_fetch` and web search are unavailable.
- Some retained upstream unit tests write to the real `~/.capricorn`.
- Upstream integration/eval/perf suites are not part of the quality gate.
- Internal package names remain `@google/gemini-cli-*` (private, bundled).
