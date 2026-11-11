# Changelog

All notable changes to Capricorn are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

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
