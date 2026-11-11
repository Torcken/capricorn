# Commands

## Command line

```text
capricorn [query..]                Start an interactive session (optional first prompt)
capricorn -p "<task>"              Headless: run one task and exit
capricorn run "<task>"             Same as -p (also: capricorn run --prompt "<task>")
capricorn --help | --version
```

Common options (all commands): `-m, --model <tag>`,
`--approval-mode default|auto_edit|plan|yolo`, `--sandbox`, `--skip-trust`,
`-r, --resume <id|latest>`, `-o, --output-format text|json|stream-json`,
`-d, --debug`. `capricorn --help` lists every option.

### Diagnostics and status

| Command                                              | Description                                                                                                                                                                                                                                                                                                                                                                           | Exit code               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `capricorn doctor [--json] [--model <tag>] [--load]` | Checks Node.js, memory, endpoint policy, Ollama daemon/version, installed Gemma 4 models, the selected model, context window, network policy, state directory, workspace, git and ripgrep. `--load` also loads the selected model once with the configured `num_ctx` (check `models.load`), which catches models Ollama cannot run or that do not fit in memory; it can take minutes. | `0` ready, `1` problems |
| `capricorn status [--json]`                          | Effective model and its source, Ollama endpoint, context, project/trust, approval mode, sandbox, currently loaded models.                                                                                                                                                                                                                                                             | `0`                     |

`--json` prints one JSON document on stdout and nothing else.

### Models

| Command                                  | Description                                                                                                                                                |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `capricorn models list [--all] [--json]` | Installed models that pass Gemma 4 verification (`*` = selected). `--all` also lists rejected models with the reason.                                      |
| `capricorn models info <tag> [--json]`   | Verdict, architecture, parameters, quantization, maximum context, capabilities. Exit `1` if not usable.                                                    |
| `capricorn models pull <tag>`            | Downloads a Gemma 4 model through Ollama with progress (Ctrl+C cancels). Non-Gemma tags are refused before downloading; the result is verified afterwards. |
| `capricorn models use <tag>`             | Verifies the model and saves it as `model.name` in user settings.                                                                                          |

### Configuration

| Command                                                        | Description                                                                                                                    |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `capricorn config list [--json]`                               | Effective merged settings, secrets redacted.                                                                                   |
| `capricorn config get <key>`                                   | One effective value (dotted key, e.g. `ollama.numCtx`).                                                                        |
| `capricorn config set <key> <value> [--scope user\|workspace]` | Validates the value against the schema and writes it. Security-sensitive keys are user-scope only. Exit `2` on invalid input.  |
| `capricorn init [--force]`                                     | Creates `CAPRICORN.md` and `.capricorn/settings.json`. Never overwrites without `--force`; `--force` keeps `CAPRICORN.md.bak`. |

### Sessions

| Command                                         | Description                                                                 |
| ----------------------------------------------- | --------------------------------------------------------------------------- |
| `capricorn sessions list`                       | Sessions for the current project (index, title, age, id).                   |
| `capricorn sessions resume <id\|index\|latest>` | Resume a session (interactive, or combine with `-p`).                       |
| `capricorn sessions delete <id\|index> [--yes]` | Delete a session. Asks for confirmation; without a TTY `--yes` is required. |

Upstream flags remain available: `--list-sessions`, `--resume`,
`--delete-session`.

### Retained upstream commands

`capricorn mcp …`, `capricorn extensions …`, `capricorn skills …`,
`capricorn hooks …` manage MCP servers, extensions (local path or git URL; no
hosted gallery), agent skills and hooks.

### Exit codes

`0` success · `1` failure (check failed, model unavailable, task error) · `2`
usage or configuration error · `41` inference back-end/configuration error in
headless mode · `42` no input provided in headless mode.

## In-session slash commands

| Command                      | Description                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| `/help`                      | Help and shortcuts.                                                                |
| `/model [<tag> [--persist]]` | List local Gemma 4 models or switch (verified first). `/model list`, `/model set`. |
| `/stats`                     | Session statistics, including token usage reported by Ollama.                      |
| `/clear`                     | Clear the screen and conversation.                                                 |
| `/compress`                  | Summarize the conversation with the local model to free context.                   |
| `/memory list\|reload\|show` | Project instruction files (`CAPRICORN.md`).                                        |
| `/permissions`               | Folder trust.                                                                      |
| `/policies`                  | Show active approval policies.                                                     |
| `/tools [desc]`              | Available tools.                                                                   |
| `/mcp`                       | MCP server status.                                                                 |
| `/chat`, `/resume`           | Save, list and resume conversation checkpoints.                                    |
| `/restore`                   | Restore files from a checkpoint (when checkpointing is enabled).                   |
| `/init`                      | Ask the model to analyze the project and draft `CAPRICORN.md`.                     |
| `/settings`                  | Settings dialog.                                                                   |
| `/theme`, `/editor`, `/vim`  | UI preferences.                                                                    |
| `/quit`                      | Exit.                                                                              |

The exact list depends on settings (e.g. `/agents` appears only with sub-agents
enabled). `/help` shows the commands available in your session.

## Keyboard shortcuts

- **Enter** send · **Ctrl+C** cancel the running request; press twice on an
  empty prompt to exit · **Esc** cancel the current request or dialog
- **Shift+Tab** cycle approval mode (default → auto-edit → plan)
- **↑ / ↓** input history
- **?** on an empty prompt shows all shortcuts
