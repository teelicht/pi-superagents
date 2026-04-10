# Superpowers Guide

The `/superpowers` command activates a structured workflow for task execution with role-specific agents, model tiers, and built-in quality gates.

## Overview

When you use `/superpowers`, pi-superagents runs your task through a bounded workflow with specialized agents (recon, plan, implement, review) instead of the freeform `/run` or `/chain` commands. The baseline `pi` harness plus generic `pi-superagents` behavior stays unchanged unless this command is used.

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

## Built-in Superpowers Agents

| Role | Agent | Purpose |
|------|-------|---------|
| Recon | `sp-recon` | Bounded reconnaissance for task discovery |
| Research | `sp-research` | Focused evidence gathering |
| Implementer | `sp-implementer` | One bounded plan task implementation |
| Code Review | `sp-code-review` | Code-quality reviewer for a single task packet |
| Spec Review | `sp-spec-review` | Spec compliance reviewer |
| Debug | `sp-debug` | One bounded failure investigation |

## Model Tiers

Superpowers agents can use model tiers defined in config, mapping role-appropriate models to cheap/balanced/max quality levels.

```json
{
  "superagents": {
    "modelTiers": {
      "cheap": { "model": "openai/gpt-5.3-mini", "thinking": "off" },
      "balanced": { "model": "openai/gpt-5.4", "thinking": "medium" },
      "max": { "model": "anthropic/claude-opus-4-6", "thinking": "high" }
    }
  }
}
```

### Custom Tiers

Define your own tier names beyond the built-in ones:

```json
{
  "superagents": {
    "modelTiers": {
      "cheap": { "model": "openai/gpt-5.3-mini" },
      "creative": { "model": "anthropic/claude-sonnet-4", "thinking": "high" }
    }
  }
}
```

Then use in agent frontmatter: `model: creative`. Tier resolution works in all workflows (`/run`, `/chain`, `/parallel`, `/superpowers`).

## Worktree Integration

Superpowers parallel steps default to worktree isolation via `superagents.worktrees.enabled` (defaults to `true`). Each parallel agent gets its own git worktree to prevent filesystem conflicts.

Configure in `~/.pi/agent/extensions/subagent/config.json`:

```json
{
  "superagents": {
    "worktrees": {
      "enabled": true,
      "root": null,
      "setupHook": "./scripts/setup-worktree.mjs",
      "setupHookTimeoutMs": 45000
    }
  }
}
```

See [Worktree Reference](../reference/worktrees.md) for the full hook contract and internals.

## Configuration

All Superpowers configuration lives under the `superagents` key in `config.json`. See [Configuration Reference](../reference/configuration.md) for the complete schema.

## Flags

Superpowers supports the same runtime flags as other slash commands:

- `--bg` — run in the background
- `--fork` — run with branched session context
- Combine: `/superpowers tdd harden auth --fork --bg`