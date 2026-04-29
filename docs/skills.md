# Skills Reference

Skills are specialized instructions loaded from `SKILL.md` files and injected into the agent's system prompt.

## Skill Locations (project-first precedence)

- **Project:** `.pi/skills/{name}/SKILL.md` and `.agents/skills/{name}/SKILL.md`
- **Project packages:** `.pi/npm/node_modules/*` via `package.json -> pi.skills`
- **Project settings:** `.pi/settings.json -> skills`
- **User:** `~/.pi/agent/skills/{name}/SKILL.md` and `~/.agents/skills/{name}/SKILL.md`
- **User packages:** `~/.pi/agent/npm/node_modules/*` via `package.json -> pi.skills`
- **User settings:** `~/.pi/agent/settings.json -> skills`
- **Global packages:** global npm packages with `package.json -> pi.skills`

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
  { agent: "sp-code-review", task: "Review the diff", skill: false }
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
| `tools` | No | Comma-separated list of tool names available to this agent |
| `maxSubagentDepth` | No | Maximum subagent delegation depth (0 disables delegation) |
| `session-mode` | No | `standalone`, `lineage-only`, or `fork`. Built-in bounded roles default to `lineage-only`. |

## Entrypoint Lifecycle Skills

The `skills` field in entrypoint agents is reserved for root lifecycle skills. These are skills with explicit trigger points (e.g., `verification-before-completion`, `receiving-code-review`, `finishing-a-development-branch`) that apply to the root session only.

Superpowers skill selection is trigger-driven via `using-superpowers`. Do not preload domain skills through command config. Entrypoint `skills` are not overlay replacements — they are lifecycle/root skills with explicit trigger points.

Bundled entrypoint assignments:
- `agents/sp-implement.md` assigns `verification-before-completion`, `receiving-code-review`, and `finishing-a-development-branch` as root lifecycle skills.
- `agents/sp-brainstorm.md` and `agents/sp-plan.md` assign their respective entry skills.

Bundled role assignments:
- `agents/sp-debug.md` assigns `systematic-debugging` to the bounded debug role.

## Missing Skills

For delegated subagent runs, missing skills are reported in the result summary and execution continues with the skills that were found. For root Superpowers entry-skill flows, missing required entry or entrypoint lifecycle skills block prompt dispatch so the user can fix the configuration.

## Status Visibility

Open `/subagents-status` and select an active or recent subagent run to see the resolved skill names injected for that run. This includes default agent skills, runtime `skill` overrides, and TDD skill injection from the explicit `useTestDrivenDevelopment` tool parameter. Missing skills are shown as warnings in the selected run details.

## Role Output

Skills and role prompts should return findings in the assistant response. Pi Superagents forwards that response through the `subagent` tool result and preserves optional debug artifacts outside the repository. Skills should not ask bounded roles to write handoff files like `implementer-report.md`, `spec-review.md`, or `code-review.md`. Skills should assume bounded Superpowers roles receive curated packet input, not inherited parent-session history, because built-in bounded roles default to `session-mode: lineage-only`.

Subagent results are rendered as compact inline lines in the Pi conversation. Collapsed view shows the agent name, task, status, and current tool activity. Expanded view reveals model, skills, recent tools, output preview, errors, and artifact paths. This keeps long-running Superpowers workflows readable without scrolling through verbose output.

## Release Notes

Skill discovery and injection behavior are part of the public extension contract. Before publishing changes to skill paths, frontmatter handling, scope enforcement, or missing-skill behavior, update this reference, `README.md`, and `CHANGELOG.md`, then follow the [Release Process](releases.md).

The extension passes explicit project and Pi agent directories to Pi's skill loader so discovery remains stable across Pi 0.67 and 0.68 runtimes.
