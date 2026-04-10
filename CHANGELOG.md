# Changelog

## [0.1.0] - 2026-04-10

Initial release of **pi-superagents**, rebranded from pi-subagents to reflect the combination of Superpowers workflow ideas and subagent-based execution.

**Highlights:**

- **Superpowers workflow** — `/superpowers` command with structured recon → plan → implement → review pipeline, model tiers, and role-specific agents (sp-recon, sp-implementer, sp-code-review, etc.)
- **Slash commands** — `/run`, `/chain`, `/parallel` with tab-completion, per-step tasks, inline config, `--bg` and `--fork` flags
- **Agents Manager overlay** — browse, create, edit, and launch agents and chains from a TUI
- **Chain files** — reusable `.chain.md` pipelines with per-step config, parallel fan-out/fan-in, and chain variables (`{task}`, `{previous}`, `{chain_dir}`)
- **Worktree isolation** — parallel agents each get their own git worktree; Superpowers defaults to worktree isolation
- **Builtin agents** — scout, planner, worker, reviewer, context-builder, researcher, delegate plus Superpowers role agents
- **Agent frontmatter** — full schema with tools, extensions sandboxing, MCP tools, thinking levels, skills, output/reads/progress defaults, max subagent depth
- **Clarification TUI** — interactive preview/edit for chains, single, and parallel runs with model, thinking, skill, and output pickers
- **Management actions** — LLM-driven CRUD for agent and chain definitions at runtime
- **Async execution** — background mode with progress overlay, completion notifications, and async status TUI
- **Session sharing** — export to GitHub Gist with `share: true`
- **Custom model tiers** — define cheap/balanced/max or custom tiers in config
- **Reorganized documentation** — README trimmed to user-relevant content; detailed API, configuration, and operational docs moved to `/docs`

**Prior history:** This project is a fork of [pi-subagents](https://github.com/nicobailon/pi-subagents). For changes before this fork, see the pi-subagents repository.