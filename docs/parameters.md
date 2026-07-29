# Parameters API Reference

These are the parameters the **LLM agent** passes when it calls the `subagent` tool. These parameters are used to delegate work to Superpowers role agents.

This reference targets Pi `^0.82.1`.

These parameters apply after explicit Superpowers activation. The default `superagents.makeSuperpowersSkillsOptInOnly: true` setting keeps ordinary Pi requests outside the Superpowers workflow, including when the upstream obra/superpowers Pi package is installed.

Maintenance note: static analysis runs with `pnpm exec fallow`; keep documented tool parameters and shared parameter types exported only when they are part of runtime or test-facing API.

## Tool Parameters

| Param             | Type                                    | Default                   | Description |
| ----------------- | --------------------------------------- | ------------------------- | ----------- |
| `agent`           | string                                  | -                         | Name of the role agent (e.g., `sp-recon`, `sp-implementer`). Used for single-agent delegation. |
| `task`            | string                                  | -                         | The specific task for the role agent to execute. |
| `tasks`           | `TaskItem[]`                            | -                         | Array of tasks for parallel execution. Each item must specify `agent` and `task`. |
| `workflow`        | `"superpowers"`                         | `"superpowers"`           | Explicitly marks the run as a Superpowers workflow. Only `superpowers` is supported. |
| `useTestDrivenDevelopment` | boolean                        | explicit root prompt value; omitted direct tool calls default to `false` | Enables test-driven development guidance for `sp-implementer` tasks. Root Superpowers prompts instruct agents to pass the resolved command value explicitly. |
| `sessionMode`     | `"standalone" \| "lineage-only" \| "fork"` | `"lineage-only"` (bounded roles) | Child session visibility mode. `lineage-only` links to parent session tree without inheriting conversation turns; `fork` inherits full parent history; `standalone` is fully isolated. |
| `cwd`             | string                                  | parent cwd                | Working directory for the subagent. |
| `skill`           | `string \| string[] \| false`           | agent default             | Skills to inject into the agent prompt. `false` disables all skills. |
| `model`           | string                                  | agent default             | Override the model for this specific run. Can be a concrete ID or a tier name (`cheap`, `balanced`, `max`). |
| `resumeSession`   | string                                  | -                         | Absolute path to a prior pi-superagents `lineage-only` `sp-implementer` session JSONL file in the current parent lineage, continued synchronously. See [Resuming a Superpowers implementer session](#resuming-a-superpowers-implementer-session). |
| `artifacts`       | boolean                                 | `true`                    | Whether to write debug artifacts (input/output logs). |
| `includeProgress` | boolean                                 | `false`                   | Whether to include full internal progress metadata in the result. |

### No Async, Wait, Collect, or Cancel Parameters

Execution is strictly synchronous and blocking. The `subagent` tool does not accept `async`, `wait`, `collect`, or `cancel` parameters. The tool does not return until the child Pi process completes.

The runtime may attach additive completion metadata to results. The child's normal answer remains available as text; the envelope only adds `status`, `summary`, optional `parentRequest`, and optional artifact references for parent orchestration.

Runtime-confirmed models, effective thinking levels, and resolved skills are shown in inline subagent rows/details and `/subagents-status` for active and recent subagent runs. Missing skills are shown as warnings there. The bundled `sp-debug` role resolves `systematic-debugging` from its frontmatter unless a call overrides or disables skills.

Provide either `agent` plus `task` for a single delegation, or `tasks` for parallel delegation. The runtime validates this selector after Pi accepts the tool call; the machine-readable schema stays intentionally simple for host compatibility.

Subagent output is inline: the child Pi process streams assistant text back through the `subagent` tool result. The tool does not accept an output-file parameter and does not instruct Superpowers roles to write repo-root report files.

> **Note:** The `subagent` tool does not accept ad-hoc extension paths at call time. Extension loading for child Pi processes is controlled through `superagents.extensions` in the global config and the `extensions` field in agent frontmatter (additive to the global list). Shared child tools are controlled through `superagents.tools`, which appends tool names or tool extension paths to every subagent after role-specific policy. Implicit Pi extension discovery is disabled by default; only configured extensions load. Pi agent extensions and project agent frontmatter `extensions:` are subject to [Project Trust](configuration.md#project-trust).

### TaskItem (for parallel tasks)

| Field   | Type    | Description |
| ------- | ------- | ----------- |
| `agent` | string  | Role agent name. |
| `task`  | string  | Task description. |
| `cwd`   | string  | Optional directory override for this specific parallel task. |
| `model` | string  | Optional model/tier override for this task. |
| `skill` | mixed   | Optional skill override for this task. |
| `resumeSession` | string | Optional `sp-implementer` lineage-only session file to continue. See [Resuming a Superpowers implementer session](#resuming-a-superpowers-implementer-session). Each `resumeSession` may appear at most once per `tasks[]` array. |

## Session Mode

`sessionMode` controls how much of the parent session the subagent receives:

- **`lineage-only`** (default for bounded roles): The child session is linked to the parent for `/tree` visibility, but it does not inherit parent conversation turns. The child receives a curated work-brief packet instead. This is the recommended default for bounded Superpowers roles.
- **`fork`**: The child inherits the full parent conversation history as read-only context, working in its own isolated branch. Useful when the subagent genuinely needs the full session background.
- **`standalone`**: Fully isolated session with no parent linkage or inherited context.

## Resuming a Superpowers implementer session

`resumeSession` continues a prior `sp-implementer` session synchronously inside the current Superpowers run. The runtime re-launches the existing JSONL session file rather than starting a fresh `sp-implementer` run, so the resumed child sees its prior turns and tools.

The parameter is intentionally narrow:

- **Synchronous only.** The `subagent` tool does not accept `async`, `wait`, or `collect`; `resumeSession` runs the resumed child in the same blocking call.
- **Implementer-only.** `resumeSession` is only valid when `agent` (top-level) or `tasks[i].agent` is `sp-implementer`. The runtime rejects other agents with an explicit error.
- **Lineage-only.** The resumed session file must have been launched with `sessionMode: "lineage-only"`. `standalone` and `fork` files are rejected.
- **Owner-checked.** The session file must have been written by pi-superagents. The runtime checks the session header's `piSuperagents` marker for `owner: "pi-superagents"`, `agent: "sp-implementer"`, and `sessionMode: "lineage-only"`.
- **Lineage-checked.** The session file's `parentSession` must match the absolute path of the current parent session file, so the resumed child links back into the same parent lineage.
- **cwd-checked.** The session file's `cwd` must equal the resolved `cwd` for the current dispatch. The fix dispatch must run in the original worktree so the implementer sees the same files the reviewer reviewed.
- **Active-use protected.** The runtime tracks resumed session files in a per-run set. Each path may appear at most once across the top-level `resumeSession` and `tasks[].resumeSession` entries; reusing a resumed file inside the same parallel request or across nested runs is rejected so two in-flight calls never share one session.

Top-level `resumeSession` is only valid for single-agent `subagent` calls. Parallel `tasks[]` requests must place `resumeSession` on the specific `tasks[i]` entry, and that array may include at most one resumed implementer at a time.

Typical use: `/sp-implement-parallel` dispatches `sp-implementer` with `resumeSession` for fix loops on a single Task without spinning up a new session. See [Skills Reference](skills.md#parallel-sdd-task-scheduling) for the dispatch contract.

Install upgrades also retire legacy `sp-spec-review` and `sp-code-review`
agents. Review dispatches should use the bundled consolidated `sp-review` role
for both task and branch scopes.

## Lifecycle Signals (Internal)

Child processes can emit lifecycle signals (`subagent_done`, `caller_ping`) through internal tools registered through the tool policy. These tools are for bounded role completion signaling and parent request handling; they are not general-purpose delegation tools. Lifecycle signals are consumed by the parent after the child exits.

## Artifacts

When `artifacts` is enabled, Pi Superagents stores debugging input, output, JSONL, and metadata files in the session artifact directory. These artifacts are separate from the repository working tree and replace the older file-handoff pattern that wrote `implementer-report.md`, `spec-review.md`, or `code-review.md` into the project root.

Work briefs for bounded roles are delivered as packet files under `<session-artifacts-dir>/packets/`. The runtime creates these packets before launching the child, passes the packet path to the child as its prompt, and cleans them up automatically when the child exits. The packet carries the controller's dispatch text — including the file-handoff paths (`task-<N>-brief.md`, `task-<N>-report.md`, `review-<…>.diff`) authored by the `subagent-driven-development` skill's scripts under `.superpowers/sdd/` — so bounded role agents read the same files the upstream skill scripts produce. The skill scripts (not the extension) are the source of those files; the extension just hands the child the paths and reads the report back.

## Review Bridge Tools

These tools are registered for root Superpowers workflows and are used by the prompt contract when Plannotator review is enabled. They are not general-purpose delegation tools.

### `superpowers_plan_review`

| Param | Type | Description |
| ----- | ---- | ----------- |
| `planContent` | string | Final Superpowers implementation plan content to review. |
| `planFilePath` | string, optional | Saved plan file path. |

### `superpowers_spec_review`

| Param | Type | Description |
| ----- | ---- | ----------- |
| `specContent` | string | Final saved Superpowers brainstorming spec content to review. |
| `specFilePath` | string, optional | Saved spec file path. |

## Settings Overlay

`/sp-settings` opens the Superpowers settings overlay. Use `c` to select a command, then toggle supported workflow options for that command or edit model tiers from PI's authenticated model list. The model picker supports type-to-search filtering, including `q`, scrolls keyboard selection through the full filtered model list, and then prompts for the tier thinking level. Model tier edits are persisted to `config.json` and apply to future subagents in the current session.

## Result Rendering

Subagent tool results are rendered inline in the Pi conversation. The renderer produces compact, width-bounded text lines:

- **Collapsed**: status line plus per-subagent rows with agent, compact runtime-confirmed model label, task name, current tool activity, and timing stats.
- **Expanded**: runtime-confirmed model, thinking level when available, skills, recent tools, bounded output preview, errors, session file, and artifact paths.

This applies to both single and parallel subagent executions. Use `/subagents-status` for a dedicated overlay of active and recent runs.

## Release Notes

Tool parameter changes can affect prompts, docs, and downstream workflows. Before publishing a version that adds, removes, or changes a parameter, update this reference, `README.md`, and `CHANGELOG.md`, then follow the [Release Process](releases.md).
