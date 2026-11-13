# Capricorn repository — instructions for coding agents

This file is read by Capricorn (and is useful to any AI coding agent) when
working **on the Capricorn source code**. It describes conventions; it does not
grant permissions and never overrides the user's approvals or the security rules
below.

## What this repository is

A TypeScript monorepo (npm workspaces): a local-first coding agent forked from
Gemini CLI v0.67.0, running only verified Gemma 4 models through a local Ollama
daemon. Internal package names still start with `@google/gemini-cli-*` on
purpose (see docs/UPSTREAM.md); do not rename them.

## Commands

- Install: `npm ci` · Build: `npm run build` · Bundle: `npm run bundle`
- Lint: `npm run lint` · Typecheck: `npm run typecheck` · Format:
  `npx prettier --write <files>`
- Unit tests: `npx vitest run --root packages/core [path]`,
  `npx vitest run --root packages/cli [path]`
- One test: add `-t "<test name>"`
- E2E (needs build): `npm run test:e2e:capricorn`
- Run from source: `node packages/cli/dist/index.js`

Run one Vitest process per package at a time.

## Where things live

- Ollama provider: `packages/core/src/providers/ollama/`
- Egress guard: `packages/core/src/security/egressGuard.ts`
- Gemma 4 prompt: `packages/core/src/prompts/capricornSnippets.ts`
- Capricorn CLI commands/preflight/diagnostics:
  `packages/cli/src/commands/capricorn.ts`, `packages/cli/src/capricorn/`
- E2E harness and mock daemon: `e2e/`,
  `packages/core/src/providers/ollama/testing/mockOllamaServer.ts`

## Rules

1. Never add hosted inference, non-Gemma-4 models, telemetry, update checks or
   unapproved network calls. Never weaken endpoint, model-verification, egress,
   workspace-boundary or approval checks.
2. Security decisions belong in code with tests, not in prompts.
3. New files get the
   `Copyright (C) <year> Guillaume S. Condamine & all awesome contributors.`
   license header; modified upstream files keep the Google header and get a
   `Capricorn:` comment.
4. Comment _why_ for protocol translation, streaming, security and fallback
   code; add TSDoc to exported APIs.
5. Report test results truthfully; never mark unverified work as complete in
   docs/IMPLEMENTATION_STATUS.md.
6. Do not commit, push or publish unless asked.
