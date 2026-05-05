# Subagent Model Confirmation UI Design

## Purpose

Show the model a subagent actually uses in the Pi subagent UI, so the UI acts as a confirmation surface for model routing. The display must confirm runtime behavior, not merely repeat agent frontmatter, model-tier config, or other pre-launch expectations.

## Scope

This change applies to the subagents status UI in the Pi chat interface. It covers active and recent subagent runs, including selected-run details. It does not change model selection policy, model tier configuration, or subagent execution semantics.

## User-Facing Behavior

The subagents status overlay will show the model in two places:

1. Each run row shows a compact model label so users can scan active and recent subagent runs at a glance.
2. The selected run details show the model and, when available, the thinking level as separate fields.

Rows should remain readable in narrow terminals by truncating the model label before the task text. Details should preserve the existing unknown/omitted behavior for old records or runs that do not expose model data.

## Source of Truth

The displayed model must come from the execution loop. The UI must not infer the confirmed model from agent frontmatter, configured model tiers, planned child-run metadata, or task parameters.

Pre-launch values may be shown only as provisional active-run metadata while a subagent is starting. Once the child execution loop reports the model it actually used, run history must update to that reported model. If the execution loop reports a later model value, that later value wins.

Thinking level should be stored separately from the model. It should represent the effective runtime thinking level passed into the child execution. If runtime execution events later provide a more authoritative thinking value, that value should replace the provisional value.

## Data Model

Add a separate optional `thinking?: ThinkingLevel` field to run/result metadata that feeds the status UI. Keep `model?: string` as the runtime-confirmed model id. Do not require UI code to parse thinking suffixes from model strings.

Existing history entries without `thinking` remain valid. The UI should render their model when present and omit thinking when absent.

## Implementation Components

- `src/shared/types.ts`: extend relevant result metadata with optional thinking data if needed by the execution-to-history path.
- `src/execution/run-history.ts`: add `thinking?: ThinkingLevel` to `RunEntry` and preserve it for active and persisted runs.
- `src/execution/child-runner.ts`: record provisional effective thinking at launch, update run history from execution loop model events, and keep runtime-reported model values authoritative.
- `src/ui/subagents-status.ts`: include a compact model column in run rows and show separate model/thinking fields in selected details.
- Tests: add or update focused tests for run history/status formatting and execution updates so the UI confirms reported model values rather than frontmatter-derived expectations.

## Error Handling and Compatibility

If no runtime model is available, the details panel should display `Model: unknown` and row rendering should use a compact unknown placeholder. Missing thinking data should be omitted rather than displayed as an error.

Invalid or stale history rows should continue to load best-effort as they do today. This feature must not make history parsing stricter.

## Testing Strategy

- Verify a run row includes a compact model label.
- Verify selected details show model and thinking separately when both are present.
- Verify selected details omit thinking when absent.
- Verify the execution loop can update a provisional model with a runtime-reported model.
- Verify old history records without thinking still render safely.

## Documentation Updates

Update user documentation after implementation where subagent UI/status behavior is described, including the README and relevant docs files if they mention subagent status output or model routing.
