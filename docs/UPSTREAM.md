# Upstream: Gemini CLI

Capricorn is a fork of Google's open-source **Gemini CLI**.

| Item                | Value                                                   |
| ------------------- | ------------------------------------------------------- |
| Upstream repository | https://github.com/google-gemini/gemini-cli             |
| Fork base           | tag `v0.67.0`                                           |
| Fork base commit    | `dc6602cec4a6e823aa33937144245dc421e5165f` (2026-11-04) |
| Upstream license    | Apache License 2.0 (`LICENSE`, unchanged)               |
| Upstream copyright  | Copyright 2025-2026 Google LLC                          |
| Local tag           | `upstream-v0.67.0` (fetched with `--depth 1`)           |

The repository history starts with the unmodified upstream commit, so
`git diff upstream-v0.67.0` shows every Capricorn change.

## Attribution rules

- Upstream files keep their `Copyright Google LLC` headers. When Capricorn
  modifies such a file, the change is marked with a `Capricorn modification`
  block comment or an inline `Capricorn:` comment.
- New files carry `Copyright 2026 Capricorn Contributors`. The ESLint header
  rule accepts exactly these two holders.
- `NOTICE` states the fork relationship, non-affiliation with Google and
  trademark use. Gemma 4 weights are not distributed.

## Major changes relative to upstream

**Inference**

- New provider `packages/core/src/providers/ollama/`: endpoint policy, NDJSON
  streaming client, Gemma 4 metadata verification, Gemini⇄Ollama protocol
  converter and `OllamaContentGenerator`.
- `core/contentGenerator.ts`: only the Ollama generator (and test fakes) can be
  constructed. The Google GenAI, Vertex AI and Code Assist paths were removed;
  Google credentials in the environment are ignored.
- `tokenLimit()` reports the allocated `num_ctx`; token counting is a local,
  calibrated estimate; embeddings are refused, not faked.
- Upstream retry logic defers to the Ollama error classification.
- New concise Gemma 4 system prompt (`prompts/capricornSnippets.ts`).

**Privacy and security**

- Process-wide egress guard (`core/src/security/egressGuard.ts`).
- Clearcut usage statistics and auto-update checks are forced off.
- `google_web_search` and `web_fetch` are not registered (hosted grounding).
- The upstream LiteRT-LM "gemma" router command was removed.
- The agent's own config directory (`.capricorn`, incl. NTFS/8.3 spellings)
  requires confirmation to modify; Seatbelt profiles protect `~/.capricorn`.
- Malformed tool-call arguments are rejected by the scheduler.
- Sandbox defaults: local image name, network off.
- No default extension gallery (it was hosted by Google).

**Product surface**

- Binary `capricorn`; root package `capricorn-cli`; version `0.1.0-alpha.0`.
- Storage `~/.capricorn`, `.capricorn/`, `CAPRICORN.md`, `.capricornignore`,
  system settings under `/etc/capricorn` (and platform equivalents).
- New subcommands: `doctor`, `status`, `models`, `config`, `init`, plus the
  `run` and `sessions` aliases; startup preflight.
- Removed Google-only UI: sign-in dialog, `/auth`, `/bug`, `/docs`, `/privacy`,
  `/setup-github`, `/upgrade`, Antigravity promotion.
- `/model` and the model dialog only offer verified local Gemma 4 models.
- Sub-agents and topic narration default to off.
- Original ASCII wordmark and icon.

**Repository**

- Removed: upstream documentation site sources, `GEMINI.md`, `.gemini/`,
  `.gcp/`, `.allstar/`, upstream `ROADMAP.md`, Google-specific GitHub workflows,
  actions and bots.
- Added: Capricorn docs, `e2e/` suite, offline verification, package smoke test,
  CI workflow without secrets.

## Intentionally retained (and why)

- **Internal package names** (`@google/gemini-cli-core`, …). They are bundled
  into `bundle/capricorn.js` and never published; renaming thousands of imports
  would make upstream merges impractical. All workspaces are marked
  `"private": true` so they cannot be published under Google's scope.
- **`@google/genai` types** as the internal message model. The agent loop,
  history, tools and UI are written against them; translation happens only at
  the provider boundary (ADR 0001).
- **Inert stand-ins for removed Google modules.** Google sign-in
  (`code_assist/oauth2.ts`), the Code Assist client (`code_assist/server.ts`),
  account onboarding (`code_assist/setup.ts`) and the Clearcut usage logger keep
  their exported names so upstream call sites compile unchanged, but they
  contain no network code: requesting a Google client throws, and the logger
  never exists. The Google Cloud telemetry exporters, Google-credential MCP /
  agent auth providers and Gemini Live transcription were deleted outright, and
  `google-auth-library` / `@google-cloud/*` are no longer dependencies of
  `packages/core`. `security/noGoogleServices.test.ts` keeps it that way.
- **Still present, all unreachable:** upstream billing/quota helpers
  (`billing/`, `utils/googleQuotaErrors.ts`: string handling only, listed as
  exceptions in the guard test); the A2A server's optional Google Cloud Storage
  persistence (`packages/a2a-server`, not part of the `capricorn` package); and
  `google-auth-library` as a transitive dependency of `@google/genai`.
- **Environment variable names** used by the retained test harness
  (`GEMINI_CLI_HOME`, `GEMINI_CLI_TRUST_WORKSPACE`, …). Capricorn-prefixed
  equivalents exist where they are user-facing (`CAPRICORN_HOME`,
  `CAPRICORN_OLLAMA_HOST`, `CAPRICORN_MODEL`, `CAPRICORN_SYSTEM_SETTINGS_PATH`).

## Updating from upstream

1. `git fetch --depth 50 upstream refs/tags/<tag>:refs/tags/upstream-<tag>`
2. Create a branch and `git merge upstream-<tag>`; expect conflicts mainly in
   `contentGenerator.ts`, `config.ts` (both packages), `settingsSchema.ts`,
   `gemini.tsx`, `BuiltinCommandLoader.ts` and prompt files.
3. Re-check every _new_ upstream network endpoint, auth path, telemetry hook and
   tool for compatibility with the local-only contract
   (`grep -rn "https://" packages/*/src`).
4. Run the full test suite, `npm run test:e2e:capricorn` and
   `npm run verify:offline`, then update this file.
