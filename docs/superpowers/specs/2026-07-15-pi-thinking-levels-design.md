# Pi-Owned Thinking Levels Design

## Goal

Remove every extension-owned thinking-level enumeration. Pi remains the sole authority for which levels each model supports and for rejecting invalid configured values at runtime.

## Approved Approach

Use Pi's exported `getSupportedThinkingLevels(model)` for the `/sp-settings` picker. When the model registry is read, each picker model receives the levels returned by Pi for that concrete model. The picker displays only those values plus its existing `default` option.

Configuration and model suffix values are passed through without extension-side validation. Shared helpers preserve precedence but do not decide whether a string is a valid thinking level. A non-empty suffix already present on a model remains authoritative; Pi validates that suffix when the child run starts.

Alternatives rejected:

1. Keep a compiler-pinned local list. This still duplicates Pi and requires extension maintenance.
2. Replace the picker with free text. This avoids enumeration but provides a worse experience than Pi's per-model metadata.
3. Import Pi's private global list or CLI validator. Those symbols are not exported and would couple the extension to unsupported internals.

## Context Map

### Files to Modify

| File | Purpose | Changes Needed |
|---|---|---|
| `src/ui/sp-settings.ts` | Settings model/thinking picker | Consume the selected model's Pi-provided levels instead of a module-level list. |
| `src/slash/slash-commands.ts` | Maps Pi registry models into picker options | Call `getSupportedThinkingLevels(model)` for every available model. |
| `src/shared/thinking-levels.ts` | Resolves effective thinking and model suffix display | Remove the list and type guard; pass configured and suffix values through using Pi's exported type. |
| `src/execution/pi-args.ts` | Builds the child Pi model argument | Preserve any existing non-empty suffix without validating it locally. |

### Dependencies

| File | Relationship |
|---|---|
| `src/execution/child-runner.ts` | Uses effective thinking and suffix extraction for launch metadata. |
| `src/execution/subagent-executor.ts` | Uses the same helpers for pending progress. |
| `src/shared/types.ts` | Re-exports Pi's `ThinkingLevel` type. |
| `src/superpowers/config-writer.ts` | Persists a picker-selected thinking value. |

### Tests

| Test | Coverage |
|---|---|
| `test/unit/sp-settings.test.ts` | The thinking picker exposes only levels Pi reports for the selected model. |
| `test/unit/thinking-levels.test.ts` | Configured and suffix values pass through without a local allowlist. |
| `test/integration/single-execution.test.ts` | An existing model-override suffix remains authoritative. |

### Reference Pattern

`ctx.modelRegistry.getAvailable()` already supplies Pi `Model` objects. `@earendil-works/pi-ai` exports `getSupportedThinkingLevels(model)`, which returns `['off']` for non-reasoning models and model-specific extended levels based on `thinkingLevelMap`.

## Data Flow

1. `/sp-settings` reads concrete models from Pi's registry.
2. The slash-command layer asks Pi for each model's supported thinking levels.
3. Selecting a model stores that model's returned levels for the next picker screen.
4. Selecting a thinking level writes the existing tier configuration format.
5. Child launch helpers pass configured or suffixed strings to Pi without checking a local allowlist.
6. Pi accepts or rejects the final value at runtime.

## Error Handling

Existing model-registry errors remain unchanged. A non-reasoning model receives Pi's `['off']` result. Unknown configured or suffixed values are not blocked by the extension and may cause the Pi child run to fail, which is the requested behavior.

## Testing

Use test-driven development:

1. Add a picker test with two models whose Pi-provided options differ and verify the selected model controls the menu.
2. Replace local-list validation tests with pass-through tests for future/unknown values.
3. Run the focused tests red, implement the minimum change, then run unit, integration, typecheck, and Biome checks.

## Risk Assessment

- [x] Behavior change: invalid thinking values are deferred to Pi runtime validation.
- [ ] Public API break: no documented public extension API changes.
- [ ] Database migration: none.
- [ ] Configuration migration: existing values and shape remain unchanged.

