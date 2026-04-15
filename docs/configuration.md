# Configuration

`@teelicht/pi-superagents` loads configuration in two layers: **bundled defaults** and **user overrides**.

Bundled defaults ship inside the package and provide sensible baseline values. User overrides live in:

```text
~/.pi/agent/extensions/subagent/config.json
```

This file is user-owned. A fresh install creates it as an empty override:

```json
{}
```

At runtime, user overrides merge on top of the bundled defaults — you only need to specify the settings you want to change. Full parseable examples are available in:

```text
~/.pi/agent/extensions/subagent/config.example.json
```

## Validation

`pi-superagents` fails closed when `config.json` cannot be trusted. If the file has invalid JSON, unknown keys, or wrong value types, subagent execution is disabled until the file is fixed.

If `config.json` duplicates the entire bundled default, the extension warns and offers a one-click migration to replace it with an empty override. This avoids drifted copies that mask changing defaults.

When Pi starts, the extension shows a notification with the config path and exact diagnostics. You can also inspect diagnostics with:

```text
/sp-settings
```

## Configuration Keys

### `superagents`

Configures the Superpowers workflow and role execution policy.

| Key                        | Description                                                                                                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useBranches`              | Require a dedicated git branch for each Superpowers implementation plan or spec (default: `false`).                                                                     |
| `useSubagents`             | Allow root Superpowers workflows to delegate through the `subagent` tool when active skills call for delegation (default: `true`).                                      |
| `useTestDrivenDevelopment` | Add test-driven-development guidance to `sp-implementer` runs (default: `true`).                                                                                        |
| `usePlannotator`           | Open the optional Plannotator browser review UI at Superpowers plan/spec approval points and wait for approval/rejection (default: `false`).                            |
| `commands`                 | Map of custom Superpowers slash command presets. Command names must match `superpowers-<name>` or `sp-<name>`.                                                          |
| `modelTiers`               | Maps abstract tier names (`cheap`, `balanced`, `max`, plus any custom tiers) to concrete model configs. Custom tiers are defined by adding new keys.                    |
| `worktrees.enabled`        | Whether to use git worktree isolation for parallel tasks (bundled default: `false`). When false, Superpowers root prompts and subagent runs must not request worktrees. |
| `worktrees.root`           | Directory for Superpowers parallel worktrees (default: system temp).                                                                                                    |
| `skillOverlays`            | Maps entry skill names to arrays of additional skill names to load alongside them in skill-entry flows (default: `{}`).                                                   |
| `interceptSkillCommands`   | List of skill names that should be intercepted and handled by Superpowers (default: `[]`). Only `brainstorming` is currently supported.                                 |
| `superpowersSkills` | List of Superpowers process skill names whose `skillOverlays` are resolved at session start (bundled default, not user-configurable yet). |


## Common Override Examples

Override one model tier while inheriting the rest:

```json
{
  "superagents": {
    "modelTiers": {
      "max": {
        "model": "anthropic/claude-3-5-sonnet",
        "thinking": "medium"
      }
    }
  }
}
```

Keep worktree creation disabled for parallel tasks:

```json
{
  "superagents": {
    "worktrees": {
      "enabled": false
    }
  }
}
```

Enable worktree isolation with a project-local root:

```json
{
  "superagents": {
    "worktrees": {
      "enabled": true,
      "root": ".worktrees"
    }
  }
}
```

If `root` is inside your repository, it must be ignored by git.

Enable the optional Plannotator browser review flow at the plan approval point:

```json
{
  "superagents": {
    "usePlannotator": true
  }
}
```

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

### Tier Schema

Each tier in `modelTiers` can be a string (model ID) or an object:

```json
{
  "model": "anthropic/claude-4-6-sonnet",
  "thinking": "low"
}
```

**Supported thinking levels:** `off`, `minimal`, `low`, `medium`, `high`, `xhigh`.

### Custom Tiers

You can define custom tiers (e.g., `creative`, `legacy`) beyond the built-in `cheap`, `balanced`, and `max`. Any non-empty string key in `modelTiers` is valid:

```json
{
  "superagents": {
    "modelTiers": {
      "creative": {
        "model": "anthropic/claude-sonnet-4",
        "thinking": "high"
      },
      "legacy": {
        "model": "openai/gpt-4o"
      }
    }
  }
}
```

Reference a custom tier using either of two approaches:

**Project-local agent override.** Place an agent `.md` file in your project's `.agents/` directory (or `.pi/agents/`) with the same `name` as a builtin agent and set `model` to your custom tier:

```markdown
---
name: sp-implementer
description: Superpowers-native implementer for one bounded plan task
model: creative
tools: read, grep, find, ls, bash, write
maxSubagentDepth: 0
---

You are a bounded implementer.
...
```

This overrides the builtin `sp-implementer` agent to use the `creative` tier instead of the default `cheap`.

**Subagent tool parameter.** Pass a tier name (built-in or custom) as the `model` parameter when calling the subagent tool directly:

```json
{
  "agent": "sp-research",
  "task": "Investigate the auth flow",
  "model": "creative"
}
```

## Custom Commands

You can define preset slash commands in your `config.json` that use the same Superpowers workflow as `/sp-implement`. Two example presets ship in `config.example.json`:

- `/sp-lean` — Disables subagents and TDD for a minimal workflow.
- `/sp-plannotator` — Enables Plannotator browser review.

Each preset field overrides the corresponding global default. Omitted fields inherit their values from the top-level `superagents` settings.

| Command          | Description                                     | Overrides                                                |
| ---------------- | ----------------------------------------------- | -------------------------------------------------------- |
| `sp-lean`        | Run Superpowers lean: no subagents, no TDD      | `useSubagents: false`, `useTestDrivenDevelopment: false` |
| `sp-plannotator` | Run Superpowers with Plannotator review enabled | `usePlannotator: true`                                   |

Copy either or both into your own `config.json` to try them out, or define your own:

```json
{
  "superagents": {
    "commands": {
      "sp-review": {
        "description": "Review-focused Superpowers run",
        "useBranches": false,
        "useSubagents": true,
        "useTestDrivenDevelopment": false,
        "usePlannotator": false,
        "worktrees": {
          "enabled": false,
          "root": null
        }
      }
    }
  }
}
```

**Preset field inheritance:** Each preset field overrides the corresponding global `superagents` default. Omitted fields inherit from global defaults through the existing merge chain. The `sp-lean` preset only sets `useSubagents` and `useTestDrivenDevelopment` — all other fields (like `useBranches`, `usePlannotator`) still inherit their default values.

Supported preset keys are `description`, `useBranches`, `useSubagents`, `useTestDrivenDevelopment`, `usePlannotator`, and `worktrees`. Preset `worktrees` supports only `enabled` and `root`.

Command names must match `superpowers-<name>` or `sp-<name>` (lowercase alphanumeric and hyphens).

## Worktree Isolation

Parallel tasks within the Superpowers workflow can use git worktrees to prevent filesystem conflicts, but this is not enabled by default. Enable it with `superagents.worktrees.enabled` when you want isolated worktree execution for parallel tasks.

```json
{
  "superagents": {
    "worktrees": {
      "enabled": true,
      "root": ".worktrees"
    }
  }
}
```

If `root` is inside your repository, make sure it is ignored by git before enabling it. Custom Superpowers commands can also override worktree behavior with `superagents.commands.<name>.worktrees`.

See [Worktree Reference](worktrees.md) for full details.

## Branch Policy

Branch policy is separate from worktree isolation. Enable `superagents.useBranches` when you want the root Superpowers workflow to require one dedicated git branch for an implementation plan or spec.

```json
{
  "superagents": {
    "useBranches": true
  }
}
```

Worktrees are temporary filesystem isolation for parallel subagents. Branch policy is a root workflow rule for organizing implementation work.

## Plannotator Browser Review

Enable the optional browser review flow in your config:

```json
{
  "superagents": {
    "usePlannotator": true
  }
}
```

Install [Plannotator](https://plannotator.ai/) separately before enabling the review UI. It is an optional dependency for the visual browser review flow:

```text
pi install npm:@plannotator/pi-extension
```

Important details regarding the Plannotator integration:

- **Plannotator is optional**: If you enable `usePlannotator` without installing Plannotator, Superpowers falls back to the normal in-chat approval flow.
- **Shared Event API**: `pi-superagents` exclusively uses Plannotator's shared event API.
- **Browser Assets**: The currently published Plannotator Pi extension includes the browser assets and event listener. Standalone public web-component packages are not required for this integration.
- **Distinct Workflows**: Installing Plannotator also registers Plannotator's own commands and shortcuts, but those are separate from this bridge. You should not activate Plannotator's native `/plannotator` plan mode for the same Superpowers workflow.

Behavior:

1. When Superpowers reaches plan approval, it opens the Plannotator browser review UI if the extension is installed and `usePlannotator` is `true`.
2. `pi-superagents` publishes the review request through Plannotator's shared event API and waits for an approval or rejection event.
3. If you approve or reject in the browser UI, the Superpowers workflow resumes with that decision.
4. If Plannotator is unavailable, not installed, or the browser review flow cannot start, Superpowers falls back to the standard in-chat approval flow.

## Skill Overlays

Skill overlays load additional skills alongside the entry skill. Two mechanisms resolve overlays:

- **Entry overlays** — resolve for the skill that starts the session (e.g., `skillOverlays["brainstorming"]` when `/sp-brainstorm` runs)
- **Invocation overlays** — resolve for all skills in `superpowersSkills` regardless of entry path (e.g., `skillOverlays["writing-plans"]` resolves even for `/sp-implement`)

```json
{
  "superagents": {
    "skillOverlays": {
      "brainstorming": ["react-native-best-practices"],
      "writing-plans": ["supabase-postgres-best-practices"]
    }
  }
}
```

Keys must be non-empty skill names. Values must be arrays of non-empty skill names. Missing overlay skills are blocking errors at runtime.

> [!NOTE]
> `writing-plans` overlays (e.g., `supabase-postgres-best-practices`) now kick in for all Superpowers commands because `writing-plans` is in the bundled `superpowersSkills` list — not just for commands whose entry skill is `writing-plans`.

### Overlay Resolution Behavior

| Entry path | entrySkill | Entry overlay | Invocation overlays |
|---|---|---|---|
| `/sp-brainstorm` | `{ name: "brainstorming", source: "command" }` | `skillOverlays["brainstorming"]` | `skillOverlays[superpowersSkills[*]]` |
| `/sp-implement` | `{ name: "using-superpowers", source: "implicit" }` | `skillOverlays["using-superpowers"]` | `skillOverlays[superpowersSkills[*]]` |
| Custom command | `{ name: "using-superpowers", source: "implicit" }` | `skillOverlays["using-superpowers"]` | `skillOverlays[superpowersSkills[*]]` |
| `/skill:brainstorming` (intercepted) | `{ name: "brainstorming", source: "intercepted-skill" }` | `skillOverlays["brainstorming"]` | `skillOverlays[superpowersSkills[*]]` |

Keys must be non-empty skill names. Values must be arrays of non-empty skill names. Missing overlay skills are blocking errors at runtime.

The `config.example.json` file ships with two overlay presets that demonstrate common pairings:

- `brainstorming` → `["react-native-best-practices"]`
- `writing-plans` → `["supabase-postgres-best-practices"]`

Copy these into your own `config.json` to try them out.

### Saved-Spec Plannotator Review

When `usePlannotator` is enabled, the Superpowers workflow calls `superpowers_spec_review` after the brainstorming session saves an approved spec. This triggers Plannotator's browser review for the saved spec before transitioning to `writing-plans`.

## Direct Skill Interception

By default, Pi skill commands like `/skill:brainstorming` run through Pi's native skill expansion. You can opt in to intercept specific skill commands and route them through the Superpowers workflow instead.

```json
{
  "superagents": {
    "interceptSkillCommands": ["brainstorming"]
  }
}
```

Currently only `brainstorming` is supported. When enabled:

- `/skill:brainstorming <task>` is handled by Superpowers with the same profile and Plannotator integration as `/sp-brainstorm`.
- Skill commands not in the list continue through native Pi behavior.
- Extension-injected messages are not re-intercepted.

Interception works independently of skill overlays. You can use `interceptSkillCommands` on its own, skill overlays on their own (e.g., with `/sp-brainstorm`), or combine both:

```json
{
  "superagents": {
    "interceptSkillCommands": ["brainstorming"],
    "skillOverlays": {
      "brainstorming": ["react-native-best-practices"]
    }
  }
}
```

## Superpowers Skills

The `superpowersSkills` list defines which skill names are Superpowers process skills. It lives in the bundled `default-config.json` and is not user-configurable yet — defined in bundled defaults only.

For skills in this list, invocation overlays resolve regardless of entry path. This means skill overlays for these names apply to all Superpowers commands, not just the command that directly invokes that skill.

New Superpowers skills can be added by updating `default-config.json`. The current list:

```json
"superpowersSkills": [
  "using-superpowers",
  "brainstorming",
  "writing-plans",
  "executing-plans",
  "test-driven-development",
  "requesting-code-review",
  "receiving-code-review",
  "verification-before-completion",
  "subagent-driven-development",
  "dispatching-parallel-agents",
  "using-git-worktrees",
  "finishing-a-development-branch"
]
```

## Status and Settings

Use `/subagents-status` to inspect active and recent subagent runs. The same overlay is available through `Ctrl+Option+S` on macOS, represented internally as `ctrl+alt+s`.

Use `/sp-settings` to inspect and toggle workflow settings such as `useSubagents`, `useTestDrivenDevelopment`, and worktree behavior. It also surfaces config validation diagnostics.

# Superpowers Workflow

## Brainstorming

Use `/sp-brainstorm` to run brainstorming through the Superpowers workflow. This loads the `brainstorming` skill as the entry point with optional overlay skills and Plannotator saved-spec review.

```text
/sp-brainstorm design the new onboarding flow
/sp-brainstorm explore mobile push notification options
```

## Implementation

The `/sp-implement` command activates a structured workflow for task execution with role-specific agents, model tiers, and built-in quality gates.

```text
/sp-implement fix the auth regression
/sp-implement tdd implement the cache invalidation task
/sp-implement direct update the Expo config
/sp-implement tdd review the release branch --fork
```

| Mode     | Description                                                                    |
| -------- | ------------------------------------------------------------------------------ |
| `tdd`    | Test-first implementer loop with the `test-driven-development` skill (default) |
| `direct` | Same review and verification loop, but code-first implementation               |

You can specify the mode as the first argument: `/sp-implement tdd <task>` or `/sp-implement direct <task>`. If nothing is specified, the default configuration from `config.json` is applied.

# Role Agents

The workflow uses a sequence of specialized role agents. Each agent is purpose-built for its phase:

| Role        | Agent            | Purpose                                                          |
| ----------- | ---------------- | ---------------------------------------------------------------- |
| Recon       | `sp-recon`       | Bounded reconnaissance for task discovery and context gathering. |
| Research    | `sp-research`    | Focused evidence gathering for APIs or complex logic.            |
| Implementer | `sp-implementer` | Execution of planned code changes with verification.             |
| Code Review | `sp-code-review` | Code-quality reviewer for implementation results.                |
| Spec Review | `sp-spec-review` | Verification of changes against design specifications.           |
| Debug       | `sp-debug`       | Bounded failure investigation and root-cause analysis.           |
