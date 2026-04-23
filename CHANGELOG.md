# Changelog

## [0.6.2] - 2026-04-23

- Added compact inline subagent result rendering with collapsed status summaries and expanded in-place details.
- Parallel subagent executor now includes pending progress rows in result details so the UI can display incomplete parallel tasks.

## [0.6.1] - 2026-04-21

- Fixed compatibility with Pi `0.68.0` by passing an explicit Pi agent directory to the skill loader while preserving support for older Pi runtimes.
- Updated development PI package dependencies to `0.68.0`.

## [0.6.0] - 2026-04-19

- **Live Model Tier Config Editing**
  - Added live model tier config editing — `/sp-settings` now includes a model picker that reads PI's authenticated model registry, writes tier overrides to `config.json`, and reloads config without restarting PI. Future subagents in the session use the updated tier values; already-running subagents keep the model they launched with.
- **Online Agent Handoffs**
  - Replaced Superpowers role handoff files with inline Pi tool-result output so subagents no longer write `implementer-report.md`, `spec-review.md`, or `code-review.md` into the repository root.
  - Removed the single-output file round trip and now use the child Pi JSONL assistant output as the authoritative subagent response.
  - Removed write access from read-only review/debug roles and documented that optional execution artifacts live in the session artifact directory instead of the project working tree.
- **Fixed Windows CI worktree validation** - by normalizing repository-relative cwd handling and line endings across checkout platforms.

## [0.5.2] - 2026-04-18

- Established GitHub Releases as the canonical release path for npm publishing after the one-time `0.5.1` npm bootstrap publish.
- Added GitHub community health files, issue forms, pull request template, Dependabot configuration, generated release-note categories, and CI/release workflows.
- Added maintainer release documentation for GitHub Releases and npm Trusted Publishing.
- Aligned GitHub workflows with the repository's no-lockfile package install model by using `npm install` without setup-node lockfile caching.
- Updated package and installer repository metadata to point at `teelicht/pi-superagents`.

## [0.5.1] - 2026-04-17

- Show resolved subagent skills and missing-skill warnings in `/subagents-status`, making `skillOverlays` easier to verify during active and recent runs.
- Fixed direct `/skill:brainstorming` and `/skill:writing-plans` interception so those paths inherit the matching command presets from `/sp-brainstorm` and `/sp-plan`.
- Fixed Plannotator review tools so per-command `usePlannotator: false` disables the bridge and returns the normal text-review guidance.
- Updated release-readiness tests for the current command config shape, current subagent tool result contract, and isolated npm sandbox installs.

## [0.5.0] - 2026-04-15

- **Major change of how commands are registered and executed**
  - Commands now all in the config file
  - Settings are now command-specific

## [0.4.1] - 2026-04-14

- **Fixes:**
  - Branching config now works as expected
  - Removed write access from review agents, preventing them from creating .md files
  - Removed hardcoded config values that shouldn't have been in the code in the first place

- **Less noisy user feedback** - trimmed information shown to the user after invoking superpowers via the slash command
- **Better TUI** - improved TUI layout

## [0.4.0] - 2026-04-13

- **Optional plannotator integration** - specs can now be reviewed in plannotator if desired

## [0.3.5] - 2026-04-12

- (hopefully) fixed memleaks
- review angents may now write to files

## [0.3.4] - 2026-04-12

- Encourage superpowers to tick off finished tasks (now for real)

## [0.3.3] - 2026-04-12

- Hardened worktree behavoir
- Encourage superpowers to tick off finished tasks

## [0.3.2] - 2026-04-11

- More typescript linter fixes, project is now clean

## [0.3.1] - 2026-04-11

- Linter fixes
- Added note about required superpowers skills installation

## [0.3.0] - 2026-04-11

### Changed

- **Lean Superpowers Runtime** — the core runtime has been radically trimmed to focus exclusively on Superpowers workflows. Generic subagent features like free-form chains, Agents Manager TUI, and management CRUD actions have been removed.
- **Narrowed Subagent Tool** — the `subagent` tool now only accepts Superpowers role agents and structured parallel tasks. The generic sequential chain parameter has been removed.
- **Unified Command Set** — slash commands are now limited to `/superpowers` and `/superpowers-status`. Generic commands like `/run`, `/chain`, `/parallel`, and `/agents` have been removed.
- **Documentation Refactor** — documentation has been rewritten to reflect the Superpowers-first identity. Generic agent and chain guides have been removed.
- **Removed Fork Branding** — branding as a fork of `pi-subagents` has been removed in favor of a standalone Superpowers extension identity.
- **Strictly Synchronous Execution** — all background run capabilities (`--bg`) and associated polling logic have been stripped; subagents now execute reliably in the foreground.
- **Simplified Agent Discovery** — agent selection and scope logic have been consolidated to directly and strictly target `sp-*` agents without extraneous abstraction constraints.

### Removed

- Generic `.chain.md` file support and serialization.
- Agents Manager TUI (Ctrl+Shift+A).
- Management dispatcher branches (`list`, `get`, `create`, `update`, `delete`).
- Generic sequential chain execution runtime.
- Generic agents like `scout`, `planner`, `worker`, etc. (Superpowers `sp-*` roles are the new standard).
- The entire `async` execution subsystem, including background polling tracking, status UI widgets, and the `--bg` slash command flag.
- The `subagent_status` tool.
- Dead executor fields like `share` / `shareEnabled` and `asyncByDefault` from core settings types.

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
