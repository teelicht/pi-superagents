# @teelicht/pi-superagents

[Pi agent-harness](https://pi.dev) extension to support [superpowers](https://skills.sh/obra/superpowers) workflows using subagents.

## Features

- **Superpowers Workflow**: Proven pipeline for robust AI-assisted development.
- **Role-Specific Agents**: Thin agents-layer for every phase of the development lifecycle.
- **Model Tiers & Command Settings**: Abstract model selection (cheap, balanced, max) for each agent. One model and optional thinking level can be configured per tier. Custom tiers are possible. Models, tier thinking, and command-scoped behavior toggles can be changed through the `/sp-settings` TUI; its model picker supports type-to-search filtering, including `q`, and scrolls through large authenticated model lists. Slash-command metadata lives in entrypoint agent frontmatter.
- **Plannotator Integration**: Optional event bridge to [Plannotator](https://plannotator.ai/) for browser-based spec/plan review and approval (setting).
- **Worktree Isolation**: Optional git worktree creation for parallel tasks to prevent filesystem conflicts. Worktree-backed parallel children are joined before cleanup; worktree policy is unchanged.
- **Entrypoint Lifecycle Skills**: Superpowers entrypoint agents inject root lifecycle skills (verification, review-feedback, branch finishing) defined in frontmatter. .
- **Subagent Extension & Tool Defaults**: Subagents run with implicit Pi extension discovery disabled by default; configure `superagents.extensions` with local paths or Pi `-e` source specs, and `superagents.tools` with shared tool names or tool extension paths. The bundled defaults provide the common read-only tools globally so agent frontmatter only lists role-specific extras.


## Installation

```bash
pi install npm:@teelicht/pi-superagents
```

> [!NOTE]
> This tool requires the `superpowers` skills to be installed. Easy installation via [https://skills.sh/obra/superpowers](https://skills.sh/obra/superpowers).

On install, `pi-superagents` creates `config.json` from the bundled defaults:

```text
~/.pi/agent/extensions/subagent/config.json
```

To remove:

```bash
pi remove npm:@teelicht/pi-superagents
```

For local development, use the package shortcut for the repository-local installer:

```bash
npm run install:local
```

## Project Trust

On Pi 0.79+, `pi-superagents` mirrors Pi's project-trust decision. Project-local agents, skills, skill packages, `.pi/settings.json` skill entries, and project agent frontmatter extensions are loaded only when the current Pi context reports the project as trusted. Child subagent Pi processes receive `--approve` when the parent context is trusted and `--no-approve` when it is not, so non-interactive child runs do not silently escalate trust.

Trusting a project enables runtime subagent delegation from project agents but does not automatically register project-local interactive entrypoint agents as slash commands. Custom slash commands should be installed as user-level (`~/.pi/agent/agents/sp-*.md`) or package-bundled entrypoint agents. See [Project Trust](docs/configuration.md#project-trust) in the Configuration reference for the full trust-gated inputs list and slash command registration caveats, and the [Skills Reference](docs/skills.md#skills-reference) for the project skill path policy.

## Execution Model

Subagent execution is synchronous and blocking. The `subagent` tool does not accept `async`, `wait`, `collect`, or `cancel` parameters. Lifecycle tools (`subagent_done`, `caller_ping`) are registered as internal child-only tools through policy; they are not general-purpose delegation tools.

## Integrated Slash Commands

Superpowers slash commands are registered from interactive entrypoint agent frontmatter, not generated from `config.json`. `config.json` only changes runtime behavior for commands that already have a matching entrypoint agent. Use `superagents.tools` to append shared tool names or tool extension paths to every subagent without repeating them in each agent frontmatter file.

| Command                 | Description                                                                 |
| ----------------------- | --------------------------------------------------------------------------- |
| `/sp-brainstorm <task>` | Brainstorm a task and save a spec, optionally review it with Plannotator UI |
| `/sp-plan <task>`       | Plan a task with optional Plannotator plan review                           |
| `/sp-implement <task>`  | Run an implementation task through the Superpowers flow                     |
| `/subagents-status`     | Open active and recent subagent run status, including runtime-confirmed models, thinking levels, and resolved skills |
| `/sp-settings`          | Open superagents settings                                                   |

### Custom Commands

Create custom slash commands by adding an interactive entrypoint agent markdown file (e.g., `~/.pi/agent/agents/sp-mycommand.md`) with the appropriate frontmatter. Optional behavior flags (e.g., `useSubagents`, `usePlannotator`) can be set in `config.json` under `superagents.commands.<name>`. Config blocks alone do not register commands.

See [Configuration](docs/configuration.md#custom-commands) for the agent frontmatter schema and behavior flag reference.

### Agents

The `/sp-implement` command activates a structured workflow for task execution with an interactive entrypoint agent, role-specific headless agents, model tiers, and built-in quality gates. The bundled `agents/sp-implement.md` entrypoint injects root lifecycle skills for verification, review-feedback handling, and branch finishing. The bundled `sp-debug` role injects `systematic-debugging` when delegated.

Subagent execution remains conservative and synchronous for ordinary Superpowers workflows. There is intentionally no user-facing `async` or `blocking` switch in agent frontmatter, config, or tool parameters. Internal result ownership prevents duplicate delivery and lifecycle sidecars let child agents report intentional completion or a parent-help request without changing the normal delegation flow. 

### Development Quality Gates

Repository maintenance uses `npx fallow` for dead-code and maintainability analysis. The checked-in `.fallowrc.json` keeps true dead-code findings blocking while documenting intentional dynamic-entrypoint exceptions and treating broad duplication/health refactors as non-blocking reports.

1. **Recon** (`sp-recon`): Initial codebase analysis and context gathering.
2. **Research** (`sp-research`): Deep dive into specific APIs, libraries, or logic.
3. **Implementation** (`sp-implementer`): Code changes guided by test-driven development (optional).
4. **Review** (`sp-code-review`): Automated review of changes against project standards.
5. **Debug** (`sp-debug`): Root cause analysis and fix verification for regressions.

Subagent-driven development keeps implementer and reviewer reports inline in the Pi conversation. Bounded roles default to `lineage-only` - they see a curated work brief rather than the full parent conversation history. The runtime does not create repo-root packet files such as `implementer-report.md`, `spec-review.md`, `code-review.md`, `debug-brief.md`, or `task-brief.md`; those names are ignored if an older prompt or manual run creates them.

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
