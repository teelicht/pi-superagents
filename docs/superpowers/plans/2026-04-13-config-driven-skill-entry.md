# Config-Driven Skill Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Superpowers-backed skill entry for brainstorming through `/sp-brainstorm` and opt-in `/skill:brainstorming` interception, with central skill overlays and saved-spec Plannotator review guidance.

**Architecture:** Keep `/superpowers` as the canonical controller and add small entry adapters that resolve the same workflow profile. Add central overlay/interception config, a skill-entry helper module, root prompt entry-skill rendering, a `/sp-brainstorm` command, and an `input` hook for opted-in direct skill invocation.

**Tech Stack:** TypeScript, Pi extension API, Node `node:test`, TypeBox, existing Superpowers config/profile/prompt modules.

**Spec:** `docs/superpowers/specs/2026-04-13-config-driven-middleware-design.md`

---

## File Structure

- Modify `src/shared/types.ts`: add config/profile types for `skillOverlays`, `interceptSkillCommands`, and root entry-skill prompt data.
- Modify `src/execution/config-validation.ts`: validate and merge overlay/interception config.
- Modify `default-config.json` and `config.example.json`: expose empty defaults for the new config fields.
- Create `src/superpowers/skill-entry.ts`: parse `/skill:<name>` input and build Superpowers skill-entry prompt metadata.
- Modify `src/superpowers/workflow-profile.ts`: carry entry-skill source metadata and overlay names alongside the existing run profile.
- Modify `src/superpowers/root-prompt.ts`: include entry skill contents, overlay contents, and the brainstorming saved-spec Plannotator contract.
- Modify `src/slash/slash-commands.ts`: register `/sp-brainstorm` and use the shared skill-entry prompt path.
- Modify `src/extension/index.ts`: register the `input` hook and add a `superpowers_spec_review` wrapper tool.
- Modify docs: `docs/guides/superpowers.md` and `docs/reference/configuration.md`.
- Test: `test/unit/config-validation.test.ts`, `test/unit/superpowers-workflow-profile.test.ts`, `test/unit/superpowers-root-prompt.test.ts`, `test/unit/superpowers-skill-entry.test.ts`, `test/integration/slash-commands.test.ts`, `test/integration/skill-entry-interception.test.ts`, `test/integration/plannotator-review-tool.test.ts`, `test/unit/default-config.test.ts`.

## Target Implementation Notes

This plan combines the stronger parts of the earlier middleware implementation plan with the corrected skill-entry plan:

- Keep the concrete Pi `input` hook contract: handlers return `{ action: "continue" }`, `{ action: "handled" }`, or `{ action: "transform" }`. Do not use an `event.handled` property.
- Keep `/sp-brainstorm` and direct `/skill:brainstorming` interception on one shared prompt-building path so command and interception behavior cannot drift.
- Keep `superpowers_spec_review` as the user-facing tool name, but reuse the existing Plannotator `plan-review` event bridge internally unless Plannotator explicitly adds a supported `spec-review` action later.
- Prefer direct test-file commands with Node's test runner flags instead of package-script argument forwarding.

No backwards compatibility is required:

- Do not support or migrate the discarded `skillHooks` config shape. It must remain an unknown-key config error.
- Do not support `@brainstorming` or other non-Pi skill syntaxes. Only `/sp-brainstorm` and opted-in `/skill:brainstorming` are in scope.
- Do not add aliases for old profile fields or old command names.
- Do not preserve removed worktree hook config. The target `worktrees` config supports only `enabled` and `root`.
- Do not add fallback behavior that silently drops missing overlay skills. Missing configured overlays are blocking errors for the wrapped Superpowers flow.

## Task 1: Config Types And Validation

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/execution/config-validation.ts`
- Modify: `default-config.json`
- Modify: `config.example.json`
- Test: `test/unit/config-validation.test.ts`
- Test: `test/unit/default-config.test.ts`

- [x] **Step 1: Write failing config validation tests**

Add these tests to `test/unit/config-validation.test.ts` inside the existing `describe("config validation", ...)` block:

```typescript
	void it("accepts skill overlays and skill command interception", () => {
		const result = validateConfigObject({
			superagents: {
				skillOverlays: {
					brainstorming: ["react-native-best-practices"],
					"writing-plans": ["supabase-postgres-best-practices"],
				},
				interceptSkillCommands: ["brainstorming"],
			},
		});

		assert.equal(result.blocked, false);
		assert.deepEqual(result.diagnostics, []);
	});

	void it("rejects malformed skill overlay and interception config", () => {
		const result = validateConfigObject({
			superagents: {
				skillOverlays: {
					brainstorming: "react-native-best-practices",
					"": ["react-native-best-practices"],
					"writing-plans": ["", 42],
				},
				interceptSkillCommands: ["", 7, "writing-plans"],
			},
		});

		assert.equal(result.blocked, true);
		assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.path), [
			"superagents.skillOverlays.brainstorming",
			"superagents.skillOverlays.",
			"superagents.skillOverlays.writing-plans[0]",
			"superagents.skillOverlays.writing-plans[1]",
			"superagents.interceptSkillCommands[0]",
			"superagents.interceptSkillCommands[1]",
			"superagents.interceptSkillCommands[2]",
		]);
	});

	void it("rejects discarded skillHooks and removed worktree hook config", () => {
		const result = validateConfigObject({
			superagents: {
				skillHooks: {
					brainstorming: { modelTier: "balanced" },
				},
				worktrees: {
					setupHook: "./setup.sh",
					setupHookTimeoutMs: 30000,
				},
			},
		});

		assert.equal(result.blocked, true);
		assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.path), [
			"superagents.skillHooks",
			"superagents.worktrees.setupHook",
			"superagents.worktrees.setupHookTimeoutMs",
		]);
	});

	void it("deep merges skill overlays while replacing intercepted skill commands", () => {
		const result = loadEffectiveConfig({
			superagents: {
				...defaults.superagents,
				skillOverlays: {
					brainstorming: ["react-native-best-practices"],
				},
				interceptSkillCommands: [],
			},
		}, {
			superagents: {
				skillOverlays: {
					"writing-plans": ["supabase-postgres-best-practices"],
				},
				interceptSkillCommands: ["brainstorming"],
			},
		});

		assert.equal(result.blocked, false);
		assert.deepEqual(result.config.superagents?.skillOverlays, {
			brainstorming: ["react-native-best-practices"],
			"writing-plans": ["supabase-postgres-best-practices"],
		});
		assert.deepEqual(result.config.superagents?.interceptSkillCommands, ["brainstorming"]);
	});
```

Add this test to `test/unit/default-config.test.ts`:

```typescript
	void it("includes empty skill entry defaults", () => {
		assert.deepEqual(config.superagents?.skillOverlays, {});
		assert.deepEqual(config.superagents?.interceptSkillCommands, []);
	});
```

- [x] **Step 2: Run tests to verify they fail**

Run:

```bash
node --experimental-strip-types --test test/unit/config-validation.test.ts test/unit/default-config.test.ts
```

Expected: FAIL with diagnostics showing `superagents.skillOverlays` and `superagents.interceptSkillCommands` are unsupported keys or missing properties.

- [x] **Step 3: Add TypeScript config types**

Modify `src/shared/types.ts`:

```typescript
/** Mapping from a root skill name to additional skill names loaded with it. */
export type SkillOverlayConfig = Record<string, string[]>;

/** Preset for a named superpowers command. */
export interface SuperpowersCommandPreset {
	description?: string;
	useBranches?: boolean;
	useSubagents?: boolean;
	useTestDrivenDevelopment?: boolean;
	usePlannotator?: boolean;
	worktrees?: SuperpowersCommandWorktreeSettings;
}

/** Worktree settings allowed inside command presets. */
export interface SuperpowersCommandWorktreeSettings {
	enabled?: boolean;
	root?: string | null;
}

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
}
```

Use the target Superpowers config shape directly. Do not keep removed worktree hook fields or legacy generic config fields for compatibility.

- [x] **Step 4: Add validation helpers**

Modify `src/execution/config-validation.ts`:

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
]);
const SUPPORTED_INTERCEPTED_SKILLS = new Set(["brainstorming"]);

const COMMAND_NAME_PATTERN = /^(?:superpowers-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|sp-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)$/;
const WORKTREE_KEYS = new Set(["enabled", "root"]);

/**
 * Validate a list of skill names.
 *
 * @param diagnostics Mutable diagnostic accumulator.
 * @param value Unknown skill-list value.
 * @param path Dot-separated path for diagnostics.
 */
function validateSkillNameArray(diagnostics: ConfigDiagnostic[], value: unknown, path: string): void {
	if (!Array.isArray(value)) {
		addError(diagnostics, path, "must be an array of non-empty skill names.");
		return;
	}
	value.forEach((entry, index) => {
		if (typeof entry !== "string" || !entry.trim()) {
			addError(diagnostics, `${path}[${index}]`, "must be a non-empty skill name.");
		}
	});
}

/**
 * Validate the root-skill overlay map.
 *
 * @param diagnostics Mutable diagnostic accumulator.
 * @param value Unknown overlay map value.
 */
function validateSkillOverlays(diagnostics: ConfigDiagnostic[], value: unknown): void {
	if (!isRecord(value)) {
		addError(diagnostics, "superagents.skillOverlays", "must be an object mapping skill names to skill-name arrays.");
		return;
	}
	for (const [skillName, overlayNames] of Object.entries(value)) {
		if (!skillName.trim()) {
			addError(diagnostics, "superagents.skillOverlays.", "must use non-empty skill names as keys.");
			continue;
		}
		validateSkillNameArray(diagnostics, overlayNames, `superagents.skillOverlays.${skillName}`);
	}
}

/**
 * Validate opted-in direct skill command interception.
 *
 * @param diagnostics Mutable diagnostic accumulator.
 * @param value Unknown interception list value.
 */
function validateInterceptSkillCommands(diagnostics: ConfigDiagnostic[], value: unknown): void {
	if (!Array.isArray(value)) {
		addError(diagnostics, "superagents.interceptSkillCommands", "must be an array of supported skill names.");
		return;
	}
	value.forEach((entry, index) => {
		if (typeof entry !== "string" || !entry.trim()) {
			addError(diagnostics, `superagents.interceptSkillCommands[${index}]`, "must be a non-empty skill name.");
			return;
		}
		if (!SUPPORTED_INTERCEPTED_SKILLS.has(entry)) {
			addError(
				diagnostics,
				`superagents.interceptSkillCommands[${index}]`,
				"must be one of: brainstorming.",
			);
		}
	});
}
```

Call those helpers inside the `superagents` validation block:

```typescript
			if ("skillOverlays" in superagents) {
				validateSkillOverlays(diagnostics, superagents.skillOverlays);
			}
			if ("interceptSkillCommands" in superagents) {
				validateInterceptSkillCommands(diagnostics, superagents.interceptSkillCommands);
			}
```

Update existing config-validation tests that still treat `setupHook` or `setupHookTimeoutMs` as valid. The new target behavior is a blocking unknown-key error for both removed keys.

- [x] **Step 5: Merge overlay maps and interception lists**

Modify `mergeConfig` in `src/execution/config-validation.ts`:

```typescript
			skillOverlays: {
				...(defaultSuperagents?.skillOverlays ?? {}),
				...(overrideSuperagents?.skillOverlays ?? {}),
			},
			interceptSkillCommands:
				overrideSuperagents?.interceptSkillCommands
				?? defaultSuperagents?.interceptSkillCommands
				?? [],
```

- [x] **Step 6: Add config defaults**

Modify `default-config.json` and `config.example.json` under `superagents`:

```json
    "skillOverlays": {},
    "interceptSkillCommands": []
```

Keep the files parseable JSON with no comments.

- [x] **Step 7: Run tests to verify they pass**

Run:

```bash
node --experimental-strip-types --test test/unit/config-validation.test.ts test/unit/default-config.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/shared/types.ts src/execution/config-validation.ts default-config.json config.example.json test/unit/config-validation.test.ts test/unit/default-config.test.ts
git commit -m "feat: add skill entry config validation"
```

## Task 2: Workflow Profile Entry Metadata

**Files:**
- Modify: `src/superpowers/workflow-profile.ts`
- Test: `test/unit/superpowers-workflow-profile.test.ts`

- [x] **Step 1: Write failing workflow profile tests**

Add these tests to `test/unit/superpowers-workflow-profile.test.ts`:

```typescript
	void it("resolves brainstorming entry skill metadata and overlays", () => {
		const parsed = parseSuperpowersWorkflowArgs("design onboarding")!;
		const profile = resolveSuperpowersRunProfile({
			config: {
				superagents: {
					useSubagents: true,
					useTestDrivenDevelopment: true,
					usePlannotator: true,
					skillOverlays: {
						brainstorming: ["react-native-best-practices"],
					},
				},
			},
			commandName: "sp-brainstorm",
			parsed,
			entrySkill: {
				name: "brainstorming",
				source: "command",
			},
		});

		assert.equal(profile.entrySkill?.name, "brainstorming");
		assert.equal(profile.entrySkill?.source, "command");
		assert.deepEqual(profile.overlaySkillNames, ["react-native-best-practices"]);
		assert.equal(profile.usePlannotatorReview, true);
	});

	void it("resolves intercepted entry skill source metadata", () => {
		const parsed = parseSuperpowersWorkflowArgs("design middleware")!;
		const profile = resolveSuperpowersRunProfile({
			config: {
				superagents: {
					skillOverlays: {
						brainstorming: ["react-native-best-practices"],
					},
				},
			},
			commandName: "skill:brainstorming",
			parsed,
			entrySkill: {
				name: "brainstorming",
				source: "intercepted-skill",
			},
		});

		assert.deepEqual(profile.entrySkill, {
			name: "brainstorming",
			source: "intercepted-skill",
		});
		assert.deepEqual(profile.overlaySkillNames, ["react-native-best-practices"]);
	});
```

- [x] **Step 2: Run tests to verify they fail**

Run:

```bash
node --experimental-strip-types --test test/unit/superpowers-workflow-profile.test.ts
```

Expected: FAIL with TypeScript/runtime errors because `entrySkill` input and `overlaySkillNames` output do not exist.

- [x] **Step 3: Extend workflow profile types and resolution**

Modify `src/superpowers/workflow-profile.ts`:

```typescript
export type SuperpowersEntrySkillSource = "command" | "intercepted-skill";

export interface SuperpowersEntrySkillProfile {
	name: string;
	source: SuperpowersEntrySkillSource;
}

export interface ResolvedSuperpowersRunProfile {
	commandName: string;
	task: string;
	useSubagents: boolean;
	useTestDrivenDevelopment: boolean;
	usePlannotatorReview: boolean;
	worktreesEnabled: boolean;
	fork: boolean;
	entrySkill?: SuperpowersEntrySkillProfile;
	overlaySkillNames: string[];
}
```

Update the resolver signature and return value:

```typescript
export function resolveSuperpowersRunProfile(input: {
	config: ExtensionConfig;
	commandName: string;
	parsed: ParsedSuperpowersWorkflowArgs;
	entrySkill?: SuperpowersEntrySkillProfile;
}): ResolvedSuperpowersRunProfile {
	const settings = input.config.superagents ?? {};
	const preset = resolveCommandPreset(input.config, input.commandName);
	const overlaySkillNames = input.entrySkill
		? settings.skillOverlays?.[input.entrySkill.name] ?? []
		: [];
	return {
		commandName: input.commandName,
		task: input.parsed.task,
		useSubagents: input.parsed.overrides.useSubagents
			?? preset.useSubagents
			?? settings.useSubagents
			?? true,
		useTestDrivenDevelopment: input.parsed.overrides.useTestDrivenDevelopment
			?? preset.useTestDrivenDevelopment
			?? settings.useTestDrivenDevelopment
			?? true,
		usePlannotatorReview: preset.usePlannotator ?? settings.usePlannotator ?? false,
		worktreesEnabled: preset.worktrees?.enabled ?? settings.worktrees?.enabled ?? true,
		fork: input.parsed.fork,
		...(input.entrySkill ? { entrySkill: input.entrySkill } : {}),
		overlaySkillNames,
	};
}
```

Use the target profile shape directly: carry `useBranches` and a resolved `worktrees` object when branch-policy/worktree simplification is part of the current branch. Do not add compatibility aliases back to older profile fields.

- [x] **Step 4: Update existing profile tests for the new field**

In each existing `assert.deepEqual(resolveSuperpowersRunProfile(...), ...)` expected object in `test/unit/superpowers-workflow-profile.test.ts`, add:

```typescript
			overlaySkillNames: [],
```

Also add any branch/worktree fields already required by the current implementation.

- [x] **Step 5: Run tests to verify they pass**

Run:

```bash
node --experimental-strip-types --test test/unit/superpowers-workflow-profile.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/superpowers/workflow-profile.ts test/unit/superpowers-workflow-profile.test.ts
git commit -m "feat: carry skill entry metadata in profiles"
```

## Task 3: Skill Entry Parsing And Prompt Assembly

**Files:**
- Create: `src/superpowers/skill-entry.ts`
- Test: `test/unit/superpowers-skill-entry.test.ts`

- [x] **Step 1: Write failing skill-entry tests**

Create `test/unit/superpowers-skill-entry.test.ts`:

```typescript
/**
 * Unit tests for Superpowers skill-entry parsing and prompt assembly helpers.
 *
 * Responsibilities:
 * - verify direct Pi skill command parsing
 * - verify interception opt-in decisions
 * - verify prompt inputs include entry and overlay skills
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	buildSkillEntryPromptInput,
	buildResolvedSkillEntryPrompt,
	parseSkillCommandInput,
	shouldInterceptSkillCommand,
} from "../../src/superpowers/skill-entry.ts";

void describe("Superpowers skill entry helpers", () => {
	void it("parses direct /skill commands", () => {
		assert.deepEqual(parseSkillCommandInput("/skill:brainstorming design onboarding"), {
			skillName: "brainstorming",
			task: "design onboarding",
		});
		assert.deepEqual(parseSkillCommandInput("/skill:writing-plans   draft plan"), {
			skillName: "writing-plans",
			task: "draft plan",
		});
		assert.equal(parseSkillCommandInput("/superpowers fix auth"), undefined);
		assert.equal(parseSkillCommandInput("/skill:brainstorming"), undefined);
	});

	void it("intercepts only configured supported skills", () => {
		assert.equal(shouldInterceptSkillCommand("brainstorming", {
			superagents: {
				interceptSkillCommands: ["brainstorming"],
			},
		}), true);
		assert.equal(shouldInterceptSkillCommand("writing-plans", {
			superagents: {
				interceptSkillCommands: ["brainstorming"],
			},
		}), false);
		assert.equal(shouldInterceptSkillCommand("brainstorming", {}), false);
	});

	void it("builds prompt input with resolved entry and overlay skills", () => {
		const input = buildSkillEntryPromptInput({
			profile: {
				commandName: "sp-brainstorm",
				task: "design onboarding",
				useSubagents: true,
				useTestDrivenDevelopment: true,
				usePlannotatorReview: true,
				worktreesEnabled: false,
				fork: false,
				entrySkill: { name: "brainstorming", source: "command" },
				overlaySkillNames: ["react-native-best-practices"],
			},
			usingSuperpowersSkill: {
				name: "using-superpowers",
				path: "/skills/using-superpowers/SKILL.md",
				content: "USING BODY",
				source: "user",
			},
			entrySkill: {
				name: "brainstorming",
				path: "/skills/brainstorming/SKILL.md",
				content: "BRAINSTORM BODY",
				source: "user",
			},
			overlaySkills: [{
				name: "react-native-best-practices",
				path: "/skills/react-native-best-practices/SKILL.md",
				content: "RN BODY",
				source: "user",
			}],
		});

		assert.equal(input.task, "design onboarding");
		assert.equal(input.entrySkill?.name, "brainstorming");
		assert.equal(input.overlaySkills?.[0]?.name, "react-native-best-practices");
	});

	void it("builds a prompt or reports missing overlay skills", () => {
		const profile = {
			commandName: "sp-brainstorm",
			task: "design onboarding",
			useSubagents: true,
			useTestDrivenDevelopment: true,
			usePlannotatorReview: false,
			worktreesEnabled: false,
			fork: false,
			entrySkill: { name: "brainstorming", source: "command" as const },
			overlaySkillNames: ["react-native-best-practices"],
		};
		const skills = new Map([
			["using-superpowers", {
				name: "using-superpowers",
				path: "/skills/using-superpowers/SKILL.md",
				content: "USING BODY",
				source: "user" as const,
			}],
			["brainstorming", {
				name: "brainstorming",
				path: "/skills/brainstorming/SKILL.md",
				content: "BRAINSTORM BODY",
				source: "user" as const,
			}],
			["react-native-best-practices", {
				name: "react-native-best-practices",
				path: "/skills/react-native-best-practices/SKILL.md",
				content: "RN BODY",
				source: "user" as const,
			}],
		]);

		const result = buildResolvedSkillEntryPrompt({
			cwd: process.cwd(),
			profile,
			resolveSkill: (_cwd, name) => skills.get(name),
			resolveSkillNames: (names) => {
				const resolved = names.map((name) => skills.get(name)).filter((skill): skill is NonNullable<typeof skill> => Boolean(skill));
				const missing = names.filter((name) => !skills.has(name));
				return { resolved, missing };
			},
		});

		assert.ok("prompt" in result);
		assert.match(result.prompt, /BRAINSTORM BODY/);
		assert.match(result.prompt, /RN BODY/);
	});
});
```

- [x] **Step 2: Run tests to verify they fail**

Run:

```bash
node --experimental-strip-types --test test/unit/superpowers-skill-entry.test.ts
```

Expected: FAIL because `src/superpowers/skill-entry.ts` does not exist.

- [x] **Step 3: Create skill-entry helper module**

Create `src/superpowers/skill-entry.ts`:

```typescript
/**
 * Superpowers skill-entry adapters.
 *
 * Responsibilities:
 * - parse direct Pi `/skill:<name>` input before native skill expansion
 * - decide whether a configured skill command should be intercepted
 * - shape resolved entry and overlay skills for root prompt construction
 *
 * Important side effects:
 * - none; callers perform prompt dispatch and skill file resolution
 */

import type { ResolvedSkill } from "../shared/skills.ts";
import type { ExtensionConfig } from "../shared/types.ts";
import type { ResolvedSuperpowersRunProfile } from "./workflow-profile.ts";
import { buildSuperpowersRootPrompt, type SuperpowersRootPromptInput } from "./root-prompt.ts";

export interface ParsedSkillCommandInput {
	skillName: string;
	task: string;
}

export interface BuildSkillEntryPromptInputParams {
	profile: ResolvedSuperpowersRunProfile;
	usingSuperpowersSkill?: ResolvedSkill;
	entrySkill?: ResolvedSkill;
	overlaySkills: ResolvedSkill[];
}

export interface BuildResolvedSkillEntryPromptParams {
	cwd: string;
	profile: ResolvedSuperpowersRunProfile;
	resolveSkill: (cwd: string, name: string) => ResolvedSkill | undefined;
	resolveSkillNames: (skillNames: string[], cwd: string) => { resolved: ResolvedSkill[]; missing: string[] };
}

const SKILL_COMMAND_PATTERN = /^\/skill:([^\s]+)\s+([\s\S]+)$/;
const SUPPORTED_INTERCEPTED_SKILLS = new Set(["brainstorming"]);

/**
 * Parse a direct Pi skill command from raw input text.
 *
 * @param text Raw user input before Pi skill expansion.
 * @returns Parsed skill name and task, or undefined when the input is not a usable skill command.
 */
export function parseSkillCommandInput(text: string): ParsedSkillCommandInput | undefined {
	const match = text.match(SKILL_COMMAND_PATTERN);
	if (!match) return undefined;
	const skillName = match[1]?.trim();
	const task = match[2]?.trim();
	if (!skillName || !task) return undefined;
	return { skillName, task };
}

/**
 * Determine whether a direct skill command should enter Superpowers.
 *
 * @param skillName Skill command name from raw input.
 * @param config Effective extension config.
 * @returns True when the skill is supported and explicitly opted in.
 */
export function shouldInterceptSkillCommand(skillName: string, config: ExtensionConfig): boolean {
	if (!SUPPORTED_INTERCEPTED_SKILLS.has(skillName)) return false;
	return config.superagents?.interceptSkillCommands?.includes(skillName) ?? false;
}

/**
 * Convert a resolved skill-entry profile into root prompt input.
 *
 * @param params Resolved profile and skill contents.
 * @returns Input for `buildSuperpowersRootPrompt`.
 */
export function buildSkillEntryPromptInput(params: BuildSkillEntryPromptInputParams): SuperpowersRootPromptInput {
	return {
		task: params.profile.task,
		useSubagents: params.profile.useSubagents,
		useTestDrivenDevelopment: params.profile.useTestDrivenDevelopment,
		usePlannotatorReview: params.profile.usePlannotatorReview,
		worktreesEnabled: params.profile.worktreesEnabled,
		fork: params.profile.fork,
		usingSuperpowersSkill: params.usingSuperpowersSkill,
		entrySkill: params.entrySkill,
		overlaySkills: params.overlaySkills,
		entrySkillSource: params.profile.entrySkill?.source,
	};
}

/**
 * Build a Superpowers root prompt for one resolved skill-entry profile.
 *
 * @param input Skill resolution inputs and dependencies.
 * @returns Prompt text, or an error when a required skill cannot be resolved.
 */
export function buildResolvedSkillEntryPrompt(
	input: BuildResolvedSkillEntryPromptParams,
): { prompt: string } | { error: string } {
	const usingSuperpowersSkill = input.resolveSkill(input.cwd, "using-superpowers");
	const entrySkillName = input.profile.entrySkill?.name;
	const entrySkill = entrySkillName ? input.resolveSkill(input.cwd, entrySkillName) : undefined;
	const overlayResolution = input.resolveSkillNames(input.profile.overlaySkillNames, input.cwd);
	if (!entrySkill) return { error: `Superpowers entry skill could not be resolved: ${entrySkillName ?? "unknown"}` };
	if (overlayResolution.missing.length > 0) {
		return { error: `Superpowers overlay skills could not be resolved: ${overlayResolution.missing.join(", ")}` };
	}
	return {
		prompt: buildSuperpowersRootPrompt(buildSkillEntryPromptInput({
			profile: input.profile,
			usingSuperpowersSkill,
			entrySkill,
			overlaySkills: overlayResolution.resolved,
		})),
	};
}
```

- [x] **Step 4: Run tests to verify they pass**

Run:

```bash
node --experimental-strip-types --test test/unit/superpowers-skill-entry.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/superpowers/skill-entry.ts test/unit/superpowers-skill-entry.test.ts
git commit -m "feat: add superpowers skill entry helpers"
```

## Task 4: Root Prompt Entry Skills And Spec Review Contract

**Files:**
- Modify: `src/superpowers/root-prompt.ts`
- Test: `test/unit/superpowers-root-prompt.test.ts`

- [x] **Step 1: Write failing root prompt tests**

Add tests to `test/unit/superpowers-root-prompt.test.ts`:

```typescript
	void it("includes entry skill and overlay skill content for brainstorming", () => {
		const prompt = buildSuperpowersRootPrompt({
			task: "design onboarding",
			useSubagents: true,
			useTestDrivenDevelopment: true,
			usePlannotatorReview: true,
			worktreesEnabled: false,
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
			overlaySkills: [{
				name: "react-native-best-practices",
				path: "/skills/react-native-best-practices/SKILL.md",
				content: "RN BODY",
			}],
			entrySkillSource: "command",
		});

		assert.match(prompt, /Entry skill:/);
		assert.match(prompt, /Name: brainstorming/);
		assert.match(prompt, /BRAINSTORM BODY/);
		assert.match(prompt, /Overlay skills:/);
		assert.match(prompt, /react-native-best-practices/);
		assert.match(prompt, /RN BODY/);
		assert.match(prompt, /superpowers_spec_review/);
		assert.match(prompt, /saved brainstorming spec/);
		assert.doesNotMatch(prompt, /every brainstorming design section/);
	});

	void it("does not include brainstorming spec review contract for general superpowers runs", () => {
		const prompt = buildSuperpowersRootPrompt({
			task: "fix auth",
			useSubagents: true,
			useTestDrivenDevelopment: true,
			usePlannotatorReview: true,
			worktreesEnabled: false,
			fork: false,
			usingSuperpowersSkill: {
				name: "using-superpowers",
				path: "/skills/using-superpowers/SKILL.md",
				content: "USING BODY",
			},
		});

		assert.match(prompt, /superpowers_plan_review/);
		assert.doesNotMatch(prompt, /superpowers_spec_review/);
	});
```

- [x] **Step 2: Run tests to verify they fail**

Run:

```bash
node --experimental-strip-types --test test/unit/superpowers-root-prompt.test.ts
```

Expected: FAIL because `entrySkill`, `overlaySkills`, and `superpowers_spec_review` are not rendered.

- [x] **Step 3: Extend root prompt input types**

Modify `src/superpowers/root-prompt.ts`:

```typescript
export interface SuperpowersRootPromptInput {
	task: string;
	useSubagents: boolean;
	useTestDrivenDevelopment: boolean;
	usePlannotatorReview: boolean;
	worktreesEnabled: boolean;
	fork: boolean;
	usingSuperpowersSkill?: SuperpowersRootPromptSkill;
	entrySkill?: SuperpowersRootPromptSkill;
	overlaySkills?: SuperpowersRootPromptSkill[];
	entrySkillSource?: "command" | "intercepted-skill";
}
```

- [x] **Step 4: Add prompt block builders**

Add these helpers to `src/superpowers/root-prompt.ts`:

```typescript
/**
 * Build the entry-skill prompt block for Superpowers skill-entry runs.
 *
 * @param input Resolved root prompt input.
 * @returns Prompt block, or an empty string for general Superpowers runs.
 */
function buildEntrySkillBlock(input: SuperpowersRootPromptInput): string {
	if (!input.entrySkill) return "";
	return [
		"Entry skill:",
		`Name: ${input.entrySkill.name}`,
		`Path: ${input.entrySkill.path}`,
		`Source: ${input.entrySkillSource ?? "command"}`,
		"",
		"This entry skill is the starting Superpowers skill for this run. Follow it after `using-superpowers` identifies relevant skills.",
		"",
		"Entry skill content:",
		"```markdown",
		input.entrySkill.content,
		"```",
	].join("\n");
}

/**
 * Build additional overlay skill content for root skill-entry runs.
 *
 * @param overlaySkills Resolved overlay skills.
 * @returns Prompt block, or an empty string when no overlays are configured.
 */
function buildOverlaySkillsBlock(overlaySkills: SuperpowersRootPromptSkill[] | undefined): string {
	if (!overlaySkills || overlaySkills.length === 0) return "";
	return [
		"Overlay skills:",
		...overlaySkills.flatMap((skill) => [
			"",
			`Name: ${skill.name}`,
			`Path: ${skill.path}`,
			"```markdown",
			skill.content,
			"```",
		]),
	].join("\n");
}

/**
 * Build the saved-spec Plannotator contract for brainstorming entry flows.
 *
 * @param input Resolved root prompt input.
 * @returns Prompt block for saved-spec review, or an empty string when not applicable.
 */
function buildBrainstormingSpecReviewContract(input: SuperpowersRootPromptInput): string {
	if (input.entrySkill?.name !== "brainstorming" || !input.usePlannotatorReview) return "";
	return [
		"Brainstorming saved-spec Plannotator review is ENABLED by config.",
		"Follow the normal brainstorming chat workflow first: ask clarifying questions, propose approaches, present design sections, and write the approved spec.",
		"After the approved brainstorming spec is saved, and before invoking or transitioning to `writing-plans`, call `superpowers_spec_review` with the saved spec content and file path.",
		"If `superpowers_spec_review` returns approved, continue the workflow.",
		"If it returns rejected, treat the response as spec-review feedback, revise the spec, save it, and resubmit through the same tool.",
		"If the tool returns unavailable, show one concise warning and continue with the normal text-based review gate.",
		"Do not call Plannotator for every brainstorming design section.",
	].join("\n");
}
```

- [x] **Step 5: Include the new blocks in the prompt**

In `buildSuperpowersRootPrompt`, insert after `buildSkillBootstrap(input.usingSuperpowersSkill)`:

```typescript
		buildEntrySkillBlock(input),
		"",
		buildOverlaySkillsBlock(input.overlaySkills),
		"",
		buildBrainstormingSpecReviewContract(input),
		"",
```

Keep the existing `superpowers_plan_review` contract unchanged for implementation-plan approval.

- [x] **Step 6: Run tests to verify they pass**

Run:

```bash
node --experimental-strip-types --test test/unit/superpowers-root-prompt.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/superpowers/root-prompt.ts test/unit/superpowers-root-prompt.test.ts
git commit -m "feat: render skill entry root prompt context"
```

## Task 5: `/sp-brainstorm` Slash Command

**Files:**
- Modify: `src/slash/slash-commands.ts`
- Test: `test/integration/slash-commands.test.ts`

- [x] **Step 1: Write failing slash command tests**

Add tests to `test/integration/slash-commands.test.ts`:

```typescript
	void it("registers /sp-brainstorm and sends a brainstorming entry prompt", async () => {
		const userMessages: Array<{ content: string | unknown[]; options?: { deliverAs?: "steer" | "followUp" } }> = [];
		const commands = new Map<string, { description?: string; handler(args: string, ctx: unknown): Promise<void> }>();
		const pi = {
			events: createEventBus(),
			registerCommand(name: string, spec: { description?: string; handler(args: string, ctx: unknown): Promise<void> }) {
				commands.set(name, spec);
			},
			sendMessage() {},
			sendUserMessage(content: string | unknown[], options?: { deliverAs?: "steer" | "followUp" }) {
				userMessages.push({ content, options });
			},
		};

		registerSlashCommands!(pi, createState(process.cwd()), {
			superagents: {
				usePlannotator: true,
				skillOverlays: {
					brainstorming: ["react-native-best-practices"],
				},
			} as never,
		});

		assert.ok(commands.has("sp-brainstorm"), "expected /sp-brainstorm to be registered");
		await commands.get("sp-brainstorm")!.handler("design onboarding", createCommandContext());

		assert.equal(userMessages.length, 1);
		const prompt = String(userMessages[0].content);
		assert.match(prompt, /Entry skill:/);
		assert.match(prompt, /Name: brainstorming/);
		assert.match(prompt, /design onboarding/);
		assert.match(prompt, /superpowers_spec_review/);
	});

	void it("/sp-brainstorm shows usage when no task is provided", async () => {
		const notifications: string[] = [];
		const commands = new Map<string, { description?: string; handler(args: string, ctx: unknown): Promise<void> }>();
		const pi = {
			events: createEventBus(),
			registerCommand(name: string, spec: { description?: string; handler(args: string, ctx: unknown): Promise<void> }) {
				commands.set(name, spec);
			},
			sendMessage() {},
			sendUserMessage() {
				throw new Error("sendUserMessage should not be called");
			},
		};

		registerSlashCommands!(pi, createState(process.cwd()), {});
		await commands.get("sp-brainstorm")!.handler("", {
			...createCommandContext({ hasUI: true }),
			ui: {
				notify(message: string) {
					notifications.push(message);
				},
			},
		});

		assert.deepEqual(notifications, ["Usage: /sp-brainstorm <task>"]);
	});

	void it("/sp-brainstorm applies global Superpowers policy", async () => {
		const userMessages: Array<{ content: string | unknown[]; options?: { deliverAs?: "steer" | "followUp" } }> = [];
		const commands = new Map<string, { description?: string; handler(args: string, ctx: unknown): Promise<void> }>();
		const pi = {
			events: createEventBus(),
			registerCommand(name: string, spec: { description?: string; handler(args: string, ctx: unknown): Promise<void> }) {
				commands.set(name, spec);
			},
			sendMessage() {},
			sendUserMessage(content: string | unknown[], options?: { deliverAs?: "steer" | "followUp" }) {
				userMessages.push({ content, options });
			},
		};

		registerSlashCommands!(pi, createState(process.cwd()), {
			superagents: {
				useSubagents: false,
				useTestDrivenDevelopment: false,
				worktrees: { enabled: false },
			},
		});

		await commands.get("sp-brainstorm")!.handler("design auth", createCommandContext());

		const prompt = String(userMessages[0].content);
		assert.match(prompt, /useSubagents:\s*false/);
		assert.match(prompt, /useTestDrivenDevelopment:\s*false/);
		assert.match(prompt, /worktrees\.enabled:\s*false/);
	});

	void it("/sp-brainstorm reports unresolved overlay skills without sending a prompt", async () => {
		const notifications: string[] = [];
		const userMessages: string[] = [];
		const commands = new Map<string, { description?: string; handler(args: string, ctx: unknown): Promise<void> }>();
		const pi = {
			events: createEventBus(),
			registerCommand(name: string, spec: { description?: string; handler(args: string, ctx: unknown): Promise<void> }) {
				commands.set(name, spec);
			},
			sendMessage() {},
			sendUserMessage(content: string | unknown[]) {
				userMessages.push(String(content));
			},
		};

		registerSlashCommands!(pi, createState(process.cwd()), {
			superagents: {
				skillOverlays: {
					brainstorming: ["definitely-missing-skill"],
				},
			} as never,
		});

		await commands.get("sp-brainstorm")!.handler("design onboarding", {
			...createCommandContext({ hasUI: true }),
			ui: {
				notify(message: string) {
					notifications.push(message);
				},
			},
		});

		assert.deepEqual(userMessages, []);
		assert.deepEqual(notifications, ["Superpowers overlay skills could not be resolved: definitely-missing-skill"]);
	});
```

- [x] **Step 2: Run tests to verify they fail**

Run:

```bash
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/slash-commands.test.ts
```

Expected: FAIL because `/sp-brainstorm` is not registered.

- [x] **Step 3: Add a shared skill-entry dispatch helper**

Modify `src/slash/slash-commands.ts` imports:

```typescript
import { resolveSkills } from "../shared/skills.ts";
import { buildResolvedSkillEntryPrompt } from "../superpowers/skill-entry.ts";
```

Add a helper near `sendSuperpowersPrompt`:

```typescript
/**
 * Send a Superpowers root-session prompt for a supported entry skill.
 *
 * @param pi Extension API for sending messages.
 * @param ctx Current command context.
 * @param profile Resolved Superpowers run profile with entry-skill metadata.
 */
function sendSkillEntryPrompt(
	pi: ExtensionAPI,
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

	if (ctx.isIdle()) {
		pi.sendUserMessage(promptResult.prompt);
		return;
	}
	pi.sendUserMessage(promptResult.prompt, { deliverAs: "followUp" });
	if (ctx.hasUI) ctx.ui.notify("Queued Superpowers skill-entry workflow as a follow-up", "info");
}
```

- [x] **Step 4: Register `/sp-brainstorm`**

Add this function in `src/slash/slash-commands.ts`:

```typescript
/**
 * Register the explicit Superpowers-backed brainstorming command.
 *
 * @param pi Extension API for command registration and message sending.
 * @param state Shared extension state for config gate checks.
 * @param config Effective extension config for profile resolution.
 */
function registerBrainstormCommand(
	pi: ExtensionAPI,
	state: SubagentState,
	config: ExtensionConfig,
): void {
	pi.registerCommand("sp-brainstorm", {
		description: "Run brainstorming through the Superpowers workflow profile",
		handler: (rawArgs, ctx) => {
			if (notifyIfConfigBlocked(state, ctx)) return Promise.resolve();
			const task = rawArgs.trim();
			if (!task) {
				if (ctx.hasUI) ctx.ui.notify("Usage: /sp-brainstorm <task>", "error");
				return Promise.resolve();
			}
			const parsed = parseSuperpowersWorkflowArgs(task);
			if (!parsed) {
				if (ctx.hasUI) ctx.ui.notify("Usage: /sp-brainstorm <task>", "error");
				return Promise.resolve();
			}
			const profile = resolveSuperpowersRunProfile({
				config,
				commandName: "sp-brainstorm",
				parsed,
				entrySkill: {
					name: "brainstorming",
					source: "command",
				},
			});
			sendSkillEntryPrompt(pi, ctx, profile);
			return Promise.resolve();
		},
	});
}
```

Call it from `registerSlashCommands` after the base `/superpowers` registration:

```typescript
	registerBrainstormCommand(pi, state, config);
```

- [x] **Step 5: Run tests to verify they pass**

Run:

```bash
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/slash-commands.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/slash/slash-commands.ts test/integration/slash-commands.test.ts
git commit -m "feat: add sp-brainstorm command"
```

## Task 6: Opt-In Direct Skill Interception

**Files:**
- Modify: `src/extension/index.ts`
- Test: `test/integration/skill-entry-interception.test.ts`

- [x] **Step 1: Write failing input interception tests**

Create `test/integration/skill-entry-interception.test.ts`:

```typescript
/**
 * Integration coverage for opt-in Superpowers skill command interception.
 *
 * Responsibilities:
 * - verify `/skill:brainstorming` can be wrapped before native Pi skill expansion
 * - verify non-opted-in skill commands continue through native Pi behavior
 * - verify extension-injected messages are not re-intercepted
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";

type InputHandler = (event: { text: string; source: "interactive" | "rpc" | "extension" }, ctx: ReturnType<typeof createCtx>) => Promise<unknown> | unknown;

function createEventBus() {
	return {
		on() {
			return () => {};
		},
		emit() {},
	};
}

function createPiMock() {
	const lifecycle = new Map<string, InputHandler[]>();
	const userMessages: string[] = [];
	return {
		lifecycle,
		userMessages,
		pi: {
			events: createEventBus(),
			registerTool() {},
			registerCommand() {},
			registerShortcut() {},
			registerMessageRenderer() {},
			sendMessage() {},
			sendUserMessage(content: string | unknown[]) {
				userMessages.push(String(content));
			},
			on(event: string, handler: InputHandler) {
				const existing = lifecycle.get(event) ?? [];
				existing.push(handler);
				lifecycle.set(event, existing);
			},
		},
	};
}

function createCtx(notifications: string[] = []) {
	return {
		cwd: process.cwd(),
		hasUI: true,
		isIdle: () => true,
		ui: {
			notify(message: string) {
				notifications.push(message);
			},
			setWidget() {},
		},
		sessionManager: {
			getSessionFile: () => null,
			getEntries: () => [],
		},
		modelRegistry: {
			getAvailable: () => [],
		},
	};
}

void describe("skill entry interception", () => {
	const originalHome = process.env.HOME;
	const tempDirs: string[] = [];

	afterEach(() => {
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;
		for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
	});

	async function loadExtension(config: unknown) {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-skill-entry-home-"));
		tempDirs.push(home);
		process.env.HOME = home;
		const extensionDir = path.join(home, ".pi", "agent", "extensions", "subagent");
		fs.mkdirSync(extensionDir, { recursive: true });
		fs.writeFileSync(path.join(extensionDir, "config.json"), JSON.stringify(config), "utf-8");
		const module = await import("../../src/extension/index.ts");
		const mock = createPiMock();
		module.default(mock.pi as never);
		return mock;
	}

	void it("handles opted-in /skill:brainstorming input", async () => {
		const mock = await loadExtension({
			superagents: {
				interceptSkillCommands: ["brainstorming"],
				usePlannotator: true,
			},
		});
		const inputHandler = mock.lifecycle.get("input")?.[0];
		assert.ok(inputHandler, "expected input handler to be registered");

		const result = await inputHandler!(
			{ text: "/skill:brainstorming design middleware", source: "interactive" },
			createCtx(),
		);

		assert.deepEqual(result, { action: "handled" });
		assert.equal(mock.userMessages.length, 1);
		assert.match(mock.userMessages[0], /Entry skill:/);
		assert.match(mock.userMessages[0], /Name: brainstorming/);
		assert.match(mock.userMessages[0], /design middleware/);
		assert.match(mock.userMessages[0], /superpowers_spec_review/);
	});

	void it("continues for non-opted-in and extension-sourced skill input", async () => {
		const mock = await loadExtension({
			superagents: {
				interceptSkillCommands: [],
			},
		});
		const inputHandler = mock.lifecycle.get("input")?.[0];
		assert.ok(inputHandler, "expected input handler to be registered");

		assert.deepEqual(await inputHandler!(
			{ text: "/skill:brainstorming design middleware", source: "interactive" },
			createCtx(),
		), { action: "continue" });
		assert.deepEqual(await inputHandler!(
			{ text: "/skill:brainstorming design middleware", source: "extension" },
			createCtx(),
		), { action: "continue" });
		assert.equal(mock.userMessages.length, 0);
	});
});
```

- [x] **Step 2: Run tests to verify they fail**

Run:

```bash
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/skill-entry-interception.test.ts
```

Expected: FAIL because the extension does not register an `input` handler for skill interception.

- [x] **Step 3: Reuse the shared prompt builder**

Confirm `/sp-brainstorm` already uses `buildResolvedSkillEntryPrompt` from Task 3. The extension `input` hook must use the same helper so command and interception paths stay identical and command registration internals are not imported into `src/extension/index.ts`.

- [x] **Step 4: Register the `input` hook**

Modify `src/extension/index.ts` imports:

```typescript
import { resolveAvailableSkill, resolveSkills } from "../shared/skills.ts";
import {
	buildResolvedSkillEntryPrompt,
	parseSkillCommandInput,
	shouldInterceptSkillCommand,
} from "../superpowers/skill-entry.ts";
import {
	parseSuperpowersWorkflowArgs,
	resolveSuperpowersRunProfile,
} from "../superpowers/workflow-profile.ts";
```

Add the handler near the other lifecycle registrations:

```typescript
	pi.on("input", (event, ctx) => {
		if (event.source === "extension") return { action: "continue" as const };
		if (state.configGate.blocked) return { action: "continue" as const };
		const parsedSkillCommand = parseSkillCommandInput(event.text);
		if (!parsedSkillCommand) return { action: "continue" as const };
		if (!shouldInterceptSkillCommand(parsedSkillCommand.skillName, config)) {
			return { action: "continue" as const };
		}

		const parsedWorkflowArgs = parseSuperpowersWorkflowArgs(parsedSkillCommand.task);
		if (!parsedWorkflowArgs) {
			if (ctx.hasUI) ctx.ui.notify(`Usage: /skill:${parsedSkillCommand.skillName} <task>`, "error");
			return { action: "handled" as const };
		}

		const profile = resolveSuperpowersRunProfile({
			config,
			commandName: `skill:${parsedSkillCommand.skillName}`,
			parsed: parsedWorkflowArgs,
			entrySkill: {
				name: parsedSkillCommand.skillName,
				source: "intercepted-skill",
			},
		});
		const promptResult = buildResolvedSkillEntryPrompt({
			cwd: ctx.cwd,
			profile,
			resolveSkill: resolveAvailableSkill,
			resolveSkillNames: resolveSkills,
		});
		if ("error" in promptResult) {
			if (ctx.hasUI) ctx.ui.notify(promptResult.error, "error");
			return { action: "handled" as const };
		}
		pi.sendUserMessage(promptResult.prompt);
		return { action: "handled" as const };
	});
```

- [x] **Step 5: Run tests to verify they pass**

Run:

```bash
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/skill-entry-interception.test.ts
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/slash-commands.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/extension/index.ts src/superpowers/skill-entry.ts src/slash/slash-commands.ts test/integration/skill-entry-interception.test.ts test/integration/slash-commands.test.ts
git commit -m "feat: intercept opted-in brainstorming skill commands"
```

## Task 7: Saved-Spec Plannotator Tool

**Files:**
- Modify: `src/extension/index.ts`
- Test: `test/integration/plannotator-review-tool.test.ts`

- [x] **Step 1: Write failing spec-review tool tests**

Add this test to `test/integration/plannotator-review-tool.test.ts`:

```typescript
	void it("emits a saved-spec review request and returns approval", async () => {
		const mock = await loadExtensionWithPlannotatorEnabled();
		const tool = mock.tools.get("superpowers_spec_review");
		assert.ok(tool, "expected superpowers_spec_review tool to be registered");

		mock.pi.events.on("plannotator:request", (request) => {
			const typedRequest = request as {
				action: string;
				payload: { planContent: string; planFilePath?: string; origin: string };
				respond(response: unknown): void;
			};
			assert.equal(typedRequest.action, "plan-review");
			assert.equal(typedRequest.payload.origin, "pi-superagents");
			assert.equal(typedRequest.payload.planContent, "Final spec");
			assert.equal(typedRequest.payload.planFilePath, "docs/superpowers/specs/spec.md");
			typedRequest.respond({
				status: "handled",
				result: { status: "pending", reviewId: "spec-review-1" },
			});
			mock.pi.events.emit("plannotator:review-result", {
				reviewId: "spec-review-1",
				approved: true,
			});
		});

		const result = await tool!.execute(
			"spec-review-approval",
			{ specContent: "Final spec", specFilePath: "docs/superpowers/specs/spec.md" },
			undefined,
			undefined,
			createCtx([]),
		);

		assert.equal((result as { content: Array<{ text: string }> }).content[0].text, "Plannotator approved the saved spec review. Continue the Superpowers workflow.");
	});
```

Add a rejection test:

```typescript
	void it("returns saved-spec rejection feedback for revision", async () => {
		const mock = await loadExtensionWithPlannotatorEnabled();
		const tool = mock.tools.get("superpowers_spec_review");
		assert.ok(tool, "expected superpowers_spec_review tool to be registered");

		mock.pi.events.on("plannotator:request", (request) => {
			const typedRequest = request as { respond(response: unknown): void };
			typedRequest.respond({
				status: "handled",
				result: { status: "pending", reviewId: "spec-review-2" },
			});
			mock.pi.events.emit("plannotator:review-result", {
				reviewId: "spec-review-2",
				approved: false,
				feedback: "Clarify interception opt-in.",
			});
		});

		const result = await tool!.execute(
			"spec-review-rejected",
			{ specContent: "Final spec" },
			undefined,
			undefined,
			createCtx([]),
		);

		assert.match((result as { content: Array<{ text: string }> }).content[0].text, /Plannotator requested saved spec changes/);
		assert.match((result as { content: Array<{ text: string }> }).content[0].text, /Clarify interception opt-in/);
	});
```

- [x] **Step 2: Run tests to verify they fail**

Run:

```bash
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/plannotator-review-tool.test.ts
```

Expected: FAIL because `superpowers_spec_review` is not registered.

- [x] **Step 3: Add spec review tool schema and executor**

Use the existing `requestPlannotatorPlanReview()` bridge internally. The user-facing tool is `superpowers_spec_review`, but the emitted Plannotator event action remains `"plan-review"` because the currently integrated Plannotator event contract is known to support that action. Do not introduce a new `"spec-review"` event action in this task unless the Plannotator extension has first added and documented support for it.

Modify `src/extension/index.ts` near `SuperpowersPlanReviewParams`:

```typescript
const SuperpowersSpecReviewParams = Type.Object({
	specContent: Type.String({ description: "Final saved Superpowers brainstorming spec content to review." }),
	specFilePath: Type.Optional(Type.String({ description: "Saved Superpowers brainstorming spec file path when available." })),
});
```

Add executor:

```typescript
/**
 * Execute the root-session Plannotator saved-spec review bridge.
 *
 * @param params Final spec content plus optional saved spec path.
 * @param ctx Extension context for optional UI notifications.
 * @returns Fail-soft saved-spec review status text.
 */
async function executeSuperpowersSpecReview(
	params: { specContent: string; specFilePath?: string },
	ctx: ExtensionContext,
): Promise<AgentToolResult<Details>> {
	if (!isSuperagentPlannotatorEnabled(config)) {
		return createTextToolResult(
			"Plannotator saved spec review is disabled in config. Continue with the normal text-based Superpowers review flow.",
		);
	}

	try {
		const result = await requestPlannotatorPlanReview({
			events: pi.events,
			planContent: params.specContent,
			planFilePath: params.specFilePath,
		});

		if (result.status === "approved") {
			return createTextToolResult("Plannotator approved the saved spec review. Continue the Superpowers workflow.");
		}

		if (result.status === "rejected") {
			return createTextToolResult(`Plannotator requested saved spec changes:
${result.feedback}`);
		}

		if (ctx.hasUI) {
			ctx.ui.notify(
				`Plannotator unavailable: ${result.reason}. Falling back to text-based spec review.`,
				"warning",
			);
		}
		return createTextToolResult(
			`Plannotator unavailable: ${result.reason}
Continue with the normal text-based Superpowers review flow.`,
		);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		if (ctx.hasUI) {
			ctx.ui.notify(
				`Plannotator unavailable: ${reason}. Falling back to text-based spec review.`,
				"warning",
			);
		}
		return createTextToolResult(
			`Plannotator unavailable: ${reason}
Continue with the normal text-based Superpowers review flow.`,
		);
	}
}
```

- [x] **Step 4: Register the tool**

Add a tool definition next to `planReviewTool`:

```typescript
	const specReviewTool: ToolDefinition<typeof SuperpowersSpecReviewParams, Details> = {
		name: "superpowers_spec_review",
		label: "Superpowers Spec Review",
		description: "Send the final saved Superpowers brainstorming spec through the optional Plannotator browser review bridge. Use only after the saved brainstorming spec exists.",
		parameters: SuperpowersSpecReviewParams,
		execute(_id, params, _signal, _onUpdate, ctx) {
			return executeSuperpowersSpecReview(
				params as { specContent: string; specFilePath?: string },
				ctx,
			);
		},
	};
```

Register it:

```typescript
	pi.registerTool(planReviewTool);
	pi.registerTool(specReviewTool);
	pi.registerTool(tool);
```

- [x] **Step 5: Run tests to verify they pass**

Run:

```bash
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/plannotator-review-tool.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/extension/index.ts test/integration/plannotator-review-tool.test.ts
git commit -m "feat: add plannotator saved spec review tool"
```

## Task 8: Documentation And User-Facing Config Reference

**Files:**
- Modify: `docs/guides/superpowers.md`
- Modify: `docs/reference/configuration.md`
- Test: `test/unit/default-config.test.ts`

- [x] **Step 1: Write documentation/config expectation tests**

Add this assertion to `test/unit/default-config.test.ts`:

```typescript
	void it("keeps direct skill interception opt-in by default", () => {
		assert.deepEqual(config.superagents?.interceptSkillCommands, []);
		assert.deepEqual(config.superagents?.skillOverlays, {});
	});
```

- [x] **Step 2: Run test to verify current config remains valid**

Run:

```bash
node --experimental-strip-types --test test/unit/default-config.test.ts
```

Expected: PASS if Task 1 already updated defaults; FAIL if defaults were missed.

- [x] **Step 3: Document `/sp-brainstorm` in the guide**

Add this section to `docs/guides/superpowers.md` after the overview examples:

```markdown
## Brainstorming Entry

Use `/sp-brainstorm` when you want the `brainstorming` skill to run through the Superpowers workflow profile:

```text
/sp-brainstorm design a React Native onboarding flow
```

This keeps the normal brainstorming conversation intact while applying Superpowers config for delegation, TDD policy, branch policy, worktree policy, skill overlays, and optional Plannotator review.

When `superagents.usePlannotator` is enabled, Plannotator reviews the saved brainstorming spec after it is written and before the workflow moves to implementation planning.
```

- [x] **Step 4: Document overlays and interception in configuration reference**

Add this section to `docs/reference/configuration.md`:

```markdown
## Skill Entry Configuration

`skillOverlays` adds domain skills to supported Superpowers root skill flows.

```json
{
  "superagents": {
    "skillOverlays": {
      "brainstorming": ["react-native-best-practices"],
      "writing-plans": ["react-native-best-practices"]
    }
  }
}
```

Overlays are additive. They do not replace `using-superpowers` or the selected entry skill.

`interceptSkillCommands` opts direct Pi skill commands into the Superpowers harness.

```json
{
  "superagents": {
    "interceptSkillCommands": ["brainstorming"]
  }
}
```

When configured, `/skill:brainstorming <task>` is intercepted before native Pi skill expansion and runs the same wrapped flow as `/sp-brainstorm <task>`. Non-listed skills continue through native Pi behavior.
```

- [x] **Step 5: Run doc-adjacent verification**

Run:

```bash
node --experimental-strip-types --test test/unit/default-config.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add docs/guides/superpowers.md docs/reference/configuration.md test/unit/default-config.test.ts
git commit -m "docs: document skill entry configuration"
```

## Task 9: Full Verification And Regression Sweep

**Files:**
- Modify only files that fail verification because of this feature.

- [x] **Step 1: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS. If it fails because branch-policy changes in the worktree have already changed profile fields, update this feature to the target profile shape directly. Do not add backwards-compatibility aliases for old profile fields.

- [x] **Step 2: Run unit tests**

Run:

```bash
npm run test:unit
```

Expected: PASS.

- [x] **Step 3: Run integration tests**

Run:

```bash
npm run test:integration
```

Expected: PASS.

- [x] **Step 4: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [x] **Step 5: Inspect public command behavior**

Run the integration slash-command test output or inspect the registered command map in `test/integration/slash-commands.test.ts`. Confirm these commands are registered:

```text
superpowers
sp-brainstorm
superpowers-status
```

Expected: only the Superpowers command surface is present. Old generic commands such as `run`, `chain`, `parallel`, and `agents` remain absent.

> Verification note (2026-04-13): Root-session verification confirmed `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, and `npm run lint` now pass. The integration fixes were test-surface updates for current runtime contracts plus an `.scratch/**` lint ignore.

- [x] **Step 6: Commit verification fixes if any were needed**

If no code changed during verification, skip this commit. If fixes were needed:

```bash
git add <files changed during verification>
git commit -m "fix: complete skill entry verification"
```

## Self-Review

- Spec coverage: The plan covers central `skillOverlays`, opt-in `interceptSkillCommands`, `/sp-brainstorm`, direct `/skill:brainstorming` interception through Pi's `input` event, saved-spec Plannotator review, the target `/superpowers` behavior, and docs.
- No unsupported Plannotator actions are introduced. The new `superpowers_spec_review` wrapper reuses the existing event bridge and scopes review to saved specs.
- Type consistency: `entrySkill`, `overlaySkillNames`, `entrySkillSource`, `skillOverlays`, and `interceptSkillCommands` names are consistent across config, profile, prompt, commands, and tests.
- Regression coverage: The target `/superpowers` prompt and `superpowers_plan_review` behavior are explicitly preserved, while removed generic/legacy surfaces stay removed.
