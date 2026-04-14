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
