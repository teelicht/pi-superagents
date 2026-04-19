# Live Model Tier Configuration

Date: 2026-04-19

## Problem

Superpowers model tiers are currently loaded from `config.json` during extension registration. The resulting effective config object is then captured by slash commands, skill interception, Plannotator helpers, and the subagent executor. When a user changes `superagents.modelTiers` in `config.json`, the active PI session keeps using the old in-memory config until PI is closed and reopened or the extension runtime is reloaded.

This makes model experimentation slow. A user who wants to switch `cheap`, `balanced`, or `max` to another model must edit the config file, restart PI, then restart their workflow before future subagents use the new model.

The current `/sp-settings` overlay can write some config changes, but it only updates the file. It does not update the in-memory effective config that model tier resolution reads from.

## Goals

- Let users change model tier mappings during the same PI session.
- Keep `config.json` as the source of truth for persistent model tier settings.
- Apply successful tier edits to future Superpowers subagent launches without closing PI.
- Add a TUI model picker that reads PI's authenticated model registry instead of requiring manual model ID entry.
- Preserve existing startup config validation behavior and diagnostics.
- Keep in-flight subagents stable; changes apply only to subagent processes launched after the edit.
- Avoid PI core changes unless the PI extension API proves insufficient for matching the built-in scoped model selector exactly.

## Non-Goals

- No temporary session-only model tier overrides.
- No automatic mutation of already-running subagent processes.
- No root-session model switching when a tier is changed.
- No changes to role-agent frontmatter tier names.
- No full extension reload after each settings edit.
- No broad settings UI redesign beyond the model tier editor needed for this feature.

## Current Architecture

`src/extension/index.ts` loads config once through `loadConfigState()`. The loaded `config` value is passed into:

- `createSubagentExecutor()`
- `registerSlashCommands()`
- skill command interception logic
- Plannotator plan/spec review helpers

Model resolution happens later in `src/execution/execution.ts`, which calls `resolveModelForAgent()` with the captured config. `resolveModelForAgent()` reads `config.superagents.modelTiers` and maps an agent frontmatter value such as `cheap` or `max` to a concrete PI model string.

Because those call paths close over a startup snapshot, writing a new `config.json` from `/sp-settings` does not affect the current PI session.

## Chosen Approach

Use a live mutable config store owned by the extension runtime.

The store loads bundled defaults plus the user config at startup, exposes the current effective config and config gate state, and can reload itself after settings writes. Runtime consumers receive a config accessor or store reference instead of a fixed config snapshot.

This keeps `config.json` authoritative while avoiding a heavy PI extension reload.

## Alternatives Considered

### Extension Reload After Writes

The settings overlay could trigger PI's extension reload path after writing `config.json`. `pi-mono` includes a `reload-runtime` example that demonstrates `ctx.reload()` from command handlers.

This would refresh extension state, but it reloads more than necessary. It also risks disturbing command/tool registration and session state for a small model tier change.

### Read Config From Disk For Every Subagent

Model tier resolution could read and validate `config.json` each time a subagent starts.

This is narrowly targeted, but it creates split behavior: model resolution would see fresh config while slash commands, skill overlays, Plannotator flags, and the settings overlay might still see stale config. A single shared store is clearer and safer.

## Design

### 1. Runtime Config Store

Add a small config store module at `src/extension/config-store.ts`. The store belongs with extension registration because it owns extension-level paths, startup diagnostics, and runtime gate state.

The store owns:

- the current effective `ExtensionConfig`
- the current `ConfigGateState`
- the bundled default config path
- the user config path
- the example config path

It exposes:

```typescript
interface RuntimeConfigStore {
  getConfig(): ExtensionConfig;
  getGate(): ConfigGateState;
  reload(): ConfigGateState;
}
```

The existing `loadConfigState()` logic should move into or delegate to this store so there is one canonical path for loading defaults, reading user overrides, merging config, and formatting diagnostics.

Reload behavior:

- On success, replace the store's effective config and gate state.
- On validation errors, keep the validated fallback behavior used today and set the gate to blocked.
- On parse/read errors, set the gate to blocked and format diagnostics the same way startup does.

### 2. Runtime Consumers Use Accessors

Code that currently receives `config: ExtensionConfig` should receive either the store or a `getConfig()` callback when it needs live settings.

Primary consumers:

- slash command profile resolution
- skill command interception
- subagent executor and subagent run options
- model tier resolution
- Plannotator enablement checks
- `/sp-settings` rendering

Command registration itself can still happen at extension startup. Built-in and configured slash command names are not expected to change live in this feature. The live behavior is for settings that affect future executions, especially model tiers.

If a user edits command definitions in `config.json`, they may still need a PI reload for command registration changes. The settings overlay should keep a precise message for this distinction: model tier changes apply immediately; command registration changes may require reload.

### 3. Settings Overlay Model Tier Editor

Extend `/sp-settings` with an interactive model tier editor.

The overlay should render configured tiers from `configStore.getConfig()`:

- built-in tiers such as `cheap`, `balanced`, and `max`
- user-defined custom tiers
- current concrete model value
- current thinking level when configured

Selecting a tier opens a searchable model picker populated from PI's model registry:

```typescript
ctx.modelRegistry.refresh();
const models = ctx.modelRegistry.getAvailable();
```

The picker should display models as `provider/id`, matching PI's model string format and the format accepted by subagent execution.

When the user confirms a model:

1. Write the selected `provider/id` to `superagents.modelTiers.<tier>.model` in `config.json`.
2. Preserve the tier's existing `thinking` value if one exists.
3. Reload the config store immediately.
4. Rerender the overlay from the store.
5. Show a success message such as `Applied to this PI session.`

If the current configured model is not present in the available model list, the overlay should still show it as the current value. Choosing a new model replaces it.

### 4. PI Model Registry Scope

PI exposes `ctx.modelRegistry` to extensions. The registry can list authenticated models through `getAvailable()` and find concrete models by provider and ID.

PI's built-in `/model` autocomplete uses the session's scoped model list when PI was launched with a restricted `--models` set, otherwise it uses `modelRegistry.getAvailable()`. The current extension context exposes `modelRegistry` but does not appear to expose the session scoped model list directly.

The first implementation should use `ctx.modelRegistry.getAvailable()`. This means the Superagents picker can select from models PI knows and can authenticate. Matching the built-in scoped `/model` list exactly can be a later PI API enhancement if needed.

### 5. Config Writer Helper

Add a focused config writer helper for model tiers in `src/superpowers/config-writer.ts`.

Expected behavior:

- Create `superagents` when missing.
- Create `superagents.modelTiers` when missing.
- Update an existing object tier by replacing only `model`.
- Preserve `thinking` on existing object tiers.
- Convert string tiers to object tiers when writing through the editor.
- Keep stable two-space JSON formatting with a trailing newline.

The settings overlay should continue to use the shared `updateSuperpowersConfigText()` parser/serializer so config writes stay consistent.

### 6. Error Handling

If writing `config.json` fails, the in-memory config remains unchanged and the overlay displays the filesystem error.

If reloading after a successful write produces validation errors, the store updates its gate state to blocked. Future subagent execution uses the same blocked-config behavior as startup. The overlay displays the formatted diagnostic message.

If no authenticated models are available, the model picker should display a clear message and avoid writing a tier change.

If model registry refresh reports an error through `getError()`, the overlay should surface that message while still showing any available built-in/authenticated models returned by the registry.

In-flight subagents are unaffected by tier edits.

## User Experience

The user opens `/sp-settings`, sees a `Model tiers` section, selects a tier, and chooses one of PI's available models. The overlay writes the persistent override and confirms that future Superpowers subagents in the current PI session will use the new mapping.

Example:

1. User opens `/sp-settings`.
2. User selects `balanced`.
3. Picker shows authenticated PI models such as `openai/gpt-5.4`, `anthropic/claude-opus-4.6`, or custom models from PI's model registry.
4. User selects `openai/gpt-5.4`.
5. `config.json` receives:

```json
{
  "superagents": {
    "modelTiers": {
      "balanced": {
        "model": "openai/gpt-5.4"
      }
    }
  }
}
```

6. The overlay rerenders and shows `balanced: openai/gpt-5.4`.
7. The next subagent whose frontmatter says `model: balanced` launches with `openai/gpt-5.4`.

## Testing

### Unit Tests

Add tests for the config store:

- loads defaults when no user config exists
- merges user config over defaults
- reloads after file changes
- exposes blocked diagnostics for invalid JSON or invalid config values
- keeps config gate state consistent with startup behavior

Add tests for model tier config writing:

- updates an existing object tier model while preserving thinking
- converts an existing string tier to an object tier
- creates missing `superagents.modelTiers`
- rejects invalid raw JSON through existing parser behavior

### TUI and Integration Tests

Extend settings overlay tests to cover:

- rendering model tiers from the live config store
- selecting a model from a supplied model list
- writing the selected model to `config.json`
- reloading the runtime store after the write
- subsequent model tier resolution using the new model without extension restart

Where direct TUI interaction is hard to assert, keep component methods small enough to test the selection/write/reload path directly.

### Regression Tests

Existing model tier resolution tests should continue to pass. Add a regression proving that changing the runtime store config changes later `resolveModelForAgent()` behavior through the execution path, not only through direct unit calls.

## Documentation

Update user-facing documentation after implementation:

- `README.md`: mention that model tiers can be edited from `/sp-settings` during a PI session.
- `docs/configuration.md`: document live model tier editing, persistence, model picker behavior, and the remaining reload requirement for command registration changes.
- `docs/parameters.md`: add or update any command/settings parameter references if the overlay behavior is listed there.
- `docs/skills.md`: mention that role-agent tier mappings can be changed without restarting PI.
- `docs/worktrees.md`: add only a brief cross-reference if `/sp-settings` behavior is described there.

## Implementation Boundaries

This feature should not change bundled skill files.

All application code should remain TypeScript. New source files require file headers, and non-trivial functions require maintained doc comments.

The first implementation should stay inside `pi-superagents`. A PI core change is only warranted later if exact scoped model-list parity with the built-in `/model` command becomes necessary.
