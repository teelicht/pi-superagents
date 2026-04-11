# Lean Superpowers Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `pi-superagents` into a self-contained Superpowers-only Pi extension with `/superpowers`, `/superpowers-status`, Superpowers role subagents, model-tier resolution from role agent frontmatter, Superpowers worktrees, TDD/subagent toggles, and custom workflow command presets.

**Architecture:** Keep the existing Pi child-process execution substrate where it directly supports Superpowers role execution, but remove the public generic subagent product surface. Add small focused modules for workflow profile resolution and root prompt construction, then simplify config, slash command registration, schemas, docs, and tests around that boundary.

**Tech Stack:** TypeScript, Node test runner, Pi extension APIs from `@mariozechner/pi-coding-agent`, TypeBox schemas, Pi TUI components, Markdown role agents, JSON config files.

---

## Scope Check

The spec is deletion-heavy but cohesive: every task serves the single product boundary of a lean Superpowers runtime. Do not split this into separate repos or packages. Implement in this repo in short commits so breakage is contained and reviewable.

## Context Map

### Files to Modify

| File | Purpose | Changes Needed |
|------|---------|----------------|
| `src/shared/types.ts` | Runtime and config contracts | Replace generic config shape with Superpowers config, workflow profile, worktree config, and command preset types. Remove config-facing `defaultImplementerMode`. |
| `src/execution/config-validation.ts` | Strict config validation and merging | Validate `useSubagents`, `useTestDrivenDevelopment`, `commands`, `worktrees`, and `modelTiers`; reject removed generic keys and old `defaultImplementerMode`. |
| `default-config.json` | Bundled defaults | Replace generic defaults with lean Superpowers defaults. |
| `config.example.json` | User-facing config reference | Mirror the lean Superpowers config surface. |
| `src/superpowers/workflow-profile.ts` | New resolver unit | Parse inline workflow tokens and combine global defaults, custom command presets, and inline overrides. |
| `src/superpowers/root-prompt.ts` | New prompt unit | Build `/superpowers` root-session prompts that bootstrap `using-superpowers` and honor resolved workflow booleans. |
| `src/slash/slash-commands.ts` | Slash command registration | Remove `/run`, `/chain`, `/parallel`, `/agents`; register `/superpowers`, `/superpowers-status`, and configured custom commands. |
| `src/extension/index.ts` | Pi extension entrypoint | Pass config into slash command registration, remove prompt-template bridge and slash subagent bridge registration, keep `subagent` and `subagent_status` tools for root-model workflows. |
| `src/shared/schemas.ts` | Tool schemas | Remove management action schema and generic chain public descriptions; narrow `subagent` to Superpowers role execution. |
| `src/execution/subagent-executor.ts` | Tool execution dispatcher | Remove management action paths and generic public chain affordances; preserve role single and parallel execution used by root Superpowers workflows. |
| `src/execution/superpowers-policy.ts` | Role policy | Replace implementer mode with `useTestDrivenDevelopment`; preserve model-tier resolution from each `sp-*` agent frontmatter. |
| `src/execution/superagents-config.ts` | Superpowers config helpers | Keep Superpowers worktree defaults and lean settings accessors. |
| `src/ui/superpowers-status.ts` | New focused TUI | Replace generic Agents Manager with status/settings display, safe config toggles, and worktree visibility. |
| `src/superpowers/config-writer.ts` | New config writer unit | Apply safe JSON updates for TUI toggles without introducing a second config system. |
| `src/ui/subagents-status.ts` | Current async status TUI | Either rename into `superpowers-status.ts` or reduce to a helper used by the focused TUI. |
| `agents/delegate.md` | Generic builtin agent | Delete unless executor still needs an internal fallback; do not document it. |
| `agents/sp-task-loop.chain.md` | Generic chain-file workflow | Delete from public builtins in the first lean pass. |
| `README.md` | User docs | Rewrite around Superpowers-only UX and remove fork lineage. |
| `docs/guides/superpowers.md` | Superpowers guide | Rewrite to describe `/superpowers`, tokens, custom commands, role-agent frontmatter models, worktrees, and status/settings. |
| `docs/reference/configuration.md` | Config reference | Replace broad config reference with lean Superpowers config. |
| `docs/reference/parameters.md` | Tool parameter docs | Narrow or remove generic public API sections. |
| `CHANGELOG.md` | Release notes | Add breaking 0.3.0 entry and remove forward-looking compatibility promises. |
| `package.json` | Package metadata | Bump to `0.3.0`, remove fork-oriented repository/homepage/bugs if incorrect, keep Pi extension entries. |
| `package-lock.json` | Lock metadata | Bump package version entries to `0.3.0`. |

### Files to Delete

| File | Reason |
|------|--------|
| `src/agents/agent-manager.ts` | Generic Agents Manager removed. |
| `src/agents/agent-manager-list.ts` | Generic Agents Manager removed. |
| `src/agents/agent-manager-detail.ts` | Generic Agents Manager removed. |
| `src/agents/agent-manager-edit.ts` | Generic Agents Manager removed. |
| `src/agents/agent-manager-chain-detail.ts` | Generic Agents Manager removed. |
| `src/agents/agent-manager-parallel.ts` | Generic Agents Manager removed. |
| `src/agents/agent-management.ts` | Generic agent and chain CRUD removed. |
| `src/agents/agent-templates.ts` | Generic agent templates removed. |
| `src/slash/prompt-template-bridge.ts` | Prompt-template bridge removed. |
| `src/slash/slash-bridge.ts` | Generic slash-to-subagent bridge removed when `/run`, `/chain`, `/parallel` are gone. |
| `src/ui/chain-clarify.ts` | Generic chain clarification TUI removed. |

Delete these only after imports and tests no longer reference them.

### Dependencies

| File | Relationship |
|------|--------------|
| `src/extension/index.ts` | Imports slash registration, prompt-template bridge, slash bridge, status TUI, config helpers, executor. |
| `src/execution/async-execution.ts` | Uses chain-oriented async concepts; keep only if recent-run status or retained Superpowers worktree execution needs it. |
| `src/execution/chain-execution.ts` | Generic chain implementation; remove from public paths, then delete if no internal Superpowers path uses it. |
| `src/execution/execution.ts` | Single role child execution; preserve and simplify. |
| `src/execution/parallel-utils.ts` | Parallel helper; preserve for root Superpowers delegated fan-out. |
| `src/agents/agents.ts` | Discovers builtin role agents; keep but narrow docs and supported builtins. |
| `src/agents/agent-serializer.ts` | Used by agent discovery/management; keep only if role agent parsing depends on it. |
| `src/agents/frontmatter.ts` | Parses role agent frontmatter; keep. |
| `src/agents/chain-serializer.ts` | Delete if no retained runtime imports it after removing chain files. |

### Test Files

| Test | Coverage |
|------|----------|
| `test/unit/config-validation.test.ts` | Update to lean config validation, commands, worktrees, model tiers, removed keys. |
| `test/unit/default-config.test.ts` | Update to lean config templates. |
| `test/unit/superpowers-workflow-profile.test.ts` | New workflow token and command preset precedence coverage. |
| `test/unit/superpowers-root-prompt.test.ts` | New root prompt bootstrap and delegation wording coverage. |
| `test/unit/superpowers-config-writer.test.ts` | New safe config text update coverage for TUI writes. |
| `test/unit/superpowers-policy.test.ts` | Update to boolean TDD and model-tier resolution from role agent frontmatter. |
| `test/unit/schemas.test.ts` | Update to narrowed `subagent` and status schemas. |
| `test/unit/package-manifest.test.ts` | Update version and package metadata expectations. |
| `test/integration/slash-commands.test.ts` | Replace generic command assertions with lean command registration and prompt behavior. |
| `test/integration/config-gating.test.ts` | Update command names and config diagnostics expectations. |
| `test/unit/prompt-template-bridge.test.ts` | Delete with bridge removal. |
| `test/integration/chain-execution.test.ts` | Delete if chain runtime is removed; otherwise update only for internal Superpowers role use. |
| `test/integration/parallel-execution.test.ts` | Keep only if it covers retained Superpowers parallel role execution and worktree defaults. |

### Reference Patterns

| File | Pattern |
|------|---------|
| `src/execution/config-validation.ts` | Existing fail-closed validation and deep merge style. |
| `src/slash/slash-commands.ts` | Existing `pi.registerCommand` and `pi.sendUserMessage` patterns. |
| `src/shared/skills.ts` | Existing runtime skill discovery and injection helpers. |
| `src/execution/superpowers-policy.ts` | Existing root-only skill policy and bounded role tool filtering. |
| `src/ui/subagents-status.ts` | Existing overlay component pattern for status UI. |
| `test/integration/slash-commands.test.ts` | Existing command-registration mock pattern. |

### Risk Assessment

- [x] Breaking changes to public API
- [x] Configuration changes required
- [x] Large deletion surface
- [ ] Database migrations needed

### Implementation Standards

- Keep all application code in TypeScript. Do not add plain JavaScript source files.
- Add or maintain file headers for every touched source file.
- Add or maintain doc comments for every non-trivial function, including new helpers in `src/superpowers/*`.

## Task 1: Lean Config Contract And Defaults

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/execution/config-validation.ts`
- Modify: `default-config.json`
- Modify: `config.example.json`
- Modify: `test/unit/config-validation.test.ts`
- Modify: `test/unit/default-config.test.ts`

- [ ] **Step 1: Write failing config validation tests**

Replace the `defaults` object in `test/unit/config-validation.test.ts` with this lean shape:

```typescript
const defaults: ExtensionConfig = {
	superagents: {
		useSubagents: true,
		useTestDrivenDevelopment: true,
		commands: {},
		worktrees: {
			enabled: false,
			root: null,
			setupHook: null,
			setupHookTimeoutMs: 30000,
		},
		modelTiers: {
			cheap: { model: "opencode-go/minimax-m2.7" },
			balanced: { model: "opencode-go/glm-5.1" },
			max: { model: "openai/gpt-5.4" },
		},
	},
};
```

Replace the deep-merge test body with:

```typescript
const result = loadEffectiveConfig(defaults, {
	superagents: {
		useSubagents: false,
		commands: {
			"superpowers-lean": {
				description: "Run lean",
				useSubagents: false,
				useTestDrivenDevelopment: false,
			},
		},
		worktrees: {
			enabled: true,
			root: "/tmp/superpowers-worktrees",
		},
		modelTiers: {
			max: { model: "openai/gpt-5.4", thinking: "high" },
			free: { model: "google/gemini-flash" },
		},
	},
});

assert.equal(result.blocked, false);
assert.equal(result.config.superagents?.useSubagents, false);
assert.equal(result.config.superagents?.useTestDrivenDevelopment, true);
assert.deepEqual(result.config.superagents?.commands?.["superpowers-lean"], {
	description: "Run lean",
	useSubagents: false,
	useTestDrivenDevelopment: false,
});
assert.deepEqual(result.config.superagents?.worktrees, {
	enabled: true,
	root: "/tmp/superpowers-worktrees",
	setupHook: null,
	setupHookTimeoutMs: 30000,
});
assert.deepEqual(result.config.superagents?.modelTiers?.cheap, defaults.superagents?.modelTiers?.cheap);
assert.deepEqual(result.config.superagents?.modelTiers?.max, {
	model: "openai/gpt-5.4",
	thinking: "high",
});
assert.deepEqual(result.config.superagents?.modelTiers?.free, {
	model: "google/gemini-flash",
});
```

Add this test:

```typescript
it("accepts lean Superpowers command presets, worktrees, and model tiers", () => {
	const result = validateConfigObject({
		superagents: {
			useSubagents: true,
			useTestDrivenDevelopment: false,
			commands: {
				"superpowers-direct": {
					description: "Direct implementation",
					useSubagents: true,
					useTestDrivenDevelopment: false,
				},
				"sp-inline": {
					useSubagents: false,
				},
			},
			worktrees: {
				enabled: true,
				root: null,
				setupHook: "./scripts/setup-worktree.mjs",
				setupHookTimeoutMs: 45000,
			},
			modelTiers: {
				cheap: "opencode-go/minimax-m2.7",
				max: { model: "openai/gpt-5.4", thinking: "high" },
			},
		},
	});

	assert.equal(result.blocked, false);
	assert.deepEqual(result.diagnostics, []);
});
```

Add this test:

```typescript
it("rejects removed generic config keys and old implementer mode", () => {
	const result = validateConfigObject({
		asyncByDefault: true,
		defaultSessionDir: "/tmp/pi",
		maxSubagentDepth: 2,
		superagents: {
			defaultImplementerMode: "tdd",
		},
	});

	assert.equal(result.blocked, true);
	assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.path), [
		"asyncByDefault",
		"defaultSessionDir",
		"maxSubagentDepth",
		"superagents.defaultImplementerMode",
	]);
});
```

Add this test:

```typescript
it("rejects invalid custom command names, fields, and worktree values", () => {
	const result = validateConfigObject({
		superagents: {
			commands: {
				"run": { useSubagents: true },
				"superpowers bad": { useSubagents: false },
				"superpowers-extra": {
					description: 123,
					useSubagents: "yes",
					useTestDrivenDevelopment: "no",
					prompt: "Do extra things",
				},
			},
			worktrees: {
				enabled: "yes",
				root: 12,
				setupHook: false,
				setupHookTimeoutMs: 0,
				setupCommand: "./setup.sh",
			},
		},
	});

	assert.equal(result.blocked, true);
	assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.path), [
		"superagents.commands.run",
		"superagents.commands.superpowers bad",
		"superagents.commands.superpowers-extra.description",
		"superagents.commands.superpowers-extra.useSubagents",
		"superagents.commands.superpowers-extra.useTestDrivenDevelopment",
		"superagents.commands.superpowers-extra.prompt",
		"superagents.worktrees.setupCommand",
		"superagents.worktrees.enabled",
		"superagents.worktrees.root",
		"superagents.worktrees.setupHook",
		"superagents.worktrees.setupHookTimeoutMs",
	]);
});
```

- [ ] **Step 2: Run config tests to verify failure**

Run:

```bash
node --experimental-strip-types --test test/unit/config-validation.test.ts test/unit/default-config.test.ts
```

Expected: FAIL because the current config schema still exposes `defaultImplementerMode`, lacks `commands`, and still allows generic top-level keys.

- [ ] **Step 3: Update TypeScript config types**

In `src/shared/types.ts`, replace `SuperpowersImplementerMode` and `SuperpowersSettings` with:

```typescript
export type WorkflowMode = "superpowers";

export interface SuperpowersCommandPreset {
	description?: string;
	useSubagents?: boolean;
	useTestDrivenDevelopment?: boolean;
}

export interface SuperpowersWorktreeSettings {
	enabled?: boolean;
	root?: string | null;
	setupHook?: string | null;
	setupHookTimeoutMs?: number;
}

export interface SuperpowersSettings {
	useSubagents?: boolean;
	useTestDrivenDevelopment?: boolean;
	commands?: Record<string, SuperpowersCommandPreset>;
	/** Superpowers-only worktree defaults for parallel delegated work. */
	worktrees?: SuperpowersWorktreeSettings;
	/** Model configuration for each tier. Supports built-in (cheap, balanced, max) and custom tiers. */
	modelTiers?: Record<string, ModelTierSetting>;
}

export interface ExtensionConfig {
	superagents?: SuperpowersSettings;
}
```

In `RunSyncOptions`, replace:

```typescript
/** Superpowers implementer behavior mode. */
implementerMode?: SuperpowersImplementerMode;
```

with:

```typescript
/** Whether Superpowers implementer roles should receive TDD skill guidance. */
useTestDrivenDevelopment?: boolean;
```

- [ ] **Step 4: Update config validation constants and validators**

In `src/execution/config-validation.ts`, remove imports of `SuperpowersImplementerMode`. Replace the supported key constants with:

```typescript
const TOP_LEVEL_KEYS = new Set(["superagents"]);
const SUPERAGENTS_KEYS = new Set([
	"useSubagents",
	"useTestDrivenDevelopment",
	"commands",
	"worktrees",
	"modelTiers",
]);
const COMMAND_PRESET_KEYS = new Set(["description", "useSubagents", "useTestDrivenDevelopment"]);
const WORKTREE_KEYS = new Set(["enabled", "root", "setupHook", "setupHookTimeoutMs"]);
const MODEL_TIER_KEYS = new Set(["model", "thinking"]);
const COMMAND_NAME_PATTERN = /^(superpowers-[a-z0-9][a-z0-9-]*|sp-[a-z0-9][a-z0-9-]*)$/;
```

Keep `validateOptionalStringOrNull`. Add this helper below `validateModelTier`:

```typescript
function validateCommandPreset(
	diagnostics: ConfigDiagnostic[],
	value: unknown,
	path: string,
): void {
	if (!isRecord(value)) {
		addError(diagnostics, path, "must be an object.");
		return;
	}
	for (const key of Object.keys(value)) {
		if (!COMMAND_PRESET_KEYS.has(key)) addError(diagnostics, `${path}.${key}`, "is not a supported config key.", "unknown_key");
	}
	if ("description" in value && typeof value.description !== "string") {
		addError(diagnostics, `${path}.description`, "must be a string.");
	}
	if ("useSubagents" in value && typeof value.useSubagents !== "boolean") {
		addError(diagnostics, `${path}.useSubagents`, "must be a boolean.");
	}
	if ("useTestDrivenDevelopment" in value && typeof value.useTestDrivenDevelopment !== "boolean") {
		addError(diagnostics, `${path}.useTestDrivenDevelopment`, "must be a boolean.");
	}
}
```

In `validateConfigObject`, delete validation for `asyncByDefault`, `defaultSessionDir`, and `maxSubagentDepth`. Inside `superagents`, add:

```typescript
if ("useSubagents" in superagents && typeof superagents.useSubagents !== "boolean") {
	addError(diagnostics, "superagents.useSubagents", "must be a boolean.");
}
if ("useTestDrivenDevelopment" in superagents && typeof superagents.useTestDrivenDevelopment !== "boolean") {
	addError(diagnostics, "superagents.useTestDrivenDevelopment", "must be a boolean.");
}
if ("defaultImplementerMode" in superagents) {
	addError(
		diagnostics,
		"superagents.defaultImplementerMode",
		"has been removed. Use superagents.useTestDrivenDevelopment instead.",
		"removed_key",
	);
}
if ("commands" in superagents) {
	const commands = superagents.commands;
	if (!isRecord(commands)) {
		addError(diagnostics, "superagents.commands", "must be an object.");
	} else {
		for (const [commandName, preset] of Object.entries(commands)) {
			const commandPath = `superagents.commands.${commandName}`;
			if (!COMMAND_NAME_PATTERN.test(commandName)) {
				addError(diagnostics, commandPath, "must start with superpowers- or sp- and contain only lowercase letters, numbers, and dashes.");
				continue;
			}
			validateCommandPreset(diagnostics, preset, commandPath);
		}
	}
}
if ("worktrees" in superagents) {
	const worktrees = superagents.worktrees;
	if (!isRecord(worktrees)) {
		addError(diagnostics, "superagents.worktrees", "must be an object.");
	} else {
		for (const key of Object.keys(worktrees)) {
			if (!WORKTREE_KEYS.has(key)) addError(diagnostics, `superagents.worktrees.${key}`, "is not a supported config key.", "unknown_key");
		}
		if ("enabled" in worktrees && typeof worktrees.enabled !== "boolean") {
			addError(diagnostics, "superagents.worktrees.enabled", "must be a boolean.");
		}
		validateOptionalStringOrNull(diagnostics, worktrees, "root", "superagents.worktrees.root");
		validateOptionalStringOrNull(diagnostics, worktrees, "setupHook", "superagents.worktrees.setupHook");
		if ("setupHookTimeoutMs" in worktrees) {
			const value = worktrees.setupHookTimeoutMs;
			if (!Number.isInteger(value) || Number(value) <= 0) {
				addError(diagnostics, "superagents.worktrees.setupHookTimeoutMs", "must be a positive integer.");
			}
		}
	}
}
```

- [ ] **Step 5: Update config merge**

Replace `mergeConfig` in `src/execution/config-validation.ts` with:

```typescript
export function mergeConfig(defaults: ExtensionConfig, overrides: ExtensionConfig): ExtensionConfig {
	const defaultSuperagents = defaults.superagents;
	const overrideSuperagents = overrides.superagents;
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
		}
		: undefined;

	return {
		...defaults,
		...overrides,
		...(mergedSuperagents ? { superagents: mergedSuperagents } : {}),
	};
}
```

- [ ] **Step 6: Replace shipped config files**

Replace `default-config.json` and `config.example.json` with:

```json
{
  "superagents": {
    "useSubagents": true,
    "useTestDrivenDevelopment": true,
    "commands": {},
    "worktrees": {
      "enabled": false,
      "root": null,
      "setupHook": null,
      "setupHookTimeoutMs": 30000
    },
    "modelTiers": {
      "cheap": {
        "model": "opencode-go/minimax-m2.7"
      },
      "balanced": {
        "model": "opencode-go/glm-5.1"
      },
      "max": {
        "model": "openai/gpt-5.4"
      }
    }
  }
}
```

- [ ] **Step 7: Update config template tests**

In `test/unit/default-config.test.ts`, replace the option key constants with:

```typescript
const TOP_LEVEL_OPTION_KEYS = ["superagents"] as const;

const SUPERAGENTS_OPTION_KEYS = [
	"useSubagents",
	"useTestDrivenDevelopment",
	"commands",
	"worktrees",
	"modelTiers",
] as const;

const WORKTREE_OPTION_KEYS = [
	"enabled",
	"root",
	"setupHook",
	"setupHookTimeoutMs",
] as const;
```

Replace `assertPublicConfigSurface` assertions after `superagents` lookup with:

```typescript
const worktrees = superagents.worktrees as Record<string, unknown>;
const modelTiers = superagents.modelTiers as Record<string, unknown>;
const cheapTier = modelTiers.cheap as Record<string, unknown>;
const balancedTier = modelTiers.balanced as Record<string, unknown>;
const maxTier = modelTiers.max as Record<string, unknown>;
const metadataKeys = Object.keys(config).filter((key) => key.startsWith("_"));

for (const key of TOP_LEVEL_OPTION_KEYS) {
	assert.ok(key in config, `Expected option '${key}' to be present`);
}
for (const key of SUPERAGENTS_OPTION_KEYS) {
	assert.ok(key in superagents, `Expected superagents option '${key}' to be present`);
}
for (const key of WORKTREE_OPTION_KEYS) {
	assert.ok(key in worktrees, `Expected superagents.worktrees.${key} to be present`);
}

assert.equal(superagents.useSubagents, true);
assert.equal(superagents.useTestDrivenDevelopment, true);
assert.deepEqual(superagents.commands, {});
assert.equal(worktrees.enabled, false);
assert.equal(worktrees.root, null);
assert.equal(worktrees.setupHook, null);
assert.equal(worktrees.setupHookTimeoutMs, 30000);
assert.equal(typeof cheapTier.model, "string");
assert.equal(typeof balancedTier.model, "string");
assert.equal(typeof maxTier.model, "string");
assert.ok(String(cheapTier.model).length > 0);
assert.ok(String(balancedTier.model).length > 0);
assert.ok(String(maxTier.model).length > 0);
assert.deepEqual(metadataKeys, []);
```

- [ ] **Step 8: Run config tests to verify pass**

Run:

```bash
node --experimental-strip-types --test test/unit/config-validation.test.ts test/unit/default-config.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit lean config contract**

Run:

```bash
git add src/shared/types.ts src/execution/config-validation.ts default-config.json config.example.json test/unit/config-validation.test.ts test/unit/default-config.test.ts
git commit -m "feat: define lean superpowers config"
```

## Task 2: Workflow Profile Resolver

**Files:**
- Create: `src/superpowers/workflow-profile.ts`
- Create: `test/unit/superpowers-workflow-profile.test.ts`

- [ ] **Step 1: Write failing resolver tests**

Create `test/unit/superpowers-workflow-profile.test.ts`:

```typescript
/**
 * Unit tests for Superpowers workflow profile resolution.
 *
 * Responsibilities:
 * - verify inline workflow token parsing
 * - verify custom command presets override global defaults
 * - verify inline tokens override custom command presets
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	parseSuperpowersWorkflowArgs,
	resolveSuperpowersRunProfile,
} from "../../src/superpowers/workflow-profile.ts";
import type { ExtensionConfig } from "../../src/shared/types.ts";

const config: ExtensionConfig = {
	superagents: {
		useSubagents: true,
		useTestDrivenDevelopment: true,
		commands: {
			"superpowers-lean": {
				description: "Lean mode",
				useSubagents: false,
				useTestDrivenDevelopment: false,
			},
			"superpowers-direct": {
				description: "Direct mode",
				useSubagents: true,
				useTestDrivenDevelopment: false,
			},
		},
	},
};

describe("Superpowers workflow profile", () => {
	it("uses global defaults when no preset or inline token is present", () => {
		const parsed = parseSuperpowersWorkflowArgs("fix auth");
		assert.deepEqual(parsed, {
			task: "fix auth",
			overrides: {},
			bg: false,
			fork: false,
		});
		assert.deepEqual(resolveSuperpowersRunProfile({
			config,
			commandName: "superpowers",
			parsed,
		}), {
			commandName: "superpowers",
			task: "fix auth",
			useSubagents: true,
			useTestDrivenDevelopment: true,
			bg: false,
			fork: false,
		});
	});

	it("applies command preset values before inline tokens", () => {
		const parsed = parseSuperpowersWorkflowArgs("tdd fix auth");
		assert.deepEqual(resolveSuperpowersRunProfile({
			config,
			commandName: "superpowers-lean",
			parsed,
		}), {
			commandName: "superpowers-lean",
			task: "fix auth",
			useSubagents: false,
			useTestDrivenDevelopment: true,
			bg: false,
			fork: false,
		});
	});

	it("parses lean, full, direct, tdd, subagents, no-subagents, and inline tokens", () => {
		assert.deepEqual(parseSuperpowersWorkflowArgs("lean fix auth").overrides, {
			useSubagents: false,
			useTestDrivenDevelopment: false,
		});
		assert.deepEqual(parseSuperpowersWorkflowArgs("full fix auth").overrides, {
			useSubagents: true,
			useTestDrivenDevelopment: true,
		});
		assert.deepEqual(parseSuperpowersWorkflowArgs("direct no-subagents fix auth").overrides, {
			useSubagents: false,
			useTestDrivenDevelopment: false,
		});
		assert.deepEqual(parseSuperpowersWorkflowArgs("tdd subagents fix auth").overrides, {
			useSubagents: true,
			useTestDrivenDevelopment: true,
		});
		assert.deepEqual(parseSuperpowersWorkflowArgs("inline fix auth").overrides, {
			useSubagents: false,
		});
	});

	it("carries bg and fork flags in either order", () => {
		assert.deepEqual(parseSuperpowersWorkflowArgs("direct fix auth --fork --bg"), {
			task: "fix auth",
			overrides: { useTestDrivenDevelopment: false },
			bg: true,
			fork: true,
		});
		assert.deepEqual(parseSuperpowersWorkflowArgs("direct fix auth --bg --fork"), {
			task: "fix auth",
			overrides: { useTestDrivenDevelopment: false },
			bg: true,
			fork: true,
		});
	});

	it("returns null when only workflow tokens are provided", () => {
		assert.equal(parseSuperpowersWorkflowArgs("direct no-subagents"), null);
		assert.equal(parseSuperpowersWorkflowArgs("--bg"), null);
		assert.equal(parseSuperpowersWorkflowArgs(""), null);
	});
});
```

- [ ] **Step 2: Run resolver tests to verify failure**

Run:

```bash
node --experimental-strip-types --test test/unit/superpowers-workflow-profile.test.ts
```

Expected: FAIL with module not found for `src/superpowers/workflow-profile.ts`.

- [ ] **Step 3: Create workflow resolver module**

Create `src/superpowers/workflow-profile.ts`:

```typescript
/**
 * Superpowers workflow profile resolution.
 *
 * Responsibilities:
 * - parse leading workflow tokens from slash command arguments
 * - preserve supported execution flags
 * - merge global defaults, custom command presets, and inline overrides
 *
 * Important side effects:
 * - none; this module is pure and safe to unit test
 */

import type { ExtensionConfig, SuperpowersCommandPreset } from "../shared/types.ts";

export interface SuperpowersWorkflowOverrides {
	useSubagents?: boolean;
	useTestDrivenDevelopment?: boolean;
}

export interface ParsedSuperpowersWorkflowArgs {
	task: string;
	overrides: SuperpowersWorkflowOverrides;
	bg: boolean;
	fork: boolean;
}

export interface ResolvedSuperpowersRunProfile {
	commandName: string;
	task: string;
	useSubagents: boolean;
	useTestDrivenDevelopment: boolean;
	bg: boolean;
	fork: boolean;
}

/**
 * Remove supported execution flags from the end of an argument string.
 *
 * @param rawArgs Raw slash command arguments.
 * @returns Cleaned arguments plus extracted flag values.
 */
function extractExecutionFlags(rawArgs: string): { args: string; bg: boolean; fork: boolean } {
	let args = rawArgs.trim();
	let bg = false;
	let fork = false;

	while (true) {
		if (args.endsWith(" --bg") || args === "--bg") {
			bg = true;
			args = args === "--bg" ? "" : args.slice(0, -5).trim();
			continue;
		}
		if (args.endsWith(" --fork") || args === "--fork") {
			fork = true;
			args = args === "--fork" ? "" : args.slice(0, -7).trim();
			continue;
		}
		break;
	}

	return { args, bg, fork };
}

/**
 * Apply one leading workflow token to an override accumulator.
 *
 * @param token Candidate workflow token.
 * @param overrides Mutable override accumulator.
 * @returns True when the token was consumed.
 */
function applyWorkflowToken(token: string, overrides: SuperpowersWorkflowOverrides): boolean {
	switch (token) {
		case "tdd":
			overrides.useTestDrivenDevelopment = true;
			return true;
		case "direct":
			overrides.useTestDrivenDevelopment = false;
			return true;
		case "subagents":
			overrides.useSubagents = true;
			return true;
		case "no-subagents":
		case "inline":
			overrides.useSubagents = false;
			return true;
		case "full":
			overrides.useSubagents = true;
			overrides.useTestDrivenDevelopment = true;
			return true;
		case "lean":
			overrides.useSubagents = false;
			overrides.useTestDrivenDevelopment = false;
			return true;
		default:
			return false;
	}
}

/**
 * Parse `/superpowers` or custom Superpowers command arguments.
 *
 * @param rawArgs Raw command arguments.
 * @returns Parsed workflow args or null when no task remains.
 */
export function parseSuperpowersWorkflowArgs(rawArgs: string): ParsedSuperpowersWorkflowArgs | null {
	const { args, bg, fork } = extractExecutionFlags(rawArgs);
	const words = args.split(/\s+/).filter(Boolean);
	const overrides: SuperpowersWorkflowOverrides = {};
	let index = 0;
	while (index < words.length && applyWorkflowToken(words[index]!, overrides)) {
		index++;
	}
	const task = words.slice(index).join(" ").trim();
	if (!task) return null;
	return { task, overrides, bg, fork };
}

/**
 * Resolve a custom command preset by registered command name.
 *
 * @param config Effective extension config.
 * @param commandName Slash command name without leading slash.
 * @returns Matching preset or an empty preset.
 */
function resolveCommandPreset(config: ExtensionConfig, commandName: string): SuperpowersCommandPreset {
	if (commandName === "superpowers") return {};
	return config.superagents?.commands?.[commandName] ?? {};
}

/**
 * Merge defaults, command preset, and inline overrides into one run profile.
 *
 * @param input Effective config, command name, and parsed arguments.
 * @returns Fully resolved Superpowers run profile.
 */
export function resolveSuperpowersRunProfile(input: {
	config: ExtensionConfig;
	commandName: string;
	parsed: ParsedSuperpowersWorkflowArgs;
}): ResolvedSuperpowersRunProfile {
	const settings = input.config.superagents ?? {};
	const preset = resolveCommandPreset(input.config, input.commandName);
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
		bg: input.parsed.bg,
		fork: input.parsed.fork,
	};
}
```

- [ ] **Step 4: Run resolver tests to verify pass**

Run:

```bash
node --experimental-strip-types --test test/unit/superpowers-workflow-profile.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit workflow resolver**

Run:

```bash
git add src/superpowers/workflow-profile.ts test/unit/superpowers-workflow-profile.test.ts
git commit -m "feat: resolve superpowers workflow profiles"
```

## Task 3: Root Prompt Bootstrap

**Files:**
- Create: `src/superpowers/root-prompt.ts`
- Create: `test/unit/superpowers-root-prompt.test.ts`
- Modify: `src/shared/skills.ts` if a public helper is needed to resolve one skill by name

- [ ] **Step 1: Write failing root prompt tests**

Create `test/unit/superpowers-root-prompt.test.ts`:

```typescript
/**
 * Unit tests for Superpowers root prompt construction.
 *
 * Responsibilities:
 * - verify using-superpowers bootstrap wording
 * - verify delegation-enabled and delegation-disabled contracts
 * - verify recon-first wording is not reintroduced
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSuperpowersRootPrompt } from "../../src/superpowers/root-prompt.ts";

describe("Superpowers root prompt", () => {
	it("bootstraps using-superpowers and enables delegation when configured", () => {
		const prompt = buildSuperpowersRootPrompt({
			task: "fix auth",
			useSubagents: true,
			useTestDrivenDevelopment: true,
			bg: false,
			fork: false,
			usingSuperpowersSkill: {
				name: "using-superpowers",
				path: "/skills/using-superpowers/SKILL.md",
				content: "USING SUPERPOWERS BODY",
			},
		});

		assert.match(prompt, /This is a Superpowers session/);
		assert.match(prompt, /using-superpowers/);
		assert.match(prompt, /USING SUPERPOWERS BODY/);
		assert.match(prompt, /useSubagents: true/);
		assert.match(prompt, /useTestDrivenDevelopment: true/);
		assert.match(prompt, /Subagent delegation is ENABLED/);
		assert.match(prompt, /must use the `subagent` tool/);
		assert.match(prompt, /Do not use a fixed recon-first workflow/);
		assert.doesNotMatch(prompt, /Start with `sp-recon`/);
	});

	it("forbids subagent tools when delegation is disabled", () => {
		const prompt = buildSuperpowersRootPrompt({
			task: "fix auth",
			useSubagents: false,
			useTestDrivenDevelopment: false,
			bg: true,
			fork: true,
			usingSuperpowersSkill: undefined,
		});

		assert.match(prompt, /useSubagents: false/);
		assert.match(prompt, /useTestDrivenDevelopment: false/);
		assert.match(prompt, /Subagent delegation is DISABLED/);
		assert.match(prompt, /Do not call `subagent` or `subagent_status`/);
		assert.match(prompt, /async: true/);
		assert.match(prompt, /context: "fork"/);
		assert.match(prompt, /using-superpowers could not be resolved/);
	});
});
```

- [ ] **Step 2: Run root prompt tests to verify failure**

Run:

```bash
node --experimental-strip-types --test test/unit/superpowers-root-prompt.test.ts
```

Expected: FAIL with module not found for `src/superpowers/root-prompt.ts`.

- [ ] **Step 3: Create root prompt module**

Create `src/superpowers/root-prompt.ts`:

```typescript
/**
 * Superpowers root-session prompt construction.
 *
 * Responsibilities:
 * - bootstrap the root session through using-superpowers
 * - express resolved workflow settings in model-readable form
 * - keep Superpowers skill selection authoritative instead of forcing recon first
 *
 * Important side effects:
 * - none; callers resolve skill file content before invoking this module
 */

export interface SuperpowersRootPromptSkill {
	name: string;
	path: string;
	content: string;
}

export interface SuperpowersRootPromptInput {
	task: string;
	useSubagents: boolean;
	useTestDrivenDevelopment: boolean;
	bg: boolean;
	fork: boolean;
	usingSuperpowersSkill?: SuperpowersRootPromptSkill;
}

/**
 * Build metadata lines for the root prompt.
 *
 * @param input Resolved Superpowers run profile.
 * @returns Human-readable metadata block.
 */
function buildMetadata(input: SuperpowersRootPromptInput): string {
	const lines = [
		'workflow: "superpowers"',
		`useSubagents: ${input.useSubagents}`,
		`useTestDrivenDevelopment: ${input.useTestDrivenDevelopment}`,
	];
	if (input.bg) {
		lines.push("async: true");
		lines.push("clarify: false");
	}
	if (input.fork) {
		lines.push('context: "fork"');
	}
	return lines.join("\n");
}

/**
 * Build the skill bootstrap block.
 *
 * @param skill Runtime-resolved using-superpowers skill content.
 * @returns Prompt block containing skill body or a warning.
 */
function buildSkillBootstrap(skill: SuperpowersRootPromptSkill | undefined): string {
	if (!skill) {
		return [
			"Required bootstrap skill warning:",
			"`using-superpowers` could not be resolved. State this limitation briefly, then proceed with best-effort Superpowers behavior.",
		].join("\n");
	}
	return [
		"Required bootstrap skill:",
		`Name: ${skill.name}`,
		`Path: ${skill.path}`,
		"",
		"Skill content:",
		"```markdown",
		skill.content,
		"```",
	].join("\n");
}

/**
 * Build the delegation contract block.
 *
 * @param useSubagents Whether subagent delegation is enabled.
 * @returns Prompt block for delegation policy.
 */
function buildDelegationContract(useSubagents: boolean): string {
	if (useSubagents) {
		return [
			"Subagent delegation is ENABLED by config.",
			"When a selected Superpowers skill calls for delegated work, you must use the `subagent` tool rather than doing that delegated work inline.",
			"This applies especially to implementation-plan execution, independent parallel investigations, bounded implementation, review, focused research, and debugging workflows.",
			"Do not skip subagent delegation merely because you can do the work yourself.",
			"Stay inline only for clarification, tiny answer-only tasks, unavailable tools, or when delegation is genuinely inappropriate.",
			"If you do not use a subagent for a non-trivial workflow step, state the concrete reason.",
		].join("\n");
	}
	return [
		"Subagent delegation is DISABLED by config.",
		"Do not call `subagent` or `subagent_status`.",
		"When a selected Superpowers skill would normally dispatch delegated agents, adapt that workflow inline in the root session and briefly note that delegation is disabled by config.",
	].join("\n");
}

/**
 * Build the complete root-session prompt for a Superpowers slash command.
 *
 * @param input Resolved run profile plus optional skill content.
 * @returns Prompt text to send through `pi.sendUserMessage`.
 */
export function buildSuperpowersRootPrompt(input: SuperpowersRootPromptInput): string {
	return [
		"This is a Superpowers session. The `using-superpowers` skill is the workflow bootstrap for this turn.",
		"",
		"Before doing substantive work or asking clarifying questions, follow `using-superpowers` exactly and identify every relevant Superpowers skill for the task.",
		"",
		"Resolved run metadata:",
		buildMetadata(input),
		"",
		buildSkillBootstrap(input.usingSuperpowersSkill),
		"",
		buildDelegationContract(input.useSubagents),
		"",
		"Do not use a fixed recon-first workflow. Use `sp-recon` only when the active skill flow or task shape calls for bounded reconnaissance.",
		"",
		"User task:",
		input.task,
	].join("\n");
}
```

- [ ] **Step 4: Run root prompt tests to verify pass**

Run:

```bash
node --experimental-strip-types --test test/unit/superpowers-root-prompt.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit root prompt builder**

Run:

```bash
git add src/superpowers/root-prompt.ts test/unit/superpowers-root-prompt.test.ts
git commit -m "feat: build superpowers root prompt"
```

## Task 4: Lean Slash Commands And Custom Command Registration

**Files:**
- Modify: `src/slash/slash-commands.ts`
- Modify: `src/extension/index.ts`
- Modify: `test/integration/slash-commands.test.ts`
- Modify: `test/integration/config-gating.test.ts`

- [ ] **Step 1: Replace slash command integration tests**

In `test/integration/slash-commands.test.ts`, remove `/run`, `/chain`, `/parallel`, `/agents`, slash bridge, and inline slash result tests. Keep the mock event bus helpers. Replace the main describe block with:

```typescript
describe("lean Superpowers slash commands", { skip: !available ? "slash-commands.ts not importable" : undefined }, () => {
	beforeEach(() => {
		clearSlashSnapshots?.();
	});

	it("registers only Superpowers commands and configured custom commands", async () => {
		const commands = new Map<string, { handler(args: string, ctx: unknown): Promise<void> }>();
		const pi = {
			events: createEventBus(),
			registerCommand(name: string, spec: { handler(args: string, ctx: unknown): Promise<void> }) {
				commands.set(name, spec);
			},
			registerShortcut() {},
			sendMessage() {},
			sendUserMessage() {},
		};
		const state = createState(process.cwd());
		state.configGate = {
			blocked: false,
			diagnostics: [],
			message: "",
		};

		registerSlashCommands!(pi, state, {
			superagents: {
				useSubagents: true,
				useTestDrivenDevelopment: true,
				commands: {
					"superpowers-lean": {
						description: "Lean mode",
						useSubagents: false,
						useTestDrivenDevelopment: false,
					},
				},
			},
		});

		assert.deepEqual([...commands.keys()].sort(), [
			"superpowers",
			"superpowers-lean",
			"superpowers-status",
		]);
	});

	it("/superpowers sends a root-session prompt with resolved defaults", async () => {
		const userMessages: Array<{ content: string | unknown[]; options?: { deliverAs?: "steer" | "followUp" } }> = [];
		const commands = new Map<string, { handler(args: string, ctx: unknown): Promise<void> }>();
		const pi = {
			events: createEventBus(),
			registerCommand(name: string, spec: { handler(args: string, ctx: unknown): Promise<void> }) {
				commands.set(name, spec);
			},
			registerShortcut() {},
			sendMessage() {},
			sendUserMessage(content: string | unknown[], options?: { deliverAs?: "steer" | "followUp" }) {
				userMessages.push({ content, options });
			},
		};

		registerSlashCommands!(pi, createState(process.cwd()), {
			superagents: {
				useSubagents: true,
				useTestDrivenDevelopment: true,
				commands: {},
			},
		});
		await commands.get("superpowers")!.handler("fix auth", createCommandContext());

		assert.equal(userMessages.length, 1);
		const prompt = String(userMessages[0]!.content);
		assert.match(prompt, /workflow:\s*"superpowers"/);
		assert.match(prompt, /useSubagents:\s*true/);
		assert.match(prompt, /useTestDrivenDevelopment:\s*true/);
		assert.match(prompt, /using-superpowers/);
		assert.doesNotMatch(prompt, /Start with `sp-recon`/);
	});

	it("custom commands apply presets and inline tokens override them", async () => {
		const userMessages: Array<{ content: string | unknown[]; options?: { deliverAs?: "steer" | "followUp" } }> = [];
		const commands = new Map<string, { handler(args: string, ctx: unknown): Promise<void> }>();
		const pi = {
			events: createEventBus(),
			registerCommand(name: string, spec: { handler(args: string, ctx: unknown): Promise<void> }) {
				commands.set(name, spec);
			},
			registerShortcut() {},
			sendMessage() {},
			sendUserMessage(content: string | unknown[], options?: { deliverAs?: "steer" | "followUp" }) {
				userMessages.push({ content, options });
			},
		};

		registerSlashCommands!(pi, createState(process.cwd()), {
			superagents: {
				useSubagents: true,
				useTestDrivenDevelopment: true,
				commands: {
					"superpowers-lean": {
						useSubagents: false,
						useTestDrivenDevelopment: false,
					},
				},
			},
		});
		await commands.get("superpowers-lean")!.handler("tdd fix auth", createCommandContext());

		assert.equal(userMessages.length, 1);
		const prompt = String(userMessages[0]!.content);
		assert.match(prompt, /useSubagents:\s*false/);
		assert.match(prompt, /useTestDrivenDevelopment:\s*true/);
	});

	it("/superpowers-status opens the status and settings overlay", async () => {
		const commands = new Map<string, { handler(args: string, ctx: unknown): Promise<void> }>();
		let customCalls = 0;
		const pi = {
			events: createEventBus(),
			registerCommand(name: string, spec: { handler(args: string, ctx: unknown): Promise<void> }) {
				commands.set(name, spec);
			},
			registerShortcut() {},
			sendMessage() {},
			sendUserMessage() {},
		};

		registerSlashCommands!(pi, createState(process.cwd()), {
			superagents: {
				useSubagents: true,
				useTestDrivenDevelopment: true,
			},
		});

		await commands.get("superpowers-status")!.handler("", createCommandContext({
			hasUI: true,
			custom: async () => {
				customCalls++;
				return undefined;
			},
		}));

		assert.equal(customCalls, 1);
	});
});
```

Update the `RegisterSlashCommandsModule` interface in that test so `registerSlashCommands` accepts the third `ExtensionConfig` argument:

```typescript
state: {
	/* existing test state fields */
	configGate: { blocked: boolean; diagnostics: unknown[]; message: string };
},
config: import("../../src/shared/types.ts").ExtensionConfig,
```

- [ ] **Step 2: Run slash tests to verify failure**

Run:

```bash
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/slash-commands.test.ts
```

Expected: FAIL because generic commands are still registered and `registerSlashCommands` does not accept config.

- [ ] **Step 3: Simplify slash command registration**

In `src/slash/slash-commands.ts`, remove imports for agent discovery, Agents Manager, slash bridge types, slash live state helpers, `MAX_PARALLEL`, and `SLASH_*` constants that only support generic slash result rendering.

Keep imports for `ExtensionAPI`, `ExtensionContext`, `SubagentState`, and add:

```typescript
import type { ExtensionConfig } from "../shared/types.ts";
import { SuperpowersStatusComponent } from "../ui/superpowers-status.ts";
import { parseSuperpowersWorkflowArgs, resolveSuperpowersRunProfile, type ResolvedSuperpowersRunProfile } from "../superpowers/workflow-profile.ts";
import { buildSuperpowersRootPrompt } from "../superpowers/root-prompt.ts";
```

Replace the `registerSlashCommands` signature with:

```typescript
export function registerSlashCommands(
	pi: ExtensionAPI,
	state: SubagentState,
	config: ExtensionConfig,
): void {
```

Add this helper:

```typescript
async function sendSuperpowersPrompt(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	profile: ResolvedSuperpowersRunProfile,
): Promise<void> {
	const prompt = buildSuperpowersRootPrompt({
		task: profile.task,
		useSubagents: profile.useSubagents,
		useTestDrivenDevelopment: profile.useTestDrivenDevelopment,
		bg: profile.bg,
		fork: profile.fork,
		usingSuperpowersSkill: undefined,
	});
	if (ctx.isIdle()) {
		pi.sendUserMessage(prompt);
		return;
	}
	pi.sendUserMessage(prompt, { deliverAs: "followUp" });
	if (ctx.hasUI) ctx.ui.notify("Queued Superpowers workflow as a follow-up", "info");
}
```

Add this helper:

```typescript
function registerSuperpowersCommand(
	pi: ExtensionAPI,
	state: SubagentState,
	config: ExtensionConfig,
	commandName: string,
	description: string,
): void {
	pi.registerCommand(commandName, {
		description,
		handler: async (rawArgs, ctx) => {
			if (notifyIfConfigBlocked(state, ctx)) return;
			const parsed = parseSuperpowersWorkflowArgs(rawArgs);
			if (!parsed?.task) {
				ctx.ui.notify(`Usage: /${commandName} [lean|full|tdd|direct|subagents|no-subagents] <task> [--bg] [--fork]`, "error");
				return;
			}
			const profile = resolveSuperpowersRunProfile({ config, commandName, parsed });
			await sendSuperpowersPrompt(pi, ctx, profile);
		},
	});
}
```

Inside `registerSlashCommands`, replace all command registration with:

```typescript
registerSuperpowersCommand(
	pi,
	state,
	config,
	"superpowers",
	"Run a Superpowers workflow: /superpowers [lean|full|tdd|direct|subagents|no-subagents] <task> [--bg] [--fork]",
);

for (const [commandName, preset] of Object.entries(config.superagents?.commands ?? {})) {
	registerSuperpowersCommand(
		pi,
		state,
		config,
		commandName,
		preset.description ?? `Run Superpowers using the ${commandName} preset`,
	);
}

pi.registerCommand("superpowers-status", {
	description: "Show Superpowers run status and settings",
	handler: async (_args, ctx) => {
		await ctx.ui.custom<void>(
			(tui, theme, _kb, done) => new SuperpowersStatusComponent(tui, theme, state, config, () => done(undefined)),
			{ overlay: true, overlayOptions: { anchor: "center", width: 92, maxHeight: "80%" } },
		);
	},
});
```

- [ ] **Step 4: Update extension slash registration call**

In `src/extension/index.ts`, replace:

```typescript
registerSlashCommands(pi, state);
```

with:

```typescript
registerSlashCommands(pi, state, config);
```

Remove `registerSlashSubagentBridge` and `registerPromptTemplateDelegationBridge` imports and setup. Remove shutdown calls to `slashBridge.dispose()` and `promptTemplateBridge.dispose()`.

- [ ] **Step 5: Add temporary Superpowers status component**

Create `src/ui/superpowers-status.ts` with a minimal component so slash tests pass. This component will be expanded in Task 8.

```typescript
/**
 * Superpowers status and settings overlay.
 *
 * Responsibilities:
 * - display current Superpowers config defaults
 * - display config diagnostics
 * - provide a focused replacement for the generic Agents Manager
 *
 * Important side effects:
 * - none in the first pass; later tasks may add safe config writing
 */

import { Container, Text } from "@mariozechner/pi-tui";
import type { ExtensionConfig, SubagentState } from "../shared/types.ts";

/**
 * Focused Superpowers status/settings TUI component.
 */
export class SuperpowersStatusComponent extends Container {
	constructor(
		_tui: unknown,
		_theme: unknown,
		private readonly state: SubagentState,
		private readonly config: ExtensionConfig,
		private readonly done: () => void,
	) {
		super();
	}

	/**
	 * Render current Superpowers status and config details.
	 *
	 * @param width Available terminal width.
	 * @returns Rendered lines.
	 */
	override render(width: number): string[] {
		this.clear();
		const settings = this.config.superagents ?? {};
		const lines = [
			"Superpowers",
			"",
			`useSubagents: ${settings.useSubagents ?? true}`,
			`useTestDrivenDevelopment: ${settings.useTestDrivenDevelopment ?? true}`,
			`customCommands: ${Object.keys(settings.commands ?? {}).length}`,
			`configStatus: ${this.state.configGate.blocked ? "blocked" : "valid"}`,
		];
		if (this.state.configGate.message) {
			lines.push("", this.state.configGate.message);
		}
		this.addChild(new Text(lines.join("\n"), 0, 0));
		return Container.prototype.render.call(this, width);
	}

	/**
	 * Close the overlay.
	 */
	close(): void {
		this.done();
	}
}
```

- [ ] **Step 6: Run slash tests to verify pass**

Run:

```bash
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/slash-commands.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit lean slash commands**

Run:

```bash
git add src/slash/slash-commands.ts src/extension/index.ts src/ui/superpowers-status.ts test/integration/slash-commands.test.ts test/integration/config-gating.test.ts
git commit -m "feat: expose lean superpowers slash commands"
```

## Task 5: Root Skill Resolution Integration

**Files:**
- Modify: `src/shared/skills.ts`
- Modify: `src/slash/slash-commands.ts`
- Modify: `test/unit/superpowers-root-prompt.test.ts`
- Modify: `test/integration/slash-commands.test.ts`

- [ ] **Step 1: Add tests for resolved skill content in slash prompt**

In `test/integration/slash-commands.test.ts`, add this assertion to `/superpowers sends a root-session prompt with resolved defaults` after the existing `using-superpowers` assertion:

```typescript
assert.match(prompt, /Required bootstrap skill/);
```

In `test/unit/superpowers-root-prompt.test.ts`, keep the existing test that injects `USING SUPERPOWERS BODY`.

- [ ] **Step 2: Run tests to verify current limitation**

Run:

```bash
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/slash-commands.test.ts
```

Expected: PASS if the prompt includes a warning block, or FAIL if the prompt omitted the bootstrap block during Task 4. Continue either way; the next step adds real skill resolution.

- [ ] **Step 3: Add skill resolution helper**

In `src/shared/skills.ts`, add:

```typescript
/**
 * Resolve one available skill by exact name.
 *
 * @param cwd Current working directory used for project skill discovery.
 * @param name Skill name to resolve.
 * @returns Resolved skill or undefined when unavailable.
 */
export function resolveAvailableSkill(cwd: string, name: string): ResolvedSkill | undefined {
	const available = discoverAvailableSkills(cwd);
	return available.find((skill) => skill.name === name);
}
```

- [ ] **Step 4: Wire skill resolution into slash command prompt**

In `src/slash/slash-commands.ts`, import:

```typescript
import { resolveAvailableSkill } from "../shared/skills.ts";
```

In `sendSuperpowersPrompt`, before building the prompt:

```typescript
const usingSuperpowersSkill = resolveAvailableSkill(ctx.cwd, "using-superpowers");
```

Pass it into `buildSuperpowersRootPrompt`:

```typescript
usingSuperpowersSkill,
```

- [ ] **Step 5: Run root prompt and slash tests**

Run:

```bash
node --experimental-strip-types --test test/unit/superpowers-root-prompt.test.ts
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/slash-commands.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit skill bootstrap integration**

Run:

```bash
git add src/shared/skills.ts src/slash/slash-commands.ts test/unit/superpowers-root-prompt.test.ts test/integration/slash-commands.test.ts
git commit -m "feat: bootstrap using-superpowers in root prompt"
```

## Task 6: Narrow Public Tool Schema And Executor Dispatcher

**Files:**
- Modify: `src/shared/schemas.ts`
- Modify: `src/execution/subagent-executor.ts`
- Modify: `src/extension/index.ts`
- Modify: `test/unit/schemas.test.ts`
- Modify: `test/integration/config-gating.test.ts`

- [ ] **Step 1: Write failing schema tests**

In `test/unit/schemas.test.ts`, add tests that inspect the TypeBox schema object:

```typescript
it("does not expose generic management actions on the subagent schema", () => {
	const properties = (SubagentParams as { properties?: Record<string, unknown> }).properties ?? {};
	assert.equal("action" in properties, false);
	assert.equal("chainName" in properties, false);
	assert.equal("config" in properties, false);
});

it("keeps only Superpowers role execution fields", () => {
	const properties = (SubagentParams as { properties?: Record<string, unknown> }).properties ?? {};
	assert.equal("agent" in properties, true);
	assert.equal("task" in properties, true);
	assert.equal("tasks" in properties, true);
	assert.equal("workflow" in properties, true);
	assert.equal("useTestDrivenDevelopment" in properties, true);
	assert.equal("implementerMode" in properties, false);
	assert.equal("chain" in properties, false);
	assert.equal("share" in properties, false);
});
```

- [ ] **Step 2: Run schema tests to verify failure**

Run:

```bash
node --experimental-strip-types --test test/unit/schemas.test.ts
```

Expected: FAIL because the current schema still exposes management, chain, share, and `implementerMode`.

- [ ] **Step 3: Replace `SubagentParams` public schema**

In `src/shared/schemas.ts`, remove `SequentialStepSchema`, `ParallelStepSchema`, and `ChainItem` exports if no retained tests import them. Replace `TaskItem` and `SubagentParams` with:

```typescript
export const SuperpowersRoleNameSchema = Type.String({
	description: "Superpowers role agent name: sp-recon, sp-research, sp-implementer, sp-spec-review, sp-code-review, or sp-debug.",
});

export const TaskItem = Type.Object({
	agent: SuperpowersRoleNameSchema,
	task: Type.String(),
	cwd: Type.Optional(Type.String()),
	model: Type.Optional(Type.String({ description: "Override model for this Superpowers role task." })),
	skill: Type.Optional(SkillOverride),
});

export const SubagentParams = Type.Object({
	agent: Type.Optional(SuperpowersRoleNameSchema),
	task: Type.Optional(Type.String({ description: "Task for a single Superpowers role agent." })),
	workflow: Type.Optional(Type.String({
		enum: ["superpowers"],
		description: "Superpowers role execution. Generic subagent workflows are not part of this package.",
	})),
	useTestDrivenDevelopment: Type.Optional(Type.Boolean({
		description: "Whether sp-implementer should receive test-driven-development guidance when available.",
	})),
	tasks: Type.Optional(Type.Array(TaskItem, {
		description: "Parallel Superpowers role tasks selected by the root Superpowers workflow.",
	})),
	context: Type.Optional(Type.String({
		enum: ["fresh", "fork"],
		description: "'fresh' or 'fork' to branch from parent session.",
	})),
	cwd: Type.Optional(Type.String()),
	async: Type.Optional(Type.Boolean({ description: "Run in background when supported by the runtime." })),
	artifacts: Type.Optional(Type.Boolean({ description: "Write debug artifacts." })),
	includeProgress: Type.Optional(Type.Boolean({ description: "Include full progress in result." })),
	sessionDir: Type.Optional(Type.String({ description: "Directory to store session logs." })),
	skill: Type.Optional(SkillOverride),
	model: Type.Optional(Type.String({ description: "Override model for single Superpowers role execution." })),
});
```

- [ ] **Step 4: Remove management action handling from extension status tool text**

In `src/extension/index.ts`, update the `subagent` tool description to remove management and generic chain examples. Use:

```typescript
description: `Delegate bounded work to Superpowers role subagents.

Use this tool only inside a Superpowers workflow when selected skills call for delegation.

SINGLE: { agent: "sp-recon", task: "Inspect the auth flow" }
PARALLEL: { tasks: [{ agent: "sp-research", task: "Check config" }, { agent: "sp-code-review", task: "Review diff" }] }

Allowed role agents: sp-recon, sp-research, sp-implementer, sp-spec-review, sp-code-review, sp-debug.
Bounded role agents are not allowed to call subagents.`,
```

- [ ] **Step 5: Remove management dispatcher branches**

In `src/execution/subagent-executor.ts`, remove the branch that checks `params.action`. Remove imports that only support management actions from `src/agents/agent-management.ts`. Keep single and `tasks` execution branches. If the executor still supports `chain`, leave that branch unreachable from the schema in this task and remove it in Task 10.

- [ ] **Step 6: Run schema and config gating tests**

Run:

```bash
node --experimental-strip-types --test test/unit/schemas.test.ts
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/config-gating.test.ts
```

Expected: PASS after updating config-gating expectations from `/run` to `/superpowers`.

- [ ] **Step 7: Commit narrowed tool contract**

Run:

```bash
git add src/shared/schemas.ts src/execution/subagent-executor.ts src/extension/index.ts test/unit/schemas.test.ts test/integration/config-gating.test.ts
git commit -m "feat: narrow subagent tool to superpowers roles"
```

## Task 7: TDD Policy And Role Agent Model Tiers

**Files:**
- Modify: `src/execution/superpowers-policy.ts`
- Modify: `src/execution/execution.ts`
- Modify: `src/execution/async-execution.ts` if retained
- Modify: `src/execution/subagent-runner.ts` if retained
- Modify: `src/execution/subagent-executor.ts`
- Modify: `test/unit/superpowers-policy.test.ts`
- Modify: `test/integration/parallel-execution.test.ts`

- [ ] **Step 1: Update policy tests**

In `test/unit/superpowers-policy.test.ts`, replace the implementer-mode test with:

```typescript
it("adds test-driven-development only when useTestDrivenDevelopment is true", () => {
	assert.deepEqual(
		resolveImplementerSkillSet({
			workflow: "superpowers",
			useTestDrivenDevelopment: true,
			config: {},
			agentSkills: [],
			stepSkills: [],
			availableSkills: new Set(["test-driven-development"]),
		}),
		["test-driven-development"],
	);
	assert.deepEqual(
		resolveImplementerSkillSet({
			workflow: "superpowers",
			useTestDrivenDevelopment: false,
			config: {},
			agentSkills: [],
			stepSkills: [],
			availableSkills: new Set(["test-driven-development"]),
		}),
		[],
	);
});
```

Keep the existing `resolveModelForAgent` tier tests. Add this test to make the role-agent-frontmatter decision explicit:

```typescript
it("resolves sp role agent frontmatter model tiers without role config", () => {
	assert.deepEqual(
		resolveModelForAgent({
			workflow: "superpowers",
			agentModel: "balanced",
			config: {
				superagents: {
					modelTiers: {
						balanced: {
							model: "openai/gpt-5.4",
							thinking: "medium",
						},
					},
				},
			},
		}),
		{ model: "openai/gpt-5.4", thinking: "medium" },
	);
});
```

- [ ] **Step 2: Run policy tests to verify failure**

Run:

```bash
node --experimental-strip-types --test test/unit/superpowers-policy.test.ts
```

Expected: FAIL because `resolveImplementerSkillSet` still requires `implementerMode`.

- [ ] **Step 3: Update policy types**

In `src/execution/superpowers-policy.ts`, remove the `SuperpowersImplementerMode` import. Do not add model settings under `superagents`. Role agent model choices remain in each `agents/sp-*.md` frontmatter `model` field, and `resolveModelForAgent` continues to resolve those values through `superagents.modelTiers`.

Replace `resolveImplementerSkillSet` signature with:

```typescript
export function resolveImplementerSkillSet(input: {
	workflow: WorkflowMode;
	useTestDrivenDevelopment: boolean;
	config: ExtensionConfig;
	agentSkills: string[];
	stepSkills: string[];
	availableSkills: ReadonlySet<string>;
}): string[] {
```

Replace the mode check with:

```typescript
if (input.workflow !== "superpowers" || !input.useTestDrivenDevelopment) return base;
```

- [ ] **Step 4: Thread boolean TDD through execution callers**

Replace every `implementerMode` property in runtime parameter types and call sites with `useTestDrivenDevelopment`. For each old condition:

```typescript
implementerMode: params.implementerMode ?? "tdd"
```

use:

```typescript
useTestDrivenDevelopment: params.useTestDrivenDevelopment ?? true
```

When calling `resolveImplementerSkillSet`, pass:

```typescript
useTestDrivenDevelopment: options.useTestDrivenDevelopment ?? true,
```

- [ ] **Step 5: Preserve Superpowers worktree defaults**

Keep `resolveSuperagentWorktreeEnabled`, `applySuperagentWorktreeDefaultsToChain`, `resolveSuperagentWorktreeRuntimeOptions`, and `resolveSuperagentWorktreeCreateOptions` in `src/execution/superagents-config.ts`. Update their doc headers from generic Superagents wording to Superpowers wording, but do not remove behavior.

Add or keep a test in `test/integration/parallel-execution.test.ts` or `test/unit/worktree.test.ts` that exercises `workflow: "superpowers"` with `superagents.worktrees.enabled: true` and verifies parallel role execution still requests worktree setup.

- [ ] **Step 6: Run policy, worktree, and execution tests**

Run:

```bash
node --experimental-strip-types --test test/unit/superpowers-policy.test.ts test/unit/worktree.test.ts
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/single-execution.test.ts test/integration/parallel-execution.test.ts
```

Expected: PASS after updating test expectations from `implementerMode` to `useTestDrivenDevelopment` and preserving Superpowers worktree defaults.

- [ ] **Step 7: Commit policy update**

Run:

```bash
git add src/execution/superpowers-policy.ts src/execution/superagents-config.ts src/execution/execution.ts src/execution/async-execution.ts src/execution/subagent-runner.ts src/execution/subagent-executor.ts test/unit/superpowers-policy.test.ts test/unit/worktree.test.ts test/integration/single-execution.test.ts test/integration/parallel-execution.test.ts
git commit -m "feat: preserve superpowers tdd and worktree policy"
```

## Task 8: Focused Superpowers Status And Settings TUI

**Files:**
- Modify: `src/ui/superpowers-status.ts`
- Modify: `test/integration/slash-commands.test.ts`

- [ ] **Step 1: Add focused TUI render test**

In `test/integration/slash-commands.test.ts`, add:

```typescript
it("renders Superpowers defaults, worktrees, model tiers, and custom commands in the status component", async () => {
	const module = await import("../../src/ui/superpowers-status.ts") as {
		SuperpowersStatusComponent: new (...args: unknown[]) => { render(width: number): string[] };
	};
	const component = new module.SuperpowersStatusComponent(
		{},
		{},
		createState(process.cwd()),
		{
			superagents: {
				useSubagents: false,
				useTestDrivenDevelopment: true,
				commands: {
					"superpowers-lean": {
						description: "Lean mode",
						useSubagents: false,
						useTestDrivenDevelopment: false,
					},
				},
				worktrees: {
					enabled: true,
					root: "/tmp/superpowers-worktrees",
				},
				modelTiers: {
					cheap: { model: "opencode-go/minimax-m2.7" },
					balanced: { model: "opencode-go/glm-5.1" },
				},
			},
		},
		() => {},
	);

	const rendered = component.render(100).join("\n");
	assert.match(rendered, /useSubagents: false/);
	assert.match(rendered, /useTestDrivenDevelopment: true/);
	assert.match(rendered, /superpowers-lean/);
	assert.match(rendered, /worktrees.enabled: true/);
	assert.match(rendered, /worktrees.root: \/tmp\/superpowers-worktrees/);
	assert.match(rendered, /cheap: opencode-go\/minimax-m2.7/);
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/slash-commands.test.ts
```

Expected: FAIL because the temporary component does not list commands, worktrees, or model tiers.

- [ ] **Step 3: Expand status component rendering**

In `src/ui/superpowers-status.ts`, update `render` lines to include commands, worktrees, and model tiers:

```typescript
const commands = Object.entries(settings.commands ?? {});
const modelTiers = Object.entries(settings.modelTiers ?? {});
const tierModel = (value: unknown): string => {
	if (typeof value === "string") return value;
	if (value && typeof value === "object" && "model" in value) {
		return String((value as { model?: unknown }).model ?? "unknown");
	}
	return "unknown";
};
const lines = [
	"Superpowers",
	"",
	`useSubagents: ${settings.useSubagents ?? true}`,
	`useTestDrivenDevelopment: ${settings.useTestDrivenDevelopment ?? true}`,
	`configStatus: ${this.state.configGate.blocked ? "blocked" : "valid"}`,
	`worktrees.enabled: ${settings.worktrees?.enabled ?? false}`,
	`worktrees.root: ${settings.worktrees?.root ?? "default"}`,
	"",
	"Commands:",
	...(commands.length
		? commands.map(([name, preset]) => `- ${name}: subagents=${preset.useSubagents ?? "default"}, tdd=${preset.useTestDrivenDevelopment ?? "default"}`)
		: ["- none"]),
	"",
	"Model tiers:",
	...(modelTiers.length
		? modelTiers.map(([name, value]) => `- ${name}: ${tierModel(value)}`)
		: ["- none"]),
];
```

- [ ] **Step 4: Run TUI/slash tests**

Run:

```bash
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/slash-commands.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit focused status TUI**

Run:

```bash
git add src/ui/superpowers-status.ts test/integration/slash-commands.test.ts
git commit -m "feat: show superpowers status and settings"
```

## Task 9: Safe Settings Writes And TUI Keybindings

**Files:**
- Create: `src/superpowers/config-writer.ts`
- Create: `test/unit/superpowers-config-writer.test.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/extension/index.ts`
- Modify: `src/ui/superpowers-status.ts`
- Modify: `test/integration/slash-commands.test.ts`

- [ ] **Step 1: Write failing config writer tests**

Create `test/unit/superpowers-config-writer.test.ts`:

```typescript
/**
 * Unit tests for safe Superpowers config text updates.
 *
 * Responsibilities:
 * - verify status TUI toggles update only Superpowers settings
 * - verify empty config files become valid override JSON
 * - verify malformed JSON produces explicit write errors
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	toggleSuperpowersBoolean,
	toggleSuperpowersWorktrees,
	updateSuperpowersConfigText,
} from "../../src/superpowers/config-writer.ts";

describe("Superpowers config writer", () => {
	it("toggles useSubagents without changing other settings", () => {
		const updated = updateSuperpowersConfigText(
			'{\n  "superagents": {\n    "useSubagents": true,\n    "useTestDrivenDevelopment": true\n  }\n}\n',
			(config) => toggleSuperpowersBoolean(config, "useSubagents"),
		);
		assert.deepEqual(JSON.parse(updated), {
			superagents: {
				useSubagents: false,
				useTestDrivenDevelopment: true,
			},
		});
	});

	it("creates superagents settings from an empty override", () => {
		const updated = updateSuperpowersConfigText("{}", (config) =>
			toggleSuperpowersBoolean(config, "useTestDrivenDevelopment"),
		);
		assert.deepEqual(JSON.parse(updated), {
			superagents: {
				useTestDrivenDevelopment: false,
			},
		});
	});

	it("toggles Superpowers worktrees without changing model tiers", () => {
		const updated = updateSuperpowersConfigText(
			'{\n  "superagents": {\n    "worktrees": { "enabled": false, "root": null },\n    "modelTiers": { "cheap": { "model": "a" } }\n  }\n}\n',
			(config) => toggleSuperpowersWorktrees(config),
		);
		assert.deepEqual(JSON.parse(updated), {
			superagents: {
				worktrees: { enabled: true, root: null },
				modelTiers: { cheap: { model: "a" } },
			},
		});
	});

	it("throws a readable error for malformed JSON", () => {
		assert.throws(
			() => updateSuperpowersConfigText("{", (config) => config),
			/Superpowers config is not valid JSON/,
		);
	});
});
```

- [ ] **Step 2: Run writer tests to verify failure**

Run:

```bash
node --experimental-strip-types --test test/unit/superpowers-config-writer.test.ts
```

Expected: FAIL with module not found for `src/superpowers/config-writer.ts`.

- [ ] **Step 3: Create safe config writer**

Create `src/superpowers/config-writer.ts`:

```typescript
/**
 * Safe text updates for Superpowers JSON config files.
 *
 * Responsibilities:
 * - parse user config text as JSON
 * - update only the Superpowers settings object
 * - serialize stable two-space JSON for TUI-initiated edits
 *
 * Important side effects:
 * - none; callers perform filesystem writes
 */

import type { ExtensionConfig } from "../shared/types.ts";

type MutableConfig = ExtensionConfig & {
	superagents?: NonNullable<ExtensionConfig["superagents"]>;
};

/**
 * Ensure a mutable Superpowers settings object exists.
 *
 * @param config Config object being edited.
 * @returns Mutable Superpowers settings.
 */
function ensureSuperagents(config: MutableConfig): NonNullable<ExtensionConfig["superagents"]> {
	config.superagents ??= {};
	return config.superagents;
}

/**
 * Parse, update, and serialize Superpowers config text.
 *
 * @param rawText Existing config file text.
 * @param update Pure update function.
 * @returns Formatted JSON text ending with a newline.
 */
export function updateSuperpowersConfigText(
	rawText: string,
	update: (config: MutableConfig) => MutableConfig,
): string {
	let parsed: unknown;
	try {
		parsed = rawText.trim() ? JSON.parse(rawText) : {};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Superpowers config is not valid JSON: ${message}`);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("Superpowers config must be a JSON object.");
	}
	const updated = update(parsed as MutableConfig);
	return `${JSON.stringify(updated, null, 2)}\n`;
}

/**
 * Toggle one boolean Superpowers setting in a config object.
 *
 * @param config Mutable config object.
 * @param key Boolean setting name.
 * @returns The same config object after mutation.
 */
export function toggleSuperpowersBoolean(
	config: MutableConfig,
	key: "useSubagents" | "useTestDrivenDevelopment",
): MutableConfig {
	const settings = ensureSuperagents(config);
	settings[key] = !(settings[key] ?? true);
	return config;
}

/**
 * Toggle Superpowers worktree isolation in a config object.
 *
 * @param config Mutable config object.
 * @returns The same config object after mutation.
 */
export function toggleSuperpowersWorktrees(config: MutableConfig): MutableConfig {
	const settings = ensureSuperagents(config);
	settings.worktrees ??= {};
	settings.worktrees.enabled = !(settings.worktrees.enabled ?? false);
	return config;
}
```

- [ ] **Step 4: Run writer tests to verify pass**

Run:

```bash
node --experimental-strip-types --test test/unit/superpowers-config-writer.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add config paths to shared state**

In `src/shared/types.ts`, extend `ConfigGateState`:

```typescript
export interface ConfigGateState {
	blocked: boolean;
	diagnostics: ConfigDiagnostic[];
	message: string;
	configPath?: string;
	examplePath?: string;
}
```

In `src/extension/index.ts`, update state creation:

```typescript
configGate: {
	blocked: configState.blocked,
	diagnostics: configState.diagnostics,
	message: configState.message,
	configPath: configState.configPath,
	examplePath: configState.examplePath,
},
```

- [ ] **Step 6: Add TUI write methods**

In `src/ui/superpowers-status.ts`, import filesystem helpers and writer functions:

```typescript
import * as fs from "node:fs";
import {
	toggleSuperpowersBoolean,
	toggleSuperpowersWorktrees,
	updateSuperpowersConfigText,
} from "../superpowers/config-writer.ts";
```

Add this field to the component:

```typescript
private lastWriteMessage = "";
```

Add this method:

```typescript
/**
 * Apply a safe JSON config update from a TUI action.
 *
 * @param update Update function to apply to the parsed config.
 */
private writeConfig(update: Parameters<typeof updateSuperpowersConfigText>[1]): void {
	const configPath = this.state.configGate.configPath;
	if (!configPath) {
		this.lastWriteMessage = "Config path is unavailable. Restart Pi and try again.";
		return;
	}
	try {
		const current = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf-8") : "{}\n";
		const next = updateSuperpowersConfigText(current, update);
		fs.writeFileSync(configPath, next, "utf-8");
		this.lastWriteMessage = `Wrote ${configPath}. Restart or reload Pi to apply command registration changes.`;
	} catch (error) {
		this.lastWriteMessage = error instanceof Error ? error.message : String(error);
	}
}
```

Add public methods for tests and keybindings:

```typescript
/**
 * Toggle the persisted useSubagents override.
 */
toggleUseSubagents(): void {
	this.writeConfig((config) => toggleSuperpowersBoolean(config, "useSubagents"));
}

/**
 * Toggle the persisted useTestDrivenDevelopment override.
 */
toggleUseTestDrivenDevelopment(): void {
	this.writeConfig((config) => toggleSuperpowersBoolean(config, "useTestDrivenDevelopment"));
}

/**
 * Toggle the persisted Superpowers worktree default.
 */
toggleWorktrees(): void {
	this.writeConfig((config) => toggleSuperpowersWorktrees(config));
}
```

Import `matchesKey`:

```typescript
import { Container, Text, matchesKey } from "@mariozechner/pi-tui";
```

Add this method to `SuperpowersStatusComponent`:

```typescript
/**
 * Handle status/settings overlay key input.
 *
 * @param data Raw key input from Pi TUI.
 */
handleInput(data: string): void {
	if (matchesKey(data, "escape") || matchesKey(data, "q") || matchesKey(data, "ctrl+c")) {
		this.close();
		return;
	}
	if (matchesKey(data, "s")) {
		this.toggleUseSubagents();
		return;
	}
	if (matchesKey(data, "t")) {
		this.toggleUseTestDrivenDevelopment();
		return;
	}
	if (matchesKey(data, "w")) {
		this.toggleWorktrees();
	}
}
```

- [ ] **Step 7: Add TUI write integration test**

In `test/integration/slash-commands.test.ts`, add a test that creates a temp config file and calls the component methods:

```typescript
it("writes Superpowers setting toggles to the config file", async () => {
	const fs = await import("node:fs");
	const os = await import("node:os");
	const path = await import("node:path");
	const module = await import("../../src/ui/superpowers-status.ts") as {
		SuperpowersStatusComponent: new (...args: unknown[]) => {
			toggleUseSubagents(): void;
			toggleWorktrees(): void;
		};
	};
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "superpowers-config-"));
	const configPath = path.join(dir, "config.json");
	fs.writeFileSync(configPath, '{\n  "superagents": { "useSubagents": true, "worktrees": { "enabled": false } }\n}\n', "utf-8");
	const state = createState(process.cwd());
	state.configGate.configPath = configPath;

	const component = new module.SuperpowersStatusComponent(
		{},
		{},
		state,
		{ superagents: { useSubagents: true, worktrees: { enabled: false } } },
		() => {},
	);
	component.toggleUseSubagents();
	component.toggleWorktrees();

	assert.deepEqual(JSON.parse(fs.readFileSync(configPath, "utf-8")), {
		superagents: {
			useSubagents: false,
			worktrees: { enabled: true },
		},
	});
});
```

- [ ] **Step 8: Run writer and slash tests**

Run:

```bash
node --experimental-strip-types --test test/unit/superpowers-config-writer.test.ts
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/slash-commands.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit settings writer**

Run:

```bash
git add src/superpowers/config-writer.ts src/shared/types.ts src/extension/index.ts src/ui/superpowers-status.ts test/unit/superpowers-config-writer.test.ts test/integration/slash-commands.test.ts
git commit -m "feat: edit superpowers settings from status tui"
```

## Task 10: Remove Generic Slash Bridges, Prompt Template Bridge, Agents Manager, And Builtins

**Files:**
- Delete: `src/slash/prompt-template-bridge.ts`
- Delete: `src/slash/slash-bridge.ts`
- Delete: `src/agents/agent-manager.ts`
- Delete: `src/agents/agent-manager-list.ts`
- Delete: `src/agents/agent-manager-detail.ts`
- Delete: `src/agents/agent-manager-edit.ts`
- Delete: `src/agents/agent-manager-chain-detail.ts`
- Delete: `src/agents/agent-manager-parallel.ts`
- Delete: `src/agents/agent-management.ts`
- Delete: `src/agents/agent-templates.ts`
- Delete: `src/ui/chain-clarify.ts`
- Delete: `agents/delegate.md`
- Delete: `agents/sp-task-loop.chain.md`
- Delete: `test/unit/prompt-template-bridge.test.ts`
- Modify: files with broken imports after deletion

- [ ] **Step 1: Confirm import graph before deletion**

Run:

```bash
rg -n "prompt-template-bridge|slash-bridge|agent-manager|agent-management|agent-templates|chain-clarify|delegate|sp-task-loop" src test agents docs README.md
```

Expected: Output lists all remaining references to remove or rewrite in this task.

- [ ] **Step 2: Delete generic modules and tests**

Run:

```bash
git rm src/slash/prompt-template-bridge.ts src/slash/slash-bridge.ts
git rm src/agents/agent-manager.ts src/agents/agent-manager-list.ts src/agents/agent-manager-detail.ts src/agents/agent-manager-edit.ts src/agents/agent-manager-chain-detail.ts src/agents/agent-manager-parallel.ts
git rm src/agents/agent-management.ts src/agents/agent-templates.ts src/ui/chain-clarify.ts
git rm agents/delegate.md agents/sp-task-loop.chain.md
git rm test/unit/prompt-template-bridge.test.ts
```

- [ ] **Step 3: Remove broken imports**

Run:

```bash
rg -n "prompt-template-bridge|slash-bridge|agent-manager|agent-management|agent-templates|chain-clarify|delegate|sp-task-loop" src test
```

For each match, remove the import and the code path that used it. Expected after edits:

```bash
rg -n "prompt-template-bridge|slash-bridge|agent-manager|agent-management|agent-templates|chain-clarify|delegate|sp-task-loop" src test
```

returns no output.

- [ ] **Step 4: Run unit and slash tests**

Run:

```bash
node --experimental-strip-types --test test/unit/*.test.ts
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/slash-commands.test.ts
```

Expected: PASS after deleting or updating tests that import removed modules.

- [ ] **Step 5: Commit generic surface deletion**

Run:

```bash
git add -A
git commit -m "refactor: remove generic subagent ui and bridges"
```

## Task 11: Remove Generic Chain Public Runtime Or Make It Internal

**Files:**
- Modify or Delete: `src/execution/chain-execution.ts`
- Modify or Delete: `src/agents/chain-serializer.ts`
- Modify: `src/execution/subagent-executor.ts`
- Modify: `src/execution/async-execution.ts`
- Modify: `src/execution/settings.ts`
- Modify/Delete: `test/integration/chain-execution.test.ts`
- Modify/Delete: `test/unit/agent-selection.test.ts` if it assumes chain discovery

- [ ] **Step 1: Search chain references**

Run:

```bash
rg -n "chain|Chain|chainDir|ChainStep|chain-serializer|executeChain|executeAsyncChain" src test agents docs README.md
```

Expected: Output identifies public chain references to remove and internal chain helpers to evaluate.

- [ ] **Step 2: Decide retention by import necessity**

If `src/execution/chain-execution.ts` is no longer imported from `src/execution/subagent-executor.ts` after Task 6, delete it:

```bash
git rm src/execution/chain-execution.ts src/agents/chain-serializer.ts test/integration/chain-execution.test.ts
```

If `src/execution/subagent-executor.ts` still imports it, remove the import and the branch that handles `params.chain` before deleting the files.

- [ ] **Step 3: Remove chain schema and type exports**

In `src/shared/types.ts`, remove `mode: "chain"` from `Details` if no retained result renderer needs it. If renderers still compile with `chain` during this pass, leave the union for internal result compatibility and remove docs/tests that expose it publicly.

In `src/shared/schemas.ts`, ensure there is no `chain` property in `SubagentParams`.

- [ ] **Step 4: Remove chain cleanup from extension startup**

If `cleanupOldChainDirs` only supports deleted chain artifacts, remove this import and call from `src/extension/index.ts`:

```typescript
import { cleanupOldChainDirs } from "../execution/settings.ts";
cleanupOldChainDirs();
```

- [ ] **Step 5: Run test suites**

Run:

```bash
node --experimental-strip-types --test test/unit/*.test.ts
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/*.test.ts
```

Expected: PASS after deleting or updating tests that protected public chain behavior.

- [ ] **Step 6: Commit chain removal**

Run:

```bash
git add -A
git commit -m "refactor: remove generic chain runtime"
```

## Task 12: Documentation, Package Identity, And Release Metadata

**Files:**
- Modify: `README.md`
- Modify: `docs/guides/superpowers.md`
- Modify: `docs/reference/configuration.md`
- Modify: `docs/reference/parameters.md`
- Modify/Delete: `docs/guides/agents.md`
- Modify/Delete: `docs/guides/chains.md`
- Modify/Delete: `docs/reference/agents-reference.md`
- Modify: `docs/reference/worktrees.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `test/unit/package-manifest.test.ts`

- [ ] **Step 1: Update package manifest test**

In `test/unit/package-manifest.test.ts`, change:

```typescript
assert.equal(packageJson.version, "0.2.0");
```

to:

```typescript
assert.equal(packageJson.version, "0.3.0");
```

Add:

```typescript
assert.doesNotMatch(String(packageJson.description), /fork/i);
assert.doesNotMatch(String(packageJson.description), /pi-subagents/i);
```

- [ ] **Step 2: Run manifest test to verify failure**

Run:

```bash
node --experimental-strip-types --test test/unit/package-manifest.test.ts
```

Expected: FAIL because package version is still `0.2.0`.

- [ ] **Step 3: Update package metadata**

In `package.json`:

```json
"version": "0.3.0",
"description": "Self-contained Superpowers subagent runtime for Pi",
```

Keep:

```json
"pi": {
  "extensions": [
    "./src/extension/index.ts",
    "./src/extension/notify.ts"
  ]
}
```

Update `package-lock.json` top-level package version and `packages[""].version` to `0.3.0`.

- [ ] **Step 4: Rewrite README around lean UX**

Replace the README feature sections with these headings:

```markdown
# pi-superagents

Self-contained Superpowers subagent runtime for Pi.

## Installation

## Configuration

## Commands

## Workflow Tokens

## Custom Superpowers Commands

## Status And Settings

## Role Agent Models

## Superpowers Worktrees

## Documentation
```

Ensure the README contains these command examples:

```text
/superpowers fix the auth regression
/superpowers direct fix the auth regression
/superpowers no-subagents inspect the failing test
/superpowers full implement the cache task
/superpowers-lean summarize the risk
/superpowers-status
```

Ensure the README does not contain these strings:

```text
/run
/chain
/parallel
/agents
fork of pi-subagents
Agents Manager
prompt-template-model
```

- [ ] **Step 5: Rewrite config docs**

In `docs/reference/configuration.md`, document only:

```json
{
  "superagents": {
    "useSubagents": true,
    "useTestDrivenDevelopment": true,
    "commands": {
      "superpowers-lean": {
        "description": "Run Superpowers inline without TDD",
        "useSubagents": false,
        "useTestDrivenDevelopment": false
      }
    },
    "worktrees": {
      "enabled": false,
      "root": null,
      "setupHook": null,
      "setupHookTimeoutMs": 30000
    },
    "modelTiers": {
      "cheap": {
        "model": "opencode-go/minimax-m2.7"
      }
    }
  }
}
```

Include the migration note:

```markdown
`superagents.defaultImplementerMode` has been removed. Use `superagents.useTestDrivenDevelopment`.
```

- [ ] **Step 6: Update Superpowers guide**

In `docs/guides/superpowers.md`, describe:

```markdown
## Command
## Workflow Tokens
## Custom Commands
## Role Agents
## Role Agent Models
## Superpowers Worktrees
## Status And Settings
## Skill Bootstrap
```

State explicitly:

```markdown
`/superpowers` starts from `using-superpowers`. It does not force `sp-recon` as the first step.
```

- [ ] **Step 7: Remove or stub generic docs**

Delete generic docs if no package links need them:

```bash
git rm docs/guides/agents.md docs/guides/chains.md docs/reference/agents-reference.md
```

Rewrite `docs/reference/worktrees.md` as a narrow Superpowers worktree reference. It should document only the retained `superagents.worktrees` options and the fact that worktree isolation applies to parallel delegated Superpowers role work, not to generic `/parallel` workflows.

If deletion breaks links in docs that remain, remove those links rather than preserving generic docs.

- [ ] **Step 8: Update parameters reference**

In `docs/reference/parameters.md`, remove management, generic chain, session sharing, and prompt-template sections. Keep only:

````markdown
# Parameters API Reference

The `subagent` tool is for root Superpowers workflows. It delegates bounded work to Superpowers role agents.

## Single Role

```typescript
{ agent: "sp-recon", task: "Inspect auth flow", workflow: "superpowers" }
```

## Parallel Roles

```typescript
{ tasks: [
  { agent: "sp-research", task: "Check config references" },
  { agent: "sp-code-review", task: "Review current diff" }
], workflow: "superpowers" }
```

Parallel role execution may use Superpowers worktree isolation when `superagents.worktrees.enabled` is true.

## Status

```typescript
{ action: "list" }
```
````

- [ ] **Step 9: Add changelog entry**

At the top of `CHANGELOG.md`, add:

```markdown
## [0.3.0] - 2026-04-11

### Breaking

- **Superpowers-only runtime** — removed generic `/run`, `/chain`, `/parallel`, `/agents`, generic chain files, prompt-template bridge support, and generic agent management.
- **Self-contained identity** — removed fork-oriented product framing and pi-subagents compatibility promises.
- **Lean config surface** — replaced broad config with Superpowers-specific `useSubagents`, `useTestDrivenDevelopment`, `commands`, `worktrees`, and `modelTiers`.

### Added

- **Custom Superpowers commands** — config-defined slash command presets for workflow options.
- **Per-run workflow tokens** — inline controls for TDD and subagent delegation.
- **Focused status/settings TUI** — `/superpowers-status` shows Superpowers defaults, diagnostics, commands, worktree defaults, and model tiers.
- **Skill bootstrap** — `/superpowers` starts from `using-superpowers` instead of a fixed recon-first flow.
- **Superpowers worktrees** — preserved worktree isolation for parallel delegated Superpowers role work.
```

- [ ] **Step 10: Run docs identity scan**

Run:

```bash
rg -n "/run|/chain|/parallel|/agents|fork of pi-subagents|pi-subagents compatibility|Agents Manager|prompt-template-model" README.md docs CHANGELOG.md package.json
```

Expected: No output except historical text in older changelog entries. If old changelog entries still match, keep them only when clearly marked as prior history and not current behavior.

- [ ] **Step 11: Run manifest test**

Run:

```bash
node --experimental-strip-types --test test/unit/package-manifest.test.ts
```

Expected: PASS.

- [ ] **Step 12: Commit docs and release metadata**

Run:

```bash
git add -A README.md docs CHANGELOG.md package.json package-lock.json test/unit/package-manifest.test.ts
git commit -m "docs: describe lean superpowers runtime"
```

## Task 13: Final Verification And Cleanup

**Files:**
- Modify: any tests still failing because they protect removed behavior
- Modify: imports reported by TypeScript runtime failures

- [ ] **Step 1: Run full unit tests**

Run:

```bash
node --experimental-strip-types --test test/unit/*.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full integration tests**

Run:

```bash
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/*.test.ts
```

Expected: PASS, or only tests for intentionally deleted generic behavior remain. Delete or rewrite those tests immediately and rerun this command until it passes.

- [ ] **Step 3: Run e2e tests**

Run:

```bash
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/e2e/*.test.ts
```

Expected: PASS after e2e fixtures are updated to `/superpowers` and `/superpowers-status`.

- [ ] **Step 4: Run package test command**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 5: Scan for removed public surfaces**

Run:

```bash
rg -n "registerCommand\\(\"(run|chain|parallel|agents)\"|prompt-template|Agents Manager|defaultImplementerMode|implementerMode|sp-task-loop|delegate" src test README.md docs default-config.json config.example.json
```

Expected: No output except references inside old committed design/plan artifacts under `docs/superpowers/specs` or `docs/superpowers/plans`. If source, tests, README, current docs, or config files match, remove or rewrite those matches.

- [ ] **Step 6: Scan for fork identity**

Run:

```bash
rg -n "fork of|pi-subagents|pi-prompt-template-model" README.md docs CHANGELOG.md package.json
```

Expected: No current-behavior matches. Historical changelog matches may remain if they are clearly old release notes.

- [ ] **Step 7: Verify git state**

Run:

```bash
git status --short
```

Expected: No output.

- [ ] **Step 8: Final commit if cleanup changed files**

If Steps 1-6 required additional edits, run:

```bash
git add -A
git commit -m "chore: finish lean superpowers cleanup"
```

If Step 7 already showed a clean tree, do not create an empty commit.

## Self-Review Checklist

- Spec Goal: covered by Tasks 1-13.
- Public UX: `/superpowers`, custom commands, and `/superpowers-status` covered by Tasks 2, 4, and 8.
- Config: `useSubagents`, `useTestDrivenDevelopment`, `commands`, `worktrees`, and `modelTiers` covered by Tasks 1, 7, 8, and 9.
- Custom commands: command preset validation and registration covered by Tasks 1, 2, and 4.
- Inline workflow tokens: covered by Task 2.
- Skill bootstrap: covered by Tasks 3 and 5.
- Role agent model-tier resolution: covered by Task 7.
- Superpowers worktrees: covered by Tasks 1, 7, 8, 9, 12, and 13.
- Generic feature removal: covered by Tasks 6, 10, 11, and 13.
- Status/settings TUI: covered by Tasks 8 and 9.
- Package identity and docs: covered by Task 12.
- Verification: covered by Task 13.
