# Roadmap

Planned work. **Nothing on this page is implemented** unless it also appears as
complete in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md). The original
product plan is in [planning/PRODUCT_ROADMAP.md](planning/PRODUCT_ROADMAP.md).

## Before 1.0

- **Hardware-aware onboarding:** first-run wizard that detects RAM/VRAM and
  recommends a Gemma 4 variant and `num_ctx`.
- **Local web fetch tool:** a `web_fetch` replacement that downloads a page
  locally (opt-in, allowlisted hosts, approval per request) instead of
  upstream's hosted URL-context path.
- **Prompt tuning with the eval suite** (suite done, see `evals/capricorn/`):
  keep improving exploration (read the file that holds the answer) and
  project-convention matching; measure every installed Gemma 4 preset; publish
  results in `evals/capricorn/RESULTS.md`.
- **Finish removing Google code:** the OAuth/Code Assist/Clearcut network code
  and Google auth/Cloud dependencies are gone (inert stand-ins remain, see
  docs/UPSTREAM.md); still to do: upstream billing/quota helpers, the A2A
  server's Google Cloud Storage persistence (or the A2A server itself), and
  replacing runtime use of `@google/genai` classes so its bundled client code
  (and `google-auth-library`) can be dropped.
- **Platform coverage:** CI runs on macOS and Windows exist; manual real-model
  validation on each still needed. Windows sandbox story.
- **Context management:** calibrated budgets per model, smarter selection of
  repository context, compaction quality checks.
- **Startup time:** profile and trim inherited initialization.
- **npm publication** once the package name and repository are confirmed.

## After 1.0

- VS Code companion extension (the upstream companion is retained but not
  adapted).
- Optional local embeddings with a verified Gemma-family embedding model, if one
  becomes available under the product contract.
- Multi-agent workflows on top of the existing sub-agent support.
- Signed release artifacts and reproducible-build verification.
