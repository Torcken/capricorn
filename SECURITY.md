# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report vulnerabilities privately through the repository's **"Report a
vulnerability"** button (GitHub private vulnerability reporting, under the
_Security_ tab). Include:

- the Capricorn version (`capricorn --version`) and platform;
- the Ollama version and model tag;
- steps to reproduce, and what an attacker gains;
- whether the issue requires an approved action, a trusted folder, YOLO mode or
  a specific setting.

We aim to acknowledge reports within 7 days and to agree on a disclosure
timeline with you. Capricorn is maintained by volunteers; there is no bug
bounty.

> Note for maintainers: private vulnerability reporting must be enabled in the
> repository settings before the first public release (see
> docs/RELEASE_CHECKLIST.md).

## Scope

In scope: anything that lets content the user did not approve cause an action
(file write, command, network request), bypasses workspace or network policy,
routes inference to a non-local or non-Gemma-4 model without the documented
opt-ins, or leaks local data.

Out of scope: a model giving wrong answers; actions the user explicitly approved
or pre-approved (YOLO, allowlists); upstream Gemini CLI issues that do not
affect Capricorn (report those to Google).

Capricorn's threat model, controls and known limits are documented in
[docs/SECURITY.md](docs/SECURITY.md).

## Supported versions

Only the latest release receives security fixes during the 0.x series.
