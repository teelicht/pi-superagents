# Extension Path Validation Design

## Purpose

Subagent extension isolation now relies on explicit `--extension` arguments from `superagents.extensions`, agent frontmatter `extensions:`, and path-like tool entries. If one of those extension paths is unavailable, Pi aborts child startup with a low-level stderr message. This design adds an early, user-facing validation step so missing configured extension paths are reported clearly before launching the child Pi process.

## Design

Add runtime validation in the subagent execution path, because relative extension paths are resolved by the child Pi process from the subagent runtime working directory. Static config loading cannot safely validate project-relative paths in `~/.pi/agent/extensions/subagent/config.json`.

The validation will inspect the effective extensions before `buildPiArgs()` is called:

1. Global allowlist entries from `config.superagents.extensions`.
2. Agent frontmatter entries from `agent.extensions`.

Each entry is resolved the same way Pi would see it: absolute paths are checked as-is, relative paths are resolved against `runtimeCwd`. If the resolved path does not exist, `runSync()` returns a failed `SingleResult` without spawning Pi. The error message identifies the source (`superagents.extensions[index]` or `agent.extensions[index]`), the configured value, and the resolved path.

Path-like tool entries remain validated by Pi for now because they are extracted inside `buildPiArgs()` from the resolved tool list. The current user-facing request is about configured global/agent extensions, so this feature stays focused on those sources.

## Error Behavior

A missing configured extension returns a normal subagent error result:

```text
Extension path from superagents.extensions[0] does not exist: ./missing.ts (resolved to /repo/missing.ts)
```

This avoids silent skipping and avoids letting Pi fail with a less contextual startup error.

## Testing

Add integration tests for `runSync()`:

- Missing global extension from `superagents.extensions` fails before spawning Pi and reports the config source.
- Missing agent frontmatter extension fails before spawning Pi and reports the agent source.
- Existing global and agent extension files still pass through as `--extension` arguments in the expected order.

Update documentation to explain that configured extension paths must exist relative to the subagent runtime working directory unless absolute paths are used.
