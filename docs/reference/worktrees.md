# Worktree Isolation Reference

When multiple agents run in parallel against the same repository, they can clobber each other's file changes. Pi Superagents can automatically give each parallel agent its own git worktree branched from HEAD to provide perfect isolation.

## Usage

Worktree isolation can be enabled for Superpowers parallel tasks with `superagents.worktrees.enabled`.

```typescript
// Parallel with worktree isolation when superagents.worktrees.enabled is true
{ tasks: [
  { agent: "sp-implementer", task: "Implement auth" },
  { agent: "sp-implementer", task: "Implement API" }
], workflow: "superpowers" }
```

After parallel completion, per-agent diff stats are appended to the output. Full patch files are written to the artifacts directory.

## Requirements

- Must be inside a git repository.
- Working tree must be clean (no uncommitted changes). Commit or stash before running parallel tasks.
- `node_modules/` is symlinked into each worktree to avoid re-installation.
- Worktree runs use the shared parallel `cwd`. Task-level `cwd` overrides must be omitted or match that shared `cwd`.

## Internals

1. `git worktree add` creates a temporary worktree per agent in the system temp directory.
2. Optional `superagents.worktrees.setupHook` runs once per worktree (JSON in on stdin, JSON out on stdout).
3. Each agent runs in its worktree's cwd.
4. Before diff capture, declared synthetic helper paths are removed.
5. After execution, `git add -A && git diff --cached` captures all changes.
6. Diff stats appear in the aggregated output; full `.patch` files are written to the artifacts directory.
7. Worktrees and temporary branches are cleaned up automatically.

## Worktree Setup Hook

`superagents.worktrees.setupHook` runs once per created worktree, after `git worktree add` succeeds and before the agent starts.

**Path rules:**
- Must be an absolute path or a repo-relative path.
- Bare command names from `PATH` are rejected.
- `~/...` is supported for home-directory hooks.

**I/O contract (JSON only):**
- **stdin:** `{ repoRoot, worktreePath, agentCwd, branch, index, runId, baseCommit }`
- **stdout:** `{ "syntheticPaths": [".venv", ".env.local"] }`

`syntheticPaths` must be relative to the worktree root. These paths are removed before diff capture so helper files or symlinks don't pollute generated patches.

## Configuration

See [Configuration Reference](configuration.md) for `superagents.worktrees.*` config keys.
