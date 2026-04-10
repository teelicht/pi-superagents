# Chains Guide

How to create, use, and manage chain files for multi-step agent pipelines.

## Overview

Chains are `.chain.md` files stored alongside agent files, defining reusable multi-step pipelines. Each `## agent-name` section defines a step. Config lines go after the header, and a blank line separates config from the task text.

## Chain File Locations

| Scope   | Path                                 |
| ------- | ------------------------------------ |
| User    | `~/.pi/agent/agents/{name}.chain.md` |
| Project | `.pi/agents/{name}.chain.md`         |

## Format

```markdown
---
name: scout-planner
description: Gather context then plan implementation
---

## scout

output: context.md

Analyze the codebase for {task}

## planner

reads: context.md
model: anthropic/claude-sonnet-4-5:high
progress: true

Create an implementation plan based on {previous}
```

### Config Lines

| Line | Example | Description |
|------|---------|-------------|
| `output` | `output: context.md` | Write results to file |
| `reads` | `reads: a.md+b.md` | Read files before executing |
| `model` | `model: anthropic/claude-sonnet-4` | Override model for this step |
| `skills` | `skills: planning+review` | Override skills (`+` separates) |
| `progress` | `progress: true` | Enable progress tracking |

Omission means "inherit from agent". Set `output: false` or `reads: false` to explicitly disable.

### Creating Chains

- From the Agents Manager: choose "Blank Chain" template, then add steps.
- From the clarify TUI: press `W` during a chain clarification to save the current configuration as a `.chain.md` file.

## Chain Variables

| Variable      | Description                                                       |
| ------------- | ----------------------------------------------------------------- |
| `{task}`      | Original task from first step (use in subsequent steps)           |
| `{previous}`  | Output from prior step (or aggregated outputs from parallel step) |
| `{chain_dir}` | Path to chain artifacts directory                                 |

### Parallel Output Aggregation

When a parallel step completes, all outputs are concatenated with clear separators:

```
=== Parallel Task 1 (worker) ===
[output from first task]

=== Parallel Task 2 (worker) ===
[output from second task]
```

This aggregated output becomes `{previous}` for the next step.

## Parallel Steps in Chains

Use `{ parallel: [...] }` in a chain to fan out:

```typescript
{ chain: [
  { agent: "scout", task: "Gather context for the codebase" },
  { parallel: [
    { agent: "worker", task: "Implement auth based on {previous}", count: 2 },
    { agent: "worker", task: "Implement API based on {previous}" }
  ]},
  { agent: "reviewer", task: "Review all changes from {previous}" }
]}
```

Parallel step options:
- `concurrency` — max concurrent tasks (default: 4)
- `failFast` — stop remaining tasks on first failure
- `worktree` — create isolated git worktrees for each task (see [Worktree Reference](../reference/worktrees.md))

## Running Chains

Via slash commands:

```text
/chain scout "analyze auth" -> planner "create plan"
/chain scout planner -- analyze the auth system
```

Via tool calls:

```typescript
{ chain: [
  { agent: "scout", task: "Gather context" },
  { agent: "planner" },  // task defaults to {previous}
  { agent: "worker" }    // uses agent defaults
]}
```

### Background & Forked

```text
/chain scout "analyze auth" -> planner "plan refactor" --bg
/chain scout "analyze auth" -> planner "plan refactor" --fork
/chain scout "analyze auth" -> planner "plan refactor" --fork --bg
```

### Clarification TUI

Chains default to `clarify: true`, which shows the TUI for previewing/editing before execution.

Keybindings:
- `Enter` — Run (or launch in background if `b` is toggled)
- `Esc` — Cancel
- `↑↓` — Navigate steps
- `e` — Edit task/template
- `m` — Select model
- `t` — Select thinking level
- `s` — Select skills
- `b` — Toggle background mode
- `w` — Edit writes/output file
- `r` — Edit reads list
- `p` — Toggle progress tracking
- `S` — Save overrides to agent frontmatter
- `W` — Save chain configuration to `.chain.md`

## Chain Directory

Each chain run creates `<tmpdir>/pi-chain-runs/{runId}/` containing:
- `context.md` — Scout/context-builder output
- `plan.md` — Planner output
- `progress.md` — Worker/reviewer shared progress
- `parallel-{stepIndex}/` — Subdirectories for parallel step outputs
- Additional files as written by agents

Directories older than 24 hours are cleaned up on extension startup.