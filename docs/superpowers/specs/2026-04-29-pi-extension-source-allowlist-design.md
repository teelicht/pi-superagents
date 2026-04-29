# Pi Extension Source Allowlist Design

## Overview

Subagent extension allowlists should accept the same source forms that users pass to `pi -e`. Local paths continue to be validated before launch, while package and remote source strings are passed through unchanged so child Pi can resolve, install, and load them using its native package resolver.

## Goals

- Allow `superagents.extensions` and agent frontmatter `extensions` to include Pi extension source specs such as `npm:@scope/package`, `git:github.com/user/repo`, `https://...`, and `ssh://...`.
- Keep local path validation for missing files and directories so users still get clear parent-side errors for local mistakes.
- Match the behavior used by `edxeth/pi-subagents`: scheme-like sources pass through unchanged; local sources resolve as paths.
- Update examples and documentation to use `npm:` prefixes for package extensions.

## Non-Goals

- Do not support bare package names such as `@scope/package` as package lookups. Bare values are treated as local paths for compatibility with existing path behavior.
- Do not import or depend on Pi internals such as `DefaultPackageManager` for this feature.
- Do not pre-install or pre-resolve package sources in the parent process.

## Architecture

Add a small source classifier in `src/execution/superagents-config.ts`:

- `isSchemeLikeExtensionSource(value)` returns `true` for strings with a URI-style scheme, excluding Windows drive-letter paths.
- `resolveLocalSubagentExtensionPath(runtimeCwd, source)` resolves local entries, including `~` and relative paths.
- `findMissingSubagentExtensionPath(...)` skips scheme-like entries and validates only local entries.

The existing `resolveSubagentExtensions(config, agentExtensions)` function keeps returning the ordered list of global extensions followed by agent extensions. `buildPiArgs()` continues receiving this list and emitting `--no-extensions` plus explicit `--extension` arguments. Child Pi remains responsible for handling package and remote source specs.

## Data Flow

1. Config validation ensures `superagents.extensions` is an array of non-empty strings.
2. Execution checks configured extension entries before spawning Pi.
3. Scheme-like entries are skipped by local existence validation.
4. Local entries are resolved from the subagent runtime working directory and checked with `fs.existsSync`.
5. The original configured extension strings are passed to child Pi.
6. Child Pi resolves `npm:`, `git:`, `https:`, and `ssh:` sources through its normal `--extension` handling.

## Error Handling

- Missing local paths still return a clear subagent error before Pi starts.
- Package or remote resolution failures are reported by child Pi, preserving canonical Pi behavior.
- Bare package-like strings without a scheme are treated as local paths and may fail with the existing missing path error.

## Testing

- Unit tests should verify that `npm:`, `git:`, `https:`, and `ssh:` entries do not fail local path validation.
- Unit tests should verify local relative, absolute, and home-relative paths still fail or pass as expected.
- Config example tests should keep `config.example.json` parseable and on the supported public surface.

## Documentation

Update configuration docs and examples to show package entries with explicit source prefixes, for example `npm:@sting8k/pi-vcc`. State that bare package names are not package lookups and should use `npm:` when referring to npm packages.
