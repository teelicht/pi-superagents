# Changelog

## [0.3.0] - 2026-04-11

### Changed

- **Lean Superpowers Runtime** — the core runtime has been radically trimmed to focus exclusively on Superpowers workflows. Generic subagent features like free-form chains, Agents Manager TUI, and management CRUD actions have been removed.
- **Narrowed Subagent Tool** — the `subagent` tool now only accepts Superpowers role agents and structured parallel tasks. The generic sequential chain parameter has been removed.
- **Unified Command Set** — slash commands are now limited to `/superpowers` and `/superpowers-status`. Generic commands like `/run`, `/chain`, `/parallel`, and `/agents` have been removed.
- **Documentation Refactor** — documentation has been rewritten to reflect the Superpowers-first identity. Generic agent and chain guides have been removed.
- **Removed Fork Branding** — branding as a fork of `pi-subagents` has been removed in favor of a standalone Superpowers extension identity.

### Removed

- Generic `.chain.md` file support and serialization.
- Agents Manager TUI (Ctrl+Shift+A).
- Management dispatcher branches (`list`, `get`, `create`, `update`, `delete`).
- Generic sequential chain execution runtime.
- Generic agents like `scout`, `planner`, `worker`, etc. (Superpowers `sp-*` roles are the new standard).

## [0.2.0] - 2026-04-11

### Changed

- **Config install model** — fresh installs now create an empty user-owned `config.json` override file instead of copying the full bundled defaults.
- **Config reference file** — installs now include `config.example.json` as the package-owned reference for all supported settings.
- **Fail-closed config validation** — invalid JSON, unknown config keys, stale removed settings, and unsupported values disable `pi-superagents` execution until fixed.
- **Pi-visible diagnostics** — config problems are reported when Pi starts, and `subagent_status` can inspect config diagnostics.
- **Safe config migration** — unchanged full-default config files can be backed up and replaced with `{}` through `--migrate-config` or `subagent_status`.

### Migration Notes

- Existing `config.json` files are preserved during install/update.
- Keep only local overrides in `config.json`; compare with `config.example.json` for the current supported shape.
- If Pi reports that `pi-superagents` is disabled, fix or remove the reported keys to fall back to bundled defaults.

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