# Dynamic Policy Resolution: Eliminate Hardcoded Role/Skill/Tool Maps

> Spec date: 2026-04-14
> Status: DRAFT

## Problem

`superpowers-policy.ts` contains three hardcoded maps that duplicate information already available at runtime:

1. **`ROOT_ONLY_WORKFLOW_SKILLS`** — A manually maintained set of skill names that only root-planning agents may receive. Every new orchestration skill requires a manual edit here or it silently leaks to bounded agents.

2. **`NON_DELEGATING_ROLE_TOOLS`** — A per-role tool allowlist that duplicates each agent's `tools:` frontmatter line-for-line. When agent frontmatter and this map drift (they already have — `sp-debug` declares `write` but the fallback omits it), the fallback serves stale data.

3. **`DELEGATION_TOOLS`** — A set of tool names (`subagent`, `subagent_status`) that should come from a central registry or the pi SDK, not a hand-maintained constant.

The core issue: **policy should enforce constraints, not duplicate declarations.** Agent `.md` files are the schema. The runtime already discovers and parses them. Hardcoding their properties in TypeScript creates a second source of truth that is guaranteed to drift.

## Design

### Principle: Single source of truth

- **Agent declarations** (frontmatter) own role-specific data: `tools`, `skills`, `model`, `maxSubagentDepth`.
- **Skill metadata** owns skill-level data: whether a skill is orchestration-only (`scope: root`).
- **Config** owns user-facing overrides: `skillOverlays`, `modelTiers`, `interceptSkillCommands`.
- **Policy code** enforces constraints (e.g., "non-root roles may not delegate"), but reads data from these sources instead of duplicating it.

### Change 1: Derive root-only skills from skill metadata

**Current:**  
```ts
const ROOT_ONLY_WORKFLOW_SKILLS = new Set([
  "using-superpowers", "brainstorming", "writing-plans", ...
]);
```

**New:** Skills declare `scope` in their SKILL.md frontmatter. The runtime reads `scope` during discovery. `resolveRoleSkillSet` filters based on the skill's `scope` property.

SKILL.md frontmatter extension:
```yaml
---
name: brainstorming
description: ...
scope: root
---
```

- `scope: root` → only available to `root-planning` role
- `scope` absent or `scope: agent` → available to all roles
- This is a minimal addition — only 5–7 skills need `scope: root`. All other skills (the vast majority) default to `agent`.

The skill discovery path already loads every SKILL.md. We add `scope` to the `CachedSkillEntry` and expose it through `getAvailableSkillNames` → `CachedSkillEntry`. Policy reads the scope, no hardcoded list.

### Change 2: Remove `NON_DELEGATING_ROLE_TOOLS`, use agent frontmatter as source

**Current:**
```ts
const NON_DELEGATING_ROLE_TOOLS = {
  "sp-recon": ["read", "grep", "find", "ls"],
  ...
};
// In resolveRoleTools:
return NON_DELEGATING_ROLE_TOOLS[input.role];
```

**New:** `resolveRoleTools` receives the already-discovered `agent.tools` from the caller. The fallback path uses a safe default (`["read", "grep", "find", "ls"]`) only for agents with no `tools` frontmatter at all — which is a configuration error for built-in agents and should arguably be caught by validation, but we don't want to crash for user-defined agents.

Updated `resolveRoleTools`:
```ts
export function resolveRoleTools(input: {
  workflow: WorkflowMode;
  role: ExecutionRole;
  agentTools?: string[];
}): string[] | undefined {
  if (input.workflow !== "superpowers" || input.role === "root-planning") {
    return input.agentTools;
  }
  const explicitTools = input.agentTools?.filter((t) => !DELEGATION_TOOLS.has(t));
  if (explicitTools && explicitTools.length > 0) return explicitTools;
  // Safe default for user-defined agents without tools frontmatter
  return READ_ONLY_TOOLS;
}
```

Where `READ_ONLY_TOOLS = ["read", "grep", "find", "ls"]` — a single, obviously safe fallback, not a per-role map.

In `execution.ts`, we already pass `agent.tools` to `resolveRoleTools`. The only change is that for built-in agents with proper frontmatter, the hardcoded map will never be hit. For user-defined agents, they get a safe read-only default instead of nothing.

### Change 3: Lift `DELEGATION_TOOLS` to `shared/tool-registry.ts`

**Current:** `DELEGATION_TOOLS` is a local constant in `superpowers-policy.ts`.

**New:** Move to `shared/tool-registry.ts` as a shared constant. This is a minor refactor — the list is unlikely to change often, but having it as a shared module makes its purpose discoverable and prevents future duplication.

### Change 4: Simplify `inferExecutionRole`

**Current:** A `switch` on all known `sp-*` names.

**New:** Derive from the `sp-` prefix convention:

```ts
export function inferExecutionRole(agentName: string): ExecutionRole {
  if (agentName.startsWith("sp-")) return agentName as ExecutionRole;
  return "root-planning";
}
```

This is safe because `ExecutionRole` is a union of `"root-planning" | "sp-*"`. If an unknown `sp-` name is passed, the type system allows it (which is correct — we shouldn't block user-defined roles), and the tool fallback will treat it as a bounded role with `READ_ONLY_TOOLS`.

### What stays in `superpowers-policy.ts`

After the refactor, the file keeps:
- `resolveModelForAgent` (tier resolution from config) — reads config, not hardcoded
- `resolveRoleSkillSet` (skill validation + root-scope filtering) — constraint enforcement, data from skill metadata
- `resolveRoleTools` (delegation stripping + fallback) — constraint enforcement, data from agent frontmatter
- `resolveImplementerSkillSet` (TDD injection) — behavioral policy, no hardcoded maps
- `inferExecutionRole` — simplified derivation

### What's removed
- `ROOT_ONLY_WORKFLOW_SKILLS` constant → replaced by skill `scope` metadata
- `NON_DELEGATING_ROLE_TOOLS` constant → replaced by `agent.tools` + `READ_ONLY_TOOLS` fallback
- Per-role switch in `inferExecutionRole` → replaced by prefix convention

## Scope boundary

This spec does **not** cover:
- The inline-output changes (that's a separate spec: `2026-04-14-inline-output-design.md`)
- Adding `scope` to non-root skills (no change needed — they default to `agent`)
- Removing the `write` tool from read-only agents (that's part of the inline-output work)
- Changing how agents declare skills in frontmatter (they don't need `scope` — skills do)

## File impact

| File | Change |
|------|--------|
| `src/execution/superpowers-policy.ts` | Remove 3 hardcoded maps, simplify `inferExecutionRole`, add import from skill discovery |
| `src/shared/skills.ts` | Add `scope` to `CachedSkillEntry`, expose root-only skill detection |
| `src/shared/types.ts` | Add `scope` to `ResolvedSkill` |
| `src/shared/tool-registry.ts` | New file: `DELEGATION_TOOLS`, `READ_ONLY_TOOLS` constants |
| `src/agents/frontmatter.ts` | No changes needed (already string-valued, `scope` is just another field) |
| `src/agents/agents.ts` | No changes needed (agents don't own skill scope) |
| ~7 skill `SKILL.md` files | Add `scope: root` frontmatter to root-only skills |
| `test/unit/superpowers-policy.test.ts` | Update tests to verify scope-based filtering instead of hardcoded set |
| `test/unit/superpowers-skill-entry.test.ts` | Update if skill resolution changes |