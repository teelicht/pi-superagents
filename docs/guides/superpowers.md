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

## Brainstorming Entry

Use `/sp-brainstorm` to run brainstorming through the Superpowers workflow. This loads the `brainstorming` skill as the entry point with optional overlay skills and Plannotator saved-spec review.

```text
/sp-brainstorm design the new onboarding flow
/sp-brainstorm explore mobile push notification options
```

### Skill Overlays

Configure additional skills to load alongside the brainstorming entry skill:

```json
{
  "superagents": {
    "skillOverlays": {
      "brainstorming": ["react-native-best-practices", "accessibility-guidelines"]
    }
  }
}
```

### Saved-Spec Plannotator Review

When `usePlannotator` is enabled, the Superpowers workflow calls `superpowers_spec_review` after the brainstorming session saves an approved spec. This triggers Plannotator's browser review for the saved spec before transitioning to `writing-plans`.

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

Parallel tasks within the Superpowers workflow can use git worktrees to prevent filesystem conflicts, but this is not enabled by default. Enable it with `superagents.worktrees.enabled` when you want isolated worktree execution for parallel tasks.

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

## Optional Plannotator Browser Review

Enable the optional browser review flow in `~/.pi/agent/extensions/subagent/config.json`:

```json
{
  "superagents": {
    "usePlannotator": true
  }
}
```

Install Plannotator separately before enabling the review UI:

```text
pi install npm:@plannotator/pi-extension
```

If you enable `usePlannotator` before installing Plannotator, Superpowers does not fail; it falls back to the normal in-chat approval flow.

Behavior:

1. When Superpowers reaches plan approval, it opens the Plannotator browser review UI if the extension is installed and `usePlannotator` is `true`.
2. `pi-superagents` publishes the review request through Plannotator's shared event API and waits for an approval or rejection event.
3. If you approve or reject in the browser UI, the Superpowers workflow resumes with that decision.
4. If Plannotator is unavailable, not installed, or the browser review flow cannot start, Superpowers falls back to the standard in-chat approval flow.

Do not enable Plannotator's native `/plannotator` planning mode for the same Superpowers workflow.

## Runtime Flags

- `--bg`: Run in the background. Progress is shown in the async status overlay.
- `--fork`: Run with `context: "fork"`, branching from the current session state.
