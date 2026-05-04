# @teelicht/pi-superagents

[Pi agent-harness](https://pi.dev) extension to support [superpowers](https://skills.sh/obra/superpowers) workflows using subagents.

## Features

- **Superpowers Workflow**: Proven pipeline for robust AI-assisted development.
- **Role-Specific Agents**: Thin agents-layer for every phase of the development lifecycle.
- **Model Tiers & Command Settings**: Abstract model selection (cheap, balanced, max) for each agent. One model can be configured per tier. Custom tiers are possible. Models and command-scoped behavior toggles can be changed through the `/sp-settings` TUI; slash-command metadata lives in entrypoint agent frontmatter.
- **Compact Inline Subagent Results**: Subagent tool results render as collapsed single-line summaries with an expandable details view, keeping the Pi conversation readable during multi-step Superpowers workflows.
- **Strictly Synchronous Execution**: Subagent execution is synchronous and blocking. There are no user-facing `async`, `wait`, `collect`, or `cancel` parameters. The subagent tool does not return until the child Pi process completes.
- **Child Lifecycle Signals**: Internal lifecycle tools (`subagent_done`, `caller_ping`) enable child processes to signal semantic completion or request parent input without exposing async control to callers.
- **Lineage-Only Sessions**: Bounded Superpowers roles default to `sessionMode: lineage-only`. Child sessions stay linked to the parent for session tree visibility, but do not inherit parent conversation turns.
- **Packet Handoffs**: Work briefs are delivered through runtime-managed packet artifacts in the session artifact directory, automatically cleaned up after the child exits.
- **Inline Agent Handoffs**: Role outputs are returned through Pi tool results and session artefacts.
- **Worktree Isolation**: Optional git worktree creation for parallel tasks to prevent filesystem conflicts. Worktree-backed parallel children are joined before cleanup; worktree policy is unchanged.
- **Entrypoint Lifecycle Skills**: Superpowers entrypoint agents inject root lifecycle skills (verification, review-feedback, branch finishing) defined in frontmatter. Skill selection is trigger-driven via `using-superpowers`; do not preload domain skills through command config.
- **Subagent Extension Allowlist**: Subagents run with implicit Pi extension discovery disabled by default; configure `superagents.extensions` with local paths or Pi `-e` source specs such as `npm:@scope/package` for extensions every subagent should receive.
- **Plannotator Integration**: Optional event bridge to [Plannotator](https://plannotator.ai/) for browser-based spec/plan review and approval (setting).

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

## Execution Model

Subagent execution is synchronous and blocking. The `subagent` tool does not accept `async`, `wait`, `collect`, or `cancel` parameters. Lifecycle tools (`subagent_done`, `caller_ping`) are registered as internal child-only tools through policy; they are not general-purpose delegation tools.

## Integrated Slash Commands

Superpowers slash commands are registered from interactive entrypoint agent frontmatter, not generated from `config.json`. `config.json` only changes runtime behavior for commands that already have a matching entrypoint agent.

| Command                 | Description                                                                 |
| ----------------------- | --------------------------------------------------------------------------- |
| `/sp-brainstorm <task>` | Brainstorm a task and save a spec, optionally review it with Plannotator UI |
| `/sp-plan <task>`       | Plan a task with optional Plannotator plan review                           |
| `/sp-implement <task>`  | Run an implementation task through the Superpowers flow                     |
| `/subagents-status`     | Open active and recent subagent run status, including resolved skills       |
| `/sp-settings`          | Open superagents settings                                                   |

### Custom Commands

Create custom slash commands by adding an interactive entrypoint agent markdown file (e.g., `~/.pi/agent/agents/sp-mycommand.md`) with the appropriate frontmatter. Optional behavior flags (e.g., `useSubagents`, `usePlannotator`) can be set in `config.json` under `superagents.commands.<name>`. Config blocks alone do not register commands.

See [Configuration](docs/configuration.md#custom-commands) for the agent frontmatter schema and behavior flag reference.

### Agents

The `/sp-implement` command activates a structured workflow for task execution with an interactive entrypoint agent, role-specific headless agents, model tiers, and built-in quality gates. The bundled `agents/sp-implement.md` entrypoint injects root lifecycle skills for verification, review-feedback handling, and branch finishing. The bundled `sp-debug` role injects `systematic-debugging` when delegated.

Subagent execution remains conservative and synchronous for ordinary Superpowers workflows. There is intentionally no user-facing `async` or `blocking` switch in agent frontmatter, config, or tool parameters. Internal result ownership prevents duplicate delivery and lifecycle sidecars let child agents report intentional completion or a parent-help request without changing the normal delegation flow. 

1. **Recon** (`sp-recon`): Initial codebase analysis and context gathering.
2. **Research** (`sp-research`): Deep dive into specific APIs, libraries, or logic.
3. **Implementation** (`sp-implementer`): Code changes guided by test-driven development (optional).
4. **Review** (`sp-code-review`): Automated review of changes against project standards.
5. **Debug** (`sp-debug`): Root cause analysis and fix verification for regressions.

Subagent-driven development keeps implementer and reviewer reports inline in the Pi conversation. Bounded roles default to `lineage-only` - they see a curated work brief rather than the full parent conversation history. The runtime does not create repo-root packet files such as `implementer-report.md`, `spec-review.md`, `code-review.md`, `debug-brief.md`, or `task-brief.md`; those names are ignored if an older prompt or manual run creates them.

Run history is persisted at `~/.pi/agent/run-history.jsonl` for `/subagents-status`. Set `PI_SUPERAGENTS_RUN_HISTORY_PATH` to isolate that file for tests or sandboxed sessions.

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