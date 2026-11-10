# ADR 0001: Fork Gemini CLI and adapt at the ContentGenerator boundary

- **Status:** Accepted
- **Date:** 2026-11-10
- **Deciders:** Capricorn maintainers

## Context

Capricorn must be a terminal coding agent running only verified local Gemma 4
models through Ollama, with no Google account, hosted LLM or telemetry. The
specification asks for a direct fork of Gemini CLI unless that proves
prohibitively coupled, with Qwen Code (itself a Gemini CLI fork with
OpenAI-compatible providers) as the fallback foundation.

## What we checked (evidence)

1. **Inference seam.** Upstream `packages/core/src/core/contentGenerator.ts`
   defines a four-method `ContentGenerator` interface (`generateContent`,
   `generateContentStream`, `countTokens`, `embedContent`) over `@google/genai`
   types. Everything above it (chat history, turns, tool scheduling,
   compression, UI) depends only on this interface and those types.
2. **Ollama protocol.** Against Ollama 0.30.11 with `gemma4:12b` on the
   development machine, `/api/chat` accepted `tools`, streamed complete
   `tool_calls` objects with ids and object arguments, accepted `role: "tool"`
   results with `tool_call_id`/`tool_name`, and returned
   `prompt_eval_count`/`eval_count`. `/api/show` exposed
   `general.architecture: "gemma4"` and `capabilities: [tools, thinking, …]`.
3. **Spike.** A first `OllamaContentGenerator` translating `Content`/`Part` to
   Ollama messages produced a correct end-to-end answer with a `read_file` tool
   round trip through the _unchanged_ agent loop, on the first attempt.

## Decision

Fork Gemini CLI v0.67.0 directly. Implement Ollama as a new `ContentGenerator`
and translate protocols at that boundary (`providers/ollama/converter.ts`). Keep
`@google/genai` types internally. Do not adopt Qwen Code: the direct fork works
and keeps upstream merges possible.

Only one provider exists. No generic multi-provider abstraction is added; model
resolution maps every upstream Gemini model name to the session's verified Gemma
4 model, so retained upstream utility calls (compression, loop detection, …) run
locally rather than failing or reaching a cloud.

## Consequences

**Positive**

- The agent loop, tools, approvals, policies, sandboxing, sessions, MCP and TUI
  are reused largely unchanged, with their large test suites.
- The safety-critical decisions (endpoint policy, model verification, tool-call
  validation) live in small, well-tested modules.

**Negative / risks**

- The internal data model is still Gemini-shaped (e.g. `thoughtSignature`,
  grounding metadata). Mismatches are handled in the converter and documented
  there.
- Unreachable Google-specific code remains for now (see docs/UPSTREAM.md).
- Upstream features built on hosted Gemini capabilities (web search grounding,
  URL context, Code Assist quotas) are unavailable.

## Alternatives considered

- **Qwen Code:** would have saved writing the converter, but its provider layer
  targets OpenAI-compatible endpoints; we would still need Gemma 4 verification,
  the native Ollama API for `num_ctx`/`think`/`keep_alive` control, and the
  privacy hardening. Not needed given the spike result.
- **OpenAI-compatible `/v1/chat/completions`:** rejected in favour of native
  `/api/chat` because it gives direct control over context size, thinking,
  keep-alive and model metadata, and returns tool arguments as objects.
