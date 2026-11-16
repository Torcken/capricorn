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

| Threat                                                                                       | Control (enforced in code)                                                                                                                                                                                                                                                      | Where                                                                                             | Tested in                                                                         |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Prompts/code sent to a remote server via a malicious project setting or env var              | Endpoint must be loopback; remote requires `ollama.allowRemoteHost` in **user** settings and is shown as "REMOTE"                                                                                                                                                               | `providers/ollama/endpoint.ts`, `cli/src/config/config.ts`                                        | `endpoint.test.ts`, e2e "refuses a remote endpoint"                               |
| A dependency, tool or MCP server phoning home                                                | Egress guard blocks every non-loopback TCP connection (before DNS) unless the host is user-allowlisted                                                                                                                                                                          | `core/src/security/egressGuard.ts`, `cli/src/capricorn/networkPolicy.ts`                          | `egressGuard.test.ts`, e2e "no non-loopback connection", `npm run verify:offline` |
| Hosted model used instead of a local one                                                     | Only the Ollama generator can be built; every request's model is verified as Gemma 4 from GGUF metadata; cloud tags refused                                                                                                                                                     | `core/contentGenerator.ts`, `providers/ollama/modelPolicy.ts`, `ollamaContentGenerator.ts`        | `modelPolicy.test.ts`, `ollamaContentGenerator.test.ts`, e2e                      |
| Misleading model alias (`ollama cp qwen gemma4:x`)                                           | Architecture metadata, not the name, decides                                                                                                                                                                                                                                    | `modelPolicy.ts`                                                                                  | `modelPolicy.test.ts`                                                             |
| Model invents a tool or sends malformed arguments                                            | Unknown tools return "not found"; non-object arguments are marked and rejected before the tool is built; schema validation follows                                                                                                                                              | `converter.ts`, `scheduler/scheduler.ts`                                                          | e2e "malformed arguments", "unknown tool"                                         |
| Unapproved edits or commands                                                                 | Policy engine + approval prompts; headless default mode does not even offer mutating tools                                                                                                                                                                                      | upstream `policy/`, `scheduler/`                                                                  | e2e "denies a shell command", "does not apply edits"                              |
| Workspace escape (`../`, absolute paths, symlinks)                                           | Paths are resolved and checked against workspace roots at execution time                                                                                                                                                                                                        | upstream `config.isPathAllowed`, `safety/built-in.ts`                                             | e2e "refuses to write outside the workspace", upstream safety tests               |
| Agent edits its own configuration to widen permissions                                       | `.capricorn` (and `.gemini`) paths, including Windows trailing-dot/space, ADS and 8.3 short-name spellings, always require confirmation                                                                                                                                         | `safety/built-in.ts`                                                                              | `built-in.test.ts`                                                                |
| Prompt injection in repository content                                                       | Content is data; approvals, policies and network policy are not influenced by model text; external tool output is wrapped in `<untrusted_context>`                                                                                                                              | upstream scheduler/policy, `prompts/capricornSnippets.ts`                                         | e2e "keeps approvals in force after … injected instructions"                      |
| Runaway agent loop                                                                           | Loop detection (identical tool call repeated 5×, repeated content), per-prompt wall-clock budget (`model.maxRunMinutes`, default 30), optional session turn cap (`model.maxSessionTurns`, off by default)                                                                       | `core/client.ts`, `services/loopDetectionService.ts`                                              | e2e "time budget", upstream loop-detection tests                                  |
| Huge or hostile stream from the daemon                                                       | NDJSON line-size cap, schema validation per frame, idle timeout, truncation detection                                                                                                                                                                                           | `ndjson.ts`, `client.ts`                                                                          | `ndjson.test.ts`, `client.test.ts`                                                |
| Secrets leaking through diagnostics                                                          | `config list/get` redact secret-looking keys and MCP env/headers; endpoint URLs with credentials are rejected                                                                                                                                                                   | `cli/src/commands/capricorn.ts`, `endpoint.ts`                                                    | `capricorn.test.ts`, `endpoint.test.ts`                                           |
| Web browsing outside the network policy (upstream browser agent drives Chrome)               | The browser agent and its chrome-devtools-mcp dependency are removed; enabling it in settings only shows a notice                                                                                                                                                               | `core/src/agents/registry.ts`                                                                     | `registry.test.ts`, package smoke test                                            |
| `web_fetch` reaching hosts the user did not choose, the LAN or local services                | Off unless the user settings enable `tools.webFetch` with hosts; exact host match; redirects followed by hand and re-checked; private/loopback addresses refused after DNS resolution; every fetch asks for approval (not auto-approved in auto-edit mode); per-host rate limit | `core/src/tools/web-fetch.ts`, `cli/src/capricorn/networkPolicy.ts`, `policy/policies/write.toml` | `web-fetch.test.ts`, `networkPolicy.test.ts`                                      |
| Crafted ZIP writes outside the target through symlink entries (extension and skill installs) | Every entry is checked before extraction: symbolic links and escaping paths are refused and nothing is written                                                                                                                                                                  | `cli/src/utils/safeZip.ts`                                                                        | `safeZip.test.ts` (real archives)                                                 |
| Telemetry / update polling                                                                   | Usage statistics and update checks are forced off after settings merge                                                                                                                                                                                                          | `cli/src/config/settings.ts` (`applyCapricornInvariants`)                                         | `settings.test.ts`                                                                |

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
- **Known dependency advisories (0.1.0-alpha.9).** zod 4.6.7 and OpenTelemetry
  0.223.0 / 2.12.0 fix the earlier zod and Jaeger-propagator advisories. The
  only high-severity advisory left in bundled code is `extract-zip` (no fixed
  release); Capricorn's pre-check above covers both of its symlink advisories.
  `npm audit --omit=dev` also lists a `ws` 7 copy, but only
  `react-devtools-core` uses it and it is not bundled (the bundle ships `ws`
  8.23.0); the remaining reports concern test and build tools (vitest, vite,
  postcss, …) that are not in the package.
- **`@github/keytar` is deprecated but kept on purpose.** `npm install` warns
  that this optional native module is no longer maintained. It stores MCP server
  OAuth tokens and extension integrity records in the OS keychain (macOS
  Keychain, Linux Secret Service, Windows Credential Manager). Without it,
  Capricorn falls back to an AES-256-GCM file whose key is derived from the
  hostname and user name, so anyone who can read your files can decrypt it.
  Until a maintained keychain module or a properly keyed fallback replaces it,
  the OS keychain is the safer default.
- **No Google client code ships.** Capricorn uses only `@google/genai`'s _types_
  (erased at build time); the SDK's Gemini/Vertex clients and
  `google-auth-library` are not in the package, which the package smoke test
  checks. Capricorn's own Google sign-in, Code Assist and usage-statistics
  stand-ins have no network code; see docs/UPSTREAM.md.

## Privacy

Capricorn sends no analytics, crash reports or update checks, and contacts no
Google service. Network traffic in normal operation is limited to the local
Ollama daemon. Settings cannot re-enable Google paths: OpenTelemetry export is
forced off (whatever `telemetry.*`, `GEMINI_TELEMETRY_*` or `OTEL_*` say), voice
transcription is local Whisper only, and Google-credential auth for MCP servers
and remote agents is refused. The voice dialog's optional Whisper model download
(from huggingface.co) only happens when you choose it, and is blocked unless you
add that host to `security.network.allowedHosts`. Two features cause internet
traffic on purpose, and only when you use them: `capricorn models pull` asks
_Ollama_ to download a model from its registry, and `web_fetch` downloads a
page, but only after you enable it in your user settings (`tools.webFetch`),
only from the hosts you list there, and only after you approve each fetch.

Capricorn stores a V8 compile cache (bytecode of its own bundled code, no user
data) in `~/.capricorn/cache/compile` (mode 0700) to start faster; deleting it
is safe, and `NODE_DISABLE_COMPILE_CACHE=1` turns it off.

Local data: settings and trust decisions in `~/.capricorn/`, session transcripts
under `~/.capricorn/tmp/<project>/chats/` (they contain your prompts, model
replies and tool results). Delete a session with
`capricorn sessions delete <id>`, or remove `~/.capricorn/tmp/` entirely.
