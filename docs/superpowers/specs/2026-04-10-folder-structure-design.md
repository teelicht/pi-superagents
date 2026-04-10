# Folder Structure Refactor Design

## Goal

Reorganize `pi-superagents` into a folder-based package layout that matches Pi package conventions, improves code navigation, and preserves both installation paths:

- local git-clone installation via `install.mjs`
- npm-based installation via `pi install npm:pi-superagents`

## Current State

The repository currently works, but nearly all runtime modules live at the repository root. That makes the package harder to scan, obscures subsystem boundaries, and increases import noise as the codebase grows.

The package already has natural clusters:

- extension entrypoints
- agent discovery/serialization/management
- execution/runtime orchestration
- slash-command bridges
- TUI rendering/editor components
- shared schemas/types/helpers

The current `package.json` also assumes a root-file layout:

- `pi.extensions` points to `./index.ts` and `./notify.ts`
- `files` publishes root-level `*.ts`

That is the main packaging constraint today. Pi itself supports folder-based TypeScript packages.

## Proposed Structure

```text
src/
  extension/
    index.ts
    notify.ts
  agents/
    agents.ts
    agent-management.ts
    agent-manager.ts
    agent-manager-chain-detail.ts
    agent-manager-detail.ts
    agent-manager-edit.ts
    agent-manager-list.ts
    agent-manager-parallel.ts
    agent-scope.ts
    agent-selection.ts
    agent-serializer.ts
    agent-templates.ts
    chain-serializer.ts
    frontmatter.ts
  execution/
    async-execution.ts
    execution.ts
    chain-execution.ts
    subagent-executor.ts
    subagent-runner.ts
    parallel-utils.ts
    fork-context.ts
    single-output.ts
    pi-args.ts
    pi-spawn.ts
    run-history.ts
    settings.ts
    superagents-config.ts
    superpowers-packets.ts
    superpowers-policy.ts
    worktree.ts
  slash/
    prompt-template-bridge.ts
    slash-bridge.ts
    slash-commands.ts
    slash-live-state.ts
  ui/
    async-job-tracker.ts
    async-status.ts
    chain-clarify.ts
    completion-dedupe.ts
    file-coalescer.ts
    render.ts
    render-helpers.ts
    result-watcher.ts
    subagents-status.ts
    text-editor.ts
  shared/
    artifacts.ts
    formatters.ts
    schemas.ts
    skills.ts
    types.ts
    utils.ts
agents/
scripts/
test/
docs/
default-config.json
install.mjs
package.json
```

## Design Rationale

### Why this structure

This layout groups files by responsibility rather than by technical coincidence.

- `src/extension/` contains the Pi entrypoints and keeps package bootstrapping obvious.
- `src/agents/` contains agent file parsing, serialization, selection, and the agent manager UI flow.
- `src/execution/` contains runtime orchestration and process-spawning behavior.
- `src/slash/` isolates slash command integration from the core runtime.
- `src/ui/` contains TUI rendering and interactive editor logic.
- `src/shared/` holds low-level cross-cutting primitives that do not define a higher-level subsystem on their own.

This keeps files that frequently change together close to each other, while preserving a flat-enough structure inside each domain.

### What stays at the repo root

- `agents/` because those are package assets, not TypeScript implementation modules
- `scripts/` because they are repository/package tooling
- `test/` because test organization is already conventional and readable
- `default-config.json`, `README.md`, `CHANGELOG.md`, `install.mjs`, `package.json`

## Dependency Hotspots and Simplifications

The dependency map suggests a few targeted simplifications are worth doing alongside the move.

### 1. Keep `agents.ts` as the agent-domain root, but make the boundary clearer

`agents.ts` is imported broadly because it currently combines:

- agent model types
- file discovery
- chain parsing coordination

That is not inherently wrong, but after the move it should live in `src/agents/` and remain the public agent-domain entry module. The simplification is architectural rather than behavioral: consumers will import agent concerns from one place instead of the repository root.

### 2. Tighten the UI/runtime boundary

Three files are especially broad today:

- `index.ts`
- `subagent-executor.ts`
- `chain-clarify.ts`

They mix coordination and UI-facing concerns in ways that make the dependency graph feel denser than the behavior actually is.

The refactor should improve this by placement:

- bootstrap and extension registration live in `src/extension/`
- execution flow lives in `src/execution/`
- TUI components live in `src/ui/`

No behavior change is required, but the folder boundaries will make it easier to see whether future extractions are needed.

### 3. Keep shared modules small and intentionally boring

`types.ts`, `utils.ts`, and `skills.ts` are legitimate shared dependencies, but shared folders often become dumping grounds.

The rule for `src/shared/` should be:

- only keep modules there when they are truly cross-domain
- otherwise prefer placing files with their main callers

That keeps future dependencies more logical and prevents the new structure from recreating the same sprawl under `src/shared/`.

### 4. Move the stray root test into `test/unit/`

`path-resolution.test.ts` currently sits at the top level even though the rest of the suite already uses `test/unit`, `test/integration`, and `test/e2e`.

It should move into `test/unit/` so test imports and discovery feel consistent.

## Package Manifest Changes

`package.json` must describe the new layout explicitly.

### `pi.extensions`

Update from:

```json
"pi": {
  "extensions": ["./index.ts", "./notify.ts"]
}
```

to:

```json
"pi": {
  "extensions": ["./src/extension/index.ts", "./src/extension/notify.ts"]
}
```

### `files`

Replace the root-file-oriented list with directory-oriented publishing:

```json
"files": [
  "src/",
  "scripts/",
  "agents/",
  "default-config.json",
  "*.mjs",
  "README.md",
  "CHANGELOG.md"
]
```

This ensures npm packages include the moved runtime sources and the local installer sees the same packaged shape via `npm pack --dry-run --json`.

## Installation Compatibility

### npm package install

The npm path will continue to work as long as:

- `package.json` publishes `src/`
- `pi.extensions` points at the new entry files
- packaged helper scripts remain available

The existing local development installer already derives its copy list from `npm pack --dry-run --json`, so keeping the package manifest accurate is enough to preserve this flow.

### local git-clone install

The git-clone installer in `install.mjs` copies the full repository into Pi's extension directory. That means folder moves are safe as long as the checked-out package still contains:

- the updated `package.json`
- the new `src/extension/*` entry files
- the referenced assets such as `default-config.json` and `agents/`

## Testing and Verification Plan

The refactor should be verified with evidence from all relevant installation and packaging flows.

### Code verification

- run unit tests
- run integration tests
- run e2e tests if they are green in the current environment

### Packaging verification

- run `npm pack --dry-run --json`
- confirm packaged entries include `src/`, `scripts/`, `agents/`, `default-config.json`, and both extension entrypoints

### Local install verification

- run the local installer script against a temp target directory
- confirm copied files match the packaged file list and include the new entrypoint locations

## Non-Goals

- no behavior changes to subagent execution
- no new public API surface
- no backwards-compatibility shims for old root-level source paths
- no multi-package workspace split

## Recommended Implementation Order

1. Update tests to target the new paths first where practical.
2. Move entrypoints and subsystem files into `src/` domain folders.
3. Update relative imports.
4. Move the stray root test into `test/unit/`.
5. Update `package.json` publishing and Pi manifest paths.
6. Verify npm package contents and local installation.

## Decision

Proceed with the domain-oriented `src/` layout described above, and treat dependency simplification as a boundary-clarity improvement during the move rather than as a separate behavioral refactor.
