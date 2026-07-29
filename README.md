# @teelicht/pi-superagents

[Pi agent-harness](https://pi.dev) extension to support [Superpowers](https://github.com/obra/superpowers) workflows using subagents. The official Superpowers Pi package injects the Superpowers skills into every session. By contrast, the pi-superagents extension leaves it up to the user to decide when Superpowers should be used.

Current compatibility target: Pi `^0.82.1`.

## Features

- **Superpowers Workflow**: Proven pipeline for robust AI-assisted development.
- **Role-Specific Agents**: Thin agents-layer for every phase of the development lifecycle.
- **Model Tiers & Command Settings**: Abstract model selection (cheap, balanced, max) for each agent. One model and optional thinking level can be configured per tier. Custom tiers are possible. Models, tier thinking, and command-scoped behavior toggles can be changed through the `/sp-settings` TUI; its model picker supports type-to-search filtering, including `q`, and scrolls through large authenticated model lists. Slash-command metadata lives in entrypoint agent frontmatter.
- **Plannotator Integration**: Optional event bridge to [Plannotator](https://plannotator.ai/) for browser-based spec/plan review and approval (setting).
- **Worktree Isolation**: Optional git worktree creation for parallel tasks to prevent filesystem conflicts. Worktree-backed parallel children are joined before cleanup; worktree policy is unchanged.
- **Entrypoint Lifecycle Skills**: Superpowers entrypoint agents inject root lifecycle skills (verification, review-feedback, branch finishing) defined in frontmatter. .
- **Subagent Extension & Tool Defaults**: Subagents run with implicit Pi extension discovery disabled by default; configure `superagents.extensions` with local paths or Pi `-e` source specs, and `superagents.tools` with shared tool names or tool extension paths. The bundled defaults provide the common read-only tools globally so agent frontmatter only lists role-specific extras.

The `/sp-settings` thinking picker uses the levels Pi reports for the selected model. The extension maintains no thinking-level allowlist; configured values are passed to Pi for runtime validation.

## Installation

```bash
pi install npm:@teelicht/pi-superagents
```

> [!NOTE]
> Requires the [`superpowers` skills](https://skills.sh/obra/superpowers), installable with `pi install git:github.com/obra/superpowers`.
> `superagents.makeSuperpowersSkillsOptInOnly` defaults to `true`, so Superpowers runs only through `/sp-*` or `/skill:*`. Set it to `false` to restore automatic activation.

On install, `pi-superagents` creates `config.json` from the bundled defaults:

```text
~/.pi/agent/extensions/subagent/config.json
```

Updates migrate existing configs in place with a timestamped backup: the
`sp-implement-parallel` preset is added when missing, legacy parallel
`sp-implement` settings are split into the new command, and custom worktree
roots are retained. Obsolete user `sp-spec-review.md` and `sp-code-review.md`
agents are backed up so the bundled consolidated `sp-review` agent is used.

To remove:

```bash
pi remove npm:@teelicht/pi-superagents
```

For local development, use the package shortcut for the repository-local installer:

```bash
pnpm run install:local
```

## Project Trust

On Pi 0.79+, `pi-superagents` mirrors Pi's project-trust decision. Project-local agents, skills, skill packages, `.pi/settings.json` skill entries, and project agent frontmatter extensions are loaded only when the current Pi context reports the project as trusted. Child subagent Pi processes receive `--approve` when the parent context is trusted and `--no-approve` when it is not, so non-interactive child runs do not silently escalate trust.

Trusting a project enables runtime subagent delegation from project agents but does not automatically register project-local interactive entrypoint agents as slash commands. Custom slash commands should be installed as user-level (`~/.pi/agent/agents/sp-*.md`) or package-bundled entrypoint agents. See [Project Trust](docs/configuration.md#project-trust) in the Configuration reference for the full trust-gated inputs list and slash command registration caveats, and the [Skills Reference](docs/skills.md) for the project skill path policy.

## Execution Model

Subagent execution is synchronous and blocking. The `subagent` tool does not accept `async`, `wait`, `collect`, or `cancel` parameters. Lifecycle tools (`subagent_done`, `caller_ping`) are registered as internal child-only tools through policy; they are not general-purpose delegation tools.

## Integrated Slash Commands

Superpowers slash commands are registered from interactive entrypoint agent frontmatter, not generated from `config.json`. `config.json` only changes runtime behavior for commands that already have a matching entrypoint agent. Use `superagents.tools` to append shared tool names or tool extension paths to every subagent without repeating them in each agent frontmatter file.

| Command                          | Description                                                                 |
| -------------------------------- | --------------------------------------------------------------------------- |
| `/sp-brainstorm <task>`          | Brainstorm a task and save a spec, optionally review it with Plannotator UI |
| `/sp-plan <task>`                | Plan a task with optional Plannotator plan review                           |
| `/sp-implement <task>`           | Run an implementation task sequentially through the Superpowers flow       |
| `/sp-implement-parallel <task>`  | Run dependency-ready implementation Tasks in isolated parallel worktrees   |
| `/subagents-status`              | Open active and recent subagent run status, including runtime-confirmed models, thinking levels, and resolved skills |
| `/sp-settings`                   | Open superagents settings                                                   |

### Custom Commands

Create custom slash commands by adding an interactive entrypoint agent markdown file (e.g., `~/.pi/agent/agents/sp-mycommand.md`) with the appropriate frontmatter. Optional behavior flags (e.g., `useSubagents`, `usePlannotator`) can be set in `config.json` under `superagents.commands.<name>`. Config blocks alone do not register commands.

See [Configuration](docs/configuration.md#custom-commands) for the agent frontmatter schema and behavior flag reference.

### Agents

The `/sp-implement` and `/sp-implement-parallel` commands activate the same structured implementation workflow with different bundled scheduling presets. Their entrypoints inject root lifecycle skills for verification, review-feedback handling, and branch finishing. The bundled `sp-debug` role injects `systematic-debugging` when delegated.

Subagent execution remains conservative and synchronous for ordinary Superpowers workflows. There is intentionally no user-facing `async` or `blocking` switch in agent frontmatter, config, or tool parameters. Internal result ownership prevents duplicate delivery and lifecycle sidecars let child agents report intentional completion or a parent-help request without changing the normal delegation flow.

Subagent-driven development keeps implementer and reviewer reports inline in the Pi conversation. Bounded roles default to `lineage-only` - they see a curated work brief rather than the full parent conversation history.

## Parallel SDD Task Scheduling

`/sp-implement` stays sequential. `/sp-implement-parallel` uses the same workflow with bundled `taskScheduling: "parallel"`, `useSubagents: true`, and `worktrees.enabled: true` defaults. In both modes, a **Task** is the whole numbered block of Steps from the implementation plan.

The bundled parallel preset is equivalent to:

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

Scheduling remains config-only per command and cannot be toggled with an inline token. Parallel scheduling is **rejected before dispatch** if the active command preset is missing `useSubagents: true` or `worktrees.enabled: true`.

Under parallel scheduling, the root session composes three existing upstream Superpowers skills — `subagent-driven-development`, `dispatching-parallel-agents`, and `using-git-worktrees` — without forking or editing them. The controller builds dependency-ready waves of at most eight Tasks, creates one **persistent** worktree per Task before writers start, dispatches each Task whole (never individual Steps), runs one `sp-review` per completed Task, and integrates approved commits in Task-number order. After every Task is integrated, the controller runs one final branch-scope `sp-review`.

Run history is persisted at `~/.pi/agent/run-history.jsonl` for `/subagents-status`. Inline subagent rows and the status overlay show the model reported by the child Pi execution loop and, when available, the effective thinking level used for that run. Set `PI_SUPERAGENTS_RUN_HISTORY_PATH` to isolate that file for tests or sandboxed sessions.

## Configuration & Documentation

- **[Configuration](docs/configuration.md)** - Workflow, settings, model tiers, custom tiers, commands, and agent overrides.
- **[Worktree Isolation](docs/worktrees.md)** - Git worktree setup.
- **[Parameters API](docs/parameters.md)** - Full parameter reference for the `subagent` tool.
- **[Skills Reference](docs/skills.md)** - Skill locations, injection, and frontmatter.
- **[Release Process](docs/releases.md)** - Maintainer steps for GitHub Releases and npm Trusted Publishing.

## Credits

- This was originally a fork of [pi-subagents](https://github.com/nicobailon/pi-subagents), so thanks for all the ground-work. This repo however moved far off the original.
- [pi-interactive-subagents](https://github.com/hazat/pi-interactive-subagents) for the session-mode implementation.
- [@tintinweb/pi-subagents](https://github.com/tintinweb/pi-subagents) for UI inspiration.
- And of course [Pi](https://pi.dev) for the awesome foundation.
