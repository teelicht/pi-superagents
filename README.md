# @teelicht/pi-superagents

Pi extension for Superpowers workflows: structured delegation to specialized role agents for recon, research, implementation, review, and debugging.

## Installation

```bash
pi install npm:@teelicht/pi-superagents
```

> [!NOTE]
> This tool requires the `superpowers` skills to be installed. I recommend installing them through https://skills.sh/obra/superpowers.

To remove:

```bash
npx @teelicht/pi-superagents --remove
```

## Quick Commands

| Command                 | Description                                                                 |
| ----------------------- | --------------------------------------------------------------------------- |
| `/sp-brainstorm <task>` | Brainstorm a task and save a spec, optionally review it with Plannotator UI |
| `/sp-implement <task>`  | Run an implementation task through the Superpowers flow                     |
| `/subagents-status`     | Open active and recent subagent run status                                  |
| `/sp-settings`          | Open Superpowers and subagent workflow settings                             |

### Custom Commands

Define your own slash commands with preset workflow options in `config.json`. Example presets ship in `config.example.json`:

- **`/sp-lean`** — Run Superpowers without subagents or TDD.
- **`/sp-plannotator`** — Run Superpowers with Plannotator browser review enabled.

See [Configuration Reference](docs/reference/configuration.md#custom-command-presets) for the full preset schema and inheritance rules.

### Superpowers Workflow

The `/sp-implement` command activates a structured workflow for task execution with role-specific agents, model tiers, and built-in quality gates.

1. **Recon** (`sp-recon`): Initial codebase analysis and context gathering.
2. **Research** (`sp-research`): Deep dive into specific APIs, libraries, or logic.
3. **Implementation** (`sp-implementer`): Code changes guided by test-driven development (optional).
4. **Review** (`sp-code-review`): Automated review of changes against project standards.
5. **Debug** (`sp-debug`): Root cause analysis and fix verification for regressions.

```text
/sp-implement fix the auth regression
/sp-implement tdd implement the cache invalidation task
/sp-implement direct update the Expo config
/sp-implement tdd review the release branch --fork
```

- **`tdd`** (default): Uses the `test-driven-development` skill for the implementation phase.
- **`direct`**: Traditional implementation loop with verification and review.

### Background & Forked Execution

- `--bg`: Run in the background. Check status with `/subagents-status` or `Ctrl+Option+S` on macOS (`ctrl+alt+s` in Pi keybinding notation).
- `--fork`: Run with `context: "fork"` (branched session from parent's current leaf).

## Configuration

On install, `pi-superagents` creates an empty user override file:

```text
~/.pi/agent/extensions/subagent/config.json
```

See [Configuration Reference](docs/reference/configuration.md) for details on model tiers and worktree settings.

## Features

- **Superpowers Workflow**: Industry-standard pipeline for robust AI-assisted development.
- **Role-Specific Agents**: Purpose-built agents for every phase of the development lifecycle.
- **Parallel Execution**: Fan-out/fan-in patterns for multi-component analysis.
- **Worktree Isolation**: Optional git worktree creation for parallel tasks to prevent filesystem conflicts.
- **Async Execution**: Background mode with real-time progress overlay and desktop notifications.
- **Model Tiers**: Abstract model selection (cheap, balanced, max) resolved via user configuration.
- **Skill Injection**: Automatic injection of project-local and user-global skills into agent prompts.
- **Skill Overlays**: Configure additional skills to load alongside entry skills (e.g., load `react-native-best-practices` when brainstorming). See [Configuration Reference](docs/reference/configuration.md#skill-overlays).
- **Plannotator Integration**: Optional event bridge to [Plannotator](https://plannotator.ai/) for visual browser-based plan review and approval.

## Documentation

- **[Superpowers Guide](docs/guides/superpowers.md)** — Workflow details, role agents, and command usage.
- **[Worktree Isolation](docs/reference/worktrees.md)** — Git worktree setup, requirements, and hooks.
- **[Configuration](docs/reference/configuration.md)** — Extension settings, model tiers, and performance tuning.
- **[Parameters API](docs/reference/parameters.md)** — Full parameter reference for the `subagent` tool.
- **[Contributing](docs/contributing.md)** — Project standards and development guidelines.
