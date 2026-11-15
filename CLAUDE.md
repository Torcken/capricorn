# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

Capricorn is a local-first terminal coding agent: a fork of Gemini CLI v0.67.0
(commit `dc6602ce`) that runs **only verified Gemma 4 models through a local
Ollama daemon**. The binding spec is
`docs/planning/CAPRICORN_CLAUDE_CODE_MASTER_PROMPT.md`; current status is
`docs/IMPLEMENTATION_STATUS.md`. Repository conventions for agents are also in
`CAPRICORN.md`.

## Commands

- Install / build / bundle: `npm ci`, `npm run build`, `npm run bundle` (bundle
  → `bundle/capricorn.js`)
- Lint / typecheck / format: `npm run lint`, `npm run typecheck`,
  `npx prettier --check .`
- Unit tests (as CI runs them): `npm run test:ci -w @capricorn/core`,
  `npm run test:ci -w @capricorn/cli`; one file / test:
  `cd packages/core && npx vitest run <file> [-t "<name>"]`. Run from the
  package directory (a few tests resolve fixtures from `process.cwd()`) and with
  `LC_ALL=C.UTF-8 TZ=UTC` on non-English machines (number formatting in
  snapshots); then both suites have 0 failures.
- CLI unit tests resolve `@capricorn/core` from `packages/core/dist`: rebuild
  core (`npm run build -w @capricorn/core`) after core changes.
- E2E (compiled CLI vs mock Ollama; needs build): `npm run test:e2e:capricorn`
- Offline verification (Linux namespaces): `npm run verify:offline`
- Package smoke: `node scripts/capricorn/pack-smoke.js`
- Real model (optional, local Ollama): `npm run test:smoke:real-model`
- Run from source: `node packages/cli/dist/index.js` (use a scratch `HOME` and
  `--skip-trust` in throwaway dirs)

Run one Vitest process per package at a time (shared coverage temp dir). Some
retained upstream tests write to the real home dir; prefer `HOME=$(mktemp -d)`.
CI uses Node 20 (`.nvmrc`, the minimum in `engines`): avoid Node 21+ features
(e.g. glob patterns in `node --test`, which Node 20 treats as file names).

## Architecture (big picture)

- The upstream agent loop (`core/src/core/client.ts`, `geminiChat.ts`,
  `turn.ts`), scheduler, policy engine, tools, sessions, MCP and Ink TUI are
  reused. The only inference seam is `ContentGenerator`
  (`core/src/core/contentGenerator.ts`), which now builds only
  `OllamaContentGenerator`.
- `core/src/providers/ollama/`: endpoint policy (loopback only unless user-scope
  `ollama.allowRemoteHost`), HTTP/NDJSON client, Gemma 4 verification from
  `/api/show` metadata (`modelPolicy.ts`), Gemini⇄Ollama converter
  (`converter.ts`), mock server for tests (`testing/mockOllamaServer.ts`). Any
  Gemini model name requested by upstream code resolves to the session's
  verified Gemma tag.
- Internal data model stays `@google/genai` types; internal packages are
  `@capricorn/*` (private, bundled; renamed from `@google/gemini-cli-*`, see
  docs/UPSTREAM.md). Import the SDK only with `import type { … }`; runtime
  values (enums, `createUserContent`, `GenerateContentResponse`) come from
  `core/src/core/genaiRuntime.ts` (core re-exports them for the CLI), so no SDK
  code is bundled.
- Security: process-wide egress guard (`core/src/security/egressGuard.ts`,
  installed in `cli/src/main.tsx` via `cli/src/capricorn/networkPolicy.ts`);
  malformed tool args rejected in `scheduler.ts` (`MALFORMED_ARGS_MARKER`);
  `.capricorn` self-config protection in `core/src/safety/built-in.ts`; settings
  invariants (`applyCapricornInvariants` in `cli/src/config/settings.ts`).
- CLI additions: `cli/src/commands/capricorn.ts`
  (doctor/status/models/config/init, all wrapped in `defer()` so parsing has no
  side effects), `cli/src/capricorn/` (runtime resolution, diagnostics,
  preflight, hardware detection + model recommendation (`recommend.ts`), arg
  aliases for `run`/`sessions`). Startup prompts must write via
  `createWorkingStdio()`/`writeToStderr`: stdio is patched before the preflight
  runs.
- Gemma 4 system prompt: `core/src/prompts/capricornSnippets.ts` (reuses
  upstream section renderers).
- Storage: `~/.capricorn`, `<project>/.capricorn`, `CAPRICORN.md`,
  `.capricornignore` (`GEMINI_DIR` constant keeps its upstream name).

## Rules

- Never add hosted inference, non-Gemma-4 models, telemetry, update checks or
  unapproved network calls; never weaken endpoint, model-verification, egress,
  workspace or approval checks.
- New files use the
  `Copyright (C) <year> Guillaume S. Condamine & all awesome contributors.`
  header; modified upstream files keep the Google header and get a `Capricorn:`
  comment. Comment the _why_ of protocol, streaming, security and fallback code;
  TSDoc exported APIs.
- Mark upstream behaviour changes in tests with a comment; remove Google-only
  tests only when the functionality was intentionally removed.
- Report test results truthfully; don't mark unverified work complete.
