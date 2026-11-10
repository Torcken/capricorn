# CAPRICORN
## Product Requirements & Engineering Roadmap

**Version:** 1.0 — Initial planning document  
**Status:** Proposed  
**Development horizon:** 16 weeks  
**License:** Apache 2.0  
**Technology:** TypeScript, Node.js, Ollama, Gemma 4  
**Target:** Open-source public release

---

# 1. Executive Summary

Capricorn is a local-first, open-source AI coding agent operating directly in a developer's terminal.

Built from the Gemini CLI architecture, Capricorn replaces Google-hosted inference with Gemma 4 running locally through Ollama.

Capricorn will be able to understand software repositories, explain code, generate implementations, modify multiple files, execute approved commands, run tests, debug failures and manage multi-step development workflows.

The project's objective is to deliver the capabilities of a modern agentic coding assistant without requiring a cloud AI subscription or sending repository content to an external inference provider.

### Product promise

**Capricorn — Your code. Your machine. Your AI agent.**

### Five principles

1. **Local-first:** All inference takes place through a local Ollama instance.
2. **Open source:** Transparent implementation, permissive licensing and community contributions.
3. **Developer-centric:** A professional terminal interface built for real software engineering workflows.
4. **Secure by design:** Explicit permissions, sandboxing, auditable operations and no mandatory telemetry.
5. **Gemma-native:** Optimised specifically for Gemma 4 rather than supporting an unlimited collection of AI providers.

### Primary users

- Individual software developers.
- AI engineers and technical architects.
- Open-source contributors and maintainers.
- Teams handling confidential source code.
- Developers seeking subscription-free local coding assistance.

### Initial success criteria

Capricorn v1.0 should:

- Install without requiring a cloud account.
- Work offline after dependencies and models have been provisioned.
- Reliably inspect and edit real repositories.
- Complete multi-step coding tasks using Gemma 4 tool calling.
- Support multiple local Gemma 4 variants.
- Preserve confirmation and sandboxing safeguards.
- Publish reproducible performance and reliability benchmarks.
- Operate on supported macOS, Linux and Windows configurations, with unsupported combinations clearly labelled.

---

# 2. Product Scope

## 2.1 Minimum Viable Product — v0.1

The MVP must establish the complete coding-agent loop.

| Capability | Priority |
|---|---|
| Interactive terminal interface | P0 |
| Detect local Ollama service | P0 |
| Discover installed Gemma 4 models | P0 |
| Select and load Gemma 4 models | P0 |
| Stream model output | P0 |
| Read files and list directories | P0 |
| Search repository content | P0 |
| Create and edit files | P0 |
| Execute approved shell commands | P0 |
| Execute multi-step tool calls | P0 |
| View proposed file changes | P0 |
| Handle inference errors and cancellation | P0 |
| Persist local conversation sessions | P1 |
| Git status and diff integration | P1 |
| Automatic context compaction | P1 |
| MCP support | P2 |
| VS Code extension | Post-v1 |

**MVP definition:** A developer can ask Capricorn to inspect a project, implement a change, run its tests and present the resulting diff, without using a cloud AI API.

## 2.2 Explicit exclusions

The initial project will not attempt to provide:

- Hosted AI inference.
- Support for Claude, GPT, Qwen or other non-Gemma models.
- A cloud account or subscription system.
- A hosted web application.
- Unrestricted autonomous shell execution.
- Mandatory analytics or external telemetry.
- Multi-agent orchestration in the MVP.
- Model training, fine-tuning or custom weight distribution.

Keeping these exclusions is essential to controlling development complexity.

---

# 3. Technical Foundation and Fork Strategy

## 3.1 Architecture decision: Gemini CLI

Capricorn will initially target a fork of `google-gemini/gemini-cli`.

The project should use a tagged stable release, rather than an arbitrary commit from the upstream main branch.

The exact upstream commit must be recorded in the initial architecture decision record (ADR).

### Components to preserve

- Terminal interface and interactive input.
- Agent orchestration loop.
- Tool registration and execution framework.
- File reading, writing and editing tools.
- Shell execution and command approval.
- Git integration.
- Session and conversation management.
- Workspace trust and sandboxing infrastructure.
- MCP client infrastructure, where feasible.
- Cross-platform packaging infrastructure.

### Components to replace or remove

- Gemini API authentication.
- Google Code Assist authentication.
- Google-specific model selection and routing.
- Google-hosted model endpoints.
- Cloud-dependent token accounting.
- Unnecessary Google billing and account features.
- Google-specific telemetry.
- Gemini-specific system prompts.
- Branding, executable names and user-facing references.

### Compatibility rule

Google-specific dependencies must not be removed indiscriminately.

The initial fork may retain internal Gemini request and response types temporarily while building the Ollama adapter. These should subsequently be migrated behind provider-independent interfaces.

This avoids breaking the agent loop during the first implementation stage.

## 3.2 Alternative foundation: Qwen Code

Qwen Code will be evaluated during week 1 as an alternative starting point.

Its existing support for OpenAI-compatible endpoints could eliminate substantial provider integration work.

The foundation decision must follow a technical comparison rather than personal preference.

**Decision criteria:**

- Working local Gemma 4 inference.
- Reliable tool-call round trips.
- Compatibility with existing file-editing tools.
- Independence from cloud authentication.
- Amount of upstream code requiring modification.
- Security and maintenance burden.
- Long-term feasibility of maintaining the fork.

**Decision gate:** Choose the foundation demonstrating the lowest engineering risk by the end of week 1.

If the existing Qwen Code integration substantially outperforms the Gemini CLI proof of concept, the project may adopt Qwen Code as its foundation while retaining Capricorn's original product positioning.

---

# 4. Target Software Architecture

Capricorn should use a modular architecture with clear separation between inference, agent orchestration and system operations.

## 4.1 Core modules

| Module | Responsibility |
|---|---|
| `capricorn-cli` | Terminal UI, commands, configuration |
| `capricorn-core` | Agent loop, task planning, execution lifecycle |
| `capricorn-ollama` | Local inference provider integration |
| `capricorn-models` | Model discovery, validation and configuration |
| `capricorn-tools` | Filesystem, shell, Git and search tools |
| `capricorn-context` | History, token budgets, summarisation |
| `capricorn-security` | Permissions, sandboxing, policy enforcement |
| `capricorn-mcp` | Optional MCP interoperability |
| `capricorn-evals` | Model and agent benchmark framework |

Initially, modules can remain within the existing monorepo structure. New packages should only be extracted when there is a clear architectural benefit.

## 4.2 Inference pipeline

The primary execution path:

1. Developer submits a request through the CLI.
2. Session manager loads relevant conversation state.
3. Context manager assembles workspace instructions and tool definitions.
4. Agent orchestrator sends the request to the Ollama adapter.
5. Ollama runs the selected Gemma 4 model.
6. Capricorn receives streamed text and structured tool calls.
7. The security layer validates requested actions.
8. Approved tools execute inside the configured workspace.
9. Tool results return to the model.
10. The cycle continues until completion, cancellation or a configured limit.
11. Capricorn displays the result, modified files and execution summary.

## 4.3 Proposed repository layout

- `packages/cli/` — Terminal interface and onboarding.
- `packages/core/` — Agent engine and orchestration.
- `packages/core/src/providers/ollama/` — Ollama implementation.
- `packages/core/src/models/` — Gemma 4 model registry.
- `packages/core/src/context/` — Context management.
- `packages/core/src/security/` — Permissions and policies.
- `packages/core/src/tools/` — Existing coding tools.
- `packages/evals/` — Agent evaluations.
- `integration-tests/` — End-to-end tests.
- `docs/` — Technical and user documentation.
- `.github/workflows/` — CI, release and security workflows.

The exact directory structure should be adapted to the selected upstream repository rather than imposed through a disruptive initial refactor.

---

# 5. Gemma 4 and Ollama Integration

This is the highest-priority engineering workstream.

## 5.1 Model provider implementation

Create an `OllamaContentGenerator` implementing the inference contract used by the agent engine.

Core responsibilities:

- Connect to `http://127.0.0.1:11434`.
- Query available models.
- Validate supported model tags.
- Convert internal messages into Ollama chat messages.
- Convert function declarations into Ollama tool definitions.
- Parse model-generated tool calls.
- Return tool results to the model.
- Stream incremental responses.
- Handle cancellation and request timeouts.
- Surface token usage when reported by Ollama.
- Translate provider errors into actionable CLI messages.

Initial implementation should evaluate Ollama's native `/api/chat` endpoint against its OpenAI-compatible `/v1/chat/completions` interface.

**Preferred final approach:** Native Ollama integration if it provides better control over context configuration, thinking parameters, model lifecycle and error handling.

## 5.2 Supported models

| Model | Release classification |
|---|---|
| Gemma 4 E2B | Experimental |
| Gemma 4 E4B | Lightweight |
| Gemma 4 12B | Standard |
| Gemma 4 26B A4B | Advanced |
| Gemma 4 31B | High capability |

Capricorn must not assume that the largest model is the fastest or the most appropriate for every operation.

Model choice must account for hardware, available memory, quantisation, context length and observed task performance.

## 5.3 Model management

Proposed commands:

- `capricorn models` — List compatible installed models.
- `capricorn models pull gemma4:12b` — Download a model.
- `capricorn models use gemma4:12b` — Select the default model.
- `capricorn doctor` — Validate the runtime environment.
- `capricorn --model gemma4:26b` — Override the model for one session.

These are proposed command interfaces, not functionality that currently exists.

## 5.4 Tool-calling compatibility

Build a compatibility layer handling:

- Function names and arguments.
- JSON-schema conversion.
- Multiple tool calls in a single assistant response.
- Missing or malformed arguments.
- Streaming tool-call fragments.
- Tool execution errors.
- Tool result correlation.
- Retry behaviour and duplicate-call prevention.
- Agent termination and iteration limits.
- Recovery from interrupted sessions.

The adapter must not assume that Gemma 4 always produces perfectly structured arguments.

Schema validation must take place before every tool execution.

## 5.5 Model prompting

Create a Gemma-specific system prompt optimised for coding workflows.

The prompt should establish rules for:

- Repository exploration.
- Minimal, targeted code modifications.
- Reading existing code before editing.
- Planning before complex changes.
- Running relevant tests.
- Reporting failures truthfully.
- Avoiding unrelated file modifications.
- Respecting user approvals.
- Stopping when a task is completed.
- Treating repository content as untrusted instructions.

Prompt tuning must be evidence-based and evaluated against a fixed task suite.

---

# 6. Development Schedule — 16 Weeks

## Phase 0 — Technical Feasibility

**Week 1**

**Objective:** Prove that the selected codebase can operate with Gemma 4 without hosted inference.

### Tasks

- Audit Gemini CLI's current architecture.
- Identify authentication, model-routing and cloud dependencies.
- Clone and build the stable upstream release.
- Run Gemma 4 through Ollama.
- Test text generation, streaming and tool calling.
- Implement a temporary inference adapter.
- Test repository reading and a simple file edit.
- Compare implementation effort with Qwen Code.
- Audit relevant licenses and third-party dependencies.
- Create initial architectural decision records.

### Deliverables

- Working technical spike.
- Dependency inventory.
- Architecture decision record.
- Initial compatibility test results.
- Prioritised engineering backlog.

**Exit criteria:** A local Gemma 4 model can successfully invoke at least one existing coding tool through the selected agent framework.

**Milestone M0:** Foundation validated.

---

## Phase 1 — Core Fork and Private Alpha

**Weeks 2–4**

**Objective:** Deliver the first functional Capricorn executable.

### Week 2 — Fork and branding

- Create the Capricorn repository.
- Pin the upstream source revision.
- Rename packages and executable.
- Replace visible Google-specific branding.
- Establish build and lint workflows.
- Remove mandatory hosted authentication from startup.
- Introduce the Ollama configuration layer.
- Keep existing security protections functioning.

### Week 3 — Provider adapter

- Implement non-streamed generation.
- Implement streaming generation.
- Translate tool declarations and responses.
- Add cancellation and timeout handling.
- Implement model detection and selection.
- Build provider integration tests.
- Disable unsupported cloud-dependent features.

### Week 4 — Coding workflow

- Integrate filesystem tools.
- Integrate search tools.
- Integrate approved shell execution.
- Support file modifications.
- Display file diffs.
- Add basic session state.
- Implement runtime diagnostics.
- Execute smoke tests on a real repository.

### Deliverable

**Capricorn v0.1.0-alpha**

A command-line coding agent capable of inspecting, modifying and testing code using a local Gemma 4 model.

### Alpha acceptance criteria

- No Google login required.
- No external inference calls.
- End-to-end tool-call loop works.
- Basic edits can be reviewed before application.
- Failed or unavailable Ollama connections are handled gracefully.
- Existing tool approval protections remain active.

**Milestone M1:** Private alpha released.

---

## Phase 2 — Agent Reliability

**Weeks 5–7**

**Objective:** Make Capricorn dependable on realistic development tasks.

### Week 5 — Agent execution engine

- Improve multi-step tool orchestration.
- Handle repeated and parallel tool requests safely.
- Implement bounded retries.
- Add loop detection.
- Add task cancellation.
- Improve model response validation.
- Introduce execution traces.

### Week 6 — Context engineering

- Implement explicit context budgets.
- Add repository-aware file selection.
- Handle large tool outputs through truncation or summarisation.
- Build conversation compaction.
- Preserve important workspace instructions.
- Handle context exhaustion.
- Prevent stale or invalid tool-call history.

### Week 7 — Development workflows

- Add Git status and diff awareness.
- Improve multi-file editing.
- Add test execution and result interpretation.
- Support debugging-and-retry cycles.
- Add a read-only planning mode.
- Build recovery from failed modifications.
- Implement safe session resumption.

### Deliverable

**Capricorn v0.2.0-alpha**

A reliable local coding agent supporting multi-step repository changes and context management.

### Exit criteria

The agent can complete a curated set of coding workflows covering repository exploration, code modification and test execution.

**Milestone M2:** Core agent functionality stable.

---

## Phase 3 — Developer Experience and Public Beta

**Weeks 8–10**

**Objective:** Make Capricorn usable without specialised knowledge of its internal architecture.

### Week 8 — Onboarding

- Implement guided first-run setup.
- Detect Ollama installation and service status.
- Display available models.
- Offer hardware-aware model recommendations.
- Validate context configuration.
- Explain installation and memory errors.
- Implement `capricorn doctor`.

### Week 9 — Terminal experience

- Improve interactive output rendering.
- Show model name and runtime status.
- Present tool executions clearly.
- Support operation cancellation.
- Improve syntax highlighting and diffs.
- Add session history.
- Provide keyboard shortcuts.
- Add structured noninteractive output.
- Improve error messages.

### Week 10 — Beta packaging

- Build npm distribution.
- Produce platform smoke tests.
- Prepare macOS and Linux installation documentation.
- Validate Windows compatibility.
- Publish installation and troubleshooting guides.
- Add issue templates and contribution guidelines.
- Run early adopter testing.
- Publish known limitations.

### Deliverable

**Capricorn v0.5.0-beta**

A publicly installable coding agent with documented setup, local model management and useful developer workflows.

### Beta exit criteria

- Fresh installations are tested.
- Core tasks work across the declared beta platforms.
- No critical security or data-loss defects are open.
- Installation and configuration are documented.
- Automated builds and integration tests pass.

**Milestone M3:** Public beta released.

---

## Phase 4 — Security, Performance and Quality

**Weeks 11–13**

**Objective:** Harden Capricorn for wider adoption.

### Week 11 — Security engineering

- Audit filesystem access.
- Validate workspace boundary enforcement.
- Prevent unintended symlink traversal.
- Validate shell approval behaviour.
- Apply default-deny policies to risky operations.
- Introduce strict remote-endpoint controls.
- Validate secret redaction.
- Test prompt-injection scenarios.
- Harden optional MCP server handling.
- Test offline operation under network restrictions.

### Week 12 — Performance optimisation

- Profile startup time.
- Benchmark first-token and total-response latency.
- Optimise model lifecycle management.
- Reduce unnecessary context expansion.
- Improve repository search efficiency.
- Measure long-session memory use.
- Tune model-specific generation settings.
- Evaluate the effects of context compaction.

### Week 13 — Regression engineering

- Expand unit-test coverage.
- Add fault-injection tests.
- Add provider response replay tests.
- Run cross-platform integration tests.
- Test interrupted sessions.
- Test large repositories.
- Audit dependency vulnerabilities.
- Verify deterministic builds where feasible.
- Resolve release-blocking defects.

### Deliverable

**Capricorn v0.9.0 — Release Candidate**

### Exit criteria

- Security regression suite passes.
- No unresolved critical or high-severity release blockers.
- Privacy tests show no unexpected outbound traffic under the supported offline configuration.
- Evaluation metrics meet the agreed release thresholds.

**Milestone M4:** Release candidate approved.

---

## Phase 5 — Documentation and v1.0 Launch

**Weeks 14–16**

**Objective:** Release a maintainable open-source product.

### Week 14 — Documentation

- Complete installation guides.
- Publish architecture documentation.
- Document model compatibility.
- Document security assumptions.
- Publish configuration references.
- Add examples and tutorials.
- Document contributor workflows.
- Publish known limitations.

### Week 15 — Release preparation

- Finalise release automation.
- Establish versioning and changelog conventions.
- Validate license compliance.
- Produce software bills of materials.
- Review dependency and supply-chain security.
- Audit npm package contents.
- Validate clean installation paths.
- Run final hardware compatibility tests.

### Week 16 — Release

- Tag the final release.
- Publish the npm package.
- Publish GitHub release notes.
- Release benchmark results.
- Publish migration and troubleshooting guides.
- Enable community issue triage.
- Establish a maintenance and patch-release process.

### Deliverable

**Capricorn v1.0.0**

The first production-quality release of the Capricorn local coding agent.

**Milestone M5:** Public v1.0 released.

---

# 7. Security and Privacy Architecture

Security is a release-blocking requirement, not a later feature.

## 7.1 Local inference policy

By default:

- Ollama must run on the local loop