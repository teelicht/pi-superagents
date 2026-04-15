# Configurable Superpowers Skill List & Invocation Overlays

## Problem

Skill overlays (`skillOverlays`) only resolve for entry-skill flows (`/sp-brainstorm`, intercepted `/skill:brainstorming`). They do not resolve for `/sp-implement` or custom slash commands because those paths pass no `entrySkill` to `resolveSuperpowersRunProfile`. This means overlays like `"writing-plans": ["supabase-postgres-best-practices"]` never take effect — `writing-plans` is never an entry skill.

The original hardcoded `ROOT_ONLY_WORKFLOW_SKILLS` set (removed in commit 65cc528) identified which skills are "superpowers process skills." The `skillOverlays` config should work for all of them regardless of entry path.

## Design

### Two overlay mechanisms

| Mechanism              | When it resolves                                       | Example                                                           |
| ---------------------- | ------------------------------------------------------ | ----------------------------------------------------------------- |
| **Entry overlay**      | Session start, based on the entry skill                | `skillOverlays["brainstorming"]` loads when `/sp-brainstorm` runs |
| **Invocation overlay** | Session start, based on all superpowers process skills | `skillOverlays["writing-plans"]` loads regardless of entry path   |

Both resolve at session-start time, not lazily during the workflow. The root prompt injects all resolved overlay skills in one block.

### 1. New config key: `superpowersSkills`

A list of skill names that are "superpowers process skills." Present in `default-config.json` only — **not user-configurable yet** (validation rejects it in user overrides).

```json
{
  "superagents": {
    "superpowersSkills": [
      "using-superpowers",
      "brainstorming",
      "writing-plans",
      "executing-plans",
      "test-driven-development",
      "requesting-code-review",
      "receiving-code-review",
      "verification-before-completion",
      "subagent-driven-development",
      "dispatching-parallel-agents",
      "using-git-worktrees",
      "finishing-a-development-branch"
    ]
  }
}
```

Adding new superpowers skills later is a config change, not a code change.

### 2. Implicit entry skill for `/sp-implement` and custom commands

`/sp-implement` and custom slash commands get `entrySkill: { name: "using-superpowers", source: "implicit" }`.

This enables:

- `skillOverlays["using-superpowers"]` overlays to resolve for `/sp-implement`
- The root prompt to include the entry-skill block for all Superpaths

No deduplication is needed. `using-superpowers` may appear in both the skill bootstrap block and the entry-skill block.

### 3. Overlay resolution

`resolveSuperpowersRunProfile` collects overlay skill names from two sources:

1. The entry skill: `skillOverlays[entrySkill.name]`
2. All superpowers process skills: `skillOverlays[skillName]` for each skill in `superpowersSkills`

The combined list is deduplicated (Set) and returned as `overlaySkillNames`.

### 4. Unified prompt path

All Superpowers command paths go through `sendSkillEntryPrompt` (the skill-entry prompt builder). The old `sendSuperpowersPrompt` function is unified into the skill-entry path since every command now has an entry skill.

### 5. Source type extension

Add `"implicit"` to `SuperpowersEntrySkillSource`:

```typescript
export type SuperpowersEntrySkillSource =
  | "command"
  | "intercepted-skill"
  | "implicit";
```

The root prompt's entry-skill block shows `Source: implicit` for `/sp-implement` and custom commands.

### 6. Config validation

- Add `"superpowersSkills"` to `SUPERAGENTS_KEYS`
- Validate: must be an array of non-empty strings if present
- In user overrides: reject with a diagnostic (not user-configurable yet)
- In merge: always take from defaults, ignore overrides

### 7. `config.example.json`

Do **not** include `superpowersSkills` in `config.example.json` since it's not user-configurable. It only appears in `default-config.json`.

## Behavior matrix

| Entry path                           | entrySkill                                               | Entry overlay                        | Invocation overlays                   |
| ------------------------------------ | -------------------------------------------------------- | ------------------------------------ | ------------------------------------- |
| `/sp-brainstorm`                     | `{ name: "brainstorming", source: "command" }`           | `skillOverlays["brainstorming"]`     | `skillOverlays[superpowersSkills[*]]` |
| `/sp-implement`                      | `{ name: "using-superpowers", source: "implicit" }`      | `skillOverlays["using-superpowers"]` | `skillOverlays[superpowersSkills[*]]` |
| Custom command                       | `{ name: "using-superpowers", source: "implicit" }`      | `skillOverlays["using-superpowers"]` | `skillOverlays[superpowersSkills[*]]` |
| `/skill:brainstorming` (intercepted) | `{ name: "brainstorming", source: "intercepted-skill" }` | `skillOverlays["brainstorming"]`     | `skillOverlays[superpowersSkills[*]]` |

Now `"writing-plans": ["supabase-postgres-best-practices"]` resolves for `/sp-brainstorm`, `/sp-implement`, and custom commands alike because `writing-plans` is in `superpowersSkills` and its overlay is collected at session start.

## Files to modify

| File                                   | Change                                                                                                                      |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/types.ts`                  | Add `superpowersSkills` to `SuperpowersSettings`, add `"implicit"` to entry skill source type                               |
| `src/execution/config-validation.ts`   | Add `"superpowersSkills"` to `SUPERAGENTS_KEYS`, add validation, reject in user overrides, merge from defaults only         |
| `src/execution/superagents-config.ts`  | Add `superpowersSkills` to `getSuperagentSettings` return shape                                                             |
| `src/superpowers/workflow-profile.ts`  | Resolve overlays from entry skill + all `superpowersSkills`, add implicit entry skill handling                              |
| `src/superpowers/skill-entry.ts`       | Accept `"implicit"` source                                                                                                  |
| `src/slash/slash-commands.ts`          | Merge `sendSuperpowersPrompt` into `sendSkillEntryPrompt`, add implicit entry skill for `/sp-implement` and custom commands |
| `default-config.json`                  | Add `superpowersSkills` array                                                                                               |
| `config.example.json`                  | No change (not user-configurable)                                                                                           |
| `docs/configuration.md`                | Update skill overlays section to document both mechanisms, add `superpowersSkills` to config keys table                     |
| `test/unit/default-config.test.ts`     | Add `superpowersSkills` to `SUPERAGENTS_OPTION_KEYS`, add test for default value                                            |
| `test/unit/config-validation.test.ts`  | Add test: reject `superpowersSkills` in user overrides                                                                      |
| `test/unit/superpowers-policy.test.ts` | Add tests: invocation overlays resolve, implicit entry skill for `/sp-implement`                                            |
