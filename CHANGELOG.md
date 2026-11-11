# Changelog

All notable changes to Capricorn are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Behavioural eval suite for local Gemma 4 models (`npm run eval:capricorn`,
  `evals/capricorn/`): 14 tasks with deterministic, outcome-based checkers; the
  suite itself is validated in the e2e tests.

### Changed

- Gemma 4 system prompt (v2): rules follow the session's real tools (shell is
  only mentioned when available; read-only sessions get a "describe, don't edit"
  rule), plans are written inline and followed by action, answers must name
  every item asked for.

### Fixed

- Headless runs could hang until the time limit: the model could call
  `enter_plan_mode` and then never leave Plan Mode. The tool is now only offered
  in interactive sessions.
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

- Gemini Live voice transcription (Google Cloud); local Whisper is the only
  backend.
- OpenTelemetry export (including the Google Cloud target) can no longer be
  enabled by settings, `GEMINI_TELEMETRY_*`/`OTEL_*` variables or flags.
- Google credential and service-account impersonation auth for MCP servers and
  remote agents (now an explicit error).
- The container sandbox no longer mounts `~/.config/gcloud` or the
  `GOOGLE_APPLICATION_CREDENTIALS` file.

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
