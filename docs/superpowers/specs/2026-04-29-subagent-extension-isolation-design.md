# Subagent Extension Isolation and Global Extension Allowlist Design

## Purpose

Subagent child Pi processes should run with predictable extension loading. Pull request #17 provides the base behavior: subagent launches pass `--no-extensions` when no agent-specific extensions are configured, preventing globally installed Pi extensions from being loaded implicitly. This design builds on that implementation and adds a global Superagents configuration setting for extensions that should always be passed to subagents.

## Goals

- Use PR #17 as the base implementation for isolated subagent launches.
- Prevent subagents from inheriting arbitrary globally installed Pi extensions by default.
- Add `superagents.extensions` as a global allowlist of Pi extension entrypoints passed to every subagent.
- Keep agent frontmatter `extensions:` additive, so individual agents can request extra extensions.
- Preserve existing support for path-like `tools` entries that are emitted as Pi `--extension` arguments.
- Document the new configuration behavior and validation rules.

## Non-goals

- Do not add per-command extension settings.
- Do not change agent discovery or frontmatter syntax beyond using the existing `extensions:` field.
- Do not remove support for path-like tool extension entries.
- Do not make subagents inherit all globally installed Pi extensions by default.

## Configuration Shape

Add a new optional setting under `superagents`:

```json
{
  "superagents": {
    "extensions": ["./src/extension/example.ts"]
  }
}
```

`superagents.extensions` is an array of non-empty strings. Each string is passed to Pi as an explicit `--extension` argument for every subagent launch. The default bundled configuration uses an empty array.

## Effective Extension Resolution

For each subagent run, resolve extensions in this order:

1. Global extensions from `config.superagents?.extensions ?? []`.
2. Agent-specific extensions from `agent.extensions ?? []`.
3. Path-like tool entries already extracted from `tools`, such as `./tools/custom.ts`.

The first two groups form the explicit extension list passed into `buildPiArgs()`. Path-like tool entries remain handled inside `buildPiArgs()` and must still be emitted even when explicit extensions are defined.

The resulting Pi command should always disable implicit extension discovery for subagents:

```bash
pi --no-extensions --extension <global-extension> --extension <agent-extension> --extension <tool-extension>
```

When no global, agent, or tool-path extensions exist, the command should still include:

```bash
--no-extensions
```

This matches the isolation behavior introduced by PR #17.

## Implementation Notes

- Merge PR #17 or otherwise apply its core behavior before adding the global allowlist, to avoid duplicating work.
- Update the `ExtensionConfig` / `SuperpowersSettings` types to include `extensions?: string[]`.
- Update config validation so `superagents.extensions` is a supported key and validates as an array of non-empty strings.
- Update config merge behavior so user-provided `superagents.extensions` replaces the bundled default list, consistent with list-style settings such as `interceptSkillCommands`.
- Update execution setup to pass a resolved array rather than raw `agent.extensions`.
- Update `buildPiArgs()` so defined explicit extensions do not suppress path-like tool extensions.

## Testing

Add tests that prove:

- Subagent launches include `--no-extensions` when neither global nor agent extensions are configured.
- Global `superagents.extensions` entries are emitted as `--extension` arguments.
- Agent frontmatter `extensions:` entries are appended after global entries.
- Path-like `tools` entries are still emitted as `--extension` arguments when explicit extensions are present.
- Invalid `superagents.extensions` values are rejected by config validation.

## Documentation

Update user-facing documentation after implementation:

- `README.md`
- `docs/configuration.md`
- `docs/worktrees.md`
- `docs/parameters.md`
- `docs/skills.md`

The main configuration docs should explain that subagents do not inherit global Pi extensions by default and that `superagents.extensions` is the allowlist for extensions that should always be available to subagents.

## Risks

- Some users may have relied on subagents implicitly inheriting installed Pi extensions. This change makes those dependencies explicit.
- Incorrect path handling could break extension loading for relative paths. Existing Pi CLI behavior should be preserved by passing values through unchanged.
- The PR #17 implementation can accidentally suppress path-like tool extensions if `buildPiArgs()` only emits those in the `extensions === undefined` branch. The implementation must fix that while keeping PR #17's isolation behavior.
