# Troubleshooting

Start with `capricorn doctor`. Each failed check prints a fix. Use
`capricorn doctor --json` when filing an issue (it contains no file contents or
prompts).

## "Cannot connect to Ollama at http://127.0.0.1:11434 (ECONNREFUSED)"

Ollama is not running, or listens elsewhere.

- Start it: `ollama serve`, or launch the Ollama desktop app.
- Check: `curl http://127.0.0.1:11434/api/version`.
- Custom port: `export CAPRICORN_OLLAMA_HOST=127.0.0.1:11500`.

## "Refusing non-local Ollama endpoint …"

The endpoint (from `OLLAMA_HOST`, `CAPRICORN_OLLAMA_HOST` or settings) is not
loopback. If you really want a remote daemon, set `ollama.allowRemoteHost: true`
in **`~/.capricorn/settings.json`** (project settings cannot enable it). Note
that `OLLAMA_HOST=0.0.0.0` is treated as local.

## "Model "gemma4:12b" is not installed in Ollama"

Install it (`capricorn models pull gemma4:12b`) or use an installed one:
`capricorn models list`, then `capricorn models use <tag>` or `--model <tag>`.

## "Model family/architecture "…" is not Gemma 4" / "Cloud-backed Ollama model"

Capricorn only runs local Gemma 4 models. `capricorn models list --all` explains
every rejection. A Gemma 4 model you re-tagged yourself is fine; a `:cloud` tag
is never accepted.

## `doctor` says ready, but the first prompt fails to load the model

`doctor` verifies the model from its metadata; it does not run it. Run
`capricorn doctor --load` to load it once with your `num_ctx`. A failure such as
"llama runner process has terminated" or "… requires ctx_other" means this
Ollama build cannot run that model file: update Ollama, or use another Gemma 4
tag (`capricorn models use <tag>`). An out-of-memory failure means a smaller
model or a lower `ollama.numCtx` (see below).

## Out of memory / "model requires more system memory"

Ollama 0.40 reports this as "model requires X GiB but only Y GiB are available".

- Use a smaller model (`gemma4:e4b`, then `gemma4:e2b`).
- Reduce the context: `capricorn config set ollama.numCtx 16384`.
- Close other models: `ollama ps`, `ollama stop <model>`.

If even `gemma4:e2b` fails at an 8K window, the machine is too small for Gemma 4
with Ollama: this is the case on every Mac with 8 GB of RAM (see
[Minimum hardware](OLLAMA.md#presets)).

These errors are not retried automatically — retrying cannot fix them.

## The first answer takes a long time

The first request loads the model into memory (seconds to minutes depending on
disk and model size). `ollama.keepAlive` (default `10m`) keeps it loaded. If it
times out, raise `ollama.requestTimeoutMs`.

## "Stopped: this task exceeded its N-minute time budget"

The per-prompt budget (`model.maxRunMinutes`, default 30) was reached. Split the
task, use a faster model, or raise the limit.

## The answer is followed by a second, corrected answer

When an answer cites files the model never opened, Capricorn asks it once to
open them and check (`model.checkCitedFiles`, on by default). If the guess was
wrong, the corrected answer follows the first one; trust the last one. Set
`model.checkCitedFiles` to `false` to turn this off.

## Headless run says a tool was "not found"

Headless runs cannot ask for approval, so tools that need it (edits, shell) are
not offered. Use `--approval-mode auto_edit` for edits and
`--allowed-tools "run_shell_command(<command prefix>)"` for specific commands.

## "Capricorn is not running in a trusted directory"

Headless runs in an untrusted folder stop. Trust the folder interactively
(`capricorn`, then confirm), or pass `--skip-trust` for a repository you
control.

## "[capricorn] blocked outbound connection to …"

Something tried to reach a non-loopback host. Run with
`CAPRICORN_EGRESS_REPORT=1` to see each attempt. If it is a remote MCP server
you configured, add its host to `security.network.allowedHosts` in user
settings.

## `--sandbox`: "Sandbox image 'capricorn-sandbox:local' is missing"

Build it once: `npm run build:sandbox` in the source checkout (uses the runtime
from `GEMINI_SANDBOX`, else Docker, else Podman). Capricorn never downloads this
image. If you build with Podman, run with `GEMINI_SANDBOX=podman` too: Docker
and Podman keep separate image stores, and `--sandbox` alone prefers Docker.

## `--sandbox`: "EACCES: permission denied" under /home/node/.capricorn

Usually rootless Podman with SELinux on an older Capricorn; current versions add
`--userns=keep-id` and `--security-opt label=disable` automatically. If you set
`SANDBOX_FLAGS` with your own `label=` option, make sure the project directory
is labelled for containers (for example mount it with `:z`).

## `--sandbox`: "this Ollama endpoint is not available inside the sandbox"

Inside the sandbox only inference and model inspection reach Ollama. Pull,
delete or create models on the host (`capricorn models pull …` outside
`--sandbox`).

## My GEMINI.md is ignored

By design. Copy what you need into `CAPRICORN.md`, or opt in with
`"context": { "fileName": ["CAPRICORN.md", "GEMINI.md"] }`.

## The terminal looks wrong

Use a terminal with true-colour support; `NO_COLOR=1` disables colours.
`--screen-reader` enables an accessible layout.

## Reset Capricorn

Remove `~/.capricorn/` (settings, trust decisions, sessions). Project files
(`CAPRICORN.md`, `.capricorn/`) are left untouched.
