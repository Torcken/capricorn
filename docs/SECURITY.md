# Security model and threat model

Capricorn lets a language model read files, edit code and run commands on your
machine. This document describes what Capricorn protects, how, and — just as
importantly — what it does **not** protect against. To report a vulnerability,
see [../SECURITY.md](../SECURITY.md).

## Assets

- Your source code and other files (confidentiality and integrity).
- Credentials on the machine (`.env` files, SSH keys, cloud tokens).
- The machine itself (arbitrary command execution).
- Capricorn's own configuration: settings, policies, trusted folders, hooks
  (whoever controls these controls the agent's permissions).

## Trust boundaries

| Source                                             | Trust level                                       | Why                                                                                        |
| -------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| The user (typed prompts, approvals)                | Trusted                                           | Capricorn acts on the user's behalf.                                                       |
| User settings `~/.capricorn/settings.json`         | Trusted                                           | Written by the user.                                                                       |
| Project `.capricorn/settings.json`, `CAPRICORN.md` | Partially trusted                                 | Repository content; only loaded in _trusted folders_, and cannot widen the network policy. |
| Model output (text, tool calls)                    | Untrusted                                         | Can be wrong, hallucinated or steered by injected content.                                 |
| File contents, command output, MCP results         | Untrusted                                         | May contain prompt-injection attempts.                                                     |
| The Ollama daemon                                  | Trusted for availability, not for well-formedness | Responses are schema-validated.                                                            |

## Threats and controls

| Threat                                                                          | Control (enforced in code)                                                                                                                                                                                | Where                                                                                      | Tested in                                                                         |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Prompts/code sent to a remote server via a malicious project setting or env var | Endpoint must be loopback; remote requires `ollama.allowRemoteHost` in **user** settings and is shown as "REMOTE"                                                                                         | `providers/ollama/endpoint.ts`, `cli/src/config/config.ts`                                 | `endpoint.test.ts`, e2e "refuses a remote endpoint"                               |
| A dependency, tool or MCP server phoning home                                   | Egress guard blocks every non-loopback TCP connection (before DNS) unless the host is user-allowlisted                                                                                                    | `core/src/security/egressGuard.ts`, `cli/src/capricorn/networkPolicy.ts`                   | `egressGuard.test.ts`, e2e "no non-loopback connection", `npm run verify:offline` |
| Hosted model used instead of a local one                                        | Only the Ollama generator can be built; every request's model is verified as Gemma 4 from GGUF metadata; cloud tags refused                                                                               | `core/contentGenerator.ts`, `providers/ollama/modelPolicy.ts`, `ollamaContentGenerator.ts` | `modelPolicy.test.ts`, `ollamaContentGenerator.test.ts`, e2e                      |
| Misleading model alias (`ollama cp qwen gemma4:x`)                              | Architecture metadata, not the name, decides                                                                                                                                                              | `modelPolicy.ts`                                                                           | `modelPolicy.test.ts`                                                             |
| Model invents a tool or sends malformed arguments                               | Unknown tools return "not found"; non-object arguments are marked and rejected before the tool is built; schema validation follows                                                                        | `converter.ts`, `scheduler/scheduler.ts`                                                   | e2e "malformed arguments", "unknown tool"                                         |
| Unapproved edits or commands                                                    | Policy engine + approval prompts; headless default mode does not even offer mutating tools                                                                                                                | upstream `policy/`, `scheduler/`                                                           | e2e "denies a shell command", "does not apply edits"                              |
| Workspace escape (`../`, absolute paths, symlinks)                              | Paths are resolved and checked against workspace roots at execution time                                                                                                                                  | upstream `config.isPathAllowed`, `safety/built-in.ts`                                      | e2e "refuses to write outside the workspace", upstream safety tests               |
| Agent edits its own configuration to widen permissions                          | `.capricorn` (and `.gemini`) paths, including Windows trailing-dot/space, ADS and 8.3 short-name spellings, always require confirmation                                                                   | `safety/built-in.ts`                                                                       | `built-in.test.ts`                                                                |
| Prompt injection in repository content                                          | Content is data; approvals, policies and network policy are not influenced by model text; external tool output is wrapped in `<untrusted_context>`                                                        | upstream scheduler/policy, `prompts/capricornSnippets.ts`                                  | e2e "keeps approvals in force after … injected instructions"                      |
| Runaway agent loop                                                              | Loop detection (identical tool call repeated 5×, repeated content), per-prompt wall-clock budget (`model.maxRunMinutes`, default 30), optional session turn cap (`model.maxSessionTurns`, off by default) | `core/client.ts`, `services/loopDetectionService.ts`                                       | e2e "time budget", upstream loop-detection tests                                  |
| Huge or hostile stream from the daemon                                          | NDJSON line-size cap, schema validation per frame, idle timeout, truncation detection                                                                                                                     | `ndjson.ts`, `client.ts`                                                                   | `ndjson.test.ts`, `client.test.ts`                                                |
| Secrets leaking through diagnostics                                             | `config list/get` redact secret-looking keys and MCP env/headers; endpoint URLs with credentials are rejected                                                                                             | `cli/src/commands/capricorn.ts`, `endpoint.ts`                                             | `capricorn.test.ts`, `endpoint.test.ts`                                           |
| Telemetry / update polling                                                      | Usage statistics and update checks are forced off after settings merge                                                                                                                                    | `cli/src/config/settings.ts` (`applyCapricornInvariants`)                                  | `settings.test.ts`                                                                |

## Approval modes

- **Default:** edits and shell commands ask first. In headless runs nothing can
  ask, so mutating tools are not offered at all.
- **Auto-edit:** file edits inside the workspace are applied; shell commands
  still ask (headless: unavailable).
- **Plan:** read-only planning.
- **YOLO:** everything is auto-approved. The header shows a warning. Workspace
  boundaries, model verification and the network policy still apply, but _any_
  command the model chooses will run. Use only in disposable environments,
  ideally with the sandbox.

Pre-approve narrowly instead of using YOLO, e.g.
`--allowed-tools "run_shell_command(npm test)"` (prefix match) or a policy file
(see the upstream-compatible policy format under `~/.capricorn/policies/`).

## Trusted folders

Project settings, project hooks, MCP servers and `CAPRICORN.md` are only applied
in folders you have trusted (interactive prompt, `/permissions`, or
`--skip-trust` / `GEMINI_CLI_TRUST_WORKSPACE=true` for automation in a
repository you control). Headless runs in an untrusted folder stop with an
explanation.

## Sandbox

Optional OS-level isolation (`--sandbox`, setting `tools.sandbox`):

- **macOS:** Seatbelt profiles (`sandbox-macos-*.sb`); `~/.capricorn` and
  credential files are write-/read-protected inside the sandbox.
- **Linux/Windows/macOS:** Docker or Podman with the locally built image
  `capricorn-sandbox:local` (`npm run build:sandbox`). Capricorn never pulls the
  default image (or any `:local` tag) from a registry. Network access inside the
  sandbox is **off** (an internal container network) unless
  `tools.sandbox.networkAccess` is true. Select the runtime with
  `GEMINI_SANDBOX=podman` or `=docker`; `--sandbox` alone auto-detects Docker
  first.

How inference works in the container sandbox: the whole CLI re-runs inside the
container, where `127.0.0.1` is the container itself and the host is
unreachable. The host process (outside the container, under the egress guard)
serves a Unix socket in the per-session, `0700` settings directory that is
mounted into the container; `socat` re-exposes it as `127.0.0.1:11434` inside.
The bridge is an HTTP filter: only `GET /api/version`, `/api/tags`, `/api/ps`
and `POST /api/show`, `/api/chat` are forwarded. `pull`, `push`, `delete`,
`create`, `copy` and blob uploads get HTTP 403, because pull/push would make the
host daemon use the network on the container's behalf. Manage models on the
host. The container sandbox refuses a remote (opt-in) Ollama endpoint.

What the container gets: the project directory and the sanitized settings
directory, nothing else from your home (no credentials, no `~/.config/gcloud`).
On **rootless Podman** the container runs with `--userns=keep-id` (your UID). On
**SELinux** hosts (Fedora, RHEL) Capricorn adds `--security-opt label=disable`
for that container instead of relabelling your project with `:z`; this removes
SELinux confinement of the container (other isolation is unchanged). To keep
SELinux confinement, pass your own `label=` option in `SANDBOX_FLAGS` (Capricorn
then adds none) and label the project for containers yourself (e.g.
`chcon -Rt container_file_t <project>`).

Verified (2026-11-11, Fedora 43, SELinux enforcing) with rootless Podman 5.8 and
rootful Docker 29: a prompt answered by `gemma4:12b` from inside the sandbox;
from inside the container, the internet, raw IPs and the host's Ollama port were
unreachable and `/api/pull`/`/api/delete` were refused. Not yet verified: Docker
Desktop on macOS/Windows (Unix-socket bind mounts across the VM boundary may not
work there), gVisor (`runsc`) and LXC.

macOS Seatbelt profiles: the `*-proxied` profiles only allow outbound
connections to the proxy on `localhost:8877`, which also blocks Ollama; use an
`*-open` profile, or have your proxy forward to Ollama. (Not verified on macOS.)

Without the sandbox, approved commands run with your user's full privileges. The
risk classification shown in approval prompts is advisory; it is not an
isolation boundary.

## Known limits (read these)

- **Child processes are outside the egress guard.** An _approved_ shell command
  (e.g. `curl`, `npm install`) or a local MCP server process can use the
  network. Approval prompts and the sandbox's network-off default are the
  controls there.
- **Approval fatigue is real.** If you approve a command, it runs. Read what you
  approve; prefer narrow allowlists to YOLO.
- **The model can be wrong or manipulated.** Capricorn prevents unapproved
  _actions_, not wrong _answers_. Review diffs before committing.
- **Remote Ollama is not private.** With the opt-in, prompts and file contents
  travel to that host, unencrypted unless you use HTTPS.
- **Local attackers.** Anyone who can write to your home directory can change
  Capricorn's settings. `capricorn doctor` warns if `~/.capricorn` is
  group/world-writable.
- **Sandbox coverage varies by platform**; see above. No universal OS isolation
  is claimed.
- **Bundled third-party Google client code.** Capricorn uses `@google/genai`'s
  types and a few of its classes, so its bundled Gemini/Vertex client code and
  `google-auth-library` (with their default Google endpoints) are still in the
  package, unreachable from Capricorn; the egress guard would block them.
  Capricorn's own Google sign-in, Code Assist and usage-statistics code has no
  network code left; see docs/UPSTREAM.md.

## Privacy

Capricorn sends no analytics, crash reports or update checks, and contacts no
Google service. Network traffic in normal operation is limited to the local
Ollama daemon. Settings cannot re-enable Google paths: OpenTelemetry export is
forced off (whatever `telemetry.*`, `GEMINI_TELEMETRY_*` or `OTEL_*` say), voice
transcription is local Whisper only, and Google-credential auth for MCP servers
and remote agents is refused. The voice dialog's optional Whisper model download
(from huggingface.co) only happens when you choose it, and is blocked unless you
add that host to `security.network.allowedHosts`. `capricorn models pull` asks
_Ollama_ to download a model from its registry; that is the only command that
intentionally causes internet traffic, and only when you run it.

Local data: settings and trust decisions in `~/.capricorn/`, session transcripts
under `~/.capricorn/tmp/<project>/chats/` (they contain your prompts, model
replies and tool results). Delete a session with
`capricorn sessions delete <id>`, or remove `~/.capricorn/tmp/` entirely.
