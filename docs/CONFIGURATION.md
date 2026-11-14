# Configuration

Capricorn reads JSON settings files (comments allowed) and environment
variables. Settings are validated against a schema; invalid values are reported
with the file and key at startup. Use `capricorn config list|get|set` to inspect
and change them safely.

## Files and precedence

Highest precedence first:

1. Command-line flags (`--model`, `--approval-mode`, `--sandbox`, …)
2. Environment variables (below)
3. **System settings** (administrator overrides):
   `/etc/capricorn/settings.json`,
   `/Library/Application Support/Capricorn/settings.json` (macOS),
   `C:\ProgramData\capricorn\settings.json` (Windows); override with
   `CAPRICORN_SYSTEM_SETTINGS_PATH`
4. **Project settings:** `<project>/.capricorn/settings.json` — only in trusted
   folders
5. **User settings:** `~/.capricorn/settings.json`
6. **System defaults:** `system-defaults.json` next to the system settings
7. Built-in defaults

`capricorn config set <key> <value>` writes user settings by default
(`--scope workspace` for the project file).

### Non-overridable settings

Applied after merging; no settings file can change them:

| Key                                                                | Forced value   | Reason                       |
| ------------------------------------------------------------------ | -------------- | ---------------------------- |
| `security.auth.selectedType`                                       | `ollama-local` | There is no hosted back-end. |
| `privacy.usageStatisticsEnabled`                                   | `false`        | No telemetry.                |
| `general.enableAutoUpdate`, `general.enableAutoUpdateNotification` | `false`        | No update polling.           |

### User-scope-only settings

These are honoured **only** in `~/.capricorn/settings.json`, because a cloned
repository must not be able to change them:

- `ollama.allowRemoteHost`
- `security.network.allowedHosts`
- remote MCP server hosts (a remote server declared in project settings is
  blocked until its host is in your user allowlist)

## Capricorn settings

| Key                             | Default                  | Description                                                                                                                                                                                                                                                         |
| ------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model.name`                    | `gemma4:12b`             | Ollama tag of the default model. Must be installed and verified as Gemma 4. Upstream Gemini names (`auto`, `gemini-*`) resolve to the default.                                                                                                                      |
| `model.maxRunMinutes`           | `30`                     | Wall-clock budget for one prompt, including all model turns and tool calls. `0` disables. Fractions allowed.                                                                                                                                                        |
| `model.checkCitedFiles`         | `true`                   | If a final answer cites 1–3 existing workspace files that were not opened (read, written, edited, or shown with matching lines by `grep_search`) during the request, ask the model once to open them and correct the answer. Files named in your prompt are exempt. |
| `model.maxSessionTurns`         | `-1`                     | Maximum turns per session (`-1` = unlimited).                                                                                                                                                                                                                       |
| `ollama.endpoint`               | `http://127.0.0.1:11434` | Ollama URL, `OLLAMA_HOST` style (`host`, `host:port` or URL). Must be loopback unless `allowRemoteHost`.                                                                                                                                                            |
| `ollama.allowRemoteHost`        | `false`                  | **User settings only.** Allow a non-loopback daemon. Prompts and file contents then leave this machine.                                                                                                                                                             |
| `ollama.numCtx`                 | `32768`                  | Context window allocated on the daemon (min 8192, capped at the model's maximum). KV-cache memory grows with it.                                                                                                                                                    |
| `ollama.think`                  | `auto`                   | Gemma 4 thinking: `auto` (follow the agent; never on internal calls such as compression), `on`, `off` (faster). Ignored for models without the capability.                                                                                                          |
| `ollama.keepAlive`              | `10m`                    | How long Ollama keeps the model loaded after a request.                                                                                                                                                                                                             |
| `ollama.requestTimeoutMs`       | `300000`                 | Max wait for the first byte (includes model load).                                                                                                                                                                                                                  |
| `security.network.allowedHosts` | `[]`                     | **User settings only.** External hosts Capricorn itself may contact, e.g. `["mcp.example.org", "*.corp.example"]`.                                                                                                                                                  |
| `experimental.enableAgents`     | `false`                  | Enable sub-agents (`invoke_agent`). Each sub-agent runs extra local inference.                                                                                                                                                                                      |
| `general.topicUpdateNarration`  | `false`                  | Structured progress updates via an extra tool.                                                                                                                                                                                                                      |
| `general.defaultApprovalMode`   | `default`                | `default`, `auto_edit` or `plan`. YOLO is only available via `--approval-mode yolo`.                                                                                                                                                                                |
| `tools.sandbox`                 | `false`                  | `true`, a command (`docker`, `podman`, `sandbox-exec`) or an object `{ enabled, command, image, networkAccess, allowedPaths }`.                                                                                                                                     |
| `context.fileName`              | `CAPRICORN.md`           | Project instruction file name(s). Set `["CAPRICORN.md", "GEMINI.md"]` to opt into reading an existing `GEMINI.md`.                                                                                                                                                  |
| `mcpServers`                    | `{}`                     | MCP servers (see below).                                                                                                                                                                                                                                            |

All other upstream settings (UI, keybindings, file filtering, hooks, policies,
…) keep their upstream meaning; `capricorn config list` shows the effective
values and the settings dialog (`/settings`) documents each one.

## Environment variables

| Variable                                                           | Effect                                                                                                |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `CAPRICORN_OLLAMA_HOST`, `OLLAMA_HOST`                             | Ollama endpoint (first one set wins; overrides `ollama.endpoint`).                                    |
| `CAPRICORN_MODEL`                                                  | Default model (below `--model`, above `model.name`). `GEMINI_MODEL` is ignored.                       |
| `CAPRICORN_HOME`                                                   | Directory used instead of your home directory for `~/.capricorn`.                                     |
| `CAPRICORN_SYSTEM_SETTINGS_PATH`, `CAPRICORN_SYSTEM_DEFAULTS_PATH` | Alternative system settings files.                                                                    |
| `CAPRICORN_EGRESS_REPORT=1`                                        | Print every blocked outbound connection to stderr.                                                    |
| `GEMINI_CLI_TRUST_WORKSPACE=true`                                  | Treat the current folder as trusted (automation in repositories you control). Same as `--skip-trust`. |
| `GEMINI_SANDBOX`                                                   | Sandbox command override (upstream name).                                                             |
| `NO_COLOR`                                                         | Disable colours.                                                                                      |

`GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_CLOUD_PROJECT` and other Google
variables are ignored for inference.

## Project instructions (`CAPRICORN.md`)

Markdown with project conventions, build/test commands and constraints.
Capricorn loads `CAPRICORN.md` files from the project (and
`~/.capricorn/CAPRICORN.md` for global preferences) into the system prompt.
`/memory list` shows which files are in use; `/memory reload` re-reads them.
Instructions are guidance for the model, not a security boundary.

## Ignoring files

`.capricornignore` (gitignore syntax) hides files from Capricorn's file tools in
addition to `.gitignore`.

## MCP servers

```jsonc
{
  "mcpServers": {
    // Local stdio server: runs as a child process.
    "files": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
    },
    // Remote server: its host must also be in security.network.allowedHosts
    // (user settings), or the connection is blocked.
    "remote": { "httpUrl": "https://mcp.example.org/mcp" },
  },
}
```

MCP is off until you configure a server. MCP tool calls go through the same
approval flow as built-in tools; MCP output is treated as untrusted.

## Hooks

Hooks (`hooks` setting) run commands at agent lifecycle events. They execute
with your privileges; project hooks only run in trusted folders. See the
`/hooks` dialog for configured hooks.

## Skills

Agent skills are folders with a `SKILL.md` under `~/.capricorn/skills/` or
`<project>/.capricorn/skills/`. Manage them with `capricorn skills` or
`/skills`.

## Example user settings

See [examples/settings.example.json](examples/settings.example.json).
