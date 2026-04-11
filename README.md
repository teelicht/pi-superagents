# pi-superagents

Pi extension for delegating tasks to subagents with chains, parallel execution, TUI clarification, and async support.

> `pi-superagents` is a fork of `pi-subagents`, rebranded to reflect the combination of Superpowers workflow ideas and subagent-based execution.

## Installation

```bash
pi install npm:@teelicht/pi-superagents
```

To remove:

```bash
npx @teelicht/pi-superagents --remove
```

### Optional: pi-prompt-template-model

If you use [pi-prompt-template-model](https://github.com/nicobailon/pi-prompt-template-model), you can wrap subagent delegation in a slash command. See [Agents Reference → pi-prompt-template-model](docs/reference/agents-reference.md#pi-prompt-template-model).

## Quick Commands

| Command                                      | Description                                              |
| -------------------------------------------- | -------------------------------------------------------- |
| `/run <agent> <task>`                        | Run a single agent with a task                           |
| `/chain agent1 "task1" -> agent2 "task2"`    | Run agents in sequence with per-step tasks               |
| `/parallel agent1 "task1" -> agent2 "task2"` | Run agents in parallel with per-step tasks               |
| `/superpowers <task>`                        | Run a task through the Superpowers workflow               |
| `/subagents-status`                          | Open the async status overlay for active and recent runs |
| `/agents`                                    | Open the Agents Manager overlay                          |

### Per-Step Tasks & Inline Config

Use `->` to separate steps and give each step its own task with quotes or `--`:

```
/chain scout "analyze auth" -> planner "create implementation plan"
/parallel scanner "find security issues" -> reviewer "check code style"
```

Append `[key=value,...]` to any agent name to override defaults:

```
/chain scout[output=context.md] "scan code" -> planner[reads=context.md] "analyze auth"
/run scout[model=anthropic/claude-sonnet-4] summarize this codebase
```

Supported inline keys: `output`, `reads`, `model`, `skills`, `progress`. Set `output=false`, `reads=false`, or `skills=false` to explicitly disable.

### Background & Forked Execution

- `--bg` — run in the background (check status with `/subagents-status`)
- `--fork` — run with `context: "fork"` (branched session from parent's current leaf)
- Combine in any order: `/run reviewer "review this diff" --fork --bg`

## Superpowers Command

`/superpowers` activates the stricter Superpowers workflow for a specific run. The baseline `pi` harness plus generic `pi-superagents` behavior stays unchanged unless this command is used.

```text
/superpowers fix the auth regression
/superpowers tdd implement the cache invalidation task
/superpowers direct update the Expo config
/superpowers tdd review the release branch --fork
```

- **`tdd`** (default) — test-first implementer loop with the `test-driven-development` skill
- **`direct`** — same review and verification loop, but allows code-first implementation

Superpowers parallel steps default to worktree isolation (configurable via `superagents.worktrees.enabled`).

See [docs/guides/superpowers.md](docs/guides/superpowers.md) for full configuration and model tier details.

## Agents

Agents are markdown files with YAML frontmatter that define specialized subagent configurations.

**Agent file locations:**

| Scope   | Path                                                | Priority |
| ------- | --------------------------------------------------- | -------- |
| Builtin | `~/.pi/agent/extensions/subagent/agents/`           | Lowest   |
| User    | `~/.pi/agent/agents/{name}.md`                      | Medium   |
| Project | `.pi/agents/{name}.md` (searches up directory tree) | Highest  |

**Builtin agents:** `scout`, `planner`, `worker`, `reviewer`, `context-builder`, `researcher`, and `delegate`. User/project agents with the same name override builtins.

> **Note:** The `researcher` agent requires [pi-web-access](https://github.com/nicobailon/pi-web-access) for web search tools.

**Minimal frontmatter example:**

```yaml
---
name: scout
description: Fast codebase recon
model: claude-haiku-4-5
thinking: high
---
Your system prompt goes here.
```

Full frontmatter field reference: [docs/reference/agents-reference.md](docs/reference/agents-reference.md)

## Agents Manager

Press **Ctrl+Shift+A** or type `/agents` to open the Agents Manager — a TUI for browsing, viewing, editing, creating, and launching agents and chains.

Key screens: List (search/filter), Detail (resolved prompt, run history), Edit (model/thinking/skills pickers), Chain Detail (flow visualization), Parallel Builder (multi-agent launch), New Agent (templates).

See [docs/guides/agents.md](docs/guides/agents.md) for keybindings and workflows.

## Chain Files

Chains are `.chain.md` files stored alongside agent files, defining reusable multi-step pipelines.

```markdown
---
name: scout-planner
description: Gather context then plan implementation
---

## scout

output: context.md

Analyze the codebase for {task}

## planner

reads: context.md

Create an implementation plan based on {previous}
```

Each `## agent-name` section defines a step. Config lines (`output`, `reads`, `model`, `skills`, `progress`) go after the header. Chains support parallel steps with `{ parallel: [...] }` and chain variables `{task}`, `{previous}`, `{chain_dir}`.

See [docs/guides/chains.md](docs/guides/chains.md) for the full chain file format and workflow.

## Features

- **Slash Commands**: `/run`, `/chain`, `/parallel`, `/superpowers` with tab-completion and live progress
- **Agents Manager Overlay**: Browse, edit, create, and launch agents from a TUI
- **Superpowers Workflow**: Structured recon → plan → implement → review pipeline with role-specific agents
- **Chain Files**: Reusable `.chain.md` pipelines with per-step config
- **Parallel Execution**: Fan-out/fan-in patterns with worktree isolation
- **Worktree Isolation**: Each parallel agent gets its own git worktree to prevent filesystem conflicts
- **Chain Clarification TUI**: Interactive preview/edit before execution
- **Session Sharing**: Upload session to GitHub Gist with `share: true`
- **Async Execution**: Background mode with progress overlay and completion notifications
- **Skill Injection**: Agents declare skills in frontmatter; skills inject into system prompts
- **MCP Tools**: Optional [pi-mcp-adapter](https://github.com/nicobailon/pi-mcp-adapter) integration for direct MCP tool access

## Documentation

- **[Agents Guide](docs/guides/agents.md)** — Creating, managing, and using agents
- **[Chains Guide](docs/guides/chains.md)** — Chain files, variables, and workflows
- **[Superpowers Guide](docs/guides/superpowers.md)** — Superpowers workflow, model tiers, and configuration
- **[Worktree Isolation](docs/reference/worktrees.md)** — Git worktree setup, requirements, and hooks
- **[Skills Reference](docs/reference/skills.md)** — Skill locations, injection, and handling
- **[Parameters API](docs/reference/parameters.md)** — Full parameter reference for the `subagent` tool
- **[Configuration](docs/reference/configuration.md)** — Extension config, model tiers, and session settings
- **[Agents Reference](docs/reference/agents-reference.md)** — Complete frontmatter schema and extension sandboxing
- **[Contributing](docs/contributing.md)** — TypeScript standards, doc headers, and testing requirements