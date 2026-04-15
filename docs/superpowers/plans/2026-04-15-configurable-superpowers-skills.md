# Configurable Superpowers Skills & Invocation Overlays Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make skill overlays resolve for all Superpowers command paths (not just `/sp-brainstorm`) by introducing a configurable `superpowersSkills` list and giving `/sp-implement` and custom commands an implicit entry skill.

**Architecture:** Two overlay mechanisms share one resolution path in `resolveSuperpowersRunProfile`: entry overlays (from the entry skill) and invocation overlays (from all skills in `superpowersSkills`). The combined deduplicated list is returned as `overlaySkillNames`. Config validation rejects `superpowersSkills` in user overrides (bundled-defaults-only for now). `/sp-implement` and custom commands get `entrySkill: { name: "using-superpowers", source: "implicit" }` so they use the unified skill-entry prompt path.

**Tech Stack:** TypeScript, Node.js test runner

---

### Task 1: Add `superpowersSkills` to types and `SuperpowersSettings`

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/execution/superagents-config.ts`

- [x] **Step 1: Add `superpowersSkills` to `SuperpowersSettings` interface**

In `src/shared/types.ts`, add `superpowersSkills?: string[]` to the `SuperpowersSettings` interface, after the `interceptSkillCommands` field:

```typescript
export interface SuperpowersSettings {
	useBranches?: boolean;
	useSubagents?: boolean;
	useTestDrivenDevelopment?: boolean;
	usePlannotator?: boolean;
	commands?: Record<string, SuperpowersCommandPreset>;
	worktrees?: SuperpowersWorktreeSettings;
	modelTiers?: Record<string, ModelTierSetting>;
	skillOverlays?: SkillOverlayConfig;
	interceptSkillCommands?: string[];
	superpowersSkills?: string[];
}
```

- [x] **Step 2: Add `"implicit"` to `SuperpowersEntrySkillSource` in `workflow-profile.ts`**

In `src/superpowers/workflow-profile.ts`, change:

```typescript
export type SuperpowersEntrySkillSource = "command" | "intercepted-skill";
```

to:

```typescript
export type SuperpowersEntrySkillSource = "command" | "intercepted-skill" | "implicit";
```

- [x] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: clean compile with no errors.

- [x] **Step 4: Commit**

```bash
git add src/shared/types.ts src/superpowers/workflow-profile.ts
git commit -m "feat: add superpowersSkills to SuperpowersSettings and implicit entry skill source type"
```

---

### Task 2: Add `superpowersSkills` to config validation and merge

**Files:**
- Modify: `src/execution/config-validation.ts`

- [ ] **Step 1: Add `superpowersSkills` to `SUPERAGENTS_KEYS` set**

In `src/execution/config-validation.ts`, add `"superpowersSkills"` to the `SUPERAGENTS_KEYS` set:

```typescript
const SUPERAGENTS_KEYS = new Set([
	"useBranches",
	"useSubagents",
	"useTestDrivenDevelopment",
	"usePlannotator",
	"commands",
	"worktrees",
	"modelTiers",
	"skillOverlays",
	"interceptSkillCommands",
	"superpowersSkills",
]);
```

- [ ] **Step 2: Add validation for `superpowersSkills` — reject in user overrides**

After the `interceptSkillCommands` validation block in `validateConfigObject`, add a new block. When `superpowersSkills` appears in user overrides, reject it as not yet user-configurable with a clear diagnostic:

```typescript
if ("superpowersSkills" in superagents) {
	addError(
		diagnostics,
		"superagents.superpowersSkills",
		"is not user-configurable. It is defined in the bundled defaults and cannot be overridden.",
		"unknown_key",
	);
}
```

This goes inside the `if ("superagents" in rawConfig)` / `else { for (const key ...)` block, after the `interceptSkillCommands` validation.

- [ ] **Step 3: Add `superpowersSkills` to merge — always take from defaults**

In the `mergeConfig` function, add `superpowersSkills` to the merged superagents object. The key rule: `superpowersSkills` always comes from defaults, never from user overrides (since user overrides are rejected in validation). Add after the `interceptSkillCommands` merge:

```typescript
const mergedSuperagents = defaultSuperagents || overrideSuperagents
	? {
		...(defaultSuperagents ?? {}),
		...(overrideSuperagents ?? {}),
		commands: {
			...(defaultSuperagents?.commands ?? {}),
			...(overrideSuperagents?.commands ?? {}),
		},
		worktrees: {
			...(defaultSuperagents?.worktrees ?? {}),
			...(overrideSuperagents?.worktrees ?? {}),
		},
		modelTiers: mergeModelTiers(defaultSuperagents?.modelTiers, overrideSuperagents?.modelTiers),
		skillOverlays: mergedSkillOverlays,
		interceptSkillCommands: mergedInterceptSkillCommands,
		superpowersSkills: defaultSuperagents?.superpowersSkills ?? [],
	}
	: undefined;
```

Since user overrides are rejected at validation time, `overrideSuperagents.superpowersSkills` will never reach merge. But we explicitly take from defaults for clarity and safety.

- [ ] **Step 4: Write unit tests for validation and merge**

In `test/unit/config-validation.test.ts`, add tests:

1. `superpowersSkills` in user config is rejected as not user-configurable.
2. `superpowersSkills` from defaults passes through to effective config.
3. Invalid `superpowersSkills` types (not an array, empty strings in array) are rejected.
4. Merge preserves defaults' `superpowersSkills` even when user override has a different value (since user override is blocked at validation, but test the merge path anyway).

- [ ] **Step 5: Run all config-validation tests**

```bash
npx vitest run test/unit/config-validation.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/execution/config-validation.ts test/unit/config-validation.test.ts
git commit -m "feat: add superpowersSkills validation and merge — reject user overrides"
```

---

### Task 3: Add `superpowersSkills` to bundled defaults and test surface

**Files:**
- Modify: `default-config.json`
- Modify: `test/unit/default-config.test.ts`

- [ ] **Step 1: Add `superpowersSkills` array to `default-config.json`**

Add the following key to the `superagents` object in `default-config.json`:

```json
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
```

- [ ] **Step 2: Add `superpowersSkills` to `SUPERAGENTS_OPTION_KEYS` in default-config test**

In `test/unit/default-config.test.ts`, add `"superpowersSkills"` to the `SUPERAGENTS_OPTION_KEYS` array:

```typescript
const SUPERAGENTS_OPTION_KEYS = [
	"useBranches",
	"useSubagents",
	"useTestDrivenDevelopment",
	"commands",
	"worktrees",
	"modelTiers",
	"usePlannotator",
	"skillOverlays",
	"interceptSkillCommands",
	"superpowersSkills",
] as const;
```

- [ ] **Step 3: Add test that `default-config.json` has the expected `superpowersSkills` entries**

Add a test case that reads `default-config.json` and verifies `superpowersSkills` contains the expected skill names:

```typescript
void it("includes superpowers skills in bundled defaults", () => {
	const config = readConfigFile("default-config.json");
	const skills = (config.superagents as Record<string, unknown>).superpowersSkills as string[];
	assert.ok(Array.isArray(skills));
	assert.ok(skills.includes("using-superpowers"));
	assert.ok(skills.includes("brainstorming"));
	assert.ok(skills.includes("writing-plans"));
	assert.ok(skills.includes("executing-plans"));
	assert.ok(skills.includes("test-driven-development"));
});
```

- [ ] **Step 4: Assert `config.example.json` does NOT include `superpowersSkills`**

Since it's not user-configurable, it must not appear in the example config:

```typescript
void it("does not include superpowersSkills in the example config", () => {
	const config = readConfigFile("config.example.json");
	assert.equal("superpowersSkills" in (config.superagents as Record<string, unknown>), false);
});
```

- [ ] **Step 5: Run default-config tests**

```bash
npx vitest run test/unit/default-config.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add default-config.json test/unit/default-config.test.ts
git commit -m "feat: add superpowersSkills to bundled defaults and test surface"
```

---

### Task 4: Resolve invocation overlays in `resolveSuperpowersRunProfile`

**Files:**
- Modify: `src/superpowers/workflow-profile.ts`
- Modify: `test/unit/superpowers-workflow-profile.test.ts`

- [ ] **Step 1: Add invocation overlay resolution to `resolveSuperpowersRunProfile`**

In `src/superpowers/workflow-profile.ts`, replace the current overlay resolution:

```typescript
const overlaySkillNames = input.entrySkill
	? settings.skillOverlays?.[input.entrySkill.name] ?? []
	: [];
```

with dual-source resolution that collects overlays from both the entry skill and all superpowers process skills:

```typescript
const superpowersSkills: readonly string[] = settings.superpowersSkills ?? [];
const invocationOverlayNames = superpowersSkills
	.flatMap((skillName) => settings.skillOverlays?.[skillName] ?? []);
const entryOverlayNames = input.entrySkill
	? settings.skillOverlays?.[input.entrySkill.name] ?? []
	: [];
const overlaySkillNames = [...new Set([...entryOverlayNames, ...invocationOverlayNames])];
```

This ensures:
- Entry overlays (e.g., `skillOverlays["brainstorming"]`) resolve when `/sp-brainstorm` is invoked
- Invocation overlays (e.g., `skillOverlays["writing-plans"]`) resolve for all commands because `writing-plans` is in `superpowersSkills`
- Both sources are deduplicated via `Set`

- [ ] **Step 2: Write unit tests for invocation overlay resolution**

In `test/unit/superpowers-workflow-profile.test.ts`, add test cases:

1. **Invocation overlays resolve from `superpowersSkills` without entry skill** — `/sp-implement` with no entry skill still gets overlays for superpowers skills:

```typescript
void it("resolves invocation overlays from superpowersSkills without entry skill", () => {
	const parsed = parseSuperpowersWorkflowArgs("fix auth")!;
	const profile = resolveSuperpowersRunProfile({
		config: {
			superagents: {
				skillOverlays: {
					"writing-plans": ["supabase-postgres-best-practices"],
				},
				superpowersSkills: ["writing-plans", "executing-plans"],
			},
		},
		commandName: "sp-implement",
		parsed,
	});
	assert.deepEqual(profile.overlaySkillNames, ["supabase-postgres-best-practices"]);
});
```

2. **Invocation overlays merge with entry overlays** — `/sp-brainstorm` gets both `brainstorming` overlays and `writing-plans` overlays:

```typescript
void it("merges entry overlays with invocation overlays from superpowersSkills", () => {
	const parsed = parseSuperpowersWorkflowArgs("design onboarding")!;
	const profile = resolveSuperpowersRunProfile({
		config: {
			superagents: {
				skillOverlays: {
					brainstorming: ["react-native-best-practices"],
					"writing-plans": ["supabase-postgres-best-practices"],
				},
				superpowersSkills: ["writing-plans", "executing-plans"],
			},
		},
		commandName: "sp-brainstorm",
		parsed,
		entrySkill: {
			name: "brainstorming",
			source: "command",
		},
	});
	assert.deepEqual(profile.overlaySkillNames, [
		"react-native-best-practices",
		"supabase-postgres-best-practices",
	]);
});
```

3. **Deduplication when entry skill is also in `superpowersSkills`**:

```typescript
void it("deduplicates overlays when entry skill overlaps with superpowersSkills", () => {
	const parsed = parseSuperpowersWorkflowArgs("design onboarding")!;
	const profile = resolveSuperpowersRunProfile({
		config: {
			superagents: {
				skillOverlays: {
					brainstorming: ["react-native-best-practices"],
				},
				superpowersSkills: ["brainstorming", "writing-plans"],
			},
		},
		commandName: "sp-brainstorm",
		parsed,
		entrySkill: {
			name: "brainstorming",
			source: "command",
		},
	});
	assert.deepEqual(profile.overlaySkillNames, ["react-native-best-practices"]);
});
```

4. **No overlays when config has empty `superpowersSkills` and no entry skill**:

```typescript
void it("returns empty overlays when superpowersSkills and entrySkill are absent", () => {
	const parsed = parseSuperpowersWorkflowArgs("fix auth")!;
	const profile = resolveSuperpowersRunProfile({
		config: {
			superagents: {
				skillOverlays: {
					brainstorming: ["react-native-best-practices"],
				},
			},
		},
		commandName: "sp-implement",
		parsed,
	});
	assert.deepEqual(profile.overlaySkillNames, []);
});
```

- [ ] **Step 3: Run workflow-profile tests**

```bash
npx vitest run test/unit/superpowers-workflow-profile.test.ts
```

Expected: all tests pass, including the new ones and the existing ones (which should still work because `superpowersSkills` defaults to `undefined` → `?? []`).

- [x] **Step 4: Commit**

```bash
git add src/superpowers/workflow-profile.ts test/unit/superpowers-workflow-profile.test.ts
git commit -m "feat: resolve invocation overlays from superpowersSkills in workflow profile"
```

---

### Task 5: Give `/sp-implement` and custom commands an implicit entry skill

**Files:**
- Modify: `src/slash/slash-commands.ts`
- Modify: `test/unit/superpowers-workflow-profile.test.ts`

- [ ] **Step 1: Add implicit entry skill to `registerSuperpowersCommand`**

In `src/slash/slash-commands.ts`, modify `registerSuperpowersCommand` to pass an implicit entry skill for `/sp-implement` and custom commands. The `sendSuperpowersPrompt` function is replaced with `sendSkillEntryPrompt`, which requires a profile with an entry skill.

Change `registerSuperpowersCommand` so that the handler creates the profile with an implicit entry skill:

```typescript
function registerSuperpowersCommand(
	pi: ExtensionAPI,
	dispatcher: ReturnType<typeof createSuperpowersPromptDispatcher>,
	state: SubagentState,
	config: ExtensionConfig,
	commandName: string,
	description: string,
): void {
	pi.registerCommand(commandName, {
		description,
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
				entrySkill: {
					name: "using-superpowers",
					source: "implicit",
				},
			});
			sendSkillEntryPrompt(dispatcher, ctx, profile);
			return Promise.resolve();
		},
	});
}
```

This replaces the previous call to `sendSuperpowersPrompt`.

- [ ] **Step 2: Remove `sendSuperpowersPrompt` function**

The `sendSuperpowersPrompt` function is no longer used — all paths now go through `sendSkillEntryPrompt`. Remove the function and its imports if they become unused. Check for any remaining callers first.

```bash
grep -n "sendSuperpowersPrompt" src/slash/slash-commands.ts
```

If only the definition and the removed call remain, delete the function. If other callers exist, keep it but add a `@deprecated` JSDoc tag pointing to `sendSkillEntryPrompt`.

- [ ] **Step 3: Verify the `using-superpowers` skill resolves in `buildResolvedSkillEntryPrompt`**

The `buildResolvedSkillEntryPrompt` function resolves `usingSuperpowersSkill`, `entrySkill`, and `overlaySkills` independently. With `entrySkill: { name: "using-superpowers", source: "implicit" }`, it will:

1. Resolve `entrySkill` from the `using-superpowers` skill file
2. Resolve `overlaySkills` from the profile's `overlaySkillNames`
3. Include both in the root prompt

The `using-superpowers` skill will appear in both the "Mandatory Startup" bootstrap block and the "Entry skill" block, which is fine — no deduplication needed per the design spec.

- [ ] **Step 4: Update the `buildEntrySkillBlock` in root-prompt.ts to show `Source: implicit`**

In `src/superpowers/root-prompt.ts`, the `buildEntrySkillBlock` function already uses `input.entrySkillSource ?? "command"`. Since we added `"implicit"` to the type, this will display `Source: implicit` automatically. Verify no changes needed.

- [ ] **Step 5: Write test for implicit entry skill**

In `test/unit/superpowers-workflow-profile.test.ts`, add:

```typescript
void it("resolves implicit entry skill for sp-implement command", () => {
	const parsed = parseSuperpowersWorkflowArgs("fix auth")!;
	const profile = resolveSuperpowersRunProfile({
		config: {
			superagents: {
				superpowersSkills: [],
			},
		},
		commandName: "sp-implement",
		parsed,
		entrySkill: {
			name: "using-superpowers",
			source: "implicit",
		},
	});
	assert.equal(profile.entrySkill?.name, "using-superpowers");
	assert.equal(profile.entrySkill?.source, "implicit");
	assert.deepEqual(profile.overlaySkillNames, []);
});
```

- [ ] **Step 6: Run all affected tests**

```bash
npx vitest run test/unit/superpowers-workflow-profile.test.ts
npx vitest run test/unit/superpowers-skill-entry.test.ts
npx vitest run test/unit/superpowers-root-prompt.test.ts
```

Expected: all tests pass.

- [ ] **Step 7: Run TypeScript compile**

```bash
npx tsc --noEmit
```

Expected: clean compilation.

- [ ] **Step 8: Commit**

```bash
git add src/slash/slash-commands.ts src/superpowers/root-prompt.ts test/unit/superpowers-workflow-profile.test.ts
git commit -m "feat: give sp-implement and custom commands an implicit using-superpowers entry skill"
```

---

### Task 6: Update documentation

**Files:**
- Modify: `docs/configuration.md`
- Modify: `AGENTS.md` (doc list)
- Modify: `README.md` (feature list)

- [ ] **Step 1: Update `docs/configuration.md` — add `superpowersSkills` to config keys table**

Add a row to the Configuration Keys table after `interceptSkillCommands`:

```
| `superpowersSkills` | List of Superpowers process skill names whose `skillOverlays` are resolved at session start (bundled default, not user-configurable yet). |
```

- [ ] **Step 2: Update `docs/configuration.md` — rewrite Skill Overlays section**

Replace the current Skill Overlays section intro to document both overlay mechanisms:

The current intro says "Skill overlays load additional skills alongside an entry skill when that entry skill is invoked through a Superpowers skill-entry flow." Replace with text that explains:

1. **Entry overlays** — resolve for the skill that starts the session (e.g., `skillOverlays["brainstorming"]` when `/sp-brainstorm` runs)
2. **Invocation overlays** — resolve for all skills in `superpowersSkills` regardless of entry path (e.g., `skillOverlays["writing-plans"]` resolves even for `/sp-implement`)

Update the example to show both mechanisms:

```json
{
  "superagents": {
    "skillOverlays": {
      "brainstorming": ["react-native-best-practices"],
      "writing-plans": ["supabase-postgres-best-practices"]
    }
  }
}
```

With a note that `writing-plans` overlays now kick in for all Superpowers commands because `writing-plans` is in `superpowersSkills`.

- [ ] **Step 3: Add the `superpowersSkills` bundled default to the Configuration section**

Add a subsection after "Direct Skill Interception" that documents the bundled `superpowersSkills` list. Explain:

- It lives in `default-config.json` (not user-configurable yet)
- It defines which skill names are Superpowers process skills
- Skill overlays for these names resolve regardless of entry path
- New Superpowers skills can be added by updating `default-config.json`

Show the full list:

```json
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
```

- [ ] **Step 4: Update `docs/configuration.md` — update the Behavior matrix**

Add a row for `/sp-implement` with its implicit entry skill and invocation overlays:

| Entry path | entrySkill | Entry overlay | Invocation overlays |
|---|---|---|---|
| `/sp-brainstorm` | `{ name: "brainstorming", source: "command" }` | `skillOverlays["brainstorming"]` | `skillOverlays[superpowersSkills[*]]` |
| `/sp-implement` | `{ name: "using-superpowers", source: "implicit" }` | `skillOverlays["using-superpowers"]` | `skillOverlays[superpowersSkills[*]]` |
| Custom command | `{ name: "using-superpowers", source: "implicit" }` | `skillOverlays["using-superpowers"]` | `skillOverlays[superpowersSkills[*]]` |
| `/skill:brainstorming` (intercepted) | `{ name: "brainstorming", source: "intercepted-skill" }` | `skillOverlays["brainstorming"]` | `skillOverlays[superpowersSkills[*]]` |

- [ ] **Step 5: Update `README.md` feature list**

Add a mention of `superpowersSkills` and invocation overlays to the features:

```markdown
- **Skill Overlays**: Configure additional skills to load alongside entry skills or Superpowers process skills. See [Configuration](docs/configuration.md#skill-overlays).
```

- [ ] **Step 6: Commit**

```bash
git add docs/configuration.md README.md
git commit -m "docs: document superpowersSkills and invocation overlay mechanism"
```

---

### Self-Review Checklist

Run through after completing all tasks:

- [ ] **Spec coverage**: Every design requirement in `docs/superpowers/specs/2026-04-15-configurable-superpowers-skills-design.md` has a corresponding task. List any gaps.
- [ ] **Placeholder scan**: No "TBD", "TODO", or vague steps in the plan.
- [ ] **Type consistency**: `SuperpowersEntrySkillSource` includes `"implicit"`, `SuperpowersSettings` includes `superpowersSkills`, all test type assertions match.
- [ ] **Backward compatibility**: Existing tests in `superpowers-workflow-profile.test.ts` still pass because `superpowersSkills` defaults to `undefined` → `?? []`.
- [ ] **Config validation**: `superpowersSkills` in user overrides is rejected with a clear diagnostic, not silently ignored.
- [ ] **No deduplication logic needed**: The `using-superpowers` skill content may appear in both the bootstrap block and the entry-skill block of the root prompt. This is by design.