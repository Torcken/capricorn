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
- New files carry
  `Copyright (C) <year> Guillaume S. Condamine & all awesome contributors.` The
  ESLint header rule accepts exactly these two holders.
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

- Binary `capricorn`; root package `capricorn-code` (npm); version
  `0.1.0-alpha.1`.
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
- Removed `packages/a2a-server` (the upstream Agent-to-Agent HTTP server). It
  only supported Google back-ends (API key, Cloud ADC, Google sign-in) and Cloud
  Storage persistence, so it could not start in Capricorn, and porting it would
  have meant a second, separately secured entry point. The core's A2A _client_
  for remote agents (`core/src/agents/`) is unaffected. When merging upstream,
  drop changes to that package.
- Added: Capricorn docs, `e2e/` suite, offline verification, package smoke test,
  CI workflow without secrets.

**Agents and archives**

- The browser agent (`agents/browser/`) is never registered: it would browse the
  web through Chrome outside the egress guard. Its sources stay to ease merges;
  `bundle:browser-mcp` is no longer part of `npm run bundle` and its output is
  not shipped.
- ZIP extraction (extension and skill installs) goes through
  `cli/src/utils/safeZip.ts`, which refuses symbolic links and escaping paths
  before `extract-zip` runs.
- `bundle/` is emptied before each bundle build, and `docs/planning/` is not
  copied into it.

## Intentionally retained (and why)

- **Internal package names** (`@google/gemini-cli-core`, …). They are bundled
  into `bundle/capricorn.js` and never published; renaming thousands of imports
  would make upstream merges impractical. All workspaces are marked
  `"private": true` so they cannot be published under Google's scope.
- **`@google/genai` types** as the internal message model. The agent loop,
  history, tools and UI are written against them; translation happens only at
  the provider boundary (ADR 0001). Only the _types_ are used: the few runtime
  values (enums, `createUserContent`, `GenerateContentResponse`) come from
  `core/src/core/genaiRuntime.ts`, checked against the SDK at compile time and
  in tests, so no SDK code (hosted clients, `google-auth-library`) is bundled.
  The SDK is a dev dependency. When merging upstream, imports from
  `@google/genai` must be `import type { … }` (the inline `import { type X }`
  form is kept as a side-effect import under `verbatimModuleSyntax`) and values
  must come from `genaiRuntime`; `security/noGoogleServices.test.ts` fails
  otherwise.
- **LiteRT-LM client** (`core/localLiteRtLmClient.ts`) is an inert stand-in and
  the experimental Gemma model router is forced off: it classified prompts with
  a non-Gemma-4 model on a separate local server.
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
  exceptions in the guard test), the quota, overage and validation dialogs, and
  the Google privacy notices (no command opens them). Until 2026-11-15 the quota
  path _was_ reachable: `retryWithBackoff` ran Ollama errors through
  `classifyGoogleError`, so an Ollama 404 or 429 started Gemini model fallback
  and its dialogs. `OllamaError` now bypasses that classification and the 5xx
  fallback path (`utils/retry.ts`). Kept rather than deleted to keep upstream
  merges small; remove them if upstream changes them substantially.
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
