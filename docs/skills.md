# Skills Reference

Skills are specialized instructions loaded from `SKILL.md` files and injected into the agent's system prompt.

This reference targets Pi `^0.85.1` and Superpowers `v6.2+`.

Maintenance note: skill discovery helpers are exercised through dynamic tests and plugin entrypoints. `.fallowrc.json` documents the small export surface that remains intentionally available for those dynamic paths.

## Skill Locations (project-first precedence)

- **Project, only when Pi project trust is active:** `.pi/skills/{name}/SKILL.md` and `.agents/skills/{name}/SKILL.md`
- **Project packages, only when Pi project trust is active:** `.pi/npm/node_modules/*` via `package.json -> pi.skills`
- **Project git packages, only when Pi project trust is active:** `.pi/git/<host>/<path segments>` via `package.json -> pi.skills`
- **Project settings, only when Pi project trust is active:** `.pi/settings.json -> skills`
- **User:** `~/.pi/agent/skills/{name}/SKILL.md` and `~/.agents/skills/{name}/SKILL.md`
- **User packages:** `~/.pi/agent/npm/node_modules/*` via `package.json -> pi.skills`
- **User git packages:** `~/.pi/agent/git/<host>/<path segments>` via `package.json -> pi.skills`
- **User settings:** `~/.pi/agent/settings.json -> skills`
- **Global packages:** global npm packages with `package.json -> pi.skills`

Git packages are resolved through their `pi.skills` metadata only. Repo roots are located by their `.git` entry (a directory for clones, a file for worktrees), so multi-segment paths such as GitLab subgroups resolve like plain `owner/repo` ones. Discovery remains inside each canonical git-install root and ignores symlinks whose targets leave it. The git-install root itself is never passed to Pi's skill loader, because Pi writes a `.gitignore` containing `*` there; packages without a `pi.skills` declaration contribute no skills, matching the npm package collector. Temporary git installs under `<agentDir>/tmp/extensions/git-*` are not scanned.

## Usage

```typescript
// Role agent with skills from its default policy/frontmatter
{ agent: "sp-recon", task: "Inspect the auth flow" }

// Override skills at runtime
{ agent: "sp-implementer", task: "Implement auth", skill: "test-driven-development" }

// Disable all skills (including agent defaults)
{ agent: "sp-research", task: "Check the SDK docs", skill: false }

// Parallel tasks can override skills per task
{ tasks: [
  { agent: "sp-research", task: "Check config", skill: "openai-docs" },
  { agent: "sp-review", task: "Review the diff", skill: false }
] }
```

## Injection Format

```xml
<skill name="safe-bash">
[skill content from SKILL.md, frontmatter stripped]
</skill>
```

## Skill Frontmatter

Skills declare metadata in YAML frontmatter at the top of their `SKILL.md` file:

```yaml
---
name: my-skill
description: When to use this skill
scope: root   # optional
---
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique skill identifier |
| `description` | Yes | Short description of when to use the skill |
| `scope` | No | `root` restricts the skill to root-planning agents only; omit or use `agent` for skills available to all roles |

Skills with `scope: root` are orchestration-level skills that should never be delegated to bounded role agents (e.g., `sp-recon`, `sp-implementer`). The runtime enforces this restriction automatically.

## Agent Frontmatter

Agent definitions (`agents/sp-*.md`) declare metadata in YAML frontmatter. Bounded role agents use `kind: role` or omit `kind`; interactive root commands use `kind: entrypoint` with `execution: interactive`.

### Entrypoint Agent Fields

Interactive entrypoint agents (used for slash command registration) support these frontmatter fields:

```yaml
---
name: sp-example
description: Example Superpowers entrypoint
kind: entrypoint
execution: interactive
command: sp-example
entrySkill: using-superpowers
skills: verification-before-completion
---
```

The `subagent` tool is the one the upstream Superpowers skills reference as "subagent from pi-subagents". Pi-superagents is the pi-subagents-compatible fork; the tool description states this and its actual capabilities (synchronous single, parallel, and forked-context dispatch — no async, chain, or resume/status) so models connect the skill reference to this tool.

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Agent identifier used by the `subagent` tool or matching entrypoint name |
| `description` | Yes | Short description of the agent's purpose |
| `kind` | Yes | `entrypoint` for interactive root command agents |
| `execution` | Yes | `interactive` for root entrypoints |
| `command` | Yes | Slash command name (e.g., `sp-example`) |
| `entrySkill` | Yes | Entry skill for the workflow (e.g., `using-superpowers`, `brainstorming`, `writing-plans`) |
| `skills` | No | Comma-separated root lifecycle skills. For root entrypoints, these are lifecycle/root skills with explicit trigger points, not overlay replacements. |

### Bounded Role Agent Fields

Bounded role agents (delegated to subagents) support:

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Agent identifier |
| `description` | No | Short description |
| `kind` | No | `role` for bounded delegated roles; omit for legacy behavior |
| `execution` | No | `headless` for bounded delegated roles |
| `skills` | No | Comma-separated skills injected into delegated subagent prompts |
| `extensions` | No | Comma-separated Pi extension entrypoints to append for this agent |
| `model` | No | Default model tier or concrete model ID |
| `tools` | No | Comma-separated list of baseline tool names available to this agent. Global `superagents.tools` entries are appended at launch time. |
| `maxSubagentDepth` | No | Maximum subagent delegation depth (0 disables delegation) |
| `session-mode` | No | `standalone`, `lineage-only`, or `fork`. Built-in bounded roles default to `lineage-only`. |

## Entrypoint Lifecycle Skills

The `skills` field in entrypoint agents is reserved for root lifecycle skills. These are skills with explicit trigger points (e.g., `verification-before-completion`, `receiving-code-review`, `finishing-a-development-branch`) that apply to the root session only.

Superpowers skill selection inside an explicit workflow is trigger-driven via `using-superpowers`. With the default `superagents.makeSuperpowersSkillsOptInOnly: true`, ordinary prompts do not advertise that bootstrap skill and the obra/superpowers Pi package's automatic bootstrap hook is neutralized. `/sp-*` and explicit `/skill:*` commands still resolve the installed upstream skills. Do not preload domain skills through command config. Entrypoint `skills` are not overlay replacements — they are lifecycle/root skills with explicit trigger points.

Command-scoped workflow toggles can be changed through `/sp-settings`; model tier edits in the same overlay use a type-to-search picker backed by PI's authenticated model registry. The picker accepts `q` as search text, scrolls through all filtered results rather than only the visible page, and is followed by a thinking-level picker for the tier.

Bundled entrypoint assignments:

- `agents/sp-implement.md` and `agents/sp-implement-parallel.md` assign `verification-before-completion`, `receiving-code-review`, and `finishing-a-development-branch` as root lifecycle skills.
- `agents/sp-brainstorm.md` and `agents/sp-plan.md` assign their respective entry skills.

Bundled role assignments:

- `agents/sp-debug.md` assigns `systematic-debugging` to the bounded debug role.
- `agents/sp-implementer.md` ships on the `cheap` model tier and reads/writes implementer reports by path; its `maxSubagentDepth: 0` keeps it from delegating further.
- `agents/sp-review.md` is the only Superpowers reviewer; it ships on the `max` tier and supports three scopes, declared explicitly in the dispatch:
  - `Review scope: task` — use the supplied upstream task-review template.
  - `Review scope: re-review` — verify only prior findings and the fix diff using the supplied upstream scoped re-review template.
  - `Review scope: branch` — use the supplied upstream final code-review template.
  Missing or unknown scope markers return `NEEDS_CONTEXT`. Successful reports follow the supplied upstream template rather than a fixed local status vocabulary.

Normal dispatches omit `model` and `tasks[].model`, allowing these frontmatter tiers to resolve through `superagents.modelTiers`. Those tool fields are only for one-off model overrides explicitly requested by the user.

Install upgrades rename user-level `sp-spec-review.md` and
`sp-code-review.md` files to timestamped backups. This prevents stale user
agents from surviving beside the consolidated bundled `sp-review` role.

### Re-arming after compaction

When pi compacts the session context mid-Superpowers-run, the extension
re-injects the lifecycle-skill trigger points so the model can continue
invoking `verification-before-completion`, `receiving-code-review`, and
`finishing-a-development-branch` at their trigger points without re-running
the original command. The re-injection is sized by the compaction reason
(threshold = full, overflow = trimmed, manual = pointer) and only occurs
in sessions where a Superpowers command has been explicitly activated.

## Parallel SDD Task Scheduling

When `/sp-implement-parallel` runs—or another implementation command resolves `taskScheduling: "parallel"`, `useSubagents: true`, and `worktrees.enabled: true`—the root session controller drives the implementation plan in waves. The controller composes the three existing upstream Superpowers skills — `subagent-driven-development`, `dispatching-parallel-agents`, and `using-git-worktrees` — **without forking or editing them**:

- `subagent-driven-development` is authoritative for SDD scripts, plan workspace and ledger, handoff artifacts, and final cleanup. The active command's `reviewCadence` may override its review timing.
- `dispatching-parallel-agents` provides the wave-building and dependency-ready heuristics.
- `using-git-worktrees` provides the directory convention and safety rules for the per-Task worktrees.

A **Task** is the whole numbered block of Steps from the implementation plan. The controller dispatches all Steps of one Task together to a single `sp-implementer` session — it never dispatches or reviews individual Steps. `reviewCadence: "per-task"` retains the upstream task/re-review/final mapping. `"final-only"` skips and runtime-rejects task/re-review dispatches, integrates successful Task commits in Task-number order, then runs `Review scope: branch` alone against the whole-plan diff. This marker works on `main`; the review base is `HEAD` recorded before Task 1, not `git merge-base main HEAD`.

Sequential scheduling keeps Pi-owned Task order only: one complete Task at a time, with no parallel writers and no persistent Task worktrees. The Task-includes-all-Steps rule still holds.

Worktree lifecycle for parallel SDD waves is described in the [Worktree Isolation reference](worktrees.md#two-kinds-of-parallel-worktree): the controller pre-creates one persistent worktree per Task under the configured worktree root. Per-task cadence reuses it across implement → review → fix → re-review; final-only cadence integrates successful implementation commits before the single final review. Ordinary parallel calls still get ephemeral, extension-owned worktrees.

## Child Lifecycle Tools

Child lifecycle tools (`subagent_done`, `caller_ping`) may be available to bounded roles through the tool policy for semantic completion signaling and parent request handling. These are internal child-only tools; they are not general-purpose delegation tools and are not listed in the parameters API.

Shared tool names or tool extension paths can be configured once with `superagents.tools`. The bundled default config uses this for the common read-only baseline (`read`, `grep`, `find`, `ls`). The runtime appends those entries to each agent's resolved baseline tools after role policy and removes duplicates, so common tools do not need to be repeated in every `agents/*.md` frontmatter block.

## Missing Skills

For delegated subagent runs, missing skills are reported in the result summary and execution continues with the skills that were found. For root Superpowers entry-skill flows, missing required entry or entrypoint lifecycle skills block prompt dispatch so the user can fix the configuration.

## Status Visibility

Inline subagent result rows show each run's compact runtime-confirmed model label. Open `/subagents-status` and select an active or recent subagent run to see the runtime-confirmed model, effective thinking level when available, and resolved skill names injected for that run. Skill details include default agent skills, runtime `skill` overrides, and TDD skill injection from the explicit `useTestDrivenDevelopment` tool parameter. Missing skills are shown as warnings in the selected run details.

## Role Output

Skills and role prompts should return findings in the assistant response. Pi Superagents forwards that response through the `subagent` tool result and preserves optional debug artifacts outside the repository. For SDD execution, the installed upstream `subagent-driven-development` skill is authoritative for scripts, plan workspace and ledger, handoff artifacts, review/fix cadence, retry and adjudication rules, and final cleanup. Pi's generated contract supplies only role names, the three local review-scope markers, conditional `resumeSession`, Task scheduling, and parallel Task-worktree orchestration. After a clean final branch review, complete upstream's final cleanup before invoking `finishing-a-development-branch`.

Subagent results are rendered as compact inline lines in the Pi conversation. Collapsed view shows the agent name, compact runtime-confirmed model label, task, status, and current tool activity. Expanded view reveals model, thinking level when available, skills, recent tools, output preview, errors, and artifact paths. This keeps long-running Superpowers workflows readable without scrolling through verbose output.

## Release Notes

Skill discovery and injection behavior are part of the public extension contract. Before publishing changes to skill paths, frontmatter handling, scope enforcement, or missing-skill behavior, update this reference, `README.md`, and `CHANGELOG.md`, then follow the [Release Process](releases.md).

The extension passes explicit project and Pi agent directories to Pi's skill loader so discovery remains stable across Pi 0.67 and 0.68 runtimes.
