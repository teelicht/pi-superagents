# Parameters API Reference

These are the parameters the **LLM agent** passes when it calls the `subagent` tool. These parameters are used to delegate work to Superpowers role agents.

## Tool Parameters

| Param             | Type                                    | Default                   | Description                                                                                                                                                        |
| ----------------- | --------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `agent`           | string                                  | -                         | Name of the role agent (e.g., `sp-recon`, `sp-implementer`). Used for single-agent delegation. |
| `task`            | string                                  | -                         | The specific task for the role agent to execute. |
| `tasks`           | `TaskItem[]`                            | -                         | Array of tasks for parallel execution. Each item must specify `agent` and `task`. |
| `workflow`        | `"superpowers"`                         | `"superpowers"`           | Explicitly marks the run as a Superpowers workflow. Only `superpowers` is supported. |
| `useTestDrivenDevelopment` | boolean                        | config-derived, usually `true` | Enables test-driven development guidance for `sp-implementer` tasks. |
| `sessionMode`     | `"standalone" \| "lineage-only" \| "fork"` | `"lineage-only"` (bounded roles) | Child session visibility mode. `lineage-only` links to parent session tree without inheriting conversation turns; `fork` inherits full parent history; `standalone` is fully isolated. |
| `cwd`             | string                                  | parent cwd                | Working directory for the subagent. |
| `skill`           | `string \| string[] \| false`           | agent default             | Skills to inject into the agent prompt. `false` disables all skills. |
| `model`           | string                                  | agent default             | Override the model for this specific run. Can be a concrete ID or a tier name (`cheap`, `balanced`, `max`). |
| `artifacts`       | boolean                                 | `true`                    | Whether to write debug artifacts (input/output logs). |
| `includeProgress` | boolean                                 | `false`                   | Whether to include full internal progress metadata in the result. |

Resolved skills, including per-call `skill` overrides and configured overlays, are shown in `/subagents-status` for active and recent subagent runs. Missing skills are shown as warnings there.

Provide either `agent` plus `task` for a single delegation, or `tasks` for parallel delegation. The runtime validates this selector after Pi accepts the tool call; the machine-readable schema stays intentionally simple for host compatibility.

Subagent output is inline: the child Pi process streams assistant text back through the `subagent` tool result. The tool does not accept an output-file parameter and does not instruct Superpowers roles to write repo-root report files.

### TaskItem (for parallel tasks)

| Field   | Type    | Description |
| ------- | ------- | ----------- |
| `agent` | string  | Role agent name. |
| `task`  | string  | Task description. |
| `cwd`   | string  | Optional directory override for this specific parallel task. |
| `model` | string  | Optional model/tier override for this task. |
| `skill` | mixed   | Optional skill override for this task. |

## Session Mode

`sessionMode` controls how much of the parent session the subagent receives:

- **`lineage-only`** (default for bounded roles): The child session is linked to the parent for `/tree` visibility, but it does not inherit parent conversation turns. The child receives a curated work-brief packet instead. This is the recommended default for bounded Superpowers roles.
- **`fork`**: The child inherits the full parent conversation history as read-only context, working in its own isolated branch. Useful when the subagent genuinely needs the full session background.
- **`standalone`**: Fully isolated session with no parent linkage or inherited context.

## Artifacts

When `artifacts` is enabled, Pi Superagents stores debugging input, output, JSONL, and metadata files in the session artifact directory. These artifacts are separate from the repository working tree and replace the older file-handoff pattern that wrote `implementer-report.md`, `spec-review.md`, or `code-review.md` into the project root.

Work briefs for bounded roles are also delivered as packet files under `<session-artifacts-dir>/packets/`. The runtime creates these packets before launching the child, passes the packet path to the child as its input brief, and cleans them up automatically when the child exits.

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

`/sp-settings` opens the Superpowers settings overlay. Use it to toggle supported workflow options and edit model tiers from PI's authenticated model list. Model tier edits are persisted to `config.json` and apply to future subagents in the current session.

## Result Rendering

Subagent tool results are rendered inline in the Pi conversation. The renderer produces compact, width-bounded text lines:

- **Collapsed**: status line, task name, current tool activity, and timing stats.
- **Expanded**: model, skills, recent tools, bounded output preview, errors, session file, and artifact paths.

This applies to both single and parallel subagent executions. Use `/subagents-status` for a dedicated overlay of active and recent runs.

## Release Notes

Tool parameter changes can affect prompts, docs, and downstream workflows. Before publishing a version that adds, removes, or changes a parameter, update this reference, `README.md`, and `CHANGELOG.md`, then follow the [Release Process](releases.md).
