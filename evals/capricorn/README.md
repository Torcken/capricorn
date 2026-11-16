# Capricorn eval suite

Behavioural evals for Capricorn with real local Gemma 4 models. They measure
whether the _model + prompt + tools_ combination gets real coding work done, and
whether the model tries unsafe things. Use them before and after changing the
system prompt, tool descriptions, context sizing or defaults.

The upstream Gemini CLI evals in the parent `evals/` directory target Gemini
models and Gemini-specific features. They are kept, but they are not adapted to
Capricorn.

## Running

```bash
npm run build                                   # the suite drives packages/cli/dist
npm run eval:capricorn -- --list                # show tasks
npm run eval:capricorn -- --model gemma4:12b --repeat 3
npm run eval:capricorn -- --model gemma4:12b,gemma4:e4b --category test-fix
npm run eval:capricorn -- --task testfix-off-by-one --keep   # keep workspaces
npm run eval:capricorn -- --num-ctx 8192        # context pressure: forces compression
```

Options: `--model` (comma-separated), `--repeat N`, `--task <substring,…>`,
`--category explore|edit|test-fix|tool-use|safety|context`, `--host` (default
`127.0.0.1:11434`), `--cli <entry>` (e.g. `bundle/capricorn.js`), `--out <dir>`,
`--keep`, `--num-ctx N` (context window for the run, written to the isolated
home's settings; at least 8192).

Each run writes `results/<timestamp>.json` (every run, including tool calls and
failure details) and `results/<timestamp>.md` (summary); `results/` is
git-ignored. Curated results are published in [RESULTS.md](RESULTS.md).

Runs are sequential (Ollama serves one request at a time by default). Expect
roughly 15–90 s per task on `gemma4:12b` with a fast CPU or a GPU.

## What a run looks like

For each task and attempt the runner:

1. creates a fresh git repository with the fixture files (one commit) and an
   empty, isolated `HOME`, so nothing from your own Capricorn settings, history
   or credentials is involved;
2. runs
   `capricorn --skip-trust --model <tag> --output-format stream-json <task flags> -p <prompt>`
   with a time limit (default 5 minutes);
3. parses the event stream (assistant text, every tool call and its result,
   token statistics);
4. runs the task's checker, which judges **outcomes**: file contents, hidden
   tests written after the run, `git diff`/`git status`, and the answer text. It
   never relies on the model saying it succeeded.

## Tasks

| Category | What it measures                                                                                                                                |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| explore  | answers that require reading files (layered config, real caller vs decoy, admitting a function doesn't exist)                                   |
| edit     | cross-file rename, adding a parameter without collateral changes, a one-line fix in a larger file; running the project's own lint script        |
| test-fix | make failing tests pass without editing the tests, verified by a hidden test (no special-casing); one project whose tests only `npm test` finds |
| tool-use | create a module + test from a spec; exhaustive count across files                                                                               |
| safety   | prompt injection in a README, a secret outside the workspace, an unapproved delete with honest reporting                                        |
| context  | keep an early requirement and a detail from a long read through compression (use `--num-ctx 8192`)                                              |

Safety tasks fail if the harm happened **or the model attempted it**. Capricorn
blocks these actions anyway, but an attempt shows how the model would behave
under a more permissive configuration (YOLO, broad allowlists).

## Keeping the suite honest

- `e2e/evals-tasks.e2e.test.ts` checks every task without a model: it must pass
  with a reference solution and fail with a realistic bad one (cheating fix,
  hallucinated answer, collateral edit, leaked secret), and test-fix fixtures
  must really fail before the fix.
- `e2e/evals-runner.e2e.test.ts` drives the real CLI against the mock daemon to
  check the runner, the stream parsing and the checkers end to end.

Both run in `npm run test:e2e:capricorn`.

## Adding a task

Add a `defineTask({...})` to the matching `tasks/*.task.ts` file. Keep the
fixture to a few files, make the prompt something a user would type, and judge
the outcome (hidden tests, diffs), not the wording. Add good and bad reference
cases to `e2e/evals-tasks.e2e.test.ts`; the suite fails until you do.

## Reading results

Model output is non-deterministic. Compare pass rates over `--repeat 3` or more,
on the same machine and model digest (both are recorded in the report). A single
failure is a signal to look at the run, not proof of a regression.
