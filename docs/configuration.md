# Configuration

`@teelicht/pi-superagents` loads configuration in two layers: **bundled defaults** and **user overrides**.

Bundled defaults ship inside the package and provide sensible baseline values. User overrides live in:

```text
~/.pi/agent/extensions/subagent/config.json
```

This file is user-owned. A fresh install creates it by copying the bundled defaults, including behavior flags for the built-in Superpowers entrypoint commands.

At runtime, user config merges on top of the bundled defaults. You only need to edit the settings you want to change. Full parseable examples are available in:

```text
~/.pi/agent/extensions/subagent/config.example.json
```

> [!NOTE]
> `config.example.json` is illustrative only. Copy only the settings you want to change into `config.json`; unspecified fields are filled in from the bundled defaults.

## Validation

`pi-superagents` fails closed when `config.json` cannot be trusted. If the file has invalid JSON, unknown keys, or wrong value types, subagent execution is disabled until the file is fixed.

If `config.json` matches the bundled default, the extension may show a non-blocking notice. This is valid for fresh installs; edit only the behavior flags you want to change.

When Pi starts, the extension shows a notification with the config path and exact diagnostics. You can also inspect diagnostics with:

```text
/sp-settings
```

## Built-in Commands

Slash commands are registered from interactive entrypoint agent frontmatter, not generated from `config.json`. The bundled defaults include behavior flags for three built-in commands:

| Command | Policy Settings |
|---|---|
| `sp-implement` | `useSubagents: true`, `useTestDrivenDevelopment: true`, `useBranches: false`, `worktrees: { enabled: false }` |
| `sp-brainstorm` | `usePlannotator: true` |
| `sp-plan` | `usePlannotator: true` |

Each built-in command has a corresponding bundled interactive entrypoint agent file (`agents/sp-implement.md`, `agents/sp-brainstorm.md`, `agents/sp-plan.md`). The entrypoint agent file provides command metadata (name, description, command name, entry skill) and root lifecycle skills. The command preset in `config.json` only controls runtime behavior flags.

Built-in command behavior can be augmented or overridden by user config. Settings in your `config.json` are deep-merged on top of the bundled defaults: any fields you specify replace the corresponding built-in values, while unspecified fields remain at their built-in defaults. To create a variant of a built-in command, reference the built-in command name in your `commands` map and override only the fields you need. Use a different command name only when you also create a matching interactive entrypoint agent.

## Configuration Keys

### `superagents`

Configures the Superpowers workflow.

| Key | Description |
|---|---|
| `commands` | Map of command behavior presets. Each preset has per-command policy booleans. Slash commands are registered from interactive entrypoint agents; `config.json` only controls behavior flags for existing entrypoint commands. |
| `extensions` | Array of local extension paths or Pi extension source specs that every subagent receives. Implicit Pi extension discovery is disabled by default; add extensions here for child Pi processes. |
| `modelTiers` | Maps abstract tier names (`cheap`, `balanced`, `max`, plus any custom tiers) to concrete model configs. |
| `interceptSkillCommands` | List of skill names intercepted for Superpowers entry (`brainstorming`, `writing-plans`). |
| `superpowersSkills` | List of Superpowers process skill names (bundled default, not user-configurable). |

### Extension Allowlist

Subagents run with implicit Pi extension discovery disabled by default. Configure `superagents.extensions` as a global list of extensions that every subagent should receive:

```json
{
  "superagents": {
    "extensions": [
      "./src/extension/custom-subagent-tools.ts",
      "npm:@sting8k/pi-vcc"
    ]
  }
}
```

Local extension entries must point to existing files or directories when the subagent starts. Relative paths resolve from the subagent runtime working directory; use absolute paths for local extensions outside the project. Missing local paths cause subagent launch to fail before Pi starts and include the config source in the error.

Package and remote entries should use normal Pi `-e` source prefixes such as `npm:`, `git:`, `https:`, or `ssh:`. These sources pass through to child Pi unchanged, and child Pi resolves, installs, and loads them through its normal extension resolver. Bare package names such as `@scope/package` are treated as local paths; use `npm:@scope/package` for npm packages.

Agent frontmatter can append additional extensions per-agent using the `extensions` field, which is additive to the global list. Extensions declared in agent frontmatter are appended to the global `extensions` array at session launch.

### Entrypoint Agent Frontmatter

Interactive entrypoint agent files own the slash command metadata (name, description, command name, entry skill) and define root lifecycle skills. `config.json` only controls behavior flags.

Create a custom command by adding an entrypoint agent file. Example:

`~/.pi/agent/agents/sp-review.md`

```yaml
---
name: sp-review
description: Review code through the Superpowers workflow
kind: entrypoint
execution: interactive
command: sp-review
entrySkill: using-superpowers
skills: verification-before-completion, receiving-code-review
---

Review code and produce actionable findings.
```

Matching behavior flags in `config.json`:

```json
{
  "superagents": {
    "commands": {
      "sp-review": {
        "useSubagents": false,
        "useTestDrivenDevelopment": false
      }
    }
  }
}
```

### Command Behavior Presets

Each command preset in `config.json` supports these behavior keys:

| Key | Description |
|---|---|
| `useBranches` | Require dedicated git branch for plans/specs. |
| `useSubagents` | Allow delegation through `subagent` tool. |
| `useTestDrivenDevelopment` | Enable TDD guidance. |
| `usePlannotator` | Enable Plannotator browser review at approval points. |
| `worktrees.enabled` | Use git worktree isolation for parallel tasks. |
| `worktrees.root` | Directory for worktrees (default: system temp). |

Command metadata (`description`, `entrySkill`) was moved to entrypoint agent frontmatter. Adding or editing command metadata requires adding or editing an `agents/*.md` entrypoint file.

## Inline Role Output

Superpowers role agents return their findings through Pi tool results. The runtime no longer configures packet output files, so `sp-implementer`, `sp-spec-review`, `sp-code-review`, and `sp-debug` do not create repo-root handoff files during normal subagent-driven development.

Execution artifacts are still available when `artifacts` is enabled. Those files are written to the session artifact directory for debugging and truncation recovery, not to the repository root.

## Compact Inline Subagent Results

Subagent tool results are rendered inline in the Pi conversation as compact, width-bounded lines. A collapsed view shows the subagent name, task, status, and live activity (e.g., current tool). Clicking or expanding the result reveals concise details: model, skills, recent tools, output preview, errors, and artifact paths. This keeps long-running Superpowers workflows readable without scrolling through verbose JSON or full Markdown output.

The compact renderer is active for all `subagent` tool results produced by `pi-superagents`. `/subagents-status` remains available for inspecting active or recently completed runs in a dedicated overlay.

## Common Override Examples

Augment the built-in `sp-implement` with custom worktree settings:

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

Enable Plannotator for the built-in brainstorm command:

```json
{
  "superagents": {
    "commands": {
      "sp-brainstorm": {
        "usePlannotator": true
      }
    }
  }
}
```

If `root` is inside your repository, it must be ignored by git.

## Custom Commands

Create a custom slash command by adding an interactive entrypoint agent markdown file:

```yaml
---
name: sp-lean
description: Lean Superpowers without subagents
kind: entrypoint
execution: interactive
command: sp-lean
entrySkill: using-superpowers
---

Lean entrypoint for Superpowers workflows.
```

Optional behavior flags in `config.json`:

```json
{
  "superagents": {
    "commands": {
      "sp-lean": {
        "useSubagents": false,
        "useTestDrivenDevelopment": false,
        "worktrees": {
          "enabled": false
        }
      }
    }
  }
}
```

Command names must match `superpowers-<name>` or `sp-<name>` (lowercase alphanumeric and hyphens), and each behavior block must have a matching interactive entrypoint agent to register a slash command.

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

**Supported thinking levels:** `off`, `minimal`, `low`, `medium`, `high`, `xhigh`. The `thinking` key is optional.

> [!NOTE]
> In `config.example.json`, `creative` and `legacy` are illustrative custom tiers added to demonstrate the surface; they are not built-in tiers. `thinking` is optional in any tier definition.

You can edit model tier mappings during an active PI session with `/sp-settings`. The model picker reads PI's authenticated model registry and writes the selected `provider/model` value back to `config.json`. Successful tier edits apply to future Superpowers subagents immediately; already-running subagents keep the model they were launched with.

`/sp-settings` also edits command-scoped workflow toggles. Use `c` to select a command, then toggle `p` for Plannotator, `s` for subagents, `t` for TDD, or `w` for worktrees on that selected command preset. This avoids writing Plannotator or TDD settings into unrelated command presets.

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

Skill selection is trigger-driven via `using-superpowers`. Do not preload domain skills through command config. Entrypoint `skills` are reserved for lifecycle/root skills with explicit trigger points.

## Status and Settings

Use `/subagents-status` to inspect active and recent subagent runs (`Ctrl+Alt+S`).

Use `/sp-settings` to inspect workflow settings and config diagnostics. In the settings overlay, `c` cycles the selected command; boolean toggles apply to that command only.

## Superpowers Workflow Commands

### `/sp-implement`

Run implementation through the Superpowers workflow:

```text
/sp-implement fix the auth regression
/sp-implement tdd implement the cache invalidation
/sp-implement direct update the config
```

**Inline tokens:** `lean`, `full`, `tdd`, `direct`, `subagents`, `no-subagents`, `--fork`

Root prompts now instruct delegated Superpowers calls to pass the resolved `useTestDrivenDevelopment` value explicitly. This prevents custom commands such as `sp-lean` from accidentally inheriting another command's TDD setting when they delegate to `sp-implementer`. If a direct `subagent` tool call omits the parameter entirely, the runtime does not inject TDD by default.

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
| Debug | `sp-debug` | Failure investigation and root-cause analysis; injects `systematic-debugging` |
