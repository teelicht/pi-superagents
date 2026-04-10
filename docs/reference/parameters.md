# Parameters API Reference

These are the parameters the **LLM agent** passes when it calls the `subagent` tool — not something you type directly. For user-facing commands, see the [README](../../README.md#quick-commands).

## Tool Parameters

| Param             | Type                                    | Default                   | Description                                                                                                                                                        |
| ----------------- | --------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `agent`           | string                                  | -                         | Agent name (single mode) or target for management get/update/delete                                                                                                |
| `task`            | string                                  | -                         | Task string (single mode)                                                                                                                                          |
| `action`          | string                                  | -                         | Management action: `list`, `get`, `create`, `update`, `delete`                                                                                                     |
| `chainName`       | string                                  | -                         | Chain name for management get/update/delete                                                                                                                        |
| `config`          | object                                  | -                         | Agent or chain config for management create/update                                                                                                                 |
| `output`          | `string \| false`                       | agent default             | Override output file for single agent (absolute path as-is, relative path resolved against cwd)                                                                    |
| `skill`           | `string \| string[] \| false`           | agent default             | Override skills (comma-separated string, array, or false to disable)                                                                                               |
| `model`           | string                                  | agent default             | Override model for single agent                                                                                                                                    |
| `tasks`           | `{agent, task, cwd?, count?, skill?}[]` | -                         | Parallel tasks. `count` repeats one task entry N times with the same settings. |
| `worktree`        | boolean                                 | false                     | Create isolated git worktrees for each parallel task. Requires clean git state. Per-worktree diffs included in output.                                             |
| `chain`           | ChainItem[]                             | -                         | Sequential steps with behavior overrides (see below)                                                                                                               |
| `context`         | `"fresh" \| "fork"`                     | `fresh`                   | Execution context mode. `fork` uses a real branched session from the parent's current leaf for each child run                                                      |
| `chainDir`        | string                                  | `<tmpdir>/pi-chain-runs/` | Persistent directory for chain artifacts (default auto-cleaned after 24h)                                                                                          |
| `clarify`         | boolean                                 | true (chains)             | Show TUI to preview/edit chain; implies sync mode                                                                                                                  |
| `agentScope`      | `"user" \| "project" \| "both"`         | `both`                    | Agent discovery scope (project wins on name collisions)                                                                                                            |
| `async`           | boolean                                 | false                     | Background execution (requires `clarify: false` for chains)                                                                                                        |
| `cwd`             | string                                  | -                         | Override working directory                                                                                                                                         |
| `maxOutput`       | `{bytes?, lines?}`                      | 200KB, 5000 lines         | Truncation limits for final output                                                                                                                                 |
| `artifacts`       | boolean                                 | true                      | Write debug artifacts                                                                                                                                              |
| `includeProgress` | boolean                                 | false                     | Include full progress in result                                                                                                                                    |
| `share`           | boolean                                 | false                     | Upload session to GitHub Gist                                                                                                                                     |
| `sessionDir`      | string                                  | -                         | Override session log directory (takes precedence over `defaultSessionDir` and parent-session-derived path)                                                         |

`context: "fork"` fails fast when the parent session is not persisted, the current leaf is missing, or a branched child session cannot be created. It never silently downgrades to `fresh`.

## ChainItem Types

### Sequential Step

| Field      | Type                          | Default                  | Description                             |
| ---------- | ----------------------------- | ------------------------ | --------------------------------------- |
| `agent`    | string                        | required                 | Agent name                              |
| `task`     | string                        | `{task}` or `{previous}` | Task template (required for first step) |
| `cwd`      | string                        | -                        | Override working directory              |
| `output`   | `string \| false`             | agent default            | Override output filename or disable     |
| `reads`    | `string[] \| false`           | agent default            | Override files to read from chain dir   |
| `progress` | boolean                       | agent default            | Override progress.md tracking           |
| `skill`    | `string \| string[] \| false` | agent default            | Override skills or disable all          |
| `model`    | string                        | agent default            | Override model for this step            |

### Parallel Step

| Field         | Type           | Default  | Description                                          |
| ------------- | -------------- | -------- | ---------------------------------------------------- |
| `parallel`    | ParallelTask[] | required | Array of tasks to run concurrently                   |
| `concurrency` | number         | 4        | Max concurrent tasks                                 |
| `failFast`    | boolean        | false    | Stop remaining tasks on first failure                |
| `worktree`    | boolean        | false    | Create isolated git worktrees for each parallel task |

### ParallelTask

| Field      | Type                          | Default       | Description                                              |
| ---------- | ----------------------------- | ------------- | -------------------------------------------------------- |
| `agent`    | string                        | required      | Agent name                                               |
| `task`     | string                        | `{previous}`  | Task template                                            |
| `cwd`      | string                        | -             | Override working directory                               |
| `count`    | number                        | 1             | Repeat this parallel task N times with the same settings |
| `output`   | `string \| false`             | agent default | Override output (namespaced to parallel-N/M-agent/)      |
| `reads`    | `string[] \| false`           | agent default | Override files to read                                   |
| `progress` | boolean                       | agent default | Override progress tracking                               |
| `skill`    | `string \| string[] \| false` | agent default | Override skills or disable all                           |
| `model`    | string                        | agent default | Override model for this task                             |

## Management Actions

Agent definitions are not loaded into LLM context by default. Management actions let the LLM discover, inspect, create, and modify agent and chain definitions at runtime. Set `action` and omit execution payloads (`task`, `chain`, `tasks`).

```typescript
// Discover all agents and chains
{ action: "list" }
{ action: "list", agentScope: "project" }

// Inspect one agent or chain
{ action: "get", agent: "scout" }
{ action: "get", chainName: "review-pipeline" }

// Create agent
{ action: "create", config: {
  name: "Code Scout",
  description: "Scans codebases for patterns and issues",
  scope: "user",
  systemPrompt: "You are a code scout...",
  model: "anthropic/claude-sonnet-4",
  tools: "read, bash, mcp:github/search_repositories",
  extensions: "", // empty = no extensions
  skills: "parallel-scout",
  thinking: "high",
  output: "context.md",
  reads: "shared-context.md",
  progress: true
}}

// Create chain (presence of steps creates .chain.md)
{ action: "create", config: {
  name: "review-pipeline",
  description: "Scout then review",
  scope: "project",
  steps: [
    { agent: "scout", task: "Scan {task}", output: "context.md" },
    { agent: "reviewer", task: "Review {previous}", reads: ["context.md"] }
  ]
}}

// Update agent fields (merge semantics)
{ action: "update", agent: "scout", config: { model: "openai/gpt-4o" } }
{ action: "update", agent: "scout", config: { output: false, skills: "" } } // clear field

// Delete definitions
{ action: "delete", agent: "scout" }
{ action: "delete", chainName: "review-pipeline" }
```

Notes:
- `create` uses `config.scope` (`"user"` or `"project"`), not `agentScope`.
- `update`/`delete` use `agentScope` only for scope disambiguation when the same name exists in both scopes.
- To clear any optional field, set it to `false` or `""` (e.g., `{ model: false }` or `{ skills: "" }`).

## Status Tool

```typescript
// List active async runs
{ action: "list" }

// Inspect one run
{ id: "a53ebe46" }

// Inspect by directory
{ dir: "<tmpdir>/pi-async-subagent-runs/a53ebe46-..." }
```

## Session Sharing

When `share: true` is passed, the extension exports the full session and uploads to a GitHub Gist, returning a shareable URL.

Requirements:
- GitHub CLI (`gh`) must be installed and authenticated
- Gists are created as "secret" (unlisted but accessible with the URL)
- **Disabled by default** — session data may contain sensitive information