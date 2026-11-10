# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

The repository holds **no code yet**: it is not a git repo, and it contains only two planning documents:

- `CAPRICORN_CLAUDE_CODE_MASTER_PROMPT.md`: the binding implementation spec. **Read it before starting any implementation work.**
- `ROADMAP.MD`: product requirements and a 16-week phased roadmap. The file stops partway through section 7.1 (Security).

There are no build, lint or test commands yet. When the codebase exists (forked from upstream), update this file with the real commands, taken from the inspected `package.json` scripts, rather than assumed ones. Expect npm workspaces, strict TypeScript, ESM, and React/Ink for the TUI.

## What Capricorn is

Capricorn is a local-first terminal coding agent with the binary name `capricorn`. It is a fork of `google-gemini/gemini-cli`, powered **only** by Gemma 4 models through a local Ollama instance (default `http://127.0.0.1:11434`, native `/api/chat`). The license is Apache-2.0.

Bootstrap procedure for an empty directory: initialize from a **pinned, tagged** upstream Gemini CLI release, and preserve its attribution. Record the commit in `docs/UPSTREAM.md` and the foundation decision in `docs/adr/0001-foundation.md`. Qwen Code (`QwenLM/qwen-code`) is the fallback foundation, but adopt it only after a documented comparison. Never switch silently.

## Planned architecture (adapt to the upstream layout, don't impose it)

These are the upstream reference points to inspect first, because paths may have drifted:

- `packages/core/src/core/contentGenerator.ts`: the inference interface. An `OllamaContentGenerator` implements it.
- `packages/core/src/core/client.ts`: chat and turn handling, the agent loop.
- `packages/core/src/config/config.ts`: config and tool registration.
- `packages/core/src/tools/`: filesystem, search, shell and patch tools.
- `packages/core/src/policy/`: confirmation and security policy.
- `packages/cli/`: the UI and CLI.

Planned additions: `packages/core/src/providers/ollama/` (the transport plus the protocol translation), `packages/core/src/models/` (Gemma 4 registry and verification), `context/`, `security/`, `packages/evals/` and `integration-tests/`. Keep everything inside the existing monorepo. Extract a new package only when there is a clear benefit.

The request flow is: CLI → session manager → context manager (instructions plus tool schemas) → orchestrator → Ollama adapter → streamed text and tool calls → schema validation → permission engine → tool execution → results back to the model. The loop repeats until the task completes, the user cancels, or a configured limit is reached.

During the first stage, upstream Gemini request/response types may remain internally behind the adapter. Migrate them to provider-independent interfaces later. Don't break the agent loop with a mass rewrite.

## Non-negotiable rules from the spec

- **Gemma 4 only, local only.** Don't fall back silently to any other model family, hosted API, or `*:cloud` tag. Verify models through Ollama metadata (`/api/tags`, `/api/show`), not just name prefixes. Never call hosted tokenizers or embedding services, and never fake embeddings. Use a lexical or ripgrep fallback instead.
- **No Google auth, telemetry, update polling or unapproved outbound network calls.**
- **Security lives in code, not in prompts.**
  - Validate every tool call against the registry and a strict schema before execution. Malformed or unknown calls never run.
  - Canonicalize paths and resolve symlinks against the workspace boundary, and recheck at execution time.
  - Risky actions are default-deny.
  - Repository content, tool output and MCP responses are untrusted data.
  - Never retry non-idempotent tools automatically.
- **Git safety:** never automatically reset, clean, force checkout, force push or delete branches.
- **Project config:** project instructions go in `CAPRICORN.md` and `.capricorn/`, and user state goes in `~/.capricorn/`. Never read, edit or import a user's `GEMINI.md` or `.gemini/` config implicitly.
- **Commenting is a release-blocking gate** (spec §7). Each new source file needs:
  - a module-level purpose comment and a license header;
  - TSDoc on nontrivial exports;
  - explanatory comments on protocol translations, streaming state machines, security branches, and fallback, retry or compaction paths.
  Preserve upstream headers and attribution on code you retain. Avoid tautological comments.
- **Honesty:** never claim a feature works unless it has been tested or is marked as unverified. Real-model smoke tests are optional and gated: skip them with an explanation when no model is available, and never fake a pass. Track real status in `docs/IMPLEMENTATION_STATUS.md`.
- **Publishing:** don't publish to npm, GitHub Releases or Homebrew, or push to remotes, without explicit authorization.

## Testing approach (planned)

- Unit and integration tests run against a **deterministic mock Ollama HTTP server**. Cover streaming NDJSON fragments, parallel tool calls, malformed responses, cancellation and timeouts.
- E2E tests run the compiled binary in a disposable git repo.
- Routine CI must not need API keys or multi-GB model downloads.
- Target ≥85% coverage of new adapter and security code.
