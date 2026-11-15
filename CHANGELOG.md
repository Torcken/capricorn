# Changelog

All notable changes to Capricorn are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Context window sized for this machine: memory is estimated from the model's
  own metadata (only Gemma 4's global attention layers cache every token: ≈18
  KiB per token for 12B, measured on CUDA), and the largest of 8K–64K that fits
  on the GPU (32K at most on a CPU) is suggested. `capricorn doctor` shows the
  estimate, warns when the window pushes the model off the GPU and says how to
  change it; first-run onboarding uses the suggestion for the first session when
  `ollama.numCtx` is not set.
- Context management for small local windows: history compression now also works
  inside one long task (it could only split before a user message, so it never
  ran mid-task), upstream limits sized for 1M tokens are scaled to the local
  window (tool-output truncation and masking, per-output size), the summarizer's
  input is fitted to the window, only the summary block is kept, and the second
  verification pass is skipped locally. A request that still overflows warns
  once, or fails with a clear error in headless mode. Eval: `--num-ctx` option
  and a `context-long-read` task; results in `evals/capricorn/RESULTS.md`.
- `start.sh`: runs Capricorn from a source checkout after checking Node.js,
  dependencies and the local Ollama daemon, rebuilding the bundle when sources
  changed. Installs and downloads nothing.
- Hardware-aware onboarding: when no verified Gemma 4 model is installed,
  startup detects RAM and GPU (NVIDIA via `nvidia-smi`, AMD via sysfs, Apple
  Silicon unified memory), recommends a preset that fits (12B, else E4B, else
  E2B; larger presets listed but not auto-recommended) and, interactively,
  offers to download it (default: no). The model is then test-loaded, so one
  Ollama cannot run is reported before the session starts. `capricorn doctor`
  gains a `runtime.hardware` check (and warns when the selected model exceeds
  GPU memory); `capricorn models list` shows the recommendation.
- Behavioural eval suite for local Gemma 4 models (`npm run eval:capricorn`,
  `evals/capricorn/`): 14 tasks with deterministic, outcome-based checkers; the
  suite itself is validated in the e2e tests.
- Cited-files check (`model.checkCitedFiles`, default on): when a final answer
  cites 1–3 workspace files that were never opened during the request, the model
  is asked once to open them and correct the answer. In evals this took
  `explore-config-port` (answer guessed without opening the config file) from
  3–6/10 to 10/10.
- `capricorn doctor --load` loads the selected model once with the configured
  `num_ctx` (check `models.load`), catching models that verify as Gemma 4 but
  that this Ollama build cannot run, or that do not fit in memory.

### Changed

- npm package name: `capricorn-code` (`capricorn-cli` and `capricorn` belong to
  other projects on npm). The command is still `capricorn`. Repository links
  added to `package.json`; the package stays private until it is published.
- Cheaper history compression on local models: in `ollama.think: auto`, internal
  calls (compression, loop detection, next-speaker and edit checks) no longer
  think (upstream configs keyed by Gemini names asked for thoughts), and local
  summaries use a short prompt without a scratchpad, with a length cap. At an 8K
  window the slowest eval tasks run about twice as fast.
- Gemma 4 system prompt (v2): rules follow the session's real tools (shell is
  only mentioned when available; read-only sessions get a "describe, don't edit"
  rule), plans are written inline and followed by action, answers must name
  every item asked for.
- Gemma 4 system prompt (v3): read the file that holds the answer before
  answering; check the project setup before creating files.
- `grep_search` adds 2 lines of context around each match for 4–20 matches
  (upstream: only for 1–3), so the enclosing function is usually visible.
- The bundle no longer contains the `@google/genai` SDK (hosted Gemini/Vertex
  clients, `google-auth-library`): only its types are used, and its few runtime
  values are implemented locally (`core/genaiRuntime.ts`). The bundle is 1.3 MB
  smaller; the package smoke test checks that no SDK code ships.
- The experimental Gemma model router (`experimental.gemmaModelRouter`) is
  always off: it sent prompts to a separate LiteRT-LM server running a
  non-Gemma-4 model.

### Fixed

- Leftover Google behaviour removed from user-visible paths: an Ollama 404 or
  429 no longer starts Gemini model fallback or quota dialogs (a 429 now says
  Ollama is busy, not "switching to gemini-2.5-flash"); errors say "Error when
  talking to Ollama", not "Gemini API"; the ACP (editor) integration offers only
  local Ollama instead of Google login, Gemini API key, Vertex AI and gateway;
  tips for missing commands (`/bug`, `/docs`, `/privacy`, `/setup-github`, …)
  are gone, and so is dead code (the `run-gemini-cli` GitHub release lookup,
  Antigravity installer commands).
- Headless runs report a model failure by its message instead of "An unexpected
  critical error occurred:[object Object]" and a stack trace.
- Error reports are written as `capricorn-client-error-*.json`, readable by
  their owner only (they hold the conversation; the temp directory is shared).
- Headless runs that hit the context window limit ended with an empty answer and
  exit code 0; they now fail with an explanation.

- Startup questions (e.g. "Use the installed model … instead? [Y/n]") were
  invisible: they were written to the already-redirected stderr, leaving a blank
  screen waiting for an answer. They now use the real terminal.

- Headless runs could hang until the time limit: the model could call
  `enter_plan_mode` and then never leave Plan Mode. The tool is now only offered
  in interactive sessions.
- API request events were labelled with the Gemini API host even though requests
  go to Ollama; they now carry the Ollama endpoint.
- Gemma 4 reasoning could appear in the answer: Ollama sometimes misses the
  opening thinking marker and streams the reasoning as normal text up to
  `<channel|>` (11 of 431 eval runs, 8 of which then failed). With thinking on,
  such text is now held back and turned into thinking when the marker arrives;
  answers without it are released unchanged (streaming starts at once when
  thinking arrives normally, or after 8,000 characters at most).
- `write_file` no longer lets the model "create a directory" by writing an empty
  extensionless file (which then blocked every write into that directory): such
  writes are refused with an explanation that parent directories are created
  automatically, and a file blocking a parent path is named in the error instead
  of a bare `ENOTDIR`.
- Gemma 4 channel markers (`<|channel>thought`, `<channel|>`) leaking into
  thinking output are stripped.

- Container sandbox (`--sandbox` with Podman/Docker) could not run at all: the
  image still installed and launched a `gemini` binary, and the in-container CLI
  had no route to Ollama. The host now relays Ollama into the container through
  a filtered Unix-socket bridge (inference and read-only endpoints only; model
  pull/push/delete refused), keeping the sandbox network off.
- The default sandbox image `capricorn-sandbox:local` is never pulled from a
  registry (Podman would have resolved the unqualified name against public
  registries).
- `GEMINI_SANDBOX=podman` is no longer overridden by `--sandbox`.
- Rootless Podman: run as the host user (`--userns=keep-id`); on SELinux hosts
  disable label separation for the sandbox container instead of failing with
  `EACCES`.

### Removed

- Windows support claim and the Windows CI job: Capricorn supports Linux and
  macOS only.
- Gemini Live voice transcription (Google Cloud); local Whisper is the only
  backend.
- OpenTelemetry export (including the Google Cloud target) can no longer be
  enabled by settings, `GEMINI_TELEMETRY_*`/`OTEL_*` variables or flags.
- Google credential and service-account impersonation auth for MCP servers and
  remote agents (now an explicit error).
- Google sign-in, Code Assist client, account onboarding and Clearcut usage
  logger network code (inert stand-ins keep the upstream API), Google Cloud
  telemetry exporters and Gemini Live transcription; `google-auth-library` and
  `@google-cloud/*` dependencies of the core package.

- The container sandbox no longer mounts `~/.config/gcloud` or the
  `GOOGLE_APPLICATION_CREDENTIALS` file.
- The upstream A2A server (`packages/a2a-server`, never part of the `capricorn`
  package). It supported only Google back-ends and Google Cloud Storage
  persistence and could not start in Capricorn. Its dependencies
  (`@google-cloud/storage`, Express and others, 45 packages) went with it. The
  A2A client for remote agents is unchanged.

## [0.1.0-alpha.0] - 2026-11-10 (not published)

First Capricorn build, forked from Gemini CLI v0.67.0 (`dc6602ce`).

### Added

- Local Ollama provider for verified Gemma 4 models: native `/api/chat`
  streaming, tool calls, thinking, structured output, model verification from
  GGUF metadata, explicit `num_ctx`, calibrated token estimates.
- Commands: `doctor`, `status`, `models list|info|pull|use`,
  `config list|get|set`, `init`, `run`, `sessions list|resume|delete`.
- Startup preflight with actionable errors; no silent model substitution.
- Process-wide egress guard (loopback + user allowlist only).
- Concise Gemma 4 system prompt.
- Per-prompt time budget (`model.maxRunMinutes`).
- `/model` picker restricted to local Gemma 4 models; header shows local or
  remote inference and the safety mode.
- End-to-end suite, offline verification script, package smoke test, gated
  real-model smoke test; CI workflow without secrets.

### Changed

- Storage under `~/.capricorn` and `.capricorn/`; instructions in
  `CAPRICORN.md`; ignore file `.capricornignore`.
- Sub-agents and topic narration default to off; sandbox network defaults to off
  and uses a locally built image.
- The agent's own configuration directory always requires confirmation to
  modify.

### Removed

- Google sign-in, Gemini API key, Vertex AI and Code Assist back-ends.
- Usage statistics, update checks, `google_web_search`, `web_fetch`, LiteRT-LM
  router, hosted extension gallery, `/auth`, `/bug`, `/docs`, `/privacy`,
  `/setup-github`, `/upgrade`.
