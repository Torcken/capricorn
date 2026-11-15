# Roadmap

Planned work. **Nothing on this page is implemented** unless it also appears as
complete in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md). The original
product plan is in [planning/PRODUCT_ROADMAP.md](planning/PRODUCT_ROADMAP.md).

## Before 1.0

- **Hardware-aware onboarding:** model recommendation and first-run download are
  done (2026-11-13), and so is a `num_ctx` suggestion per machine computed from
  the model's own metadata (2026-11-15; onboarding and `capricorn doctor`).
  Still to do: the same metadata-based estimate for the model recommendation
  before download (it still uses the presets' approximations: 12B measured ≈9.2
  GiB at 32K vs. the 11 GiB estimate), and measurements of the other presets.
- **Local web fetch tool:** a `web_fetch` replacement that downloads a page
  locally (opt-in, allowlisted hosts, approval per request) instead of
  upstream's hosted URL-context path.
- **Prompt tuning with the eval suite** (suite done, see `evals/capricorn/`):
  keep improving exploration (read the file that holds the answer) and
  project-convention matching; measure every installed Gemma 4 preset; publish
  results in `evals/capricorn/RESULTS.md`.
- **Finish removing Google code:** the OAuth/Code Assist/Clearcut network code
  and Google auth/Cloud dependencies are gone (inert stand-ins remain, see
  docs/UPSTREAM.md), as are the upstream A2A server package and all bundled
  `@google/genai` SDK code (only its types remain). Since 2026-11-15 Ollama
  errors can no longer reach the Google quota/fallback code, and the ACP
  integration offers local Ollama only. Optional: delete the unreachable
  billing/quota helpers and dialogs (Gemini CLI is no longer developed, so there
  are no upstream merges to keep them for).
- **Platform coverage:** Linux and macOS are supported (CI on both); manual
  real-model validation on macOS still needed. Windows is not supported.
- **Context management:** compression inside long tasks, window-scaled limits an
  8K-window eval and cheaper summaries (no thinking on utility calls, short
  capped snapshots; 2026-11-14) are done (`evals/capricorn/RESULTS.md`). Still
  to do: smarter selection of repository context.
- **Dependencies:** migrate from `zod` 3 to 4 (the only fix for a high-severity
  audit advisory; touches about 40 files and the `zod-to-json-schema`
  conversions) and update OpenTelemetry to a fixed major version.
- **Startup time:** profile and trim inherited initialization.
- **npm publication** once the package name and repository are confirmed.

## After 1.0

- VS Code companion extension (the upstream companion is retained but not
  adapted).
- Optional local embeddings with a verified Gemma-family embedding model, if one
  becomes available under the product contract.
- Multi-agent workflows on top of the existing sub-agent support.
- Signed release artifacts and reproducible-build verification.
