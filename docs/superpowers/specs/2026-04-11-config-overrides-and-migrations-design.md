# Config Overrides and Migrations Design

## Goal

Make `pi-superagents` configuration transparent without freezing users onto stale copies of old defaults.

The installation flow should create an empty user override file, provide a complete example file for discoverability, and fail closed when the user configuration is invalid or outdated. When configuration problems are detected, Pi should inform the user clearly and point to concrete repair or migration steps.

## Current State

`pi-superagents` currently reads optional JSON config from:

```text
~/.pi/agent/extensions/subagent/config.json
```

Runtime config loads the bundled `default-config.json`, then overlays `config.json` when present. The current installer seeds `config.json` by copying `default-config.json` when the user file is missing.

That copy-based install flow is convenient, but it makes later breaking changes hard to reason about:

- A copied file can become an old snapshot of the default structure.
- The runtime cannot tell whether a stale value was intentionally edited or only copied during install.
- New defaults do not flow naturally into existing installations when users have a full copied config.
- Invalid or outdated parameters are currently easy to miss because parse failures only log to stderr.

The existing Pi extension lifecycle gives us a better user-facing warning path. The extension receives `session_start` events with an `ExtensionContext`, and `ctx.ui.notify(...)` can show warnings or errors in Pi when UI is available.

## Decision

Use a small override-file model instead of copying the full defaults into the user file.

Installation creates:

```text
~/.pi/agent/extensions/subagent/config.json
~/.pi/agent/extensions/subagent/config.example.json
```

`config.json` is an empty JSON object by default:

```json
{}
```

`config.example.json` contains the full editable example with every supported user-facing setting. It is regenerated or overwritten on install/update because it is package-owned reference material, not user state.

`default-config.json` remains bundled and package-owned. It is the runtime source of default values and should not be treated as the user-facing editable template.

## User Experience

### Fresh install

After installation, the user sees:

```text
Config override file: ~/.pi/agent/extensions/subagent/config.json
Config examples:       ~/.pi/agent/extensions/subagent/config.example.json
```

The installer explains that users should copy only the settings they want to change from `config.example.json` into `config.json`.

### Existing install update

If `config.json` already exists, the installer preserves it. It refreshes `config.example.json`, validates `config.json`, and prints a concise status:

- valid config: no action needed
- invalid JSON: Pi will disable `pi-superagents` until fixed
- unsupported schema version or removed keys: migration required
- deprecated keys with safe migration available: run the migration command or allow the installer to apply it if that mode is supported

### Pi startup

When Pi opens and the extension loads, configuration is validated before tools and slash commands become usable.

If the user config is valid, startup is silent.

If the user config is invalid or outdated, the extension should show one clear Pi notification per session:

```text
pi-superagents is disabled because config.json needs attention.
Path: ~/.pi/agent/extensions/subagent/config.json

- Removed key: superagents.modelTiers.max.thinking
- Unknown key: superagents.worktrees.setupCommand

See config.example.json for the current shape.
Run the config migration command if available, or edit the file manually.
```

The extension should also avoid registering or executing behavior that depends on the invalid config. If Pi requires tools to be registered before validation can surface, the tools should return a blocking error result instead of running subagents.

## Config File Responsibilities

### `default-config.json`

Package-owned runtime defaults.

Responsibilities:

- provide safe default values for runtime behavior
- evolve with releases
- always be included in packaged installs
- never be copied wholesale into `config.json`

### `config.example.json`

Package-owned user reference.

Responsibilities:

- expose all supported user-facing settings
- include representative model tier and worktree examples
- document optional keys through nearby docs, not JSON comments
- be overwritten on install/update

Because JSON does not support comments, detailed explanations stay in `docs/reference/configuration.md`. The example file should remain parseable JSON.

### `config.json`

User-owned override file.

Responsibilities:

- contain only settings the user wants to override
- be created as `{}` on first install
- be preserved on update
- be removed only when the user explicitly removes the extension directory
- be validated before use

The runtime effective config is:

```text
effective config = bundled defaults + validated user overrides
```

## Validation Model

Introduce a config validation module with one purpose: convert raw config files into either a validated effective config or diagnostics that are safe to show to users.

Validation should detect:

- invalid JSON
- non-object top-level config
- unknown top-level keys
- unknown nested keys under supported config groups
- wrong value types
- invalid enum values, such as unsupported implementer modes
- invalid numeric ranges, such as negative timeout values
- removed keys that require manual migration
- deprecated keys that can be migrated
- unsupported config schema versions, if schema metadata is introduced

Unknown keys are blocking errors. This keeps misspellings and stale copied defaults from silently being ignored.

Diagnostics should be structured, not just strings:

```ts
interface ConfigDiagnostic {
	level: "warning" | "error";
	code: string;
	path: string;
	message: string;
	action?: string;
}
```

Errors disable the extension. Warnings allow the extension to run but should be visible when they indicate deprecated config that will break in a future release.

## Fail-Closed Behavior

The safe route is to disable `pi-superagents` when config errors exist.

Blocking errors include:

- invalid JSON
- config root is not an object
- unsupported config schema version
- removed keys with no safe automatic migration
- value types that could change runtime behavior unpredictably
- invalid model tier entries that would break model resolution
- invalid worktree setup settings that could create unsafe filesystem behavior

When disabled:

- subagent execution must not start
- slash commands that launch subagents must refuse to run
- status or diagnostic commands may still run if they help the user inspect the problem
- Pi startup should notify the user when UI is available
- non-UI environments should receive stderr or tool-result errors

This prevents old or malformed config from silently producing surprising behavior.

## Migration Strategy

Use explicit migration metadata rather than relying on best-effort ad hoc transforms.

Recommended baseline:

- Keep `config.json` valid without requiring metadata for the initial empty override model.
- Do not add schema metadata to newly created empty `config.json` files yet.
- Add optional metadata later only when it helps detect copied legacy files or future schema transitions.
- Maintain a list of known config migrations in code.
- Each migration declares the source pattern, target change, safety level, and user message.

Migration classes:

| Class | Behavior |
| ----- | -------- |
| Safe automatic migration | Can rewrite without changing user intent, such as renaming a key with identical semantics. |
| Guided manual migration | Requires user choice, such as replacing a removed setting with two new settings. |
| Deprecated but supported | Runs for now, warns at startup, and documents the removal release. |
| Unknown unsupported config | Blocks execution and points to `config.example.json`. |

The installer can print migration guidance during update. Runtime validation remains authoritative because users may edit `config.json` after installation.

Migration access should exist in both places:

- an installer flag for users already in the terminal during install or update
- a diagnostic-safe Pi tool action for users who first learn about the problem from the startup notification

## Installation Changes

Fresh install should:

1. Install package files.
2. Ensure `config.json` exists.
3. Write `{}` to `config.json` only when missing.
4. Copy or generate `config.example.json`.
5. Validate `config.json`.
6. Print config location, example location, and any diagnostics.

Update install should:

1. Refresh package files.
2. Preserve existing `config.json`.
3. Refresh `config.example.json`.
4. Validate `config.json`.
5. Print any migration or blocking diagnostics.

The local development installer should follow the same user-file preservation rule. Package-owned files can be refreshed, but user-owned config must not be deleted as stale install content.

## Runtime Flow

Extension startup should separate config loading from runtime registration:

1. Read bundled defaults.
2. Read user `config.json` if present.
3. Validate user overrides.
4. Build effective config only when there are no blocking errors.
5. Store diagnostics for startup notification.
6. On `session_start`, show a single warning/error notification if diagnostics exist.
7. Register diagnostic-safe tools even when config is blocked.
8. Prevent execution tools and slash launchers from running while config is blocked.

The notification should be deduplicated per session to avoid repeated noise.

## Error Handling

Config errors should be precise and actionable.

Good:

```text
config.json: superagents.worktrees.setupHookTimeoutMs must be a positive integer.
```

Better:

```text
pi-superagents is disabled.
config.json: superagents.worktrees.setupHookTimeoutMs must be a positive integer.
Set it to a number like 30000 or remove the key to use the default.
```

Avoid generic failures such as:

```text
Failed to load config.
```

If both bundled defaults and user config fail, bundled default failure is a package integrity error and should be reported separately from user repair guidance.

## Documentation

Update configuration docs to make the ownership model explicit:

- `default-config.json` is package-owned runtime defaults.
- `config.example.json` is the reference users copy from.
- `config.json` is user-owned overrides only.
- Empty `{}` is a valid config.
- Invalid config disables the extension until fixed.
- Migration diagnostics appear during install/update and Pi startup.

The docs should include examples for:

- enabling async by default
- changing worktree defaults
- overriding model tiers
- adding a custom model tier
- fixing common validation errors

## Testing

Unit tests should cover:

- empty `config.json` merges with bundled defaults
- missing `config.json` behaves like an empty override
- invalid JSON returns blocking diagnostics
- unknown keys return blocking diagnostics
- deprecated keys return migration diagnostics
- safe migrations produce expected rewritten config when invoked
- invalid config prevents subagent execution
- diagnostic-safe status/config inspection still works

Installer tests should cover:

- fresh install creates `{}` config
- fresh install creates or refreshes `config.example.json`
- update preserves existing `config.json`
- update refreshes `config.example.json`
- local development install does not delete user-owned config
- installer prints blocking diagnostics for invalid config

Integration tests should cover:

- Pi startup notification appears for blocking config errors when UI is available
- subagent tool returns a blocking error when config is invalid
- valid override config still allows normal subagent execution

## Rollout Plan

1. Add `config.example.json` to the package.
2. Change installers to create empty `config.json` and preserve it on updates.
3. Add config validation and diagnostics.
4. Change runtime loading to fail closed on blocking config errors.
5. Show Pi startup notifications through `session_start`.
6. Add migration helpers for known legacy full-copy configs.
7. Update docs and tests.

## Implementation Decisions

- Unknown config keys block immediately.
- Fresh empty `config.json` files do not need schema metadata.
- Migration should be available from both the installer and a diagnostic-safe Pi tool action.
- The current explicit whole-directory removal behavior stays destructive for now, but normal install and update paths must preserve user-owned `config.json`.
