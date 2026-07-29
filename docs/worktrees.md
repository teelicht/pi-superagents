# Worktree Isolation Reference

When multiple agents run in parallel against the same repository, they can clobber each other's file changes. Pi Superagents can automatically give each parallel agent its own git worktree branched from HEAD to provide perfect isolation.

This reference targets Pi `^0.82.1`.

Worktree automation starts only from an explicit Pi Superagents workflow while the default `superagents.makeSuperpowersSkillsOptInOnly: true` setting is active; ordinary Pi requests do not enter Superpowers through the upstream automatic bootstrap hook.

> **Relationship to the `using-git-worktrees` skill:** that skill guides the root-session agent in setting up *one* isolated workspace for its own feature work (detect existing isolation, prefer native tools, fall back to `git worktree add`, verify `.gitignore`). This extension's worktree isolation is a separate concern: it programmatically creates *N* parallel worktrees for concurrent subagent runs. The runtime now mirrors the skill's directory convention (default `.worktrees/` at the repository root, the `using-git-worktrees` skill's `git worktree add` invocation, and the auto-`.gitignore` safety rule), but the SDD Task-worktree lifecycle stays under the controller's control.

Development note: `pnpm exec fallow` is part of repository maintenance. Worktree-related runtime files should stay reachable through imports or documented dynamic entrypoints so Fallow does not mistake active isolation support for dead code.

## Two Kinds of Parallel Worktree

The extension owns two distinct worktree lifecycles. They share `worktrees.enabled` as the gate, but their ownership, lifetime, and cleanup rules are different:

```text
ordinary parallel call → extension-owned ephemeral worktrees → patch capture → automatic cleanup
parallel SDD wave      → controller-owned persistent Task worktrees → review/fix reuse → cherry-pick → controller cleanup
```

- **Ordinary parallel call.** Triggered when a Superpowers command runs `tasks: [...]` against an existing command preset. The extension creates a fresh worktree per task under the configured worktree root, captures each agent's diff as `.patch` artifacts, and cleans up the worktree and temporary branch automatically before the parent run finishes.
- **Parallel SDD wave.** Triggered by `/sp-implement-parallel`, or when another implementation command resolves `taskScheduling: "parallel"`, `useSubagents: true`, and `worktrees.enabled: true`. The root session controller pre-creates one persistent worktree per Task under the configured worktree root, dispatches the Task's `sp-implementer` into that worktree, reuses the same worktree for the per-Task `sp-review`, the implementer fix dispatch via `resumeSession`, and the re-review, and finally cherry-picks the approved commit into the parent branch. The controller owns cleanup; the extension only validates the worktree is safe to enter. See the [Skills Reference](skills.md#parallel-sdd-task-scheduling) for the dispatch contract and the [Configuration reference](configuration.md#parallel-sdd-task-scheduling) for the preflight rules.

When `taskScheduling: "parallel"` is set but a worktree is unsafe to create, the controller surfaces the failure and runs the affected Task sequentially instead of silently dropping back to a different mode.

## Usage

Worktree isolation is optional. Enable it for the entrypoint command that launches the Superpowers workflow with `superagents.commands.<name>.worktrees.enabled`:

```typescript
// Parallel with worktree isolation when the launching command resolves worktrees.enabled: true
{ tasks: [
  { agent: "sp-implementer", task: "Implement auth" },
  { agent: "sp-implementer", task: "Implement API" }
], workflow: "superpowers" }
```

Example behavior-only config for `/sp-implement`:

```json
{
  "superagents": {
    "commands": {
      "sp-implement": {
        "worktrees": { "enabled": true, "root": "../worktrees" }
      }
    }
  }
}
```

Bundled parallel-SDD config for `/sp-implement-parallel`:

```json
{
  "superagents": {
    "commands": {
      "sp-implement-parallel": {
        "taskScheduling": "parallel",
        "useSubagents": true,
        "worktrees": { "enabled": true }
      }
    }
  }
}
```

During upgrades, a custom `sp-implement.worktrees.root` is copied to a missing
`sp-implement-parallel` preset automatically. At runtime, an enabled parallel
or custom command worktree policy takes precedence over the sequential
`sp-implement` hard-off; `sp-implement.worktrees.enabled: false` remains the
fallback only when no command enables worktrees.

After parallel completion, per-agent diff stats are appended to the output. Full patch files are written to the artifacts directory.

While parallel worktree runs are active, inline subagent rows and `/subagents-status` show each delegated subagent separately, including its runtime-confirmed model, effective thinking level when available, resolved skills, and any missing-skill warnings. Worktree isolation does not change entrypoint or role skill resolution; implementation root lifecycle skills and `sp-debug`'s `systematic-debugging` assignment are resolved before any child process runs in a worktree.

Agent reports themselves are returned inline through Pi tool results. Worktree isolation does not require `implementer-report.md` or `code-review.md` files in the worktree. Worktree isolation and session mode are separate concerns: packet handoff files live in the session artifact directory, not inside the worktree, and are cleaned up by the runtime.

## Execution and Lifecycle

Execution is strictly synchronous and blocking. Worktree-backed parallel children are joined before cleanup; this policy is unchanged.

Lifecycle tools (`subagent_done`, `caller_ping`) are internal child-only tools registered through policy; they are not user-configurable delegation controls or worktree settings.

## Extension Loading

Extension and shared-tool loading for subagents is independent of worktree isolation. Even when running inside a git worktree, child Pi processes load extensions from `superagents.extensions` (global config) and the `extensions` field in agent frontmatter (additive to global). They also receive global `superagents.tools` entries appended to each agent's role-policy tool list. Implicit Pi extension discovery is disabled by default; only explicitly configured extensions are loaded. Configured entries that fail to resolve are reported before the child process is launched.

## Requirements

- Must be inside a git repository.
- Working tree must be clean (no uncommitted changes). Commit or stash before running parallel tasks.
- `node_modules/` is symlinked into each worktree when it is safe to do so, avoiding unnecessary dependency installs.
- Worktree runs use the shared parallel `cwd`. Task-level `cwd` overrides must be omitted or match that shared `cwd`.
- A configured project-local `worktrees.root` is ignored automatically: if it is not in `.gitignore`, the runtime appends it (the `using-git-worktrees` skill's safety rule). The default `.worktrees/` root is likewise appended when first used.
- Parallel SDD Task worktrees must be pre-isolated by the controller before any writer starts, must remain in place across the per-Task `sp-review`, the `resumeSession` fix dispatch, and the re-review, and are removed by the controller after the Task commit is integrated into the parent branch.

## Internals

1. `git worktree add` creates a worktree per agent under the worktree root directory, which defaults to `.worktrees/` at the repository root (mirroring the `using-git-worktrees` skill's directory convention).
2. If the resolved command behavior sets `worktrees.root`, worktrees are created under that directory instead of `.worktrees/`. An existing `.worktrees/` or `worktrees/` directory is reused when no root is configured.
3. Each agent runs in its worktree's cwd.
4. Before diff capture, synthetic helper paths created by Pi Superagents, such as a safe `node_modules` symlink, are removed.
5. After execution, `git add -A && git diff --cached` captures all changes.
6. Diff stats appear in the aggregated output; full `.patch` files are written to the artifacts directory.
7. Worktrees and temporary branches are cleaned up automatically for ordinary parallel calls. Parallel SDD Task worktrees are removed by the controller after the Task commit is integrated.

## Configuration

See [Configuration Reference](configuration.md) for `superagents.commands.<name>.worktrees.*` config keys.

The `/sp-settings` overlay also shows Superpowers model tiers and command-scoped workflow toggles. Use `c` to select a command before pressing `w`; worktree toggles are written to the selected command preset. Tier edits use a type-to-search model picker followed by a thinking-level picker and apply immediately to future subagents, while worktree command registration changes may still require a PI reload.

## Release Notes

Worktree behavior affects parallel execution safety, so user-facing changes to this subsystem should be called out in `CHANGELOG.md` before publishing. Follow the [Release Process](releases.md) when preparing a version that changes worktree defaults, cleanup, branch behavior, or artifact output.
