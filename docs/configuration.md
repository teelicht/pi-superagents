# Configuration

`@teelicht/pi-superagents` loads configuration in two layers: **bundled defaults** and **user overrides**.

This reference targets Pi `^0.82.1`.

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

## Install-time upgrades

Normal installs and `pnpm install:local` safely migrate existing user config.
Before writing, the installer creates `config.json.bak-<timestamp>`. It then:

- adds `superagents.makeSuperpowersSkillsOptInOnly: true` when missing while preserving an explicit `false`;
- adds the bundled `sp-implement-parallel` preset when missing;
- moves legacy `taskScheduling: "parallel"` behavior from `sp-implement` to
  `sp-implement-parallel`, leaving `sp-implement` sequential;
- carries a custom `worktrees.root` into the parallel preset;
- removes obsolete `sp-spec-review` and `sp-code-review` command presets.

Already-migrated configs are left byte-for-byte unchanged. Invalid JSON fails
the install migration instead of being overwritten. The same migration can be
run explicitly with `npx @teelicht/pi-superagents --migrate-config`. Local
extension refreshes preserve existing `config.json.bak-*` migration backups.

## Validation

`pi-superagents` fails closed when `config.json` cannot be trusted. If the file has invalid JSON, unknown keys, or wrong value types, subagent execution is disabled until the file is fixed.

If `config.json` matches the bundled default, the extension may show a non-blocking notice. This is valid for fresh installs; edit only the behavior flags you want to change.

When Pi starts, the extension shows a notification with the config path and exact diagnostics. You can also inspect diagnostics with:

```text
/sp-settings
```

## No Async Configuration

Execution is strictly synchronous and blocking. There is no `async`, `wait`, `collect`, or `cancel` frontmatter key or config key. Lifecycle tools (`subagent_done`, `caller_ping`) are internal child-only tools registered through policy; they are not user-configurable delegation controls.

## Repository Quality Configuration

The repository includes `.fallowrc.json` for `pnpm exec fallow`. It keeps dead-code checks active, records dynamic entrypoint exceptions used by tests and plugin discovery, and leaves broad duplication/health findings as informational reports rather than blocking this extension's runtime configuration.

## Built-in Commands

Slash commands are registered from interactive entrypoint agent frontmatter, not generated from `config.json`. The bundled defaults include behavior flags for four built-in commands:

| Command | Policy Settings |
|---|---|
| `sp-implement` | `taskScheduling: "sequential"`, `useSubagents: true`, `useTestDrivenDevelopment: true`, `useBranches: false`, `worktrees: { enabled: false }` |
| `sp-implement-parallel` | `taskScheduling: "parallel"`, `useSubagents: true`, `useTestDrivenDevelopment: true`, `useBranches: false`, `worktrees: { enabled: true }` |
| `sp-brainstorm` | `usePlannotator: true` |
| `sp-plan` | `usePlannotator: true` |

Each built-in command has a corresponding bundled interactive entrypoint agent file, including `agents/sp-implement.md` and `agents/sp-implement-parallel.md`. The entrypoint agent file provides command metadata (name, description, command name, entry skill) and root lifecycle skills. The command preset in `config.json` only controls runtime behavior flags.

Built-in command behavior can be augmented or overridden by user config. Settings in your `config.json` are deep-merged on top of the bundled defaults: any fields you specify replace the corresponding built-in values, while unspecified fields remain at their built-in defaults. To create a variant of a built-in command, reference the built-in command name in your `commands` map and override only the fields you need. Use a different command name only when you also create a matching interactive entrypoint agent.

## Project Trust

On Pi 0.79+, `pi-superagents` mirrors Pi's project-trust decision through `ctx.isProjectTrusted()`. The following project-local inputs load only when the current Pi context reports the project as trusted:

- **Project-local agents** (`.agents/*.md`, `.pi/agents/*.md`) used for runtime subagent delegation.
- **Project skills** — see the [Skills Reference](skills.md#skills-reference) for the full project skill path policy.
- **Project skill packages** (`.pi/npm/node_modules/*` via `package.json -> pi.skills`).
- **Project settings skill entries** (`.pi/settings.json -> skills`).
- **Project agent frontmatter `extensions:`** entries. Untrusted project agents do not contribute to child Pi `--extension` flags.

User-level agents, user-level skills, package-bundled agents, and global npm package skills continue to load before project trust is granted.

### Child Subagent Trust Mirroring

Child subagent processes mirror the parent trust decision. Trusted parent contexts launch child Pi with `--approve`; untrusted parent contexts launch child Pi with `--no-approve`. This prevents non-interactive child runs from silently escalating trust into a project the user has not approved. Configure project-local Pi resources only for repositories you trust.

### Slash Command Registration

Trusting a project does **not** automatically register project-local interactive entrypoint agents as slash commands. Slash command registration is wired to user-level and package-bundled entrypoint agents, so custom slash commands should continue to be installed at the user level (for example, `~/.pi/agent/agents/sp-*.md`) or as package-bundled entrypoints, even when a project is trusted. If a future version wires trusted-project command registration, this section will be updated. Until then, project-level entrypoint agents can still be invoked through entry-skill workflows but will not be listed in the slash-command palette.

## Configuration Keys

### `superagents`

Configures the Superpowers workflow.

| Key | Description |
|---|---|
| `commands` | Map of command behavior presets. Each preset has per-command policy booleans. Slash commands are registered from interactive entrypoint agents; `config.json` only controls behavior flags for existing entrypoint commands. |
| `extensions` | Array of local extension paths or Pi extension source specs that every subagent receives. Implicit Pi extension discovery is disabled by default; add extensions here for child Pi processes. |
| `tools` | Array of tool names or tool extension paths appended to every subagent after role-specific tool policy. Use this for shared tools you do not want to repeat in every agent frontmatter file. |
| `modelTiers` | Maps abstract tier names (`cheap`, `balanced`, `max`, plus any custom tiers) to concrete model configs. |
| `interceptSkillCommands` | List of skill names intercepted for Superpowers entry (`brainstorming`, `writing-plans`). |
| `makeSuperpowersSkillsOptInOnly` | When `true` (default), hides `using-superpowers` from ordinary model skill selection and neutralizes obra/superpowers' automatic Pi bootstrap hook. Explicit `/sp-*` and `/skill:*` commands still work. |
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

> [!NOTE]
> Project agent frontmatter `extensions:` entries are also subject to [Project Trust](#project-trust) and are ignored when the parent Pi context has not trusted the project.

### Global Tools

Configure `superagents.tools` as a global list of tool names or tool extension paths that every subagent should receive:

```json
{
  "superagents": {
    "tools": ["read", "grep", "find", "ls", "./tools/shared-tool.ts"]
  }
}
```

These tools are appended after each role's normal tool policy and de-duplicated while preserving order. The bundled default config provides the common read-only baseline (`read`, `grep`, `find`, `ls`) globally, so built-in role agents only list extra tools such as `bash` or `write` in frontmatter. Existing agent `tools:` frontmatter still defines that agent's baseline extras; `superagents.tools` saves you from repeating common additions. Path-like entries such as `./tools/shared-tool.ts` are passed through Pi's normal extension/tool resolver, so they must resolve under the same rules described for [Extension Allowlist](#extension-allowlist).

Bounded Superpowers roles still cannot receive delegation tools such as `subagent` through this setting; those entries are filtered by policy for bounded roles. Child lifecycle tools (`subagent_done`, `caller_ping`) remain managed by the runtime.

> [!NOTE]
> Child subagent trust mirroring is governed by [Project Trust](#project-trust): trusted parent contexts launch child Pi with `--approve`; untrusted parent contexts launch child Pi with `--no-approve`.

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
| `taskScheduling` | `"sequential"` (default) or `"parallel"` to opt into parallel Task scheduling. Config-only; not a slash-command token. |
| `worktrees.enabled` | Use git worktree isolation for parallel tasks. |
| `worktrees.root` | Directory for worktrees (default: system temp). |

Command metadata (`description`, `entrySkill`) was moved to entrypoint agent frontmatter. Adding or editing command metadata requires adding or editing an `agents/*.md` entrypoint file.

## Parallel SDD Task Scheduling

`/sp-implement` has a bundled sequential preset. `/sp-implement-parallel` has a bundled parallel preset. `taskScheduling` remains **config-only** per command — there is no inline token for switching modes.

Parallel mode is rejected before dispatch if the active command preset does not also enable `useSubagents: true` and `worktrees.enabled: true`; the controller surfaces a clear preflight error and the run never starts.

Bundled `/sp-implement-parallel` preset:

```json
{
  "superagents": {
    "commands": {
      "sp-implement-parallel": {
        "taskScheduling": "parallel",
        "useSubagents": true,
        "worktrees": { "enabled": true }
      }
    }
  }
}
```

When the preflight passes, the root session composes the three existing upstream Superpowers skills (`subagent-driven-development`, `dispatching-parallel-agents`, `using-git-worktrees`) without forking or editing them. Each Task — the whole numbered block of Steps from the implementation plan — is dispatched together to its own pre-isolated worktree, reviewed once via `sp-review`, and integrated in Task-number order. After every Task is integrated, the controller runs one final branch-scope `sp-review`. See [Skills Reference](skills.md#parallel-sdd-task-scheduling) for the dispatch contract and the [Worktree Isolation](worktrees.md#parallel-sdd-waves-vs-ordinary-parallel-calls) reference for the persistent worktree lifecycle.

## Inline Role Output

Superpowers role agents return their findings through Pi tool results. The bounded SDD roles (`sp-implementer`, `sp-review`) use the `subagent-driven-development` skill's file handoff: they read the task brief and review-package diff and write the implementer report by path, under the gitignored `.superpowers/sdd/` workspace the skill's `scripts/sdd-workspace` creates — not the repository root. The controller cleans those files up with `rm -f` after a `DONE` review; `progress.md` (the SDD ledger) is preserved until `finishing-a-development-branch`. `sp-debug` keeps inline delivery. The extension injects no `[Read from:]`/`[Write to:]` references and performs no cleanup itself.

Execution artifacts are still available when `artifacts` is enabled. Those files are written to the session artifact directory for debugging and truncation recovery, not to the repository root.

## Compact Inline Subagent Results

Subagent tool results are rendered inline in the Pi conversation as compact, width-bounded lines. A collapsed view shows the subagent name, runtime-confirmed model label, task, status, and live activity (e.g., current tool). Clicking or expanding the result reveals concise details: model, thinking level when available, skills, recent tools, output preview, errors, and artifact paths. This keeps long-running Superpowers workflows readable without scrolling through verbose JSON or full Markdown output. The result preview is bounded; the full conversation turns live in the child session and in the session artifact directory when artifacts are enabled.

The compact renderer is active for all `subagent` tool results produced by `pi-superagents`. `/subagents-status` remains available for inspecting active or recently completed runs in a dedicated overlay, including the runtime-confirmed model and separate thinking level when available.

## Run History

Completed subagent runs are stored as JSONL at `~/.pi/agent/run-history.jsonl` so `/subagents-status` can show recent runs across sessions. Inline rows use live progress/result metadata, and run history stores the child Pi-reported model separately from the effective thinking level so the overlay can confirm actual model routing instead of only showing configured defaults. Set `PI_SUPERAGENTS_RUN_HISTORY_PATH` to an absolute file path when you need to isolate run history, for example in tests or sandboxed sessions where the default path is read-only or shared.

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

The `/sp-settings` thinking picker uses the levels Pi reports for the selected model. The extension maintains no thinking-level allowlist; configured values are passed to Pi for runtime validation.

The `thinking` key is optional.

The reserved tier names `cheap`, `balanced`, `max`, and `reasoning` are always treated as tier references by Superpowers agents. If an agent declares one of these (or any key present in `modelTiers`) and the corresponding entry is missing or has an empty `model`, the subagent launch is halted before spawning with an error naming the tier and the `modelTiers` key to fix — the literal tier name is never passed to Pi as a model id.

> [!NOTE]
> In `config.example.json`, `creative` and `legacy` are illustrative custom tiers added to demonstrate the surface; they are not built-in tiers. `thinking` is optional in any tier definition.

You can edit model tier mappings during an active PI session with `/sp-settings`. The model picker reads PI's authenticated model registry, supports type-to-search filtering by provider, ID, or display name (including names containing `q`), scrolls keyboard selection through the full filtered model list, then asks for the tier thinking level. Successful tier edits write the selected `provider/model` and optional `thinking` value to `config.json` and apply to future Superpowers subagents immediately. Tier edits never retroactively re-target an already-running child; a child Pi process keeps the model it launched with until that run completes.

`/sp-settings` also edits command-scoped workflow toggles. Use `c` to select a command, then toggle `p` for Plannotator, `s` for subagents, `t` for TDD, or `w` for worktrees on that selected command preset. This avoids writing Plannotator or TDD settings into unrelated command presets.

## Opt-in-only Superpowers

Superpowers activation is explicit by default:

```json
{
  "superagents": {
    "makeSuperpowersSkillsOptInOnly": true
  }
}
```

With this setting, Pi does not advertise `using-superpowers` to the model during ordinary requests. If `git:github.com/obra/superpowers` is also installed as a Pi package, Pi Superagents replaces its automatic `using-superpowers` bootstrap with a hidden opt-in guard regardless of extension load order. The upstream skills remain installed and available to `/sp-*` and `/skill:*` commands; no upstream files or Pi package settings are changed.

Set `makeSuperpowersSkillsOptInOnly` to `false` to restore Pi's normal model-driven skill visibility and allow the upstream automatic bootstrap hook to run.

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

Before changing package metadata, install behavior, or default configuration files, check the [Release Process](releases.md). Release candidates must keep `package.json`, `pnpm-lock.yaml`, `CHANGELOG.md`, and the npm package contents aligned.

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

Use `/subagents-status` to inspect active and recent subagent runs (`Ctrl+Alt+S`), including runtime-confirmed model labels, thinking levels, resolved skills, and warnings.

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

`/sp-implement` stays sequential by default. The scheduling mode is not an inline token.

### `/sp-implement-parallel`

Run dependency-ready implementation Tasks in isolated worktrees:

```text
/sp-implement-parallel implement the approved plan
```

The bundled preset enables parallel scheduling, subagents, TDD, and worktrees. See [Parallel SDD Task Scheduling](#parallel-sdd-task-scheduling) for the dispatch and preflight rules.

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
| Reviewer | `sp-review` | Combined specification and code-quality reviewer for one Task (`Review scope: task`) or the whole branch (`Review scope: branch`); uses the `max` model tier |
| Debug | `sp-debug` | Failure investigation and root-cause analysis; injects `systematic-debugging` |
