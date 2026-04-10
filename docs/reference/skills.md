# Skills Reference

Skills are specialized instructions loaded from `SKILL.md` files and injected into the agent's system prompt.

## Skill Locations (project-first precedence)

- **Project:** `.pi/skills/{name}/SKILL.md`
- **Project packages:** `.pi/npm/node_modules/*` via `package.json -> pi.skills`
- **Project settings:** `.pi/settings.json -> skills`
- **User:** `~/.pi/agent/skills/{name}/SKILL.md`
- **User packages:** `~/.pi/agent/npm/node_modules/*` via `package.json -> pi.skills`
- **User settings:** `~/.pi/agent/settings.json -> skills`

## Usage

```typescript
// Agent with skills from frontmatter
{ agent: "scout", task: "..." }  // uses agent's default skills

// Override skills at runtime
{ agent: "scout", task: "...", skill: "tmux, safe-bash" }

// Disable all skills (including agent defaults)
{ agent: "scout", task: "...", skill: false }

// Chain with chain-level skills (additive to agent skills)
{ chain: [...], skill: "code-review" }

// Chain step with skill override
{ chain: [
  { agent: "scout", skill: "safe-bash" },  // only safe-bash
  { agent: "worker", skill: false }        // no skills at all
]}
```

## Injection Format

```xml
<skill name="safe-bash">
[skill content from SKILL.md, frontmatter stripped]
</skill>
```

## Missing Skills

If a skill cannot be found, execution continues with a warning shown in the result summary.