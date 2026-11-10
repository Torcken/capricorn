# Example prompts

Tasks that work well with a local Gemma 4 model. Be specific: name files,
commands and the result you expect.

## Understand

- `Explain what src/parser.ts does, then list its exported functions.`
- `Find where configuration is loaded and summarize the precedence rules.`
- `Which tests cover the retry logic? Show the file and test names.`

## Change

- `The add function in math.js returns the wrong result. Fix it with a minimal edit, then run "npm test" and report the result.`
- `Rename the function fetchUser to loadUser in src/ and update its callers. Show the diff when done.`
- `Add input validation to createUser in src/users.ts: reject empty names with a descriptive error. Add a unit test.`

## Investigate failures

- `Run "npm test", read the first failure, find the cause and propose a fix. Do not change files yet.`
- `The build fails with "Cannot find module './config'". Investigate and explain the cause.`

## Headless (scripts / CI)

```bash
capricorn run "Summarize the changes in the last commit" --approval-mode plan
capricorn run "Fix the lint errors in src/utils.ts" --approval-mode auto_edit
capricorn run "Run the tests and fix any failure" \
  --approval-mode auto_edit --allowed-tools "run_shell_command(npm test)"
```

Headless runs cannot ask for approval: without `--approval-mode auto_edit` or an
allowlist they only have read-only tools.
