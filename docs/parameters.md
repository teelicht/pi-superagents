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
| `context`         | `"fresh" \| "fork"`                     | `"fresh"`                 | Execution context mode. `"fork"` branches from the current parent session. |
| `cwd`             | string                                  | parent cwd                | Working directory for the subagent. |
| `skill`           | `string \| string[] \| false`           | agent default             | Skills to inject into the agent prompt. `false` disables all skills. |
| `model`           | string                                  | agent default             | Override the model for this specific run. Can be a concrete ID or a tier name (`cheap`, `balanced`, `max`). |
| `artifacts`       | boolean                                 | `true`                    | Whether to write debug artifacts (input/output logs). |
| `includeProgress` | boolean                                 | `false`                   | Whether to include full internal progress metadata in the result. |

Resolved skills, including per-call `skill` overrides and configured overlays, are shown in `/subagents-status` for active and recent subagent runs. Missing skills are shown as warnings there.

Subagent output is inline: the child Pi process streams assistant text back through the `subagent` tool result. The tool does not accept an output-file parameter and does not instruct Superpowers roles to write repo-root report files.

### TaskItem (for parallel tasks)

| Field   | Type    | Description |
| ------- | ------- | ----------- |
| `agent` | string  | Role agent name. |
| `task`  | string  | Task description. |
| `cwd`   | string  | Optional directory override for this specific parallel task. |
| `model` | string  | Optional model/tier override for this task. |
| `skill` | mixed   | Optional skill override for this task. |

## Context: Fork

`context: "fork"` branches the session from the current parent state. This allows the subagent to "see" the prior conversation history as read-only context while working in its own isolated branch. This is highly recommended for complex tasks where the subagent needs the full background of the current session.

## Artifacts

When `artifacts` is enabled, Pi Superagents stores debugging input, output, JSONL, and metadata files in the session artifact directory. These artifacts are separate from the repository working tree and replace the older file-handoff pattern that wrote `implementer-report.md`, `spec-review.md`, or `code-review.md` into the project root.

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
