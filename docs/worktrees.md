# Worktree Isolation Reference

When multiple agents run in parallel against the same repository, they can clobber each other's file changes. Pi Superagents can automatically give each parallel agent its own git worktree branched from HEAD to provide perfect isolation.

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

When resolved worktree config is `enabled: false`, Superpowers treats that as a hard off switch. Root prompts must not ask for worktrees, and Superpowers subagent runs ignore `worktree: true` requests.

After parallel completion, per-agent diff stats are appended to the output. Full patch files are written to the artifacts directory.

While parallel worktree runs are active, `/subagents-status` shows each delegated subagent separately, including its resolved skills and any missing-skill warnings. Worktree isolation does not change entrypoint or role skill resolution; for example, `/sp-implement` root lifecycle skills and `sp-debug`'s `systematic-debugging` assignment are resolved before any child process runs in a worktree.

Agent reports themselves are returned inline through Pi tool results. Worktree isolation does not require `implementer-report.md`, `spec-review.md`, or `code-review.md` files in the worktree. Worktree isolation and session mode are separate concerns: packet handoff files live in the session artifact directory, not inside the worktree, and are cleaned up by the runtime.

## Execution and Lifecycle

Execution is strictly synchronous and blocking. Worktree-backed parallel children are joined before cleanup; this policy is unchanged.

Lifecycle tools (`subagent_done`, `caller_ping`) are internal child-only tools registered through policy; they are not user-configurable delegation controls or worktree settings.

## Extension Loading

Extension loading for subagents is independent of worktree isolation. Even when running inside a git worktree, child Pi processes load extensions from `superagents.extensions` (global config) and the `extensions` field in agent frontmatter (additive to global). Implicit Pi extension discovery is disabled by default; only explicitly configured extensions are loaded. Configured entries may be local paths or normal Pi `-e` source specs such as `npm:@scope/package`; relative local paths resolve from the subagent runtime working directory.

## Requirements

- Must be inside a git repository.
- Working tree must be clean (no uncommitted changes). Commit or stash before running parallel tasks.
- `node_modules/` is symlinked into each worktree when it is safe to do so, avoiding unnecessary dependency installs.
- Worktree runs use the shared parallel `cwd`. Task-level `cwd` overrides must be omitted or match that shared `cwd`.
- A configured project-local `worktrees.root` must be ignored by git, such as through `.gitignore`.

## Internals

1. `git worktree add` creates a temporary worktree per agent in the system temp directory.
2. If the resolved command behavior sets `worktrees.root`, worktrees are created under that directory instead of the system temp directory.
3. Each agent runs in its worktree's cwd.
4. Before diff capture, synthetic helper paths created by Pi Superagents, such as a safe `node_modules` symlink, are removed.
5. After execution, `git add -A && git diff --cached` captures all changes.
6. Diff stats appear in the aggregated output; full `.patch` files are written to the artifacts directory.
7. Worktrees and temporary branches are cleaned up automatically.

## Configuration

See [Configuration Reference](configuration.md) for `superagents.commands.<name>.worktrees.*` config keys.

The `/sp-settings` overlay also shows Superpowers model tiers and command-scoped workflow toggles. Use `c` to select a command before pressing `w`; worktree toggles are written to the selected command preset. Tier edits apply immediately to future subagents, while worktree command registration changes may still require a PI reload.

## Release Notes

Worktree behavior affects parallel execution safety, so user-facing changes to this subsystem should be called out in `CHANGELOG.md` before publishing. Follow the [Release Process](releases.md) when preparing a version that changes worktree defaults, cleanup, branch behavior, or artifact output.