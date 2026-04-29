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

## Built-in Commands

The bundled defaults define three built-in commands:

| Command | Entry Skill | Policy Settings |
|---|---|---|
| `sp-implement` | `using-superpowers` | `useSubagents: true`, `useTestDrivenDevelopment: true`, `useBranches: false`, `worktrees: { enabled: false }` |
| `sp-brainstorm` | `brainstorming` | `usePlannotator: true` |
| `sp-plan` | `writing-plans` | `usePlannotator: true` |

Built-in commands cannot be overridden by user config. Create a custom command with a different name instead.

## Configuration Keys

### `superagents`

Configures the Superpowers workflow.

| Key | Description |
|---|---|
| `commands` | Map of command presets. Each preset has an `entrySkill` and per-command policy booleans. |
| `extensions` | Array of extension paths or package IDs that every subagent receives. Implicit Pi extension discovery is disabled by default; add extensions here for child Pi processes. |
| `modelTiers` | Maps abstract tier names (`cheap`, `balanced`, `max`, plus any custom tiers) to concrete model configs. |
| `skillOverlays` | Maps entry skill names to arrays of additional skill names to load alongside them. |
| `interceptSkillCommands` | List of skill names intercepted for Superpowers entry (`brainstorming`, `writing-plans`). |
| `superpowersSkills` | List of Superpowers process skill names (bundled default, not user-configurable). |

### Extension Allowlist

Subagents run with implicit Pi extension discovery disabled by default. Configure `superagents.extensions` as a global list of extensions that every subagent should receive:

```json
{
  "superagents": {
    "extensions": ["./src/extension/custom-subagent-tools.ts"]
  }
}
```

Agent frontmatter can append additional extensions per-agent using the `extensions` field, which is additive to the global list. Extensions declared in agent frontmatter are appended to the global `extensions` array at session launch.

### Command Presets

Each command preset supports these keys:

| Key | Description |
|---|---|
| `description` | Command description shown in help. |
| `entrySkill` | Entry skill name (e.g., `using-superpowers`, `brainstorming`, `writing-plans`). |
| `useBranches` | Require dedicated git branch for plans/specs. |
| `useSubagents` | Allow delegation through `subagent` tool. |
| `useTestDrivenDevelopment` | Enable TDD guidance. |
| `usePlannotator` | Enable Plannotator browser review at approval points. |
| `worktrees.enabled` | Use git worktree isolation for parallel tasks. |
| `worktrees.root` | Directory for worktrees (default: system temp). |

## Inline Role Output

Superpowers role agents return their findings through Pi tool results. The runtime no longer configures packet output files, so `sp-implementer`, `sp-spec-review`, `sp-code-review`, and `sp-debug` do not create repo-root handoff files during normal subagent-driven development.

Execution artifacts are still available when `artifacts` is enabled. Those files are written to the session artifact directory for debugging and truncation recovery, not to the repository root.

## Compact Inline Subagent Results

Subagent tool results are rendered inline in the Pi conversation as compact, width-bounded lines. A collapsed view shows the subagent name, task, status, and live activity (e.g., current tool). Clicking or expanding the result reveals concise details: model, skills, recent tools, output preview, errors, and artifact paths. This keeps long-running Superpowers workflows readable without scrolling through verbose JSON or full Markdown output.

The compact renderer is active for all `subagent` tool results produced by `pi-superagents`. `/subagents-status` remains available for inspecting active or recently completed runs in a dedicated overlay.

## Common Override Examples

Create a custom command with lean settings:

```json
{
  "superagents": {
    "commands": {
      "sp-lean": {
        "description": "Lean: no subagents, no TDD",
        "entrySkill": "using-superpowers",
        "useSubagents": false,
        "useTestDrivenDevelopment": false
      }
    }
  }
}
```

Enable Plannotator for a custom planning command:

```json
{
  "superagents": {
    "commands": {
      "sp-review": {
        "description": "Planning with browser review",
        "entrySkill": "writing-plans",
        "usePlannotator": true
      }
    }
  }
}
```

Override worktree settings for the built-in `sp-implement`:

```json
{
  "superagents": {
    "commands": {
      "sp-implement": {
        "worktrees": {
          "enabled": true,
          "root": ".worktrees"
        }
      }
    }
  }
}
```

If `root` is inside your repository, it must be ignored by git.

## Custom Commands

Define preset slash commands in your `config.json`:

```json
{
  "superagents": {
    "commands": {
      "sp-custom": {
        "description": "Custom workflow",
        "entrySkill": "using-superpowers",
        "useSubagents": true,
        "useTestDrivenDevelopment": true,
        "useBranches": true,
        "worktrees": {
          "enabled": false
        }
      }
    }
  }
}
```

Command names must match `superpowers-<name>` or `sp-<name>` (lowercase alphanumeric and hyphens).

Agent frontmatter may declare `session-mode: standalone | lineage-only | fork`. Built-in bounded roles ship with `lineage-only`.

## Model Tiers

Superpowers agents use abstract model tiers. Define tiers in your configuration:

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

**Supported thinking levels:** `off`, `minimal`, `low`, `medium`, `high`, `xhigh`.

You can edit model tier mappings during an active PI session with `/sp-settings`. The model picker reads PI's authenticated model registry and writes the selected `provider/model` value back to `config.json`. Successful tier edits apply to future Superpowers subagents immediately; already-running subagents keep the model they were launched with.

Command registration still happens when the extension loads. If you add or rename slash commands in `config.json`, reload PI before using those new command names.

## Skill Overlays

Skill overlays load additional skills alongside the entry skill:

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

Overlay resolution happens at session start for skills in `superpowersSkills` (invocation overlays) and for the entry skill (entry overlays).

Open `/subagents-status` and select a run to verify which overlay skills were resolved for each delegated subagent. Missing overlay skills appear as warning text in the same details pane.

## Direct Skill Interception

Route skill commands through Superpowers:

```json
{
  "superagents": {
    "interceptSkillCommands": ["brainstorming", "writing-plans"]
  }
}
```

When enabled:
- `/skill:brainstorming <task>` → Superpowers with `brainstorming` entry skill
- `/skill:writing-plans <task>` → Superpowers with `writing-plans` entry skill

## Plannotator Browser Review

Plannotator review is enabled per-command via `usePlannotator`. For built-in commands:

- `sp-brainstorm`: `usePlannotator: true` — reviews saved specs
- `sp-plan`: `usePlannotator: true` — reviews saved plans

Install [Plannotator](https://plannotator.ai/) separately:

```text
pi install npm:@plannotator/pi-extension
```

If Plannotator is unavailable, Superpowers falls back to in-chat approval.

## Release Configuration

Maintainer release automation lives in `.github/workflows/release.yml` and uses npm Trusted Publishing. It does not require local configuration keys or npm tokens in `config.json`.

Before changing package metadata, install behavior, or default configuration files, check the [Release Process](releases.md). Release candidates must keep `package.json`, `package-lock.json`, `CHANGELOG.md`, and the npm package contents aligned.

## Superpowers Skills

The bundled `superpowersSkills` list defines process skills. Current list:

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

Use `/subagents-status` to inspect active and recent subagent runs (`Ctrl+Alt+S`).

Use `/sp-settings` to inspect workflow settings and config diagnostics.

## Superpowers Workflow Commands

### `/sp-implement`

Run implementation through the Superpowers workflow:

```text
/sp-implement fix the auth regression
/sp-implement tdd implement the cache invalidation
/sp-implement direct update the config
```

**Inline tokens:** `lean`, `full`, `tdd`, `direct`, `subagents`, `no-subagents`, `--fork`

### `/sp-brainstorm`

Run brainstorming with Plannotator spec review:

```text
/sp-brainstorm design the new onboarding flow
/sp-brainstorm explore mobile push options
```

### `/sp-plan`

Run planning with Plannotator plan review:

```text
/sp-plan redesign the auth flow
/sp-plan plan the mobile push integration
```

## Role Agents

| Role | Agent | Purpose |
|---|---|---|
| Recon | `sp-recon` | Context gathering for task discovery |
| Research | `sp-research` | Evidence gathering for complex logic |
| Implementer | `sp-implementer` | Planned code changes with verification |
| Code Review | `sp-code-review` | Quality reviewer for implementation |
| Spec Review | `sp-spec-review` | Verification against design specs |
| Debug | `sp-debug` | Failure investigation and root-cause analysis |