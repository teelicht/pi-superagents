# Superpowers Guide

The `/superpowers` command activates a structured workflow for task execution with role-specific agents, model tiers, and built-in quality gates.

## Overview

When you use `/superpowers`, pi-superagents runs your task through a bounded workflow with specialized agents (recon, research, implement, review) instead of a single generic agent. This structured approach ensures that context is gathered before implementation and that results are verified before completion.

```text
/superpowers fix the auth regression
/superpowers tdd implement the cache invalidation task
/superpowers direct update the Expo config
/superpowers tdd review the release branch --fork
```

## Implementer Modes

| Mode      | Description |
|-----------|-------------|
| `tdd`     | Test-first implementer loop with the `test-driven-development` skill (default) |
| `direct`  | Same review and verification loop, but code-first implementation |

Specify the mode as the first argument: `/superpowers tdd <task>` or `/superpowers direct <task>`.

## Role Agents

The workflow uses a sequence of specialized role agents. Each agent is purpose-built for its phase:

| Role | Agent | Purpose |
|------|-------|---------|
| Recon | `sp-recon` | Bounded reconnaissance for task discovery and context gathering. |
| Research | `sp-research` | Focused evidence gathering for APIs or complex logic. |
| Implementer | `sp-implementer` | Execution of planned code changes with verification. |
| Code Review | `sp-code-review` | Code-quality reviewer for implementation results. |
| Spec Review | `sp-spec-review` | Verification of changes against design specifications. |
| Debug | `sp-debug` | Bounded failure investigation and root-cause analysis. |

## Model Tiers

Superpowers agents use abstract model tiers defined in your configuration. This allows you to scale quality and cost without modifying individual agent files.

```json
{
  "superagents": {
    "modelTiers": {
      "cheap": { "model": "openai/gpt-4o-mini", "thinking": "off" },
      "balanced": { "model": "anthropic/claude-3-5-sonnet", "thinking": "low" },
      "max": { "model": "anthropic/claude-3-5-sonnet", "thinking": "medium" }
    }
  }
}
```

### Custom Tiers

You can define custom tiers (e.g., "creative", "legacy") in the `modelTiers` object and reference them in project-local agent overrides.

## Worktree Isolation

Parallel tasks within the Superpowers workflow automatically use git worktrees to prevent filesystem conflicts. This is enabled by default via `superagents.worktrees.enabled`.

Configure in `~/.pi/agent/extensions/subagent/config.json`:

```json
{
  "superagents": {
    "worktrees": {
      "enabled": true,
      "setupHook": "./scripts/setup-worktree.mjs"
    }
  }
}
```

See [Worktree Reference](../reference/worktrees.md) for full details.

## Runtime Flags

- `--bg`: Run in the background. Progress is shown in the async status overlay.
- `--fork`: Run with `context: "fork"`, branching from the current session state.
