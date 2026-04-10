# Worktree Isolation Reference

When multiple agents run in parallel against the same repo, they can clobber each other's file changes. Pass `worktree: true` to give each parallel agent its own git worktree branched from HEAD.

## Usage

```typescript
// Top-level parallel with worktree isolation
{ tasks: [
  { agent: "worker", task: "Implement auth", count: 2 },
  { agent: "worker", task: "Implement API" }
], worktree: true }

// Chain with worktree-isolated parallel step
{ chain: [
  { agent: "scout", task: "Gather context" },
  { parallel: [
    { agent: "worker", task: "Implement feature A based on {previous}" },
    { agent: "worker", task: "Implement feature B based on {previous}" }
  ], worktree: true },
  { agent: "reviewer", task: "Review all changes from {previous}" }
]}
```

After parallel completion, per-agent diff stats are appended to the output (and become `{previous}` for the next chain step). Full patch files are written to disk.

## Requirements

- Must be inside a git repository
- Working tree must be clean (no uncommitted changes) — commit or stash first
- `node_modules/` is symlinked into each worktree to avoid reinstalling
- Worktree runs use the shared parallel/step `cwd`. Task-level `cwd` overrides must be omitted or match that shared `cwd`
- If `superagents.worktrees.setupHook` is configured for a Superpowers run, it must return valid JSON and complete before timeout

## Internals

1. `git worktree add` creates a temporary worktree per agent in `<tmpdir>/pi-worktree-*`
2. Optional `superagents.worktrees.setupHook` runs once per worktree for Superpowers runs (JSON in on stdin, JSON out on stdout)
3. Each agent runs in its worktree's cwd (preserving subdirectory context)
4. Before diff capture, declared synthetic helper paths are removed
5. After execution, `git add -A && git diff --cached` captures all real changes
6. Diff stats appear in the aggregated output; full `.patch` files written to artifacts directory
7. Worktrees and temp branches are cleaned up in a `finally` block

## Worktree Setup Hook

`superagents.worktrees.setupHook` runs once per created Superpowers worktree, after `git worktree add` succeeds and before the agent starts.

**Path rules:**
- Must be an absolute path or a repo-relative path
- Bare command names from `PATH` are rejected
- `~/...` is supported for home-directory hooks

**I/O contract (JSON only):**
- **stdin:** `{ repoRoot, worktreePath, agentCwd, branch, index, runId, baseCommit }`
- **stdout:** `{ "syntheticPaths": [".venv", ".env.local"] }`

`syntheticPaths` must be relative to the worktree root. These paths are removed before diff capture so helper files/symlinks don't pollute generated patches. Tracked-file edits are never excluded — if the hook tries to mark tracked paths as synthetic, setup fails.

## Superpowers Integration

Superpowers parallel steps default to `worktree: true` via `superagents.worktrees.enabled`. Set it to `false` in config if you want parallel steps to share the normal cwd unless a run explicitly opts in.

See [Configuration Reference](configuration.md) for `superagents.worktrees.*` config keys.