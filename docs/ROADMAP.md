# Roadmap

Planned work. **Nothing on this page is implemented** unless it also appears as
complete in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md). The original
product plan is in [planning/PRODUCT_ROADMAP.md](planning/PRODUCT_ROADMAP.md).

## Before 1.0

- **Hardware-aware onboarding:** model recommendation and first-run download are
  done (2026-11-13), and so is a `num_ctx` suggestion per machine computed from
  the model's own metadata (2026-11-15; onboarding and `capricorn doctor`).
  Since 2026-11-16 the recommendation before download uses memory profiles
  measured from each preset's own metadata (E4B, 12B, 26B, 31B) at the window
  that would be suggested. Still to do: a profile for E2B (no copy measured yet;
  it keeps a rough approximation).
- **Prompt tuning with the eval suite** (suite done, see `evals/capricorn/`):
  keep improving exploration (read the file that holds the answer) and
  project-convention matching; measure every installed Gemma 4 preset (12B and
  26B measured 2026-11-16); add a task that exercises the project-commands hint;
  publish results in `evals/capricorn/RESULTS.md`.
- **Finish removing Google code:** the OAuth/Code Assist/Clearcut network code
  and Google auth/Cloud dependencies are gone (inert stand-ins remain, see
  docs/UPSTREAM.md), as are the upstream A2A server package and all bundled
  `@google/genai` SDK code (only its types remain). Since 2026-11-15 Ollama
  errors can no longer reach the Google quota/fallback code, and the ACP
  integration offers local Ollama only. Since 2026-11-15 the billing, quota,
  sign-in and Code Assist code is deleted too.
- **Platform coverage:** Linux and macOS are supported (CI on both); manual
  real-model validation on macOS still needed. Windows is not supported.
- **Context management:** compression inside long tasks, window-scaled limits an
  8K-window eval and cheaper summaries (no thinking on utility calls, short
  capped snapshots; 2026-11-14) are done (`evals/capricorn/RESULTS.md`). Still
  to do: smarter selection of repository context. Since 2026-11-16 the context
  names the project's detected test/build/lint commands and the folder tree
  shrinks in small windows.
- **Startup time:** the relaunch parent no longer loads the bundle, `--version`
  answers without starting the app, and a private V8 compile cache is used
  (2026-11-16: `-p` 2.2 s → 1.3 s against the mock daemon). Still to do: lazy
  loading inside the app itself (most of the remaining time is loading ~16 MB of
  bundled code).

## After 1.0

- Optional local embeddings with a verified Gemma-family embedding model, if one
  becomes available under the product contract.
- Multi-agent workflows on top of the existing sub-agent support.
- Signed release artifacts and reproducible-build verification.
