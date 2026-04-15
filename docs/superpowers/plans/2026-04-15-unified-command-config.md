# Unified Command Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify all Superpowers slash command registration into config-driven presets with per-command policy booleans, add `/sp-plan`, and eliminate contract noise.

**Architecture:** Move all policy configuration from global `superagents` booleans to per-command `commands` presets. Each command declares `entrySkill` and only the policy booleans relevant to it. The root prompt builder emits contract blocks only when the corresponding option is present (`!== undefined`) on the resolved profile. Entry skill metadata is simplified from `{ name, source }` to a plain string. A single generic Plannotator review contract replaces separate spec-review vs plan-review contracts.

**Tech Stack:** TypeScript, Node.js test runner (node:test), vitest-compatible assertions

**Spec:** `docs/superpowers/specs/2026-04-15-unified-command-config-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `default-config.json` | Built-in command presets with `entrySkill` and per-command booleans; no global booleans |
| `config.example.json` | User-facing example showing custom command with `entrySkill` |
| `src/shared/types.ts` | `SuperpowersSettings` without global booleans; `SuperpowersCommandPreset` with `entrySkill` |
| `src/superpowers/workflow-profile.ts` | Simplified profile: `entrySkill` as string, resolve from preset only |
| `src/superpowers/root-prompt.ts` | Optional policy fields, presence-based emission, generic Plannotator contract |
| `src/superpowers/skill-entry.ts` | Remove `entrySkillSource`, add `writing-plans` to supported interception |
| `src/slash/slash-commands.ts` | Single registration loop over all command presets |
| `src/execution/config-validation.ts` | Remove global boolean validation, add built-in command protection, `entrySkill` validation |
| `src/execution/superagents-config.ts` | Remove `isSuperagentPlannotatorEnabled`, update worktree resolution path |
| `src/extension/index.ts` | Update interception and remove global Plannotator config check from tools |
| `docs/configuration.md` | Document per-command settings and `entrySkill` |
| `test/unit/default-config.test.ts` | Updated for new schema |
| `test/unit/config-validation.test.ts` | Built-in command protection, removed global boolean tests |
| `test/unit/superpowers-workflow-profile.test.ts` | Simplified `entrySkill`, per-command resolution |
| `test/unit/superpowers-root-prompt.test.ts` | Optional fields, presence-based emission |
| `test/unit/superpowers-skill-entry.test.ts` | Removed `entrySkillSource`, expanded interception |
| `test/unit/superagents-config.test.ts` | Updated worktree resolution path |

---

### Task 1: Update types and config files

**Files:**
- Modify: `src/shared/types.ts:210-270`
- Modify: `default-config.json`
- Modify: `config.example.json`

- [ ] **Step 1: Update `SuperpowersCommandPreset` in types.ts**

Add `entrySkill` to the preset interface:

```typescript
export interface SuperpowersCommandPreset {
	description?: string;
	entrySkill?: string;
	useBranches?: boolean;
	useSubagents?: boolean;
	useTestDrivenDevelopment?: boolean;
	usePlannotator?: boolean;
	worktrees?: SuperpowersCommandWorktreeSettings;
}
```

No changes needed to `SuperpowersCommandWorktreeSettings` — it already has `enabled?: boolean; root?: string | null`.

- [ ] **Step 2: Remove global booleans from `SuperpowersSettings`**

Remove `useBranches`, `useSubagents`, `useTestDrivenDevelopment`, `usePlannotator`, and `worktrees` from the `SuperpowersSettings` interface. These fields are now per-command only. The interface should become:

```typescript
export interface SuperpowersSettings {
	commands?: Record<string, SuperpowersCommandPreset>;
	modelTiers?: Record<string, ModelTierSetting>;
	skillOverlays?: SkillOverlayConfig;
	interceptSkillCommands?: string[];
	superpowersSkills?: string[];
}
```

- [ ] **Step 3: Update `default-config.json`**

Replace the current schema with the new per-command structure. All three built-in commands move into `commands` with `entrySkill` and only their relevant policy booleans. Remove global `useBranches`, `useSubagents`, `useTestDrivenDevelopment`, `usePlannotator`, and `worktrees`.

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

- [ ] **Step 4: Update `config.example.json`**

Update to show the new per-command schema. Add `entrySkill` to custom command examples:

```json
{
  "superagents": {
    "commands": {
      "sp-lean": {
        "description": "Run Superpowers lean: no subagents, no TDD",
        "useSubagents": false,
        "useTestDrivenDevelopment": false
      },
      "sp-plannotator": {
        "description": "Run Superpowers with Plannotator review enabled",
        "usePlannotator": true
      }
    },
    "modelTiers": {
      "cheap": {
        "model": "opencode-go/minimax-m2.7",
        "thinking": "low"
      },
      "balanced": {
        "model": "opencode-go/glm-5.1",
        "thinking": "medium"
      },
      "max": {
        "model": "openai/gpt-5.4",
        "thinking": "high"
      },
      "creative": {
        "model": "anthropic/claude-opus-4.6",
        "thinking": "high"
      },
      "legacy": {
        "model": "openai/gpt-4o"
      }
    },
    "skillOverlays": {
      "brainstorming": [
        "react-native-best-practices"
      ],
      "writing-plans": [
        "supabase-postgres-best-practices"
      ]
    },
    "interceptSkillCommands": []
  }
}
```

- [ ] **Step 5: Run tests to see what breaks**

Run: `npx tsx --test test/unit/default-config.test.ts`
Expected: Multiple failures — tests reference global booleans that no longer exist.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts default-config.json config.example.json
git commit -m "refactor: move policy config to per-command presets, add sp-plan command"
```

---

### Task 2: Update default-config and config-validation tests

**Files:**
- Modify: `test/unit/default-config.test.ts`
- Modify: `test/unit/config-validation.test.ts`
- Modify: `src/execution/config-validation.ts`

- [ ] **Step 1: Rewrite `default-config.test.ts`**

Replace the `SUPERAGENTS_OPTION_KEYS` array to remove global booleans. Update `assertPublicConfigSurface` to check built-in commands instead of global booleans. Check that `sp-implement`, `sp-brainstorm`, and `sp-plan` exist in `commands` with the correct `entrySkill` and policy booleans. Remove assertions for `superagents.useBranches`, `superagents.useSubagents`, etc. Move `worktrees` assertions to check inside `commands.sp-implement.worktrees`.

The `SUPERAGENTS_OPTION_KEYS` becomes:

```typescript
const SUPERAGENTS_OPTION_KEYS = [
	"commands",
	"modelTiers",
	"skillOverlays",
	"interceptSkillCommands",
	"superpowersSkills",
] as const;
```

The `assertPublicConfigSurface` function checks built-in commands:

```typescript
const commands = superagents.commands as Record<string, Record<string, unknown>>;
const spImplement = commands["sp-implement"];
assert.ok(spImplement, "Expected sp-implement command");
assert.equal(spImplement.entrySkill, "using-superpowers");
assert.equal(spImplement.useSubagents, true);
assert.equal(spImplement.useTestDrivenDevelopment, true);
assert.equal(spImplement.useBranches, false);
const worktrees = spImplement.worktrees as Record<string, unknown>;
assert.equal(worktrees.enabled, false);
assert.equal(worktrees.root, null);

const spBrainstorm = commands["sp-brainstorm"];
assert.ok(spBrainstorm, "Expected sp-brainstorm command");
assert.equal(spBrainstorm.entrySkill, "brainstorming");
assert.equal(spBrainstorm.usePlannotator, true);

const spPlan = commands["sp-plan"];
assert.ok(spPlan, "Expected sp-plan command");
assert.equal(spPlan.entrySkill, "writing-plans");
assert.equal(spPlan.usePlannotator, true);
```

Remove the `WORKTREE_OPTION_KEYS` loop check since worktrees are now inside a command preset.

Update the `config.example.json` test to not assert global booleans. Remove checks for `superagents.useBranches`, `superagents.useSubagents`, etc. The example config no longer needs a `worktrees` key at top level. Update the `bundledDefaultsOnly` parameter usage — the example config no longer has global booleans to check, so `assertPublicConfigSurface` needs adjusting to handle both the defaults (with built-in commands) and the example (without built-in commands).

- [ ] **Step 2: Run default-config tests**

Run: `npx tsx --test test/unit/default-config.test.ts`
Expected: PASS — tests match the new config structure.

- [ ] **Step 3: Update `SUPERAGENTS_KEYS` and `COMMAND_PRESET_KEYS` in config-validation.ts**

Remove global booleans from `SUPERAGENTS_KEYS`:

```typescript
const SUPERAGENTS_KEYS = new Set([
	"commands",
	"modelTiers",
	"skillOverlays",
	"interceptSkillCommands",
	"superpowersSkills",
]);
```

Add `entrySkill` to `COMMAND_PRESET_KEYS`:

```typescript
const COMMAND_PRESET_KEYS = new Set([
	"description",
	"entrySkill",
	"useBranches",
	"useSubagents",
	"useTestDrivenDevelopment",
	"usePlannotator",
	"worktrees",
]);
```

- [ ] **Step 4: Remove global boolean validation from `validateConfigObject`**

Remove the `if ("useBranches" in superagents ...)`, `if ("useSubagents" in superagents ...)`, `if ("useTestDrivenDevelopment" in superagents ...)`, `if ("usePlannotator" in superagents ...)` blocks from the `superagents` validation section (lines 317-328). Also remove the `if ("worktrees" in superagents)` block (lines 346-359) — worktrees validation now happens inside command presets only.

- [ ] **Step 5: Add `entrySkill` validation to `validateCommandPreset`**

After the existing `description` check, add:

```typescript
if ("entrySkill" in value && (typeof value.entrySkill !== "string" || !value.entrySkill.trim())) {
	addError(diagnostics, `${path}.entrySkill`, "must be a non-empty string.");
}
```

- [ ] **Step 6: Add built-in command name protection**

Add a constant set and validation check in the commands block:

```typescript
const BUILT_IN_COMMAND_NAMES = new Set(["sp-implement", "sp-brainstorm", "sp-plan"]);
```

In the commands validation loop, after the name pattern check:

```typescript
if (BUILT_IN_COMMAND_NAMES.has(commandName)) {
	addError(
		diagnostics,
		`superagents.commands.${commandName}`,
		"is a built-in command and cannot be overridden. Create a custom command with a different name instead.",
		"builtin_override",
	);
}
```

- [ ] **Step 7: Add `"writing-plans"` to `SUPPORTED_INTERCEPTED_SKILLS`**

```typescript
const SUPPORTED_INTERCEPTED_SKILLS = new Set(["brainstorming", "writing-plans"]);
```

Update the error message in `validateInterceptSkillCommands` to:

```typescript
"must be one of: brainstorming, writing-plans."
```

- [ ] **Step 8: Remove global worktree validation from `mergeConfig`**

In `mergeConfig`, remove the standalone `worktrees` merge:

```typescript
// Remove this block:
worktrees: {
	...(defaultSuperagents?.worktrees ?? {}),
	...(overrideSuperagents?.worktrees ?? {}),
},
```

Command presets with worktrees will be merged through the commands merge (`...(defaultSuperagents?.commands ?? {}), ...(overrideSuperagents?.commands ?? {})`).

- [ ] **Step 9: Update config-validation.test.ts**

Update the `defaults` object at the top — remove global booleans and worktrees, add commands:

```typescript
const defaults: ExtensionConfig = {
	superagents: {
		commands: {
			"sp-implement": {
				description: "Run a Superpowers implementation workflow",
				entrySkill: "using-superpowers",
				useSubagents: true,
				useTestDrivenDevelopment: true,
				useBranches: false,
				worktrees: { enabled: false, root: null },
			},
			"sp-brainstorm": {
				description: "Run brainstorming through the Superpowers workflow profile",
				entrySkill: "brainstorming",
				usePlannotator: true,
			},
			"sp-plan": {
				description: "Run planning through the Superpowers workflow profile",
				entrySkill: "writing-plans",
				usePlannotator: true,
			},
		},
		modelTiers: {
			cheap: { model: "opencode-go/minimax-m2.7" },
			balanced: { model: "opencode-go/glm-5.1" },
			max: { model: "openai/gpt-5.4" },
		},
		skillOverlays: {},
		interceptSkillCommands: [],
		superpowersSkills: [],
	},
};
```

Remove tests that reference global booleans:
- "accepts usePlannotator true and false" — remove (global boolean gone)
- "rejects non-boolean usePlannotator" — remove (global boolean gone)
- "merges usePlannotator defaults and user overrides" — remove
- "deep merges user overrides over bundled defaults" — update to test per-command merge
- "blocks wrong primitive types" — remove global `useSubagents`, `useTestDrivenDevelopment` checks
- "merges worktree settings deeply" — update to merge inside command presets

Add new tests:
- "rejects user overrides of built-in command names"
- "accepts custom commands with entrySkill"
- "rejects non-string entrySkill on command presets"
- "accepts writing-plans in interceptSkillCommands"

- [ ] **Step 10: Run config-validation tests**

Run: `npx tsx --test test/unit/config-validation.test.ts`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add test/unit/default-config.test.ts test/unit/config-validation.test.ts src/execution/config-validation.ts
git commit -m "refactor: update config validation for per-command settings, add built-in command protection"
```

---

### Task 3: Simplify workflow profile resolution

**Files:**
- Modify: `src/superpowers/workflow-profile.ts`
- Modify: `test/unit/superpowers-workflow-profile.test.ts`

- [ ] **Step 1: Update test expectations**

In `superpowers-workflow-profile.test.ts`, update the config fixture at the top. Remove global booleans, add commands with per-command settings:

```typescript
const config: ExtensionConfig = {
	superagents: {
		commands: {
			"sp-implement": {
				entrySkill: "using-superpowers",
				useSubagents: true,
				useTestDrivenDevelopment: true,
				useBranches: false,
				worktrees: { enabled: false },
			},
			"superpowers-lean": {
				description: "Lean mode",
				entrySkill: "using-superpowers",
				useBranches: true,
				useSubagents: false,
				useTestDrivenDevelopment: false,
			},
			"superpowers-direct": {
				description: "Direct mode",
				entrySkill: "using-superpowers",
				useSubagents: true,
				useTestDrivenDevelopment: false,
			},
		},
	},
};
```

Update test assertions:
- "uses global defaults when no preset" → change `commandName` to `"sp-implement"` (global defaults no longer exist; the command `"superpowers"` has no preset). Make all booleans optional in assertions — undefined means not applicable.
- Change all `entrySkill: { name: "...", source: "..." }` to `entrySkill: "..."` (plain string).
- Remove `profile.entrySkill?.source` assertions.
- Replace `profile.entrySkill?.name` with `profile.entrySkill`.
- Make `worktreesEnabled` → `worktrees` in resolved profile assertions (object, not boolean).
- Remove the "resolves implicit entry skill" test — no more implicit source.
- Update "resolves brainstorming entry skill metadata" and "resolves intercepted entry skill" to pass `entrySkill` as a plain string.

- [ ] **Step 2: Run workflow profile tests to see failures**

Run: `npx tsx --test test/unit/superpowers-workflow-profile.test.ts`
Expected: FAIL — tests use the new interface but code still has old interface.

- [ ] **Step 3: Remove `SuperpowersEntrySkillSource` and `SuperpowersEntrySkillProfile`**

Delete these types from `workflow-profile.ts`:

```typescript
// DELETE:
export type SuperpowersEntrySkillSource = "command" | "intercepted-skill" | "implicit";

export interface SuperpowersEntrySkillProfile {
	name: string;
	source: SuperpowersEntrySkillSource;
}
```

- [ ] **Step 4: Update `ResolvedSuperpowersRunProfile`**

Change `entrySkill` from `SuperpowersEntrySkillProfile | undefined` to `string` (required). Add optional policy booleans. Replace `worktreesEnabled: boolean` with `worktrees?: { enabled: boolean; root?: string | null }`:

```typescript
export interface ResolvedSuperpowersRunProfile {
	commandName: string;
	task: string;
	entrySkill: string;
	useBranches?: boolean;
	useSubagents?: boolean;
	useTestDrivenDevelopment?: boolean;
	usePlannotatorReview?: boolean;
	worktrees?: { enabled: boolean; root?: string | null };
	fork: boolean;
	overlaySkillNames: string[];
}
```

- [ ] **Step 5: Update `resolveSuperpowersRunProfile` function**

Change the input interface: `entrySkill` becomes `string | undefined` (optional, not the old profile object). Remove the global fallback chain — resolve only from the command preset:

```typescript
export function resolveSuperpowersRunProfile(input: {
	config: ExtensionConfig;
	commandName: string;
	parsed: ParsedSuperpowersWorkflowArgs;
	entrySkill?: string;
}): ResolvedSuperpowersRunProfile {
	const settings = input.config.superagents ?? {};
	const preset = resolveCommandPreset(input.config, input.commandName);
	const entrySkill = input.entrySkill ?? preset.entrySkill ?? "using-superpowers";
	const superpowersSkills: readonly string[] = settings.superpowersSkills ?? [];
	const invocationOverlayNames = superpowersSkills
		.flatMap((skillName) => settings.skillOverlays?.[skillName] ?? []);
	const entryOverlayNames = settings.skillOverlays?.[entrySkill] ?? [];
	const overlaySkillNames = [...new Set([...entryOverlayNames, ...invocationOverlayNames])];

	return {
		commandName: input.commandName,
		task: input.parsed.task,
		entrySkill,

		// Only present when the preset declares them; inline tokens can override
		useSubagents: input.parsed.overrides.useSubagents ?? preset.useSubagents,
		useTestDrivenDevelopment: input.parsed.overrides.useTestDrivenDevelopment ?? preset.useTestDrivenDevelopment,
		useBranches: preset.useBranches,
		usePlannotatorReview: preset.usePlannotator,
		worktrees: preset.worktrees ? { enabled: preset.worktrees.enabled ?? false, root: preset.worktrees.root } : undefined,

		fork: input.parsed.fork,
		overlaySkillNames,
	};
}
```

Also update `resolveCommandPreset`: remove the special-case for `"superpowers"` command name — all commands now come from config:

```typescript
function resolveCommandPreset(config: ExtensionConfig, commandName: string): SuperpowersCommandPreset {
	return config.superagents?.commands?.[commandName] ?? {};
}
```

- [ ] **Step 6: Run workflow profile tests**

Run: `npx tsx --test test/unit/superpowers-workflow-profile.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/superpowers/workflow-profile.ts test/unit/superpowers-workflow-profile.test.ts
git commit -m "refactor: simplify workflow profile to per-command resolution, entrySkill as string"
```

---

### Task 4: Update root prompt for presence-based emission

**Files:**
- Modify: `src/superpowers/root-prompt.ts`
- Modify: `test/unit/superpowers-root-prompt.test.ts`

- [ ] **Step 1: Update test expectations**

In `superpowers-root-prompt.test.ts`:

Make all policy fields optional in test inputs. Add a new test for brainstorming-only prompt (no delegation/tdd/branch/worktree contracts). Add a test for sp-plan (only Plannotator contract). Update the brainstorming spec review test to use the generic Plannotator contract.

Update "includes entry skill" test: remove `entrySkillSource: "command"` from test input.

Add new test:

```typescript
void it("omits delegation, tdd, branch, worktree contracts when booleans are absent", () => {
	const prompt = buildSuperpowersRootPrompt({
		task: "design onboarding",
		usePlannotatorReview: true,
		fork: false,
		usingSuperpowersSkill: {
			name: "using-superpowers",
			path: "/skills/using-superpowers/SKILL.md",
			content: "USING BODY",
		},
		entrySkill: {
			name: "brainstorming",
			path: "/skills/brainstorming/SKILL.md",
			content: "BRAINSTORM BODY",
		},
	});

	assert.doesNotMatch(prompt, /Subagent delegation is/);
	assert.doesNotMatch(prompt, /Branch policy is/);
	assert.doesNotMatch(prompt, /Worktree isolation is/);
	assert.doesNotMatch(prompt, /Task tracking is/);
	assert.doesNotMatch(prompt, /test-driven/i);
	assert.match(prompt, /Plannotator browser review is ENABLED/);
});
```

Update existing tests to use `worktrees` object instead of `worktreesEnabled` boolean.

Remove assertion for `Source: command` in the entry skill test.
Remove "does not include brainstorming spec review contract for general superpowers runs" test — replaced by generic Plannotator contract.
Update visible summary test to check only present fields.

- [ ] **Step 2: Run root prompt tests to see failures**

Run: `npx tsx --test test/unit/superpowers-root-prompt.test.ts`
Expected: FAIL — tests use new interface but code has old interface.

- [ ] **Step 3: Update `SuperpowersRootPromptInput` interface**

Make all policy fields optional. Replace `worktreesEnabled: boolean` with `worktrees?: { enabled: boolean; root?: string | null }`. Remove `entrySkillSource`:

```typescript
export interface SuperpowersRootPromptInput {
	task: string;
	useBranches?: boolean;
	useSubagents?: boolean;
	useTestDrivenDevelopment?: boolean;
	usePlannotatorReview?: boolean;
	worktrees?: { enabled: boolean; root?: string | null };
	fork: boolean;
	usingSuperpowersSkill?: SuperpowersRootPromptSkill;
	entrySkill?: SuperpowersRootPromptSkill;
	overlaySkills?: SuperpowersRootPromptSkill[];
}
```

- [ ] **Step 4: Update `buildMetadata` to only show present fields**

```typescript
function buildMetadata(input: SuperpowersRootPromptInput): string {
	const lines = ['workflow: "superpowers"'];
	if (input.useBranches !== undefined) lines.push(`useBranches: ${input.useBranches}`);
	if (input.useSubagents !== undefined) lines.push(`useSubagents: ${input.useSubagents}`);
	if (input.useTestDrivenDevelopment !== undefined) lines.push(`useTestDrivenDevelopment: ${input.useTestDrivenDevelopment}`);
	if (input.usePlannotatorReview !== undefined) lines.push(`usePlannotatorReview: ${input.usePlannotatorReview}`);
	if (input.worktrees !== undefined) lines.push(`worktrees.enabled: ${input.worktrees.enabled}`);
	if (input.fork) lines.push('context: "fork"');
	return lines.join("\n");
}
```

- [ ] **Step 5: Update `buildEntrySkillBlock` — remove Source line**

```typescript
function buildEntrySkillBlock(input: SuperpowersRootPromptInput): string {
	if (!input.entrySkill) return "";
	return [
		"Entry skill:",
		`Name: ${input.entrySkill.name}`,
		`Path: ${input.entrySkill.path}`,
		"",
		"This entry skill is the starting Superpowers skill for this run. Follow it after `using-superpowers` identifies relevant skills.",
		"",
		"Entry skill content:",
		"```markdown",
		input.entrySkill.content,
		"```",
	].join("\n");
}
```

- [ ] **Step 6: Delete `buildBrainstormingSpecReviewContract` and update `buildPlannotatorReviewContract`**

Delete the `buildBrainstormingSpecReviewContract` function entirely.

Update `buildPlannotatorReviewContract` to be generic — it tells the model Plannotator is available without prescribing spec-review vs plan-review:

```typescript
function buildPlannotatorReviewContract(usePlannotatorReview: boolean): string {
	if (!usePlannotatorReview) {
		return "Plannotator browser review is DISABLED by config. Use the normal text-based approval flow.";
	}

	return [
		"Plannotator browser review is ENABLED by config.",
		"At the review gate for this workflow phase, call the appropriate Plannotator review tool with the saved artifact content and file path.",
		"Use `superpowers_plan_review` for implementation plans and `superpowers_spec_review` for brainstorming specs.",
		"If the review tool returns approved, continue the workflow.",
		"If the review tool returns rejected, treat the response as review feedback, revise the artifact, save it, and resubmit.",
		"If the tool returns unavailable, show one concise warning and continue with normal text-based approval.",
	].join("\n");
}
```

- [ ] **Step 7: Update `buildSuperpowersRootPrompt` — presence-based emission**

Replace the unconditional contract blocks with presence checks:

```typescript
export function buildSuperpowersRootPrompt(input: SuperpowersRootPromptInput): string {
	const sections = [
		"# Superpowers Root Session Contract",
		"",
		"This is a Superpowers session. This is a strict hidden instruction block for one Superpowers turn. Follow it as authoritative runtime policy. The user-visible command summary may be terse; do not ask the user to restate details that are present here.",
		"",
		"## User Task",
		input.task,
		"",
		"## Resolved Options",
		buildMetadata(input),
		"",
		"## Mandatory Startup",
		"Before doing substantive work or asking clarifying questions, follow `using-superpowers` exactly and identify every relevant Superpowers skill for the task.",
		"",
		"## Skill Bootstrap",
		buildSkillBootstrap(input.usingSuperpowersSkill),
		"",
		buildEntrySkillBlock(input),
		"",
		buildOverlaySkillsBlock(input.overlaySkills),
		"",
		"## Runtime Policy",
	];

	if (input.useBranches !== undefined) {
		sections.push(buildBranchContract(input.useBranches));
		sections.push("");
	}
	if (input.useSubagents !== undefined) {
		sections.push(buildDelegationContract(input.useSubagents));
		sections.push("");
	}
	if (input.useTestDrivenDevelopment !== undefined) {
		sections.push(buildTddContract(input.useTestDrivenDevelopment));
		sections.push("");
	}
	if (input.worktrees !== undefined) {
		sections.push(buildWorktreeContract(input.worktrees.enabled));
		sections.push("");
	}
	if (input.useSubagents === true) {
		sections.push(buildTaskTrackingContract());
		sections.push("");
	}
	if (input.usePlannotatorReview !== undefined) {
		sections.push(buildPlannotatorReviewContract(input.usePlannotatorReview));
		sections.push("");
	}

	return sections.join("\n");
}
```

Note: `buildTddContract` doesn't exist yet — extract the TDD portion from the current prompt or create it. Actually, looking at the current code, TDD policy is not a separate contract function. It's part of the metadata only. The current root prompt doesn't have a `buildTddContract`. The `useTestDrivenDevelopment` value is currently only shown in metadata. So for now, skip the `buildTddContract` — TDD is communicated through the metadata block and the `test-driven-development` skill content. Remove the `if (input.useTestDrivenDevelopment !== undefined)` block from the code above.

- [ ] **Step 8: Update `buildSuperpowersVisiblePromptSummary` — only show present fields**

```typescript
export function buildSuperpowersVisiblePromptSummary(input: SuperpowersRootPromptInput): string {
	const configLines: string[] = [];
	if (input.useBranches !== undefined) configLines.push(`useBranches: ${input.useBranches}`);
	if (input.useSubagents !== undefined) configLines.push(`useSubagents: ${input.useSubagents}`);
	if (input.useTestDrivenDevelopment !== undefined) configLines.push(`useTestDrivenDevelopment: ${input.useTestDrivenDevelopment}`);
	if (input.usePlannotatorReview !== undefined) configLines.push(`usePlannotatorReview: ${input.usePlannotatorReview}`);
	if (input.worktrees !== undefined) configLines.push(`worktrees.enabled: ${input.worktrees.enabled}`);
	configLines.push(`context: ${input.fork ? "fork" : "fresh"}`);

	return [
		`Superpowers ▸ ${input.task}`,
		"",
		"Config:",
		configLines.join("\n"),
	].join("\n");
}
```

- [ ] **Step 9: Run root prompt tests**

Run: `npx tsx --test test/unit/superpowers-root-prompt.test.ts`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/superpowers/root-prompt.ts test/unit/superpowers-root-prompt.test.ts
git commit -m "refactor: presence-based contract emission, generic Plannotator contract"
```

---

### Task 5: Update skill entry module

**Files:**
- Modify: `src/superpowers/skill-entry.ts`
- Modify: `test/unit/superpowers-skill-entry.test.ts`

- [ ] **Step 1: Update test expectations**

In `superpowers-skill-entry.test.ts`:

Remove all `entrySkillSource` assertions. Replace `entrySkill: { name: "...", source: "..." }` with `entrySkill: "..."` (plain string) in all test profiles. Make policy booleans optional (remove booleans that aren't relevant to the test command). Replace `worktreesEnabled` with `worktrees` object where applicable. Remove the test "passes entry skill source through prompt input" entirely. Update the interception test to also check `"writing-plans"`.

- [ ] **Step 2: Run skill entry tests to see failures**

Run: `npx tsx --test test/unit/superpowers-skill-entry.test.ts`
Expected: FAIL — tests use new interface but code has old.

- [ ] **Step 3: Update `SkillEntryPromptInput` — remove `entrySkillSource`**

Remove the `entrySkillSource` field from the interface:

```typescript
export interface SkillEntryPromptInput extends SuperpowersRootPromptInput {
	/** Resolved entry skill content. */
	entrySkill?: ResolvedSkill;
	/** Resolved overlay skill contents. */
	overlaySkills?: ResolvedSkill[];
}
```

- [ ] **Step 4: Update `buildSkillEntryPromptInput`**

Remove the `entrySkillSource` line. Update to pass optional booleans through:

```typescript
export function buildSkillEntryPromptInput(params: BuildSkillEntryPromptInputParams): SkillEntryPromptInput {
	return {
		task: params.profile.task,
		useBranches: params.profile.useBranches,
		useSubagents: params.profile.useSubagents,
		useTestDrivenDevelopment: params.profile.useTestDrivenDevelopment,
		usePlannotatorReview: params.profile.usePlannotatorReview,
		worktrees: params.profile.worktrees,
		fork: params.profile.fork,
		usingSuperpowersSkill: params.usingSuperpowersSkill,
		entrySkill: params.entrySkill,
		overlaySkills: params.overlaySkills,
	};
}
```

- [ ] **Step 5: Update `buildResolvedSkillEntryPrompt`**

Change `input.profile.entrySkill?.name` to `input.profile.entrySkill` (it's now a string):

```typescript
const entrySkillName = input.profile.entrySkill;
const entrySkill = entrySkillName ? input.resolveSkill(input.cwd, entrySkillName) : undefined;
```

- [ ] **Step 6: Add `"writing-plans"` to `SUPPORTED_INTERCEPTED_SKILLS`**

```typescript
const SUPPORTED_INTERCEPTED_SKILLS = new Set(["brainstorming", "writing-plans"]);
```

- [ ] **Step 7: Run skill entry tests**

Run: `npx tsx --test test/unit/superpowers-skill-entry.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/superpowers/skill-entry.ts test/unit/superpowers-skill-entry.test.ts
git commit -m "refactor: remove entrySkillSource, add writing-plans to interception"
```

---

### Task 6: Unify slash command registration

**Files:**
- Modify: `src/slash/slash-commands.ts`

- [ ] **Step 1: Delete `registerBrainstormCommand` function**

Remove the entire `registerBrainstormCommand` function (lines 171-204).

- [ ] **Step 2: Update `registerSuperpowersCommand` to read `preset.entrySkill`**

Change the function signature to accept the preset object directly:

```typescript
function registerSuperpowersCommand(
	pi: ExtensionAPI,
	dispatcher: ReturnType<typeof createSuperpowersPromptDispatcher>,
	state: SubagentState,
	config: ExtensionConfig,
	commandName: string,
	preset: SuperpowersCommandPreset,
): void {
	pi.registerCommand(commandName, {
		description: preset.description ?? `Run Superpowers using the ${commandName} preset`,
		handler: (rawArgs, ctx) => {
			if (notifyIfConfigBlocked(state, ctx)) return Promise.resolve();
			const parsed = parseSuperpowersWorkflowArgs(rawArgs);
			if (!parsed?.task) {
				if (ctx.hasUI) {
					ctx.ui.notify(`Usage: /${commandName} [lean|full|tdd|direct|subagents|no-subagents] <task> [--fork]`, "error");
				}
				return Promise.resolve();
			}
			const profile = resolveSuperpowersRunProfile({
				config,
				commandName,
				parsed,
				entrySkill: preset.entrySkill,
			});
			sendSkillEntryPrompt(dispatcher, ctx, profile);
			return Promise.resolve();
		},
	});
}
```

- [ ] **Step 3: Update `sendSkillEntryPrompt` for optional booleans**

The `buildSuperpowersVisiblePromptSummary` call now passes optional fields directly from the profile:

```typescript
function sendSkillEntryPrompt(
	dispatcher: ReturnType<typeof createSuperpowersPromptDispatcher>,
	ctx: ExtensionContext,
	profile: ResolvedSuperpowersRunProfile,
): void {
	const promptResult = buildResolvedSkillEntryPrompt({
		cwd: ctx.cwd,
		profile,
		resolveSkill: resolveAvailableSkill,
		resolveSkillNames: resolveSkills,
	});
	if ("error" in promptResult) {
		if (ctx.hasUI) ctx.ui.notify(promptResult.error, "error");
		return;
	}

	const wasIdle = ctx.isIdle();
	dispatcher.send(
		buildSuperpowersVisiblePromptSummary({
			task: profile.task,
			useBranches: profile.useBranches,
			useSubagents: profile.useSubagents,
			useTestDrivenDevelopment: profile.useTestDrivenDevelopment,
			usePlannotatorReview: profile.usePlannotatorReview,
			worktrees: profile.worktrees,
			fork: profile.fork,
		}),
		promptResult.prompt,
		ctx,
	);
	if (!wasIdle && ctx.hasUI) ctx.ui.notify("Queued Superpowers skill-entry workflow as a follow-up", "info");
}
```

- [ ] **Step 4: Update `registerSlashCommands` — single loop over all commands**

Replace the hardcoded `sp-implement` registration and `registerBrainstormCommand` call with a single loop:

```typescript
export function registerSlashCommands(
	pi: ExtensionAPI,
	state: SubagentState,
	config: ExtensionConfig,
): void {
	const dispatcher = createSuperpowersPromptDispatcher(pi);

	// Register all commands (built-in + custom) from config
	for (const [commandName, preset] of Object.entries(config.superagents?.commands ?? {})) {
		registerSuperpowersCommand(pi, dispatcher, state, config, commandName, preset);
	}

	pi.registerCommand("subagents-status", {
		description: "Show active and recent subagent run status",
		handler: async (_args, ctx) => {
			await openSubagentsStatusOverlay(ctx);
		},
	});

	pi.registerShortcut("ctrl+alt+s", {
		description: "Open subagents status",
		handler: async (ctx) => {
			await openSubagentsStatusOverlay(ctx);
		},
	});

	pi.registerCommand("sp-settings", {
		description: "Show Superpowers and subagent workflow settings",
		handler: async (_args, ctx) => {
			await openSuperpowersSettingsOverlay(ctx, state, config);
		},
	});
}
```

- [ ] **Step 5: Remove unused import**

Remove `type SuperpowersCommandPreset` import from `../shared/types.ts` if the type is inferred from the preset argument. Actually, we need it for the function signature — add it if not already imported.

- [ ] **Step 6: Run all tests**

Run: `npx tsx --test test/unit/*.test.ts`
Expected: Some tests may fail in other modules that reference old types. Note failures for next tasks.

- [ ] **Step 7: Commit**

```bash
git add src/slash/slash-commands.ts
git commit -m "refactor: unify command registration into single config-driven loop"
```

---

### Task 7: Update extension index and superagents-config

**Files:**
- Modify: `src/extension/index.ts`
- Modify: `src/execution/superagents-config.ts`
- Modify: `test/unit/superagents-config.test.ts`

- [ ] **Step 1: Remove `isSuperagentPlannotatorEnabled` from superagents-config.ts**

Delete the function. Update the file header to remove the Plannotator reference.

- [ ] **Step 2: Update worktree resolution functions**

`resolveSuperagentWorktreeEnabled` and `resolveSuperagentWorktreeRuntimeOptions` currently read from `config.superagents?.worktrees`. Update to read from `config.superagents?.commands?.["sp-implement"]?.worktrees`:

```typescript
export function resolveSuperagentWorktreeEnabled(
	requested: boolean | undefined,
	workflow: WorkflowMode,
	config: ExtensionConfig,
): boolean | undefined {
	const worktrees = config.superagents?.commands?.["sp-implement"]?.worktrees;
	if (workflow === "superpowers" && worktrees?.enabled === false) return false;
	if (requested !== undefined) return requested;
	if (workflow !== "superpowers") return undefined;
	return worktrees?.enabled ?? true;
}

export function resolveSuperagentWorktreeRuntimeOptions(
	workflow: WorkflowMode,
	config: ExtensionConfig,
): Omit<CreateWorktreesOptions, "agents"> {
	if (workflow !== "superpowers") return {};

	const worktrees = config.superagents?.commands?.["sp-implement"]?.worktrees;
	const options: Omit<CreateWorktreesOptions, "agents"> = {};

	if (worktrees?.root) {
		options.rootDir = worktrees.root;
		options.requireIgnoredRoot = true;
	}

	return options;
}
```

- [ ] **Step 3: Remove Plannotator config check from tool handlers in index.ts**

In `executeSuperpowersPlanReview` and `executeSuperpowersSpecReview`, remove the `isSuperagentPlannotatorEnabled(config)` check. The prompt contract already controls whether the model calls these tools. If the model calls them, execute them. Remove the import of `isSuperagentPlannotatorEnabled`.

Replace:
```typescript
if (!isSuperagentPlannotatorEnabled(config)) {
	return createTextToolResult("...");
}
```

With nothing — just proceed directly to the `requestPlannotatorPlanReview` call.

- [ ] **Step 4: Update skill command interception in index.ts**

In the `pi.on("input", ...)` handler, update the `entrySkill` parameter from object to string:

```typescript
const profile = resolveSuperpowersRunProfile({
	config,
	commandName: `skill:${parsedSkillCommand.skillName}`,
	parsed: parsedWorkflowArgs,
	entrySkill: parsedSkillCommand.skillName,
});
```

Remove the `source: "intercepted-skill"` line.

Update the `buildSuperpowersVisiblePromptSummary` call to pass `worktrees: profile.worktrees` instead of `worktreesEnabled: profile.worktreesEnabled`:

```typescript
dispatcher.send(
	buildSuperpowersVisiblePromptSummary({
		task: profile.task,
		useBranches: profile.useBranches,
		useSubagents: profile.useSubagents,
		useTestDrivenDevelopment: profile.useTestDrivenDevelopment,
		usePlannotatorReview: profile.usePlannotatorReview,
		worktrees: profile.worktrees,
		fork: profile.fork,
	}),
	promptResult.prompt,
	ctx,
);
```

- [ ] **Step 5: Update superagents-config.test.ts**

Update test fixtures to use new config shape (worktrees inside `commands.sp-implement`).

- [ ] **Step 6: Run all tests**

Run: `npx tsx --test test/unit/*.test.ts`
Expected: PASS for all tests.

- [ ] **Step 7: Commit**

```bash
git add src/extension/index.ts src/execution/superagents-config.ts test/unit/superagents-config.test.ts
git commit -m "refactor: update extension index and worktree resolution for per-command config"
```

---

### Task 8: Fix remaining test compilation and run full suite

**Files:**
- Modify: `test/unit/sp-settings.test.ts` (if it references global booleans)
- Modify: `test/unit/superpowers-policy.test.ts` (if it references global booleans)
- Any other test files that reference `SuperpowersSettings` global booleans

- [ ] **Step 1: Search for remaining references to removed fields**

```bash
grep -rn "useBranches\|useSubagents\|useTestDrivenDevelopment\|usePlannotator\|worktreesEnabled\|entrySkillSource\|SuperpowersEntrySkillSource\|SuperpowersEntrySkillProfile\|\.source.*implicit\|\.source.*command\|\.source.*intercepted" test/
grep -rn "settings\.useBranches\|settings\.useSubagents\|settings\.useTestDrivenDevelopment\|settings\.usePlannotator\|settings\.worktrees\|superagents\.useBranches\|superagents\.useSubagents\|superagents\.useTestDrivenDevelopment\|superagents\.usePlannotator\|superagents\.worktrees" src/
```

Expected: Only per-command references should remain.

- [ ] **Step 2: Fix any remaining references**

Update found files to use new per-command config paths.

- [ ] **Step 3: Run the full test suite**

Run: `npx tsx --test test/unit/*.test.ts`
Expected: PASS for all tests.

- [ ] **Step 4: Run the linter**

Run: `npx eslint src/ test/ --ext .ts`
Expected: PASS with no errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix: resolve remaining test and lint issues after per-command config migration"
```

---

### Task 9: Update documentation

**Files:**
- Modify: `docs/configuration.md`
- Modify: `README.md`

- [ ] **Step 1: Update `docs/configuration.md`**

Rewrite the configuration section to document the per-command structure. Show the new `default-config.json` schema. Document each built-in command and its settings. Document custom command creation with `entrySkill`. Remove documentation about global booleans. Document the `interceptSkillCommands` expansion to include `writing-plans`.

- [ ] **Step 2: Update `README.md`**

Update the quick-start or configuration section if it references global booleans (`useBranches`, `useSubagents`, etc.). Add mention of `/sp-plan` command alongside `/sp-implement` and `/sp-brainstorm`.

- [ ] **Step 3: Commit**

```bash
git add docs/configuration.md README.md
git commit -m "docs: update configuration and README for per-command settings"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ Add `/sp-plan` — Task 1 (config), Task 6 (registration)
- ✅ Unify all commands in config — Task 1, Task 6
- ✅ Move all policy config to per-command — Task 1, Task 3, Task 4
- ✅ Eliminate contract noise — Task 4 (presence-based emission)
- ✅ Simplify entry skill type — Task 3, Task 5
- ✅ Unify Plannotator contracts — Task 4
- ✅ Add writing-plans to interception — Task 5
- ✅ Config validation — Task 2
- ✅ Built-in command protection — Task 2
- ✅ Documentation — Task 9

**2. Placeholder scan:** No TBD, TODO, or incomplete sections.

**3. Type consistency:** `entrySkill` is consistently `string` in types, profiles, and test assertions. `worktrees` is consistently `{ enabled: boolean; root?: string | null }` on the profile and `SuperpowersCommandWorktreeSettings` on the preset. `worktreesEnabled` boolean is removed everywhere.
