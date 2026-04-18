# @teelicht/pi-superagents

[Pi agent-harness](https://pi.dev) extension to support [superpowers](https://skills.sh/obra/superpowers) workflows using subagents. This was originally a fork of [pi-subagents](https://github.com/nicobailon/pi-subagents), but moved from a very flexible subagent implementation to an opinionated tool to integrate the superpowers skills, adding a level of configurability.

## Features

- **Superpowers Workflow**: Proven pipeline for robust AI-assisted development.
- **Role-Specific Agents**: Thin agents-layer for every phase of the development lifecycle.
- **Model Tiers**: Abstract model selection (cheap, balanced, max) for each agent to reduce costs and to utilize AI models according to their strengths. One model can be configured per tier. Custom tiers are possible.
- **Subagent Execution**: Automatically spawns sub-agents (setting).
- **Worktree Isolation**: Optional git worktree creation for parallel tasks to prevent filesystem conflicts (setting).
- **Skill Overlays**: Configure additional skills to load alongside entry skills or Superpowers process skills. Entry overlays resolve for the active entry skill; invocation overlays resolve for all Superpowers process skills at session start. See [Configuration](docs/configuration.md#skill-overlays).
- **Skill Visibility**: `/subagents-status` shows the resolved skills and missing-skill warnings for each subagent run, which helps verify `skillOverlays`.
- **Plannotator Integration**: Optional event bridge to [Plannotator](https://plannotator.ai/) for browser-based spec/plan review and approval (setting).

## Installation

```bash
pi install npm:@teelicht/pi-superagents
```

> [!NOTE]
> This tool requires the `superpowers` skills to be installed. Easy installtion via [https://skills.sh/obra/superpowers](https://skills.sh/obra/superpowers).

To remove:

```bash
pi remove npm:@teelicht/pi-superagents
```

## Integrated Slash Commands

| Command                 | Description                                                                 |
| ----------------------- | --------------------------------------------------------------------------- |
| `/sp-brainstorm <task>` | Brainstorm a task and save a spec, optionally review it with Plannotator UI |
| `/sp-plan <task>`       | Plan a task with optional Plannotator plan review                           |
| `/sp-implement <task>`  | Run an implementation task through the Superpowers flow                     |
| `/subagents-status`     | Open active and recent subagent run status, including resolved skills       |
| `/sp-settings`          | Open superagents settings                                                   |

### Custom Commands

Define your own slash commands with preset workflow options in `config.json`. Example presets ship in `config.example.json`:

- **`/sp-lean`** — Run Superpowers without subagents or TDD.
- **`/sp-plannotator`** — Run Superpowers with Plannotator browser review enabled.

See [Configuration](docs/configuration.md#custom-commands) for the full preset schema and inheritance rules.

### Agents

The `/sp-implement` command activates a structured workflow for task execution with role-specific agents, model tiers, and built-in quality gates.

1. **Recon** (`sp-recon`): Initial codebase analysis and context gathering.
2. **Research** (`sp-research`): Deep dive into specific APIs, libraries, or logic.
3. **Implementation** (`sp-implementer`): Code changes guided by test-driven development (optional).
4. **Review** (`sp-code-review`): Automated review of changes against project standards.
5. **Debug** (`sp-debug`): Root cause analysis and fix verification for regressions.

## Configuration & Documentation

On install, `pi-superagents` creates an empty user override file:

```text
~/.pi/agent/extensions/subagent/config.json
```

- **[Configuration](docs/configuration.md)** — Workflow, settings, model tiers, custom tiers, commands, and agent overrides.
- **[Worktree Isolation](docs/worktrees.md)** — Git worktree setup.
- **[Parameters API](docs/parameters.md)** — Full parameter reference for the `subagent` tool.
- **[Skills Reference](docs/skills.md)** — Skill locations, injection, and frontmatter.
- **[Release Process](docs/releases.md)** — Maintainer steps for GitHub Releases and npm Trusted Publishing.
