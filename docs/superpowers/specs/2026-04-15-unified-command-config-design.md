# Unified Command Configuration

Date: 2026-04-15

## Problem

The current Superpowers architecture has three issues:

1. **Missing planning phase.** There is no dedicated `/sp-plan` command. The `writing-plans` skill either runs inline inside `/sp-implement` (with no human review gate before execution starts) or must be called manually via `/skill:writing-plans` (bypassing all Superpowers config). Users who want to write a plan, review it, and then implement have no supported path.

2. **Inconsistent command registration.** `/sp-brainstorm` is hardcoded in a dedicated `registerBrainstormCommand` function, `/sp-implement` is hardcoded through a separate `registerSuperpowersCommand` call, and custom commands come from config. Three registration paths for the same pattern.

3. **Noisy root prompts.** Every command gets every contract block (delegation, TDD, branches, worktrees, task tracking, Plannotator). `/sp-brainstorm` currently receives a delegation contract telling it to use subagents for a collaborative dialogue. This is contextually wrong noise that could confuse the model.

4. **Unnecessary complexity in entry skill metadata.** `SuperpowersEntrySkillProfile` carries a `source` field (`"command"` | `"intercepted-skill"` | `"implicit"`) that no code branches on. It is pure display metadata with no behavioral effect.

5. **Global policy booleans applied uniformly.** `useSubagents`, `useBranches`, `useTestDrivenDevelopment`, and `usePlannotator` are global settings under `superagents`, but their relevance depends on the command. `useSubagents` is meaningless for brainstorming. `usePlannotator` is meaningless for implementation (the review gate belongs to the planning phase).

## Goals

- **Add `/sp-plan`** wrapping the `writing-plans` skill as a first-class Superpowers command with its own Plannotator review gate.
- **Unify all commands in config.** `sp-implement`, `sp-brainstorm`, `sp-plan`, and custom commands all follow one registration path driven by `default-config.json`.
- **Move all policy booleans to per-command settings.** Remove global `useBranches`, `useSubagents`, `useTestDrivenDevelopment`, `usePlannotator`, and `worktrees` from the `superagents` level. Each command declares only the policies relevant to it.
- **Eliminate contract noise.** The root prompt builder only emits a contract block when the corresponding boolean is present on the command preset. Absent booleans produce no output — not even a "DISABLED" message.
- **Simplify the entry skill type.** `entrySkill` becomes a plain string (the skill name). Remove the `SuperpowersEntrySkillProfile` interface and the `SuperpowersEntrySkillSource` type entirely.
- **Unify the Plannotator review contract.** Replace the separate `buildBrainstormingSpecReviewContract` with a single generic `buildPlannotatorReviewContract`. Plannotator is context-agnostic — it receives a file and returns feedback. The skill content tells the AI when to call which tool endpoint.

## Non-Goals

- No root model switching.
- No changes to subagent execution or role-agent files.
- No changes to the Plannotator event bridge itself.
- No new Plannotator actions (annotate, code-review).
- No backward compatibility or migration for global booleans (project is pre-release).

## Design

### 1. Config schema

All policy booleans move into per-command presets. The `superagents` level retains only structural settings.

#### `default-config.json`

```json
{
  "superagents": {
    "commands": {
      "sp-implement": {
        "description": "Run a Superpowers implementation workflow",
        "entrySkill": "using-superpowers",
        "useSubagents": true,
        "useTestDrivenDevelopment": true,
        "useBranches": false,
        "worktrees": { "enabled": false, "root": null }
      },
      "sp-brainstorm": {
        "description": "Run brainstorming through the Superpowers workflow profile",
        "entrySkill": "brainstorming",
        "usePlannotator": true
      },
      "sp-plan": {
        "description": "Run planning through the Superpowers workflow profile",
        "entrySkill": "writing-plans",
        "usePlannotator": true
      }
    },
    "modelTiers": {
      "cheap": { "model": "opencode-go/minimax-m2.7" },
      "balanced": { "model": "opencode-go/glm-5.1" },
      "max": { "model": "openai/gpt-5.4" }
    },
    "skillOverlays": {},
    "interceptSkillCommands": [],
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

#### Per-command policy rationale

| Command | Settings | Rationale |
|---|---|---|
| `sp-implement` | `useSubagents`, `useTestDrivenDevelopment`, `useBranches`, `worktrees` | Implementation delegates work, uses TDD, may use branches and worktrees. No Plannotator — the review gate belongs to the planning phase. |
| `sp-brainstorm` | `usePlannotator` | Brainstorming is a collaborative dialogue. No delegation, TDD, branches, or worktrees. Plannotator reviews the spec after it is saved. |
| `sp-plan` | `usePlannotator` | Planning writes a plan document. No delegation, TDD, branches, or worktrees. Plannotator reviews the plan after it is saved. |

#### Built-in commands cannot be overridden by users

Config validation rejects user overrides of `sp-implement`, `sp-brainstorm`, and `sp-plan`. Users who want different settings create custom commands (e.g., `sp-lean`).

#### Custom commands

Users define custom commands in their `config.json`. Custom commands that omit `entrySkill` default to `"using-superpowers"`. Custom commands can use any combination of the policy booleans. The root prompt builder only emits contracts for booleans that are present.

### 2. Type changes

#### Remove `SuperpowersEntrySkillSource` and `SuperpowersEntrySkillProfile`

The `source` field has no behavioral effect anywhere in the codebase. The only consumer is `root-prompt.ts:95` which prints `Source: ${input.entrySkillSource ?? "command"}` as informational text. Remove both types entirely.

#### `entrySkill` becomes a plain string

Everywhere `entrySkill` appears in interfaces and function signatures, it becomes `string | undefined` instead of `SuperpowersEntrySkillProfile | undefined`.

#### `SuperpowersCommandPreset` gains `entrySkill`

```typescript
interface SuperpowersCommandPreset {
  description?: string;
  entrySkill?: string;
  useBranches?: boolean;
  useSubagents?: boolean;
  useTestDrivenDevelopment?: boolean;
  usePlannotator?: boolean;
  worktrees?: SuperpowersCommandWorktreeSettings;
}
```

#### `SuperpowersSettings` loses global booleans

```typescript
interface SuperpowersSettings {
  commands?: Record<string, SuperpowersCommandPreset>;
  modelTiers?: Record<string, ModelTierSetting>;
  skillOverlays?: SkillOverlayConfig;
  interceptSkillCommands?: string[];
  superpowersSkills?: string[];
}
```

The fields `useBranches`, `useSubagents`, `useTestDrivenDevelopment`, `usePlannotator`, and `worktrees` are removed from `SuperpowersSettings`.

#### `ResolvedSuperpowersRunProfile` simplified

```typescript
interface ResolvedSuperpowersRunProfile {
  commandName: string;
  task: string;
  entrySkill: string;
  useBranches?: boolean;
  useSubagents?: boolean;
  useTestDrivenDevelopment?: boolean;
  usePlannotatorReview?: boolean;
  worktreesEnabled?: boolean;
  fork: boolean;
  overlaySkillNames: string[];
}
```

All policy booleans become optional. `undefined` means "not applicable to this command." `entrySkill` is a required string (every command has one — custom commands default to `"using-superpowers"`).

### 3. Command registration

#### Delete `registerBrainstormCommand`

The dedicated `registerBrainstormCommand` function is removed. All commands — including `sp-implement` and `sp-brainstorm` — are registered through a single loop over the merged command presets.

#### Single registration loop

```typescript
for (const [commandName, preset] of Object.entries(config.superagents?.commands ?? {})) {
  registerSuperpowersCommand(pi, dispatcher, state, config, commandName, preset);
}
```

#### `registerSuperpowersCommand` reads `preset.entrySkill`

Instead of hardcoding `{ name: "using-superpowers", source: "implicit" }`, the function reads `preset.entrySkill ?? "using-superpowers"` and passes the plain string through to profile resolution.

### 4. Root prompt contract filtering

#### Presence-based emission

The root prompt builder checks whether each policy boolean is present (`!== undefined`) on the resolved profile. If present, the contract block is emitted with the boolean's value. If absent, nothing is emitted.

```typescript
if (input.useSubagents !== undefined) {
  sections.push(buildDelegationContract(input.useSubagents));
}
if (input.useTestDrivenDevelopment !== undefined) {
  sections.push(buildTddContract(input.useTestDrivenDevelopment));
}
if (input.useBranches !== undefined) {
  sections.push(buildBranchContract(input.useBranches));
}
if (input.worktreesEnabled !== undefined) {
  sections.push(buildWorktreeContract(input.worktreesEnabled));
}
if (input.useSubagents === true) {
  sections.push(buildTaskTrackingContract());
}
if (input.usePlannotatorReview !== undefined) {
  sections.push(buildPlannotatorReviewContract(input.usePlannotatorReview));
}
```

Task tracking is emitted when `useSubagents` is `true` because task tracking is inherently tied to delegation — the root session ticks off plan items after subagents complete.

#### What this eliminates

- `/sp-brainstorm` no longer gets delegation, TDD, branch, worktree, or task tracking contracts. Only the Plannotator review contract.
- `/sp-plan` no longer gets delegation, TDD, worktree, or task tracking contracts. Only the Plannotator review contract.
- `/sp-implement` no longer gets the Plannotator review contract. The review gate belongs to the planning phase.

### 5. Plannotator contract unification

#### Remove `buildBrainstormingSpecReviewContract`

The current `buildBrainstormingSpecReviewContract` hardcodes a check for `input.entrySkill?.name !== "brainstorming"` and emits brainstorming-specific review instructions. This is replaced by the generic `buildPlannotatorReviewContract`.

#### Single `buildPlannotatorReviewContract`

The generic contract tells the model: "Plannotator browser review is enabled. At the review gate for your current phase, call the appropriate review tool." The skill content (brainstorming or writing-plans) already tells the AI when to call the tool and which artifact to submit. The contract does not need to distinguish between spec review and plan review.

#### Two tool endpoints remain

`superpowers_spec_review` and `superpowers_plan_review` remain as separate tool registrations. They help the model disambiguate which artifact it is submitting. Both tools use the same Plannotator event bridge internally.

### 6. Interception updates

#### Add `"writing-plans"` to `SUPPORTED_INTERCEPTED_SKILLS`

The set in both `skill-entry.ts` and `config-validation.ts` expands to:

```typescript
const SUPPORTED_INTERCEPTED_SKILLS = new Set(["brainstorming", "writing-plans"]);
```

This enables `/skill:writing-plans <task>` interception when `interceptSkillCommands` includes `"writing-plans"`.

### 7. Profile resolution

#### `resolveSuperpowersRunProfile` changes

The function resolves per-command booleans from the command preset only. No more global fallback chain.

```typescript
export function resolveSuperpowersRunProfile(input: {
  config: ExtensionConfig;
  commandName: string;
  parsed: ParsedSuperpowersWorkflowArgs;
  entrySkill: string;
}): ResolvedSuperpowersRunProfile {
  const preset = config.superagents?.commands?.[commandName] ?? {};

  return {
    commandName,
    task: parsed.task,
    entrySkill: preset.entrySkill ?? "using-superpowers",

    // Only present when the preset declares them
    useSubagents: parsed.overrides.useSubagents ?? preset.useSubagents,
    useTestDrivenDevelopment: parsed.overrides.useTestDrivenDevelopment ?? preset.useTestDrivenDevelopment,
    useBranches: preset.useBranches,
    usePlannotatorReview: preset.usePlannotator,
    worktreesEnabled: preset.worktrees?.enabled,

    fork: parsed.fork,
    overlaySkillNames: resolveOverlaySkillNames(...),
  };
}
```

Inline workflow tokens (`tdd`, `subagents`, `lean`, etc.) still override per-command booleans via `parsed.overrides`. This means a user can run `/sp-implement no-subagents <task>` to disable delegation for one run.

### 8. Config validation

#### Remove global boolean validation

Remove validation for `useBranches`, `useSubagents`, `useTestDrivenDevelopment`, `usePlannotator`, and `worktrees` at the `superagents` level. These keys should be rejected as unknown keys if present.

#### Built-in command protection

Reject user overrides of built-in command names (`sp-implement`, `sp-brainstorm`, `sp-plan`). If a user's `config.json` has `commands.sp-implement`, validation emits an error.

#### Command preset validation extended

Add `entrySkill` to `COMMAND_PRESET_KEYS`. Validate it as an optional non-empty string.

#### `SUPERAGENTS_KEYS` updated

Remove `useBranches`, `useSubagents`, `useTestDrivenDevelopment`, `usePlannotator`, `worktrees`. Keep `commands`, `modelTiers`, `skillOverlays`, `interceptSkillCommands`, `superpowersSkills`.

### 9. Visible prompt summary

The `buildSuperpowersVisiblePromptSummary` function should only show config flags that are present (not `undefined`) on the profile. A brainstorming run should show `usePlannotator: true`, not a wall of irrelevant flags.

### 10. Entry skill block in root prompt

The `buildEntrySkillBlock` function no longer emits a `Source:` line. It receives the entry skill name as a plain string.

## Behavior matrix

| Entry path | `entrySkill` | Contracts emitted | Plannotator gate |
|---|---|---|---|
| `/sp-implement <task>` | `using-superpowers` | delegation, tdd, branches, worktrees, taskTracking | none |
| `/sp-brainstorm <task>` | `brainstorming` | plannotatorReview | spec review after saved spec |
| `/sp-plan <task>` | `writing-plans` | plannotatorReview | plan review after saved plan |
| Custom command | configurable | depends on declared booleans | depends on `usePlannotator` |
| `/skill:brainstorming` (intercepted) | `brainstorming` | plannotatorReview | spec review after saved spec |
| `/skill:writing-plans` (intercepted) | `writing-plans` | plannotatorReview | plan review after saved plan |

## Files to modify

| File | Change |
|---|---|
| `default-config.json` | Move all three built-in commands into `commands` with `entrySkill` and per-command booleans. Remove global booleans and `worktrees`. |
| `config.example.json` | Update to reflect new schema. Show custom command example with `entrySkill`. |
| `src/shared/types.ts` | Remove global booleans from `SuperpowersSettings`. Add `entrySkill` to `SuperpowersCommandPreset`. Remove `worktrees` from `SuperpowersSettings`. |
| `src/superpowers/workflow-profile.ts` | Remove `SuperpowersEntrySkillSource` and `SuperpowersEntrySkillProfile`. Change `entrySkill` to `string`. Resolve booleans from preset only, no global fallback. Make booleans optional on `ResolvedSuperpowersRunProfile`. |
| `src/superpowers/root-prompt.ts` | Make all policy booleans optional on `SuperpowersRootPromptInput`. Emit contracts only when the boolean is present. Remove `buildBrainstormingSpecReviewContract`. Update `buildPlannotatorReviewContract` to be generic. Remove `entrySkillSource` from interfaces and `buildEntrySkillBlock`. Update `buildSuperpowersVisiblePromptSummary` to show only present flags. |
| `src/superpowers/skill-entry.ts` | Remove `SkillEntryPromptInput.entrySkillSource`. Remove `SuperpowersEntrySkillSource` import. Update `buildSkillEntryPromptInput` to pass `entrySkill` as string. Add `"writing-plans"` to `SUPPORTED_INTERCEPTED_SKILLS`. |
| `src/slash/slash-commands.ts` | Delete `registerBrainstormCommand`. Register all commands (including built-ins) from config in a single loop. Read `preset.entrySkill` instead of hardcoding. Pass `entrySkill` as plain string to profile resolution. Update `sendSkillEntryPrompt` for optional booleans. |
| `src/execution/config-validation.ts` | Remove global boolean validation from `superagents` level. Add `entrySkill` to `COMMAND_PRESET_KEYS`. Add built-in command name protection. Add `"writing-plans"` to `SUPPORTED_INTERCEPTED_SKILLS`. Remove global `useBranches`, `useSubagents`, `useTestDrivenDevelopment`, `usePlannotator`, `worktrees` from `SUPERAGENTS_KEYS`. |
| `src/extension/index.ts` | Update skill command interception to pass `entrySkill` as plain string. |
| `docs/configuration.md` | Document per-command settings, new schema, custom command `entrySkill` field. |
| `test/unit/default-config.test.ts` | Update for new schema: built-in commands in `commands`, no global booleans. |
| `test/unit/config-validation.test.ts` | Add: built-in command override rejection. Remove: global boolean tests. Add: `entrySkill` validation in presets. |
| `test/unit/superpowers-workflow-profile.test.ts` | Update for simplified `entrySkill` string, per-command boolean resolution, no global fallback. |
| `test/unit/superpowers-root-prompt.test.ts` | Update for optional booleans, presence-based contract emission, removed `entrySkillSource`, generic Plannotator contract. |
| `test/unit/superpowers-skill-entry.test.ts` | Update for simplified `entrySkill` string, removed `entrySkillSource`, expanded `SUPPORTED_INTERCEPTED_SKILLS`. |

## Self-Review

- **Placeholder scan:** No TBD, TODO, or incomplete sections.
- **Internal consistency:** Config schema, type changes, command registration, root prompt filtering, and profile resolution all reference the same per-command boolean design. No conflicts.
- **Scope check:** This spec covers one coherent change: unifying command config with per-command policies and adding `/sp-plan`. It is focused enough for a single implementation plan.
- **Ambiguity check:** "Presence-based emission" is explicit — `undefined` means skip, `true`/`false` means emit. Built-in command protection is explicit — validation rejects user overrides of `sp-implement`, `sp-brainstorm`, `sp-plan`.
