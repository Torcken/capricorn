# Ollama and Gemma 4

## How Capricorn uses Ollama

Capricorn talks to Ollama's native REST API on `http://127.0.0.1:11434`:

| Endpoint           | Used for                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/version` | `doctor`, `status`                                                                                                                          |
| `GET /api/tags`    | Listing installed models                                                                                                                    |
| `POST /api/show`   | Gemma 4 verification (architecture, capabilities, context length)                                                                           |
| `POST /api/chat`   | All inference (streamed NDJSON, tools, thinking, structured output); `doctor --load` sends one with no messages, which only loads the model |
| `GET /api/ps`      | Currently loaded models and memory (`status`, `doctor --load`)                                                                              |
| `POST /api/pull`   | `capricorn models pull` only                                                                                                                |

Every chat request sets `options.num_ctx` explicitly (default 32768), because
Ollama's implicit context is small and silently truncates long prompts.

## Which models are accepted

A model is usable when **all** of these hold:

1. It is installed locally (`/api/tags`).
2. Its GGUF metadata says `general.architecture = gemma4` (older daemons:
   `details.family = gemma4`). The _name_ is irrelevant: a re-tagged Gemma 4 is
   accepted, a non-Gemma model named `gemma4:…` is rejected.
3. It is not cloud-backed: no `:cloud`/`-cloud` tag and no
   `remote_host`/`remote_model` metadata.
4. Ollama reports the `tools` capability (if it reports capabilities).

`capricorn models list --all` shows every installed model with its verdict.

## Presets

| Tag          | Class                        | Approx. resident memory (Q4, 32K ctx) |
| ------------ | ---------------------------- | ------------------------------------- |
| `gemma4:e2b` | experimental                 | ~7 GiB (even at 8K ctx)               |
| `gemma4:e4b` | lightweight                  | ~7 GiB                                |
| `gemma4:12b` | standard (candidate default) | ~11 GiB                               |
| `gemma4:26b` | advanced (26B A4B)           | ~20 GiB                               |
| `gemma4:31b` | high capability              | ~24 GiB                               |

These figures are rough planning numbers, not measurements of your system;
`capricorn status` shows real usage once a model is loaded.

**Minimum hardware.** Even the smallest preset, `gemma4:e2b`, needs about 7 GiB
that the model can use: Ollama 0.40.16 asked for 6.9 GiB at an 8K window on a
MacBook Air M1. A Mac lets the GPU use about two thirds of its RAM (minus 0.5
GiB for Ollama), so **Macs with 8 GB of RAM cannot run any Gemma 4 model**; 12
GB is the minimum and 16 GB or more is recommended. On other machines, a GPU
with 8 GB or more, or about 9 GB of free RAM for (slow) CPU inference, is
needed. `capricorn doctor` warns when the selected model does not fit, and
`capricorn doctor --load` asks Ollama to be sure. Availability of each tag
depends on the Ollama registry at the time you pull.

If the configured model is not installed, Capricorn does **not** switch
silently: interactively it asks whether to use an installed alternative;
headless runs fail and list the alternatives.

## Choosing a context window (`ollama.numCtx`)

The KV cache grows linearly with `num_ctx`. Start with the default 32768.

- Less memory / faster first token: `capricorn config set ollama.numCtx 16384`
- Long sessions on a large machine: `65536` or more (capped at the model's
  maximum, shown by `capricorn models info`).

When the conversation approaches the window, Capricorn compresses older history
using the same local model.

## Thinking

Gemma 4 can produce a separate reasoning channel. `ollama.think`:

- `auto` (default): follow the agent's request for the main conversation;
- `off`: never think — fastest;
- `on`: always think.

Reasoning is shown as "thinking" in the UI, never as the answer, and is not sent
back into later requests.

## Remote Ollama (opt-in, not local-only)

To use a daemon on another machine, edit **user** settings:

```jsonc
// ~/.capricorn/settings.json
{
  "ollama": { "endpoint": "http://gpu-box.lan:11434", "allowRemoteHost": true },
}
```

Your prompts, file contents and command output are then sent to that host. The
header shows "REMOTE inference (not local-only)". Project settings cannot enable
this. Cloud model tags remain refused.

## Performance tips

- Keep the model loaded between prompts: `ollama.keepAlive` (default `10m`).
- The first request after loading is slow (model load + prompt processing);
  later turns reuse Ollama's prompt cache.
- `ollama.think: "off"` reduces latency noticeably on smaller machines.
- Prefer `gemma4:e4b` on laptops without a discrete GPU.

## Embeddings

Gemma 4 generation models are not embedding models. Capricorn does not fake
embeddings; features that would need them use lexical search (ripgrep) instead.
