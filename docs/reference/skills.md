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

## Missing Skills

For delegated subagent runs, missing skills are reported in the result summary and execution continues with the skills that were found. For root Superpowers entry-skill flows, missing required entry or overlay skills block prompt dispatch so the user can fix the configuration.
