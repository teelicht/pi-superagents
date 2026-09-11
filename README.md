# @teelicht/pi-superagents

[Pi agent-harness](https://pi.dev) extension to support [Superpowers](https://github.com/obra/superpowers) workflows using subagents. The official Superpowers Pi package injects the Superpowers skills into every session. By contrast, the pi-superagents extension leaves it up to the user to decide when Superpowers should be used.

## Features

- **Superpowers Workflow**: Proven pipeline for robust AI-assisted development.
- **Role-Specific Agents**: Thin agents-layer for every phase of the development lifecycle.
- **Model Tiers & Command Settings**: Abstract model selection (cheap, balanced, max) for each agent. One model and optional thinking level can be configured per tier. Custom tiers are possible. Models, tier thinking, and command-scoped behavior toggles can be changed through the `/sp-settings` TUI.
- **Plannotator Integration**: Optional event bridge to [Plannotator](https://plannotator.ai/) for browser-based spec/plan review and approval (setting).
- **Worktree Isolation**: Optional git worktree creation for parallel tasks to prevent filesystem conflicts. Worktree-backed parallel children are joined before cleanup; worktree policy is unchanged.
- **Subagent Extension & Tool Defaults**: Subagents run with implicit Pi extension discovery disabled by default; configure `superagents.extensions` with local paths or Pi `-e` source specs, and `superagents.tools` with shared tool names or tool extension paths. The bundled defaults provide the common read-only tools globally so agent frontmatter only lists role-specific extras.

## Installation

```bash
pi install npm:@teelicht/pi-superagents
```

> [!NOTE]
> Requires Superpowers v6.2+ ([`superpowers` skills](https://skills.sh/obra/superpowers)), installable with `pi install git:github.com/obra/superpowers`.

On install, the extension creates `config.json` from the bundled defaults and migrates existing configs in place with a timestamped backup. To remove:

```bash
pi remove npm:@teelicht/pi-superagents
```

For local development, use the package shortcut for the repository-local installer:

```bash
pnpm run install:local
```

## Slash Commands

| Command                          | Description                                                           |
| -------------------------------- | --------------------------------------------------------------------- |
| `/sp-brainstorm <task>`          | Brainstorm a task and save a spec, optionally review it with Plannotator |
| `/sp-plan <task>`                | Plan a task with optional Plannotator plan review                     |
| `/sp-implement <task>`           | Run an implementation task sequentially through the Superpowers flow  |
| `/sp-implement-parallel <task>`  | Run dependency-ready implementation Tasks in isolated parallel worktrees |
| `/subagents-status`              | Open active and recent subagent run status                            |
| `/sp-settings`                   | Open superagents settings                                             |

Superpowers runs only through these commands by default (`superagents.makeSuperpowersSkillsOptInOnly: true`); set it to `false` in `config.json` to restore automatic activation.

## Documentation

- **[Configuration](docs/configuration.md)** - Configuration reference: model tiers, commands, project trust, run history, and settings.
- **[Worktree Isolation](docs/worktrees.md)** - Git worktree setup.
- **[Parameters API](docs/parameters.md)** - Full parameter reference for the `subagent` tool.
- **[Skills Reference](docs/skills.md)** - Skill locations, injection, and frontmatter.
- **[Release Process](docs/releases.md)** - Maintainer steps for GitHub Releases and npm Trusted Publishing.

## Credits

- This was originally a fork of [pi-subagents](https://github.com/nicobailon/pi-subagents), so thanks for all the ground-work. This repo however moved far off the original.
- [pi-interactive-subagents](https://github.com/hazat/pi-interactive-subagents) for the session-mode implementation.
- [@tintinweb/pi-subagents](https://github.com/tintinweb/pi-subagents) for UI inspiration.
- And of course [Pi](https://pi.dev) for the awesome foundation.
