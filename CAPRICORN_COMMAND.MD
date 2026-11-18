# Capricorn command reference

Every command, option and in-session slash command of Capricorn
`0.1.0-alpha.9`, what it does, how to use it, and whether it works.

**How this was checked (2026-11-18):** every command marked _Tested_ was run by
hand against a real local Ollama 0.40.16 with `gemma4:e4b` (Linux x64, TITAN V),
from the sources at `5f1778256` plus the fixes listed in
[Fixed while writing this reference](#fixed-while-writing-this-reference).
Slash commands were typed into the real interactive interface through a
pseudo-terminal. Commands are run in a scratch home and project, never in a
real one.

| Status                 | Meaning                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| ✅ **Tested**          | Run by hand for this reference; works as described.                                                 |
| ☑️ **Unit-tested**     | Not run by hand here; covered by the automated test suites, which pass.                             |
| ⚙️ **Off by default**  | Works, but only after turning on the setting named in the entry.                                    |
| ⚠️ **Limited**         | Works with a condition or a known gap, explained in the entry.                                      |
| ❌ **Not implemented** | Removed from the upstream Gemini CLI, or not available in Capricorn. Typing it does nothing useful. |

Contents: [Terminal commands](#1-terminal-commands) ·
[Options](#2-options-for-a-session) ·
[Slash commands](#3-slash-commands-inside-a-session) ·
[Input shortcuts](#4-input-shortcuts-and-keys) ·
[Custom commands](#5-custom-slash-commands) ·
[Environment variables](#6-environment-variables) ·
[Exit codes](#7-exit-codes) · [Not implemented](#8-not-implemented)

---

## 1. Terminal commands

Run these from a shell. `capricorn <command> --help` shows each command's own
options.

### Start a session

| Command                     | What it does                                                                                                                                                                                                                    | Status         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `capricorn`                 | Starts the interactive session (terminal UI) in the current folder. Asks before every edit and command by default.                                                                                                              | ✅ Tested      |
| `capricorn "<prompt>"`      | Starts the interactive session and sends `<prompt>` as the first message.                                                                                                                                                       | ☑️ Unit-tested |
| `capricorn -p "<task>"`     | **Headless:** runs one task, prints the answer, exits. Text piped on stdin is appended to the prompt. Anything that needs approval is denied (no one can answer), unless you choose another approval mode.                      | ✅ Tested      |
| `capricorn run "<task>"`    | Same as `-p "<task>"`. Also `capricorn run --prompt "<task>"`. **`run` must be the first argument** (put options after it: `capricorn run --model gemma4:e4b "<task>"`); otherwise the words are sent to the model as a prompt. | ✅ Tested      |
| `capricorn -i "<prompt>"`   | Runs `<prompt>` and stays in the interactive session.                                                                                                                                                                           | ☑️ Unit-tested |
| `capricorn --version`, `-v` | Prints the version (`0.1.0-alpha.9`).                                                                                                                                                                                           | ✅ Tested      |
| `capricorn --help`, `-h`    | Lists commands and options.                                                                                                                                                                                                     | ✅ Tested      |

### Diagnostics

| Command                                     | What it does                                                                                                                                                                                                                                                                                                | Status         |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `capricorn doctor`                          | Checks Node.js, memory, hardware and the recommended model, the Ollama endpoint and daemon, installed Gemma 4 models, the selected model, context window, network policy, state directory, workspace, `git` and `rg`. Each failed check prints the command that fixes it. Exit `0` = ready, `1` = problems. | ✅ Tested      |
| `capricorn doctor --load`                   | Also loads the selected model once in Ollama, to prove it runs with your context window (can take minutes). If it does not fit in memory, it names a smaller window that loads, e.g. `capricorn config set ollama.numCtx 16384`.                                                                            | ✅ Tested      |
| `capricorn doctor --model <tag>`            | Checks `<tag>` instead of the configured model.                                                                                                                                                                                                                                                             | ✅ Tested      |
| `capricorn doctor --json`                   | Same checks as one JSON document on stdout (for scripts).                                                                                                                                                                                                                                                   | ☑️ Unit-tested |
| `capricorn status [--json] [--model <tag>]` | Shows the effective model and where it comes from (flag, settings, default), the Ollama endpoint and version, context window, project and trust, approval mode, sandbox, and the models Ollama has loaded.                                                                                                  | ✅ Tested      |

### Models

Only models that Ollama's own metadata identifies as Gemma 4 are accepted; the
tag name alone proves nothing. Cloud models (`:cloud`) are always refused.

| Command                            | What it does                                                                                                                                                                                                                                            | Status                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `capricorn models` / `models list` | Installed models that pass Gemma 4 verification, with size and quantization (`*` = selected).                                                                                                                                                           | ✅ Tested                        |
| `capricorn models list --all`      | Also lists rejected models (other families, cloud models) and why.                                                                                                                                                                                      | ☑️ Unit-tested                   |
| `capricorn models list --json`     | Machine-readable list.                                                                                                                                                                                                                                  | ☑️ Unit-tested                   |
| `capricorn models info <tag>`      | Verdict, architecture, parameters, quantization, maximum context, capabilities (`tools`, `vision`, …). Exit `1` if the model is not usable.                                                                                                             | ✅ Tested                        |
| `capricorn models pull <tag>`      | Downloads a Gemma 4 model **through the Ollama daemon** (the daemon needs internet; Capricorn itself only talks to the local daemon). Shows progress; Ctrl+C cancels. Non-Gemma tags are refused before any download, and the result is verified after. | ✅ Tested (on macOS, 2026-11-16) |
| `capricorn models use <tag>`       | Verifies the model and saves it as your default (`model.name` in user settings).                                                                                                                                                                        | ✅ Tested                        |

Presets: `gemma4:e2b` (experimental), `gemma4:e4b`, `gemma4:12b` (default),
`gemma4:26b`, `gemma4:31b`. `doctor` recommends one for your machine.

### Settings

| Command                                                        | What it does                                                                                                                                                                                                | Status    |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `capricorn config list [--json]`                               | All effective settings (user + project merged), secrets redacted.                                                                                                                                           | ✅ Tested |
| `capricorn config get <key>`                                   | One setting, by dotted key, e.g. `capricorn config get ollama.numCtx`.                                                                                                                                      | ✅ Tested |
| `capricorn config set <key> <value> [--scope user\|workspace]` | Validates the value against the settings schema and writes it (default scope: `user`). Security-sensitive keys (endpoint, allowed hosts, …) can only be set in user settings. Exit `2` on an invalid value. | ✅ Tested |
| `capricorn init [--force]`                                     | Creates `CAPRICORN.md` (project instructions) and `.capricorn/settings.json` in the current folder. Never overwrites; `--force` overwrites `CAPRICORN.md` and keeps a `.bak` copy.                          | ✅ Tested |

### Sessions

Conversations are saved automatically per project.

| Command                                         | What it does                                                                                                       | Status    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------- |
| `capricorn sessions list`                       | Saved sessions of this project: index, title, age, id.                                                             | ✅ Tested |
| `capricorn sessions resume <id\|index\|latest>` | Resumes a session; add `-p "<task>"` to continue it headless.                                                      | ✅ Tested |
| `capricorn sessions delete <id\|index> [--yes]` | Deletes a session. Asks for confirmation; in a non-interactive shell it refuses (exit `2`) unless you add `--yes`. | ✅ Tested |
| `capricorn --list-sessions`                     | Same as `sessions list` (upstream flag).                                                                           | ✅ Tested |
| `capricorn --resume <id\|index\|latest>`, `-r`  | Same as `sessions resume`.                                                                                         | ✅ Tested |
| `capricorn --delete-session <index>`            | Deletes **without** asking (upstream flag). Prefer `sessions delete`.                                              | ✅ Tested |

As with `run`, **`sessions` must be the first argument**.

### MCP servers (`capricorn mcp`)

MCP servers give the model extra tools. They are stored in settings; project
settings are only read and written in a **trusted** folder.

| Command                                                      | What it does                                                                                                                                                                                                                                                                                      | Status                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `capricorn mcp add <name> <command> [args...]`               | Adds a local (stdio) server, e.g. `capricorn mcp add files node server.js`. Options: `--scope user\|project` (default `project`, which needs a trusted folder), `-e KEY=value`, `--timeout`, `--trust` (skip confirmations for its tools), `--description`, `--include-tools`, `--exclude-tools`. | ✅ Tested                                                  |
| `capricorn mcp add <name> <url> --transport http\|sse`       | Adds a remote server. Add `-H "Header: value"` for headers. Its host must also be in `security.network.allowedHosts` (user settings), or Capricorn's network policy blocks it.                                                                                                                    | ✅ Tested (add/remove; a remote connection was not tested) |
| `capricorn mcp list`                                         | Configured servers and their connection status. In an untrusted folder all servers are suppressed, and it says so.                                                                                                                                                                                | ✅ Tested                                                  |
| `capricorn mcp remove <name> [--scope]`                      | Removes a server.                                                                                                                                                                                                                                                                                 | ✅ Tested                                                  |
| `capricorn mcp enable <name>` / `disable <name> [--session]` | Turns a configured server on or off without removing it (`--session`: only for the current session). Exit `1` for an unknown name.                                                                                                                                                                | ✅ Tested (after a fix, see below)                         |

### Extensions (`capricorn extensions`)

An extension bundles commands, MCP servers, skills, hooks, policies or themes.
There is **no hosted gallery**: install from a local folder or a git
repository. Every install shows a security notice first; `--consent` accepts it
(needed in scripts).

| Command                                                                                      | What it does                                                                                                                                                                          | Status                                                                |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `capricorn extensions new <path> [template]`                                                 | Creates a new extension. Templates: `custom-commands`, `exclude-tools`, `hooks`, `mcp-server`, `policies`, `skills`, `themes-example`.                                                | ✅ Tested                                                             |
| `capricorn extensions validate <path>`                                                       | Checks an extension folder.                                                                                                                                                           | ✅ Tested                                                             |
| `capricorn extensions install <path> [--consent]`                                            | Installs a copy of a local extension.                                                                                                                                                 | ✅ Tested                                                             |
| `capricorn extensions install <git-url> [--ref] [--auto-update] [--pre-release] [--consent]` | Installs from a git repository (`git clone`, which needs network access). `file://` URLs are not accepted; use a plain path.                                                          | ⚠️ Limited: not tested here (no network test); local paths are tested |
| `capricorn extensions link <path> [--consent]`                                               | Links a local folder instead of copying it: edits take effect at once. **Without `--consent` in a script it waits for an answer that never comes**, so always pass `--consent` there. | ✅ Tested                                                             |
| `capricorn extensions list`                                                                  | Installed extensions.                                                                                                                                                                 | ✅ Tested                                                             |
| `capricorn extensions enable\|disable [--scope] <name>`                                      | Turns an extension on or off.                                                                                                                                                         | ✅ Tested                                                             |
| `capricorn extensions config [name] [setting]`                                               | Edits an extension's settings.                                                                                                                                                        | ✅ Tested                                                             |
| `capricorn extensions update [<name>] [--all]`                                               | Updates git-installed extensions.                                                                                                                                                     | ✅ Tested (nothing to update)                                         |
| `capricorn extensions uninstall [names..]`                                                   | Removes extensions.                                                                                                                                                                   | ✅ Tested                                                             |
| `capricorn --list-extensions`, `-l`                                                          | Lists extensions and exits.                                                                                                                                                           | ✅ Tested                                                             |

### Agent skills (`capricorn skills`)

A skill is a folder with a `SKILL.md` (name, description, instructions) that the
model can activate when relevant.

| Command                                                                   | What it does                                                   | Status                 |
| ------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------- |
| `capricorn skills list [--all]`                                           | Discovered skills and whether each is enabled.                 | ✅ Tested              |
| `capricorn skills install <path\|git-url> [--scope] [--path] [--consent]` | Installs a skill (copy).                                       | ✅ Tested (local path) |
| `capricorn skills link <path> [--scope user\|workspace] [--consent]`      | Links a skill folder; edits take effect at once.               | ✅ Tested              |
| `capricorn skills enable <name>` / `disable <name> [--scope]`             | Turns a skill on or off. Project scope needs a trusted folder. | ✅ Tested              |
| `capricorn skills uninstall <name> [--scope]`                             | Removes an installed skill.                                    | ✅ Tested              |

### Hooks (`capricorn hooks`)

| Command                                 | What it does                                                                                                                                                                       | Status    |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `capricorn hooks migrate --from-claude` | Converts Claude Code hooks from `.claude/settings.json` into Capricorn's format in `.capricorn/settings.json` (e.g. `PreToolUse` on `Bash` → `BeforeTool` on `run_shell_command`). | ✅ Tested |

Hooks themselves are configured in settings (`hooks` and `hooksConfig`); see
`docs/CONFIGURATION.md`.

---

## 2. Options for a session

Use with `capricorn`, `capricorn -p` or `capricorn run`.

| Option                                        | What it does                                                                                                                                                                                                        | Status                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `-m, --model <tag>`                           | Model for this session (must be a verified, installed Gemma 4 model).                                                                                                                                               | ✅ Tested                                                                              |
| `--approval-mode default`                     | Asks before every edit and command (the default). In a headless run, anything that needs approval is denied.                                                                                                        | ✅ Tested                                                                              |
| `--approval-mode auto_edit`                   | Applies file edits without asking; still asks before shell commands.                                                                                                                                                | ☑️ Unit-tested (used by the eval suite)                                                |
| `--approval-mode plan`                        | **Read-only:** the model may read and search, and write plans only to its plans folder. In a headless run it cannot leave plan mode; to apply the plan, run again with another mode.                                | ✅ Tested (after a fix, see below)                                                     |
| `--approval-mode yolo`, `-y, --yolo`          | Approves **everything** automatically, shell commands included. Use only in a throwaway folder or a sandbox.                                                                                                        | ✅ Tested                                                                              |
| `--skip-trust`                                | Trusts the current folder for this session (project settings, MCP servers, hooks and skills of the folder are then used).                                                                                           | ✅ Tested                                                                              |
| `-s, --sandbox`                               | Runs tools inside a container or OS sandbox (Docker, Podman, bubblewrap or macOS Seatbelt; network off by default). Build the image once with `npm run build:sandbox` in a source checkout. See `docs/SECURITY.md`. | ✅ Tested (Podman, Linux)                                                              |
| `--include-directories <dir,...>`             | Adds folders outside the current one to the workspace.                                                                                                                                                              | ✅ Tested                                                                              |
| `--policy <file\|dir>`                        | Loads extra policy files (`.toml`) that allow, ask or deny tools. A denied tool is removed from the model's tool list.                                                                                              | ✅ Tested                                                                              |
| `--admin-policy <file\|dir>`                  | Same, at administrator priority (wins over user policies).                                                                                                                                                          | ☑️ Unit-tested                                                                         |
| `-o, --output-format text\|json\|stream-json` | `json`: one JSON result at the end; `stream-json`: one JSON event per line (messages, tool calls, results, token stats).                                                                                            | ✅ Tested                                                                              |
| `-r, --resume <id\|index\|latest>`            | Continues a saved session.                                                                                                                                                                                          | ✅ Tested                                                                              |
| `--session-id <uuid>`                         | Starts a new session with this id.                                                                                                                                                                                  | ✅ Tested                                                                              |
| `--session-file <file>`                       | Loads a session from an exported JSON file (see `/export-session`).                                                                                                                                                 | ☑️ Unit-tested                                                                         |
| `-w, --worktree [name]`                       | Starts in a new git worktree (`.capricorn/worktrees/<name>`, branch `worktree-<name>`).                                                                                                                             | ⚙️ Off by default: `capricorn config set experimental.worktrees true` — then ✅ Tested |
| `-e, --extensions <name,...>`                 | Uses only these extensions (`none` for none).                                                                                                                                                                       | ✅ Tested                                                                              |
| `--allowed-mcp-server-names <name,...>`       | Uses only these MCP servers.                                                                                                                                                                                        | ☑️ Unit-tested                                                                         |
| `--allowed-tools <tool,...>`                  | **Deprecated:** tools that run without confirmation. Still works, with a warning; use a policy file instead.                                                                                                        | ✅ Tested                                                                              |
| `--screen-reader`                             | Screen-reader friendly output (no decorative layout).                                                                                                                                                               | ✅ Tested                                                                              |
| `--raw-output` [`--accept-raw-output-risk`]   | Does not sanitize the model's output (allows terminal escape sequences). A security risk with untrusted content.                                                                                                    | ☑️ Unit-tested                                                                         |
| `-d, --debug`                                 | Debug mode; F12 opens the debug console.                                                                                                                                                                            | ☑️ Unit-tested                                                                         |
| `--acp`                                       | Runs as an agent for editors that speak the Agent Client Protocol (JSON-RPC on stdin/stdout). It offers only the local Ollama method. `--experimental-acp` is the deprecated name.                                  | ✅ Tested (initialize handshake)                                                       |

---

## 3. Slash commands (inside a session)

Type them at the prompt of the interactive session. `/help` lists the ones
available in your session; typing `/` shows suggestions.

**In headless mode (`-p`)** only a few work (for example `/policies list` and
`/memory list`); the others are passed to the model as ordinary text. An
unknown or disabled slash command is also passed to the model as text.

### Information

| Command                   | What it does                                                                                                                 | Status    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------- |
| `/help`                   | Basics (`@`, `!`), every command and subcommand, shortcuts.                                                                  | ✅ Tested |
| `/about`                  | Version, git commit, model, sandbox, OS, back-end (`ollama-local`).                                                          | ✅ Tested |
| `/stats` (alias `/usage`) | Session statistics; `/stats session`, `/stats model` (requests and tokens per model, as reported by Ollama), `/stats tools`. | ✅ Tested |
| `/tools` / `/tools desc`  | The tools the model can use, optionally with descriptions.                                                                   | ✅ Tested |
| `/shortcuts`              | Shows or hides the shortcuts panel above the input.                                                                          | ✅ Tested |

### Model

| Command                                         | What it does                                                                                | Status    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------- | --------- |
| `/model` / `/model list`                        | Local Gemma 4 models; `●` marks the current one.                                            | ✅ Tested |
| `/model <tag>` / `/model set <tag> [--persist]` | Switches model for this session (verified first); `--persist` also saves it as the default. | ✅ Tested |

### Conversation

| Command                                        | What it does                                                                                                       | Status                                                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `/clear` (alias `/new`)                        | Clears the screen and starts a new session.                                                                        | ✅ Tested                                                                                                              |
| `/compress` (aliases `/summarize`, `/compact`) | Replaces the history with a summary written by the local model, to free context. Example seen: 5,672 → 814 tokens. | ✅ Tested                                                                                                              |
| `/rewind` (or press **Esc twice**)             | Jump back to an earlier message and continue from there; shows which files each step changed.                      | ✅ Tested                                                                                                              |
| `/resume`                                      | Opens the session browser (resume, search, delete).                                                                | ✅ Tested                                                                                                              |
| `/chat save <tag>`                             | Saves the conversation as a named checkpoint. `/resume save <tag>` is the same.                                    | ✅ Tested                                                                                                              |
| `/chat list`                                   | Lists saved checkpoints.                                                                                           | ✅ Tested                                                                                                              |
| `/chat resume <tag>` (alias `load`)            | Restores a saved checkpoint.                                                                                       | ☑️ Unit-tested                                                                                                         |
| `/chat delete <tag>`                           | Deletes a checkpoint.                                                                                              | ☑️ Unit-tested                                                                                                         |
| `/chat share <file.md\|file.json>`             | Writes the conversation to a Markdown or JSON file.                                                                | ✅ Tested                                                                                                              |
| `/export-session <file.json>`                  | Exports the whole session to JSON (a path is required). Load it later with `--session-file`.                       | ✅ Tested                                                                                                              |
| `/copy`                                        | Copies the last answer or code block to the clipboard.                                                             | ⚠️ Limited: on Linux it needs `xsel`, `xclip` or `wl-copy` installed                                                   |
| `/restore [<checkpoint>]`                      | Lists the file snapshots taken before each edit, and restores one.                                                 | ⚙️ Off by default: `capricorn config set general.checkpointing.enabled true` — then ✅ Tested (after a fix, see below) |

### Project and memory

| Command                            | What it does                                                                                                                                          | Status         |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `/init`                            | The model analyzes the project and writes a tailored `CAPRICORN.md` (it asks before writing). Differs from `capricorn init`, which writes a template. | ✅ Tested      |
| `/memory show`                     | The project instructions currently loaded.                                                                                                            | ✅ Tested      |
| `/memory list`                     | Paths of the `CAPRICORN.md` files in use.                                                                                                             | ✅ Tested      |
| `/memory reload` (alias `refresh`) | Re-reads the `CAPRICORN.md` files.                                                                                                                    | ✅ Tested      |
| `/memory inbox`                    | Reviews skills extracted from past sessions and moves them to your skills.                                                                            | ☑️ Unit-tested |
| `/directory show` (alias `/dir`)   | Workspace folders.                                                                                                                                    | ✅ Tested      |
| `/directory add <path,...>`        | Adds folders to the workspace; asks whether to trust them.                                                                                            | ✅ Tested      |

### Safety and permissions

| Command                      | What it does                                                                                                                                                                            | Status    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `/permissions trust [<dir>]` | Sets the trust level of a folder (trust this folder, its parent, or don't trust).                                                                                                       | ✅ Tested |
| `/policies list`             | Active policy rules by approval mode, with priority and source file. It also shows inactive rules for upstream tools Capricorn removed (e.g. `google_web_search`); they have no effect. | ✅ Tested |
| `/plan`                      | Switches to plan mode (read-only) and shows the current plan.                                                                                                                           | ✅ Tested |
| `/plan copy`                 | Copies the approved plan to the clipboard.                                                                                                                                              | ✅ Tested |

**Shift+Tab** cycles the approval mode (default → auto-edit → plan) and
**Ctrl+Y** toggles YOLO.

### Tools and integrations

| Command                                                                                              | What it does                                                                                                                                                                             | Status                                                                                             |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `/mcp list` (aliases `ls`, `nodesc`)                                                                 | MCP servers and their tools.                                                                                                                                                             | ✅ Tested                                                                                          |
| `/mcp desc` / `/mcp schema`                                                                          | Same, with descriptions / with input schemas.                                                                                                                                            | ✅ Tested (`desc`); `schema` ☑️ Unit-tested                                                        |
| `/mcp reload`                                                                                        | Reconnects MCP servers.                                                                                                                                                                  | ✅ Tested                                                                                          |
| `/mcp enable <name>` / `/mcp disable <name>`                                                         | Turns a server on or off.                                                                                                                                                                | ☑️ Unit-tested                                                                                     |
| `/mcp auth <name>`                                                                                   | OAuth sign-in for an MCP server that needs it (tokens are kept in the OS keychain). The server's host must be allowed in `security.network.allowedHosts`.                                | ⚠️ Limited: not tested here (no OAuth server)                                                      |
| `/extensions list`                                                                                   | Active extensions.                                                                                                                                                                       | ✅ Tested                                                                                          |
| `/extensions explore`                                                                                | Explains how to install extensions (no hosted gallery).                                                                                                                                  | ✅ Tested                                                                                          |
| `/extensions install`, `uninstall` (alias `delete`), `link`, `enable`, `disable`, `update`, `config` | Same as the terminal commands of section 1.                                                                                                                                              | ☑️ Unit-tested                                                                                     |
| `/extensions reload` (alias `restart`)                                                               | Reloads all extensions.                                                                                                                                                                  | ✅ Tested                                                                                          |
| `/skills list [nodesc] [all]`                                                                        | Available skills.                                                                                                                                                                        | ✅ Tested                                                                                          |
| `/skills link <path>`, `enable <name>`, `disable <name>`                                             | Same as the terminal commands.                                                                                                                                                           | ☑️ Unit-tested                                                                                     |
| `/skills reload` (alias `refresh`)                                                                   | Re-scans skills.                                                                                                                                                                         | ✅ Tested                                                                                          |
| `/hooks panel` (aliases `list`, `show`)                                                              | Registered hooks and their status.                                                                                                                                                       | ✅ Tested                                                                                          |
| `/hooks enable <name>` / `disable <name>`                                                            | Turns one hook on or off.                                                                                                                                                                | ☑️ Unit-tested                                                                                     |
| `/hooks enable-all` / `disable-all`                                                                  | Turns all hooks on or off.                                                                                                                                                               | ✅ Tested                                                                                          |
| `/commands list`                                                                                     | Custom command files (`.toml`) found.                                                                                                                                                    | ✅ Tested                                                                                          |
| `/commands reload` (alias `refresh`)                                                                 | Re-reads custom commands.                                                                                                                                                                | ✅ Tested                                                                                          |
| `/tasks` (aliases `/bg`, `/background`)                                                              | Shows or hides background shell tasks.                                                                                                                                                   | ✅ Tested                                                                                          |
| `/agents list`, `reload`, `enable`, `disable`, `config`                                              | Sub-agents the model can delegate to (codebase investigator, generalist, CLI help). The CLI help agent still describes itself as answering questions about "the Gemini CLI application". | ⚙️ Off by default: `capricorn config set experimental.enableAgents true` — then ✅ Tested (`list`) |

### Interface

| Command                         | What it does                                                                                                                                                                                                                                                         | Status                                                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `/settings`                     | Settings dialog (search, edit, choose scope).                                                                                                                                                                                                                        | ✅ Tested                                                                                                          |
| `/theme`                        | Theme picker with preview.                                                                                                                                                                                                                                           | ✅ Tested                                                                                                          |
| `/editor`                       | Chooses the external editor (used by Ctrl+G and "modify with external editor").                                                                                                                                                                                      | ✅ Tested                                                                                                          |
| `/footer` (alias `/statusline`) | Chooses what the footer shows (folder, git branch, sandbox, model, context used, …).                                                                                                                                                                                 | ✅ Tested                                                                                                          |
| `/vim`                          | Turns Vim keybindings on or off for the input.                                                                                                                                                                                                                       | ✅ Tested                                                                                                          |
| `/terminal-setup`               | Configures Shift+Enter for multi-line input.                                                                                                                                                                                                                         | ⚠️ Limited: only VS Code, Cursor, Windsurf and Antigravity terminals                                               |
| `/voice`, `/voice model`        | Voice dictation with local Whisper (`whisper-stream`, recording with `rec` from SoX). Downloading a Whisper model from huggingface.co is blocked by the network policy unless you allow that host; you can place a model in `~/.capricorn/whisper_models/` yourself. | ⚙️ Off by default (`experimental.voiceMode true`) and ⚠️ Limited: not tested end to end (no `whisper-stream` here) |
| `/corgi`                        | Hidden easter egg (toggles corgi mode).                                                                                                                                                                                                                              | ☑️ Unit-tested                                                                                                     |
| `/quit` (alias `/exit`)         | Exits.                                                                                                                                                                                                                                                               | ✅ Tested                                                                                                          |

### Development-only

| Command       | What it does                                                           | Status                                   |
| ------------- | ---------------------------------------------------------------------- | ---------------------------------------- |
| `/profile`    | Profiling view; only in a development build (`NODE_ENV=development`).  | ⚠️ Limited: not available in the package |
| `/chat debug` | Exports the most recent model request as JSON; only in nightly builds. | ⚠️ Limited: not available in releases    |

---

## 4. Input shortcuts and keys

| Input                  | What it does                                                  | Status                     |
| ---------------------- | ------------------------------------------------------------- | -------------------------- |
| `@path/to/file`        | Adds a file or folder to the message (pick from suggestions). | ☑️ Unit-tested             |
| `!command`             | Shell mode: runs a shell command yourself (e.g. `!npm test`). | ☑️ Unit-tested             |
| `?` on an empty prompt | Shows the shortcuts.                                          | ☑️ Unit-tested             |
| **Enter**              | Sends the message.                                            | ✅ Tested                  |
| **Esc**                | Cancels the running request or closes a dialog.               | ✅ Tested (closes dialogs) |
| **Esc Esc**            | Rewind (same as `/rewind`).                                   | ✅ Tested                  |
| **Shift+Tab**          | Cycles the approval mode.                                     | ☑️ Unit-tested             |
| **Ctrl+Y**             | Toggles YOLO mode.                                            | ☑️ Unit-tested             |
| **Ctrl+C**             | Cancels; twice on an empty prompt exits.                      | ☑️ Unit-tested             |
| **Ctrl+R**             | Reverse search in your input history; **↑ / ↓** browse it.    | ☑️ Unit-tested             |
| **Ctrl+G**             | Opens the external editor for the input.                      | ☑️ Unit-tested             |
| **Ctrl+V**             | Pastes images.                                                | ☑️ Unit-tested             |
| **Alt+M**              | Raw Markdown mode.                                            | ☑️ Unit-tested             |
| **Tab**                | Focuses the UI (e.g. a running shell).                        | ☑️ Unit-tested             |
| **F12**                | Debug console (with `--debug`).                               | ☑️ Unit-tested             |

---

## 5. Custom slash commands

Put a `.toml` file in `~/.capricorn/commands/` (all projects) or
`<project>/.capricorn/commands/` (this project). `commands/git/fix.toml` becomes
`/git:fix`.

```toml
description = "Explain a file"
prompt = "Explain {{args}} in plain words, then list its risks."
```

`{{args}}` is replaced by what you type after the command; `!{...}` runs a
shell command (asking first) and inserts its output; `@{file}` inserts a file.
List them with `/commands list`, reload with `/commands reload`. Prompts from
connected MCP servers also appear as slash commands. Status: ☑️ Unit-tested
(loader); `/commands list` ✅ Tested.

---

## 6. Environment variables

| Variable                                                           | Effect                                                                                                                                                      |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CAPRICORN_OLLAMA_HOST`, `OLLAMA_HOST`                             | Ollama endpoint (first one set wins). Only loopback unless you allow a remote host in user settings.                                                        |
| `CAPRICORN_MODEL`                                                  | Default model (below `--model`, above `model.name`). `GEMINI_MODEL` is ignored.                                                                             |
| `CAPRICORN_HOME`                                                   | Folder used instead of your home directory for `~/.capricorn`.                                                                                              |
| `CAPRICORN_SYSTEM_SETTINGS_PATH`, `CAPRICORN_SYSTEM_DEFAULTS_PATH` | Alternative system-wide settings files.                                                                                                                     |
| `CAPRICORN_EGRESS_REPORT=1`                                        | Prints every outbound connection Capricorn blocked.                                                                                                         |
| `GEMINI_CLI_TRUST_WORKSPACE=true`                                  | Trusts the current folder (like `--skip-trust`); needed for project-scope `mcp`/`skills` changes in scripts. Upstream name; there is no `CAPRICORN_` alias. |
| `GEMINI_SANDBOX`                                                   | Sandbox command override (upstream name).                                                                                                                   |
| `NO_COLOR`                                                         | No colours.                                                                                                                                                 |

`GEMINI_API_KEY`, `GOOGLE_API_KEY` and other Google variables are ignored.

---

## 7. Exit codes

`0` success · `1` failure (a check failed, model unavailable, task error) · `2`
usage or configuration error (e.g. invalid `config set` value, `sessions delete`
without `--yes` in a script) · `41` inference back-end error in headless mode ·
`42` no input in headless mode.

---

## 8. Not implemented

These upstream Gemini CLI commands were removed because they need Google
services or Google sign-in. Typing one sends the text to the model.

| Command                            | Upstream purpose                        | Status                                                                               |
| ---------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------ |
| `/auth`                            | Google sign-in                          | ❌ Not implemented                                                                   |
| `/bug`, `/bug-memory`              | File a bug on Google's tracker          | ❌ Not implemented                                                                   |
| `/docs`                            | Open the Gemini CLI website             | ❌ Not implemented                                                                   |
| `/ide`                             | IDE companion integration               | ❌ Not implemented                                                                   |
| `/privacy`                         | Google privacy notice and data settings | ❌ Not implemented                                                                   |
| `/setup-github`                    | GitHub Actions setup for Gemini         | ❌ Not implemented                                                                   |
| `/upgrade`                         | Gemini plan upgrade                     | ❌ Not implemented                                                                   |
| `/config`                          | Upstream config slash command           | ❌ Not implemented (use `capricorn config` or `/settings`)                           |
| Gemini models, API keys, Vertex AI | Hosted inference                        | ❌ Not implemented: Capricorn runs only verified Gemma 4 models through local Ollama |

---

## Fixed while writing this reference

Testing every command found four bugs, now fixed in the sources (they ship in
the next release after `0.1.0-alpha.9`):

1. **Headless plan mode was not read-only.** With `--approval-mode plan -p`,
   the model could call `exit_plan_mode`, which switched to YOLO, then edit
   files and run shell commands without approval (seen with `gemma4:e4b`). A
   headless plan run now stays read-only.
2. **Checkpointing broke startup** (`general.checkpointing.enabled`, needed by
   `/restore`): a dependency update (simple-git 4.0.2) rejected the git
   settings Capricorn uses for its snapshot repository.
3. **`capricorn mcp enable/disable` never found a server** (it read the wrong
   object) and exited `0` on errors.
4. **Leftover upstream wording:** the extension notice said "Google does not
   vet…", the folder-trust dialog said "allows Gemini to…", and `/mcp list`
   pointed to a `/docs` command that does not exist.
