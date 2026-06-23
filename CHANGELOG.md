# Changelog

## [Unreleased]



## [0.9.3] - 2026-06-23

- **Compaction Durability**
  - Re-arms the Superpowers root contract after context compaction so the model retains lifecycle-trigger awareness across long autonomous runs.
  - Sizes re-injection by compaction flow: full contract for threshold auto-compaction, trimmed reminder for overflow recovery, minimal one-line pointer for manual `/compact`.
- **Model Tier Hardening**
  - Subagent now hard-stoppes with a clear error when an agent references a reserved model tier (`cheap`, `balanced`, `max`, `reasoning`) or a configured tier key that has no usable `model` — the literal tier name is never passed to Pi as a model id.
  - Centralized model resolution in `resolveEffectiveModel` removes duplicated fallback logic across the single and parallel execution paths.
  - Moved the built-in tier name list to `superpowers-policy.ts` as the single source of truth (`RESERVED_MODEL_TIERS`), imported by the settings overlay.
- **Subagent Tool Naming Bridge**
  - The `subagent` tool description now identifies itself as the tool the upstream Superpowers skills reference (provided by pi-superagents, the pi-subagents-compatible fork) and states its actual capabilities (synchronous single, parallel, and forked-context dispatch — no async, chain, or resume/status), so models connect the skill reference to this tool.
- **Inline Packet Delivery Consistency**
  - Removed `[Read from:]` references to legacy handoff filenames (`task-brief.md`, `debug-brief.md`, `implementer-report.md`, `spec-review.md`) that built-in Superpowers role packet defaults injected into bounded subagent task text.
- Bumped Pi development dependencies to `^0.79.10`.

## [0.9.2] - 2026-06-12

- **Pi 0.79 Project Trust Support**
  - Mirrored parent project-trust decisions into child Pi runs with `--approve` for trusted projects and `--no-approve` for untrusted projects.
  - Trust-gated project-local agents, skills, skill packages, `.pi/settings.json` skill entries, and project agent frontmatter extensions.
  - Updated Pi development dependencies to `^0.79.1` and documented project-trust behavior in README/configuration/skills docs.
  - Added pnpm build-script policy for nonessential transitive dependencies (`@google/genai`, `protobufjs`).
- General refactoring following `npx fallow` findings
- Standardize project tooling on `pnpm`


## [0.9.1] - 2026-05-29

- **Model Picker Navigation Fixes**
  - Fixed `/sp-settings` model picker navigation so keyboard selection scrolls through the full filtered model list before wrapping to the top.
  - Allowed `q` to be typed into model picker search queries; `Esc` now clears search or returns to tier selection from the model picker.
  - Updated model picker documentation and regression coverage for off-screen selection and `q` filtering.

## [0.9.0] - 2026-05-20

- **Pi 0.72+ Model Registry Compatibility**
  - Fixed `/sp-settings` model tier editing for newer Pi model registry objects by mapping registry models into Superagents' `{ provider, id, name }` option shape.
  - Added type-to-search filtering for large authenticated model lists and constrained keyboard selection to the visible result window.
  - Ensured model tier edits create the config directory when needed before writing `config.json`.

- **Model Tier Thinking Configuration**
  - Added a post-model thinking picker to `/sp-settings`; tier editing now flows from tier selection, to model selection, to thinking level selection.
  - Supported tier thinking choices: `default`, `off`, `minimal`, `low`, `medium`, `high`, and `xhigh`.
  - Added config writer support for setting and clearing tier-level `thinking` while preserving the selected model.

- **Pi Dependency Migration**
  - Migrated Pi development dependencies and imports from `@mariozechner/pi-*` to `@earendil-works/pi-*` `^0.75.3`.
  - Removed the old `@marcfargas/pi-test-harness` dependency because it still pulls the legacy Pi package scope.
  - Updated TypeScript test scripts to use Node's supported `--experimental-strip-types` flag instead of the removed `--experimental-transform-types` flag.

- **Validation Fixes**
  - Made Windows CI assertions path-separator independent and skipped the POSIX-only unreadable-permission lifecycle test on Windows.

## [0.8.3] - 2026-05-11
  
- Updated pi dependencies to `^0.73.0`
  
- **Global Tools Alowlist**
  - Global config for tools that are allowed to be used by all agents.
  - Global tools are appended to agent-specific ones.

- **Hardened Subagent Execution**
  - Added child lifecycle sidecar parsing (`lifecycle-signals.ts`) for atomic `.exit` sidecar writes consumed by the parent after child exit.
  - Added deterministic result delivery store (`result-delivery.ts`) with `wait`/`join`/`detach` semantics and delivered-once enforcement.
  - Extracted child runner into `child-runner.ts` (replaces deleted `execution.ts`).
  - Added execution planner (`execution-planner.ts`) for prepared child run plans with packet/fork handoff logic.
  - Subagent results carry optional `completion` envelope metadata and `lifecycle` sidecar status.
  - Worktree-backed parallel children are joined before cleanup; worktree policy is unchanged.

- **Improved Subagent UI**
  - Inline Pi chat subagent rows now show compact runtime-confirmed model labels for started, running, and completed subagent runs.
  - Expanded inline details and `/subagents-status` selected details show the child Pi-reported model separately from the effective thinking level.
  - Run history records thinking metadata separately from model ids so the status overlay can confirm actual subagent model routing.

## [0.8.2] - 2026-05-04

- **Fixed**
  - Record the actual child Pi model emitted by assistant messages in subagent run results while preserving the requested model label for child Pi error events.
  - Isolate run-history storage during tests with `PI_SUPERAGENTS_RUN_HISTORY_PATH`.

## [0.8.1] - 2026-05-04

- **Compatibility**
  - Bumped Pi development dependencies from `^0.70.0` to `^0.72.1` after verifying the `v0.70.0` to `v0.72.1` API changes do not require Superagents code changes.

## [0.8.0] - 2026-04-30

- **Breaking: Agent Configuration**
  - Moved Superpowers slash-command metadata into entrypoint agent frontmatter so `config.json` only carries runtime behavior flags. 
  - Slash-commands are now registered from discovered agents that declare `kind: entrypoint` and `execution: interactive`.
  - Added `/sp-brainstorm` and `/sp-plan` entrypoint agents and removed skill overlay config to keep Superpowers skill selection trigger-driven.
  - Added bundled `agents/sp-implement.md` entrypoint metadata so `/sp-implement` root sessions load lifecycle skills for verification, review-feedback handling, and branch finishing.
  - Added support for future interactive command agents to define their own root-session lifecycle skills through frontmatter.
  - Assigned `systematic-debugging` to `sp-debug` so delegated debug runs start with root-cause analysis guidance.
  - Made `/sp-settings` workflow toggles command-scoped; use `c` to select a command before toggling Plannotator, subagents, TDD, or worktrees on that command preset.
  - Root prompts now instruct delegated `subagent` calls to pass the resolved `useTestDrivenDevelopment` value explicitly, and omitted direct tool calls no longer inherit `/sp-implement` TDD settings.

- **Breaking: Extension Loading**
  - Isolated subagent extension loading with global and agent-level allowlists.
  - Pi-style extension source support such as `npm:` while retaining local path validation.
  - Clear pre-spawn diagnostics for missing configured extension paths.

## [0.7.0] - 2026-04-27

- **Lineage-Only Communication**
  - Bounded Superpowers roles now default to `session-mode: lineage-only`. Child sessions stay linked to the parent for `/tree`, but they do not inherit parent conversation turns.
  - Work briefs are delivered through runtime-managed packet artifacts under the session artifact directory and cleaned up automatically after the child exits.
- **Executor Consolidation**
  - Extracted shared per-task execution pipeline into `runChild()` — used by both single and parallel paths for `prepareLaunch → runSync → cleanup → annotate`.
  - Extracted `executor-validation.ts` with session-mode decorators (`withSessionModeDetails`, `withSingleResultSessionMode`, `withProgressResultSessionMode`) and validation helpers (`validateExecutionInput`, `toExecutionErrorResult`, `buildParallelModeError`).
  - Removed inline duplicates of parallel worktree helpers and `buildParallelModeError` — now imported from `worktree.ts` and `executor-validation.ts`.
  - Kept all execution paths in `subagent-executor.ts` (single file, no over-fragmentation) — reduced from ~940 to ~770 lines.
  - Removed dead code: `_buildRequestedModeError`, `_cleanTask`, commented `fs` import, `LegacyExecutionContext`.
  - Removed `context` field from `SubagentParamsLike`, `Details`, `resolveRequestedSessionMode`, and UI renderer.
  - Migrated `fork-context-execution.test.ts` from `context` to `sessionMode`.
  - Cleaned `ExecutorDeps`: removed unused `pi`, `expandTilde`, `tempArtifactsDir`, `config?`.
- Bump devDependencies for pi-mono packages from ^0.69.0 to ^0.70.0

## [0.6.3] - 2026-04-23

- **Compatibility**
  - Migrated from `@sinclair/typebox` to `typebox` `1.x` to maintain compatibility with `pi-coding-agent` v0.69.0 breaking changes.

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

- Hardened worktree behavoir
- Encourage superpowers to tick off finished tasks

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
- Generic agents like `scout`, `planner`, `worker`, reviewer, context-builder, researcher, delegate plus Superpowers `sp-*` roles are the new standard.
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

**Prior history:** This project is a fork of `pi-subagents` (https://github.com/nicobailon/pi-subagents). For changes before this fork, see the pi-subagents repository.