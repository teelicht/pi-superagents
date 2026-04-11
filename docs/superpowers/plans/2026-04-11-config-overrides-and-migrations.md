# Config Overrides and Migrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an override-only `config.json` install model with `config.example.json`, fail-closed runtime validation, Pi-visible diagnostics, migration inspection, documentation, and release notes.

**Architecture:** Runtime config validation lives in a focused TypeScript module that parses user overrides, validates supported keys and values, merges them over bundled defaults, and formats diagnostics. The Pi extension uses that module to gate execution and notify users on `session_start`; installers keep a small JavaScript validation path because `install.mjs` must run directly through `npx` without TypeScript loading.

**Tech Stack:** TypeScript, Node.js built-in test runner, TypeBox schemas, Pi extension API, npm package metadata

---

## Version Decision

Release this as `0.2.0`, not `0.1.1`.

Reason: the new behavior is intentionally stricter and can block existing installations with invalid, stale, misspelled, or copied legacy config. The default runtime behavior for valid users remains compatible, but fail-closed validation changes the operational contract enough to count as a minor breaking change for a `0.x` package.

## File Structure

### Files to Create

- `config.example.json` — package-owned parseable example containing every supported user-facing config key.
- `src/execution/config-validation.ts` — TypeScript runtime validator, merger, diagnostics formatter, and migration preview helpers.
- `test/unit/config-validation.test.ts` — unit tests for validation, merge behavior, diagnostics, and migration preview.
- `test/integration/config-gating.test.ts` — integration tests for extension startup notification and blocked tool execution.

### Files to Modify

- `default-config.json` — keep runtime defaults aligned with `config.example.json`; do not add user metadata.
- `install.mjs` — create `{}` user config on fresh install, refresh `config.example.json`, preserve existing user config, print validation diagnostics, support check and safe migration flags.
- `scripts/local-extension-install.ts` — preserve user-owned `config.json` during local refresh and copy `config.example.json`.
- `src/extension/index.ts` — replace private config merge helpers with the validation module, gate execution, expose config diagnostics, and notify on `session_start`.
- `src/shared/types.ts` — allow nullable config values that already exist in `default-config.json`.
- `src/shared/schemas.ts` — add diagnostic-safe `subagent_status` actions for config inspection and safe config migration.
- `src/slash/slash-commands.ts` — refuse `/run`, `/chain`, `/parallel`, and `/superpowers` when config is blocked.
- `test/unit/default-config.test.ts` — assert default and example config contracts.
- `test/unit/package-manifest.test.ts` — assert `config.example.json` is packaged and package version is `0.2.0`.
- `test/unit/local-extension-install.test.ts` — assert local install preserves user config.
- `test/e2e/e2e-sandbox-install.test.ts` — assert packaged sandbox includes `config.example.json` and does not surface extension load errors.
- `README.md` — document the override-only config model and disabled-extension behavior.
- `docs/reference/configuration.md` — document config file ownership, examples, validation errors, and migration path.
- `CHANGELOG.md` — after implementation, add `0.2.0` change notes.
- `package.json` — bump version to `0.2.0` and include `config.example.json` in package files.
- `package-lock.json` — bump lockfile package version to `0.2.0`.

### Existing Patterns To Preserve

- Every new TypeScript source/test file needs a file header.
- Every non-trivial function needs a TSDoc/JSDoc header.
- Use `.ts` for application/test code. `install.mjs` is an unavoidable executable package script; keep its new JavaScript minimal and documented in the plan/implementation.
- Keep user config ownership separate from package-owned files.
- Commit after each task.

## Task 1: Add Package Config Asset Contracts

**Files:**
- Create: `config.example.json`
- Modify: `default-config.json`
- Modify: `test/unit/default-config.test.ts`
- Modify: `test/unit/package-manifest.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Write failing tests for config assets and package metadata**

In `test/unit/default-config.test.ts`, add example-config coverage beside the existing default-config test:

```ts
/**
 * Read and parse a config JSON file from the repository root.
 *
 * @param fileName Root-relative config file name.
 * @returns Parsed JSON object.
 */
function readConfigFile(fileName: string): Record<string, unknown> {
	const filePath = path.join(process.cwd(), fileName);
	return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
}

/**
 * Assert that one config object exposes the current public config surface.
 *
 * @param config Parsed config object to inspect.
 */
function assertPublicConfigSurface(config: Record<string, unknown>): void {
	const superagents = config.superagents as {
		[key: string]: unknown;
		modelTiers?: Record<string, unknown>;
		worktrees?: Record<string, unknown>;
	};
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
		assert.ok(key in worktrees, `Expected superagents.worktrees option '${key}' to be present`);
	}

	assert.equal(superagents.defaultImplementerMode, "tdd");
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
}
```

Replace the current test body with:

```ts
describe("config templates", () => {
	it("ships all supported runtime defaults", () => {
		assertPublicConfigSurface(readConfigFile("default-config.json"));
	});

	it("ships a parseable user-facing example config with the same public surface", () => {
		assertPublicConfigSurface(readConfigFile("config.example.json"));
	});
});
```

In `test/unit/package-manifest.test.ts`, update the manifest assertions:

```ts
assert.equal(packageJson.version, "0.2.0");
assert.deepEqual(packageJson.files, [
	"src/",
	"scripts/",
	"agents/",
	"docs/",
	"default-config.json",
	"config.example.json",
	"*.mjs",
	"README.md",
	"CHANGELOG.md",
]);
```

- [ ] **Step 2: Run the asset tests and verify they fail**

Run:

```bash
node --experimental-strip-types --test test/unit/default-config.test.ts test/unit/package-manifest.test.ts
```

Expected:

- `default-config.test.ts` fails because `config.example.json` does not exist.
- `package-manifest.test.ts` fails because version is still `0.1.0` and `config.example.json` is not in `files`.

- [ ] **Step 3: Add `config.example.json`**

Create `config.example.json` with this parseable JSON:

```json
{
  "asyncByDefault": false,
  "defaultSessionDir": null,
  "maxSubagentDepth": 2,
  "superagents": {
    "defaultImplementerMode": "tdd",
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
      },
      "creative": {
        "model": "anthropic/claude-sonnet-4",
        "thinking": "high"
      }
    }
  }
}
```

- [ ] **Step 4: Update package version and files**

In `package.json`, change:

```json
"version": "0.2.0"
```

and add `config.example.json` directly after `default-config.json` in `files`:

```json
"files": [
  "src/",
  "scripts/",
  "agents/",
  "docs/",
  "default-config.json",
  "config.example.json",
  "*.mjs",
  "README.md",
  "CHANGELOG.md"
]
```

In `package-lock.json`, update both root version occurrences from `0.1.0` to `0.2.0`.

- [ ] **Step 5: Run the asset tests and verify they pass**

Run:

```bash
node --experimental-strip-types --test test/unit/default-config.test.ts test/unit/package-manifest.test.ts
```

Expected: both tests pass.

- [ ] **Step 6: Commit**

```bash
git add config.example.json default-config.json package.json package-lock.json test/unit/default-config.test.ts test/unit/package-manifest.test.ts
git commit -m "feat: add config example asset"
```

## Task 2: Build Runtime Config Validation

**Files:**
- Create: `src/execution/config-validation.ts`
- Create: `test/unit/config-validation.test.ts`
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Write failing validator tests**

Create `test/unit/config-validation.test.ts`:

```ts
/**
 * Unit coverage for extension config validation and merge behavior.
 *
 * Responsibilities:
 * - verify empty user overrides inherit bundled defaults
 * - verify unknown and malformed config blocks execution
 * - verify diagnostics are precise enough to show directly to users
 * - verify migration diagnostics identify copied full-default config
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionConfig } from "../../src/shared/types.ts";
import {
	formatConfigDiagnostics,
	loadEffectiveConfig,
	validateConfigObject,
} from "../../src/execution/config-validation.ts";

const defaults: ExtensionConfig = {
	asyncByDefault: false,
	defaultSessionDir: null,
	maxSubagentDepth: 2,
	superagents: {
		defaultImplementerMode: "tdd",
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

describe("config validation", () => {
	it("treats missing and empty user config as valid overrides", () => {
		assert.deepEqual(loadEffectiveConfig(defaults, undefined).config, defaults);
		assert.deepEqual(loadEffectiveConfig(defaults, {}).config, defaults);
		assert.equal(loadEffectiveConfig(defaults, {}).blocked, false);
	});

	it("deep merges user overrides over bundled defaults", () => {
		const result = loadEffectiveConfig(defaults, {
			asyncByDefault: true,
			superagents: {
				worktrees: { enabled: true },
				modelTiers: {
					max: { model: "openai/gpt-5.4", thinking: "high" },
					free: { model: "google/gemini-flash" },
				},
			},
		});

		assert.equal(result.blocked, false);
		assert.equal(result.config.asyncByDefault, true);
		assert.equal(result.config.superagents?.worktrees?.enabled, true);
		assert.equal(result.config.superagents?.worktrees?.setupHookTimeoutMs, 30000);
		assert.deepEqual(result.config.superagents?.modelTiers?.cheap, defaults.superagents?.modelTiers?.cheap);
		assert.deepEqual(result.config.superagents?.modelTiers?.max, {
			model: "openai/gpt-5.4",
			thinking: "high",
		});
		assert.deepEqual(result.config.superagents?.modelTiers?.free, {
			model: "google/gemini-flash",
		});
	});

	it("blocks unknown top-level and nested keys", () => {
		const result = validateConfigObject({
			asyncByDefalt: true,
			superagents: {
				worktrees: {
					setupCommand: "./setup.sh",
				},
			},
		});

		assert.equal(result.blocked, true);
		assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code), [
			"unknown_key",
			"unknown_key",
		]);
		assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.path), [
			"asyncByDefalt",
			"superagents.worktrees.setupCommand",
		]);
	});

	it("blocks wrong primitive types and invalid enum values", () => {
		const result = validateConfigObject({
			asyncByDefault: "yes",
			maxSubagentDepth: -1,
			superagents: {
				defaultImplementerMode: "fast",
				worktrees: {
					enabled: "yes",
					setupHookTimeoutMs: 0,
				},
				modelTiers: {
					max: {
						model: "",
						thinking: "huge",
					},
				},
			},
		});

		assert.equal(result.blocked, true);
		assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.path), [
			"asyncByDefault",
			"maxSubagentDepth",
			"superagents.defaultImplementerMode",
			"superagents.worktrees.enabled",
			"superagents.worktrees.setupHookTimeoutMs",
			"superagents.modelTiers.max.model",
			"superagents.modelTiers.max.thinking",
		]);
	});

	it("allows nullable path settings already present in default config", () => {
		const result = validateConfigObject({
			defaultSessionDir: null,
			superagents: {
				worktrees: {
					root: null,
					setupHook: null,
				},
			},
		});

		assert.equal(result.blocked, false);
		assert.deepEqual(result.diagnostics, []);
	});

	it("formats diagnostics for Pi notifications and tool results", () => {
		const result = validateConfigObject({
			superagents: {
				worktrees: {
					setupHookTimeoutMs: "slow",
				},
			},
		});

		assert.equal(
			formatConfigDiagnostics(result.diagnostics, {
				configPath: "~/.pi/agent/extensions/subagent/config.json",
				examplePath: "~/.pi/agent/extensions/subagent/config.example.json",
			}),
			[
				"pi-superagents is disabled because config.json needs attention.",
				"Path: ~/.pi/agent/extensions/subagent/config.json",
				"",
				"- superagents.worktrees.setupHookTimeoutMs: must be a positive integer.",
				"",
				"See ~/.pi/agent/extensions/subagent/config.example.json for the current config shape.",
			].join("\n"),
		);
	});

	it("warns when config looks like a copied default file", () => {
		const result = loadEffectiveConfig(defaults, defaults);

		assert.equal(result.blocked, false);
		assert.deepEqual(result.diagnostics, [{
			level: "warning",
			code: "legacy_full_copy",
			path: "$",
			message: "appears to duplicate the bundled defaults. Replace it with {} and keep only local overrides.",
			action: "replace_with_empty_override",
		}]);
	});
});
```

- [ ] **Step 2: Run validator tests and verify they fail**

Run:

```bash
node --experimental-strip-types --test test/unit/config-validation.test.ts
```

Expected: fail because `src/execution/config-validation.ts` does not exist.

- [ ] **Step 3: Update nullable config types**

In `src/shared/types.ts`, update config-facing interfaces:

```ts
export type ConfigDiagnosticLevel = "warning" | "error";

export interface ConfigDiagnostic {
	level: ConfigDiagnosticLevel;
	code: string;
	path: string;
	message: string;
	action?: string;
}

export interface SuperpowersSettings {
	/** Superpowers-only worktree defaults for parallel execution. */
	worktrees?: {
		enabled?: boolean;
		root?: string | null;
		setupHook?: string | null;
		setupHookTimeoutMs?: number;
	};
	/** Model configuration for each tier. Supports built-in (cheap, balanced, max) and custom tiers. */
	modelTiers?: Record<string, ModelTierSetting>;
	defaultImplementerMode?: SuperpowersImplementerMode;
}

export interface ExtensionConfig {
	asyncByDefault?: boolean;
	defaultSessionDir?: string | null;
	maxSubagentDepth?: number;
	superagents?: SuperpowersSettings;
}
```

- [ ] **Step 4: Implement `src/execution/config-validation.ts`**

Create the file with a header and these exports:

```ts
/**
 * Extension config validation and merge helpers.
 *
 * Responsibilities:
 * - validate user-authored config overrides before runtime use
 * - merge validated overrides over bundled defaults without losing nested defaults
 * - format diagnostics for Pi startup notifications and tool results
 *
 * Important side effects:
 * - none; this module is pure and safe to use from tests and extension startup
 */

import type {
	ConfigDiagnostic,
	ExtensionConfig,
	ModelTierSetting,
	SuperpowersImplementerMode,
	ThinkingLevel,
} from "../shared/types.ts";

export interface ConfigValidationResult {
	blocked: boolean;
	diagnostics: ConfigDiagnostic[];
}

export interface EffectiveConfigResult extends ConfigValidationResult {
	config: ExtensionConfig;
}

export interface FormatConfigDiagnosticsOptions {
	configPath: string;
	examplePath: string;
}

const TOP_LEVEL_KEYS = new Set(["asyncByDefault", "defaultSessionDir", "maxSubagentDepth", "superagents"]);
const SUPERAGENTS_KEYS = new Set(["defaultImplementerMode", "worktrees", "modelTiers"]);
const WORKTREE_KEYS = new Set(["enabled", "root", "setupHook", "setupHookTimeoutMs"]);
const MODEL_TIER_KEYS = new Set(["model", "thinking"]);
const IMPLEMENTER_MODES: readonly SuperpowersImplementerMode[] = ["tdd", "direct"];
const THINKING_LEVELS: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

/**
 * Determine whether a value is a non-array object.
 *
 * @param value Unknown value to inspect.
 * @returns True when the value is a record object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Add one diagnostic to the mutable diagnostics list.
 *
 * @param diagnostics Mutable diagnostic accumulator.
 * @param path Dot-separated config path.
 * @param message User-facing diagnostic message.
 * @param code Stable diagnostic code.
 */
function addError(diagnostics: ConfigDiagnostic[], path: string, message: string, code = "invalid_value"): void {
	diagnostics.push({ level: "error", code, path, message });
}

/**
 * Determine whether two JSON-compatible values are structurally equal.
 *
 * @param left First value.
 * @param right Second value.
 * @returns True when their JSON representation matches.
 */
function jsonEqual(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Validate an optional string-or-null path setting.
 *
 * @param diagnostics Mutable diagnostic accumulator.
 * @param config Config object containing the key.
 * @param key Key to validate.
 * @param path Dot-separated config path.
 */
function validateOptionalStringOrNull(
	diagnostics: ConfigDiagnostic[],
	config: Record<string, unknown>,
	key: string,
	path: string,
): void {
	if (!(key in config)) return;
	const value = config[key];
	if (value !== null && typeof value !== "string") {
		addError(diagnostics, path, "must be a string or null.");
	}
}

/**
 * Validate one model tier setting.
 *
 * @param diagnostics Mutable diagnostic accumulator.
 * @param value Unknown model tier value.
 * @param path Dot-separated config path.
 */
function validateModelTier(diagnostics: ConfigDiagnostic[], value: unknown, path: string): void {
	if (typeof value === "string") {
		if (!value.trim()) addError(diagnostics, path, "must not be an empty string.");
		return;
	}
	if (!isRecord(value)) {
		addError(diagnostics, path, "must be a model string or an object with a model field.");
		return;
	}
	for (const key of Object.keys(value)) {
		if (!MODEL_TIER_KEYS.has(key)) addError(diagnostics, `${path}.${key}`, "is not a supported config key.", "unknown_key");
	}
	if (typeof value.model !== "string" || !value.model.trim()) {
		addError(diagnostics, `${path}.model`, "must be a non-empty string.");
	}
	if ("thinking" in value && !THINKING_LEVELS.includes(value.thinking as ThinkingLevel)) {
		addError(diagnostics, `${path}.thinking`, "must be one of off, minimal, low, medium, high, xhigh.");
	}
}

/**
 * Validate user-authored config shape and values.
 *
 * @param rawConfig Parsed user config value.
 * @returns Validation diagnostics plus a blocked flag.
 */
export function validateConfigObject(rawConfig: unknown): ConfigValidationResult {
	const diagnostics: ConfigDiagnostic[] = [];
	if (!isRecord(rawConfig)) {
		addError(diagnostics, "$", "must be a JSON object.");
		return { blocked: true, diagnostics };
	}

	for (const key of Object.keys(rawConfig)) {
		if (!TOP_LEVEL_KEYS.has(key)) addError(diagnostics, key, "is not a supported config key.", "unknown_key");
	}

	if ("asyncByDefault" in rawConfig && typeof rawConfig.asyncByDefault !== "boolean") {
		addError(diagnostics, "asyncByDefault", "must be a boolean.");
	}
	validateOptionalStringOrNull(diagnostics, rawConfig, "defaultSessionDir", "defaultSessionDir");
	if ("maxSubagentDepth" in rawConfig) {
		const value = rawConfig.maxSubagentDepth;
		if (!Number.isInteger(value) || Number(value) < 0) {
			addError(diagnostics, "maxSubagentDepth", "must be an integer greater than or equal to 0.");
		}
	}

	if ("superagents" in rawConfig) {
		const superagents = rawConfig.superagents;
		if (!isRecord(superagents)) {
			addError(diagnostics, "superagents", "must be an object.");
		} else {
			for (const key of Object.keys(superagents)) {
				if (!SUPERAGENTS_KEYS.has(key)) addError(diagnostics, `superagents.${key}`, "is not a supported config key.", "unknown_key");
			}
			if (
				"defaultImplementerMode" in superagents
				&& !IMPLEMENTER_MODES.includes(superagents.defaultImplementerMode as SuperpowersImplementerMode)
			) {
				addError(diagnostics, "superagents.defaultImplementerMode", "must be either tdd or direct.");
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
			if ("modelTiers" in superagents) {
				const modelTiers = superagents.modelTiers;
				if (!isRecord(modelTiers)) {
					addError(diagnostics, "superagents.modelTiers", "must be an object.");
				} else {
					for (const [tierName, tierValue] of Object.entries(modelTiers)) {
						validateModelTier(diagnostics, tierValue, `superagents.modelTiers.${tierName}`);
					}
				}
			}
		}
	}

	return { blocked: diagnostics.some((diagnostic) => diagnostic.level === "error"), diagnostics };
}

/**
 * Merge one model tier map while preserving existing tiers.
 *
 * @param defaults Bundled default model tiers.
 * @param overrides User-authored model tier overrides.
 * @returns Merged model tier map.
 */
function mergeModelTiers(
	defaults: Record<string, ModelTierSetting> | undefined,
	overrides: Record<string, ModelTierSetting> | undefined,
): Record<string, ModelTierSetting> | undefined {
	if (!defaults && !overrides) return undefined;
	return {
		...(defaults ?? {}),
		...(overrides ?? {}),
	};
}

/**
 * Merge user config over bundled defaults.
 *
 * @param defaults Bundled defaults.
 * @param overrides Validated user overrides.
 * @returns Effective runtime config.
 */
export function mergeConfig(defaults: ExtensionConfig, overrides: ExtensionConfig): ExtensionConfig {
	const defaultSuperagents = defaults.superagents;
	const overrideSuperagents = overrides.superagents;
	const mergedSuperagents = defaultSuperagents || overrideSuperagents
		? {
			...(defaultSuperagents ?? {}),
			...(overrideSuperagents ?? {}),
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

/**
 * Validate user overrides and produce an effective config when possible.
 *
 * @param defaults Bundled default config.
 * @param userConfig Parsed user override config, if present.
 * @returns Effective config plus diagnostics.
 */
export function loadEffectiveConfig(defaults: ExtensionConfig, userConfig: unknown | undefined): EffectiveConfigResult {
	if (userConfig === undefined) {
		return { blocked: false, diagnostics: [], config: defaults };
	}
	const validation = validateConfigObject(userConfig);
	if (validation.blocked) {
		return { ...validation, config: defaults };
	}
	const migrationDiagnostics: ConfigDiagnostic[] = jsonEqual(defaults, userConfig)
		? [{
			level: "warning",
			code: "legacy_full_copy",
			path: "$",
			message: "appears to duplicate the bundled defaults. Replace it with {} and keep only local overrides.",
			action: "replace_with_empty_override",
		}]
		: [];
	return {
		blocked: false,
		diagnostics: [...validation.diagnostics, ...migrationDiagnostics],
		config: mergeConfig(defaults, userConfig as ExtensionConfig),
	};
}

/**
 * Format diagnostics into a concise user-facing message.
 *
 * @param diagnostics Diagnostics to display.
 * @param options Config and example paths for repair guidance.
 * @returns Multi-line notification text.
 */
export function formatConfigDiagnostics(
	diagnostics: ConfigDiagnostic[],
	options: FormatConfigDiagnosticsOptions,
): string {
	const headline = diagnostics.some((diagnostic) => diagnostic.level === "error")
		? "pi-superagents is disabled because config.json needs attention."
		: "pi-superagents config.json has warnings.";
	const body = diagnostics.map((diagnostic) => `- ${diagnostic.path}: ${diagnostic.message}`);
	return [
		headline,
		`Path: ${options.configPath}`,
		"",
		...body,
		"",
		`See ${options.examplePath} for the current config shape.`,
	].join("\n");
}
```

- [ ] **Step 5: Run validator tests and fix compile issues**

Run:

```bash
node --experimental-strip-types --test test/unit/config-validation.test.ts
```

Expected: pass. If TypeScript reports nullable type errors in existing callers, keep the nullable types and update callers to ignore `null` values where they already mean “unset”.

- [ ] **Step 6: Commit**

```bash
git add src/execution/config-validation.ts src/shared/types.ts test/unit/config-validation.test.ts
git commit -m "feat: validate config overrides"
```

## Task 3: Gate Runtime Execution And Notify In Pi

**Files:**
- Modify: `src/extension/index.ts`
- Modify: `src/slash/slash-commands.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/schemas.ts`
- Create: `test/integration/config-gating.test.ts`
- Modify: `test/integration/slash-commands.test.ts`

- [ ] **Step 1: Write failing extension gating tests**

Create `test/integration/config-gating.test.ts`:

```ts
/**
 * Integration coverage for fail-closed config handling at the extension boundary.
 *
 * Responsibilities:
 * - verify invalid config diagnostics are shown on Pi session start
 * - verify execution tools refuse to run while config is blocked
 * - verify diagnostic-safe config inspection stays available
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import registerSubagentExtension from "../../src/extension/index.ts";

interface RegisteredTool {
	name: string;
	execute(id: string, params: Record<string, unknown>, signal: AbortSignal | undefined, onUpdate: unknown, ctx: unknown): Promise<unknown>;
}

/**
 * Create a minimal event bus matching what the extension uses.
 *
 * @returns Event bus with `on` and `emit`.
 */
function createEventBus() {
	const handlers = new Map<string, Array<(data: unknown) => void>>();
	return {
		on(event: string, handler: (data: unknown) => void) {
			const existing = handlers.get(event) ?? [];
			existing.push(handler);
			handlers.set(event, existing);
			return () => {
				handlers.set(event, (handlers.get(event) ?? []).filter((entry) => entry !== handler));
			};
		},
		emit(event: string, data: unknown) {
			for (const handler of handlers.get(event) ?? []) handler(data);
		},
	};
}

/**
 * Create a minimal Pi API mock for extension registration tests.
 *
 * @returns Mock API plus captured tools, commands, and messages.
 */
function createPiMock() {
	const events = createEventBus();
	const lifecycle = new Map<string, Array<(event: unknown, ctx: unknown) => void>>();
	const tools = new Map<string, RegisteredTool>();
	const messages: unknown[] = [];
	return {
		tools,
		messages,
		pi: {
			events,
			registerTool(tool: RegisteredTool) {
				tools.set(tool.name, tool);
			},
			registerCommand() {},
			registerShortcut() {},
			registerMessageRenderer() {},
			sendMessage(message: unknown) {
				messages.push(message);
			},
			on(event: string, handler: (event: unknown, ctx: unknown) => void) {
				const existing = lifecycle.get(event) ?? [];
				existing.push(handler);
				lifecycle.set(event, existing);
			},
		},
		emitLifecycle(event: string, payload: unknown, ctx: unknown) {
			for (const handler of lifecycle.get(event) ?? []) handler(payload, ctx);
		},
	};
}

/**
 * Create a minimal extension context with notification capture.
 *
 * @param notifications Mutable notification list.
 * @returns Extension context mock.
 */
function createCtx(notifications: Array<{ message: string; type?: string }>) {
	return {
		cwd: process.cwd(),
		hasUI: true,
		ui: {
			notify(message: string, type?: string) {
				notifications.push({ message, type });
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

describe("extension config gating", () => {
	const originalHome = process.env.HOME;
	const tempDirs: string[] = [];

	afterEach(() => {
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;
		for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
	});

	it("notifies on session start and blocks subagent execution when config is invalid", async () => {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-config-gate-home-"));
		tempDirs.push(home);
		process.env.HOME = home;
		const extensionDir = path.join(home, ".pi", "agent", "extensions", "subagent");
		fs.mkdirSync(extensionDir, { recursive: true });
		fs.writeFileSync(path.join(extensionDir, "config.json"), JSON.stringify({ asyncByDefalt: true }), "utf-8");

		const mock = createPiMock();
		registerSubagentExtension(mock.pi as never);

		const notifications: Array<{ message: string; type?: string }> = [];
		const ctx = createCtx(notifications);
		mock.emitLifecycle("session_start", { type: "session_start", reason: "startup" }, ctx);

		assert.equal(notifications.length, 1);
		assert.equal(notifications[0]!.type, "error");
		assert.match(notifications[0]!.message, /pi-superagents is disabled/);
		assert.match(notifications[0]!.message, /asyncByDefalt/);

		const result = await mock.tools.get("subagent")!.execute("blocked", { agent: "scout", task: "inspect" }, undefined, undefined, ctx);
		assert.equal((result as { isError?: boolean }).isError, true);
		assert.match(JSON.stringify(result), /config\.json needs attention/);
	});

	it("keeps config diagnostics available through subagent_status", async () => {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-config-status-home-"));
		tempDirs.push(home);
		process.env.HOME = home;
		const extensionDir = path.join(home, ".pi", "agent", "extensions", "subagent");
		fs.mkdirSync(extensionDir, { recursive: true });
		fs.writeFileSync(path.join(extensionDir, "config.json"), JSON.stringify({ maxSubagentDepth: -1 }), "utf-8");

		const mock = createPiMock();
		registerSubagentExtension(mock.pi as never);
		const result = await mock.tools.get("subagent_status")!.execute(
			"config",
			{ action: "config" },
			undefined,
			undefined,
			createCtx([]),
		);

		assert.equal((result as { isError?: boolean }).isError, true);
		assert.match(JSON.stringify(result), /maxSubagentDepth/);
	});

	it("can safely migrate an unchanged copied default config to an empty override", async () => {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-config-migrate-home-"));
		tempDirs.push(home);
		process.env.HOME = home;
		const extensionDir = path.join(home, ".pi", "agent", "extensions", "subagent");
		fs.mkdirSync(extensionDir, { recursive: true });
		const defaultConfig = JSON.parse(fs.readFileSync(path.resolve("default-config.json"), "utf-8"));
		const configPath = path.join(extensionDir, "config.json");
		fs.writeFileSync(configPath, `${JSON.stringify(defaultConfig, null, 2)}\n`, "utf-8");

		const mock = createPiMock();
		registerSubagentExtension(mock.pi as never);
		const result = await mock.tools.get("subagent_status")!.execute(
			"migrate-config",
			{ action: "migrate-config" },
			undefined,
			undefined,
			createCtx([]),
		);

		assert.equal((result as { isError?: boolean }).isError, false);
		assert.equal(fs.readFileSync(configPath, "utf-8"), "{}\n");
		assert.match(JSON.stringify(result), /Restart or reload Pi/);
	});
});
```

- [ ] **Step 2: Update slash command tests for blocked config**

In `test/integration/slash-commands.test.ts`, extend `createState()` with a config gate once the type exists:

```ts
configGate: {
	blocked: false,
	diagnostics: [],
	message: "",
},
```

Add a test:

```ts
it("/run refuses to execute when config is blocked", async () => {
	const notifications: Array<{ message: string; type?: string }> = [];
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
		blocked: true,
		diagnostics: [{ level: "error", code: "unknown_key", path: "asyncByDefalt", message: "is not supported." }],
		message: "pi-superagents is disabled because config.json needs attention.",
	};
	const ctx = createCommandContext({ hasUI: true });
	(ctx as { ui: { notify(message: string, type?: string): void } }).ui.notify = (message, type) => {
		notifications.push({ message, type });
	};

	registerSlashCommands!(pi, state);
	await commands.get("run")!.handler("scout inspect this", ctx);

	assert.equal(notifications.length, 1);
	assert.equal(notifications[0]!.type, "error");
assert.match(notifications[0]!.message, /disabled because config\.json needs attention/);
});
```

Update every other `SubagentState` fixture with the same valid default gate:

```ts
configGate: {
	blocked: false,
	diagnostics: [],
	message: "",
},
```

Apply that fixture update in:

```text
test/integration/fork-context-execution.test.ts
test/integration/result-watcher.test.ts
test/integration/superpowers-packets.test.ts
```

- [ ] **Step 3: Run gating tests and verify they fail**

Run:

```bash
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/config-gating.test.ts test/integration/slash-commands.test.ts
```

Expected: fail because runtime gating and `subagent_status` config action do not exist.

- [ ] **Step 4: Add config gate type to shared state**

In `src/shared/types.ts`, add:

```ts
export interface ConfigGateState {
	blocked: boolean;
	diagnostics: ConfigDiagnostic[];
	message: string;
}
```

and add to `SubagentState`:

```ts
configGate: ConfigGateState;
```

- [ ] **Step 5: Add `subagent_status` config action to schema**

In `src/shared/schemas.ts`, change the `StatusParams.action` description:

```ts
action: Type.Optional(Type.String({ description: "Action: 'list' to show active async runs, 'config' to inspect config diagnostics, 'migrate-config' to apply safe config migrations, or omit to inspect one run by id/dir" })),
```

- [ ] **Step 6: Refactor config loading in `src/extension/index.ts`**

Replace the private `mergeConfig()` helper with imports from the validation module:

```ts
import {
	formatConfigDiagnostics,
	loadEffectiveConfig,
} from "../execution/config-validation.ts";
import type { ConfigDiagnostic } from "../shared/types.ts";
```

Keep `readJsonConfig()` but make it return `unknown`:

```ts
/**
 * Read one JSON config file from disk.
 *
 * @param filePath Absolute path to the JSON file.
 * @returns Parsed JSON value or `undefined` when the file is absent.
 */
function readJsonConfig(filePath: string): unknown | undefined {
	if (!fs.existsSync(filePath)) return undefined;
	return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}
```

Replace `loadConfig()` with:

```ts
interface LoadedConfigState {
	config: ExtensionConfig;
	blocked: boolean;
	diagnostics: ConfigDiagnostic[];
	message: string;
	configPath: string;
	examplePath: string;
}

/**
 * Load and validate extension config, preserving diagnostics for user display.
 *
 * @returns Validated config state for runtime registration.
 */
function loadConfigState(): LoadedConfigState {
	const extensionDir = path.dirname(fileURLToPath(import.meta.url));
	const packageRoot = path.resolve(extensionDir, "..", "..");
	const bundledDefaultConfigPath = path.join(packageRoot, "default-config.json");
	const configPath = path.join(os.homedir(), ".pi", "agent", "extensions", "subagent", "config.json");
	const examplePath = path.join(os.homedir(), ".pi", "agent", "extensions", "subagent", "config.example.json");
	try {
		const bundledDefaults = (readJsonConfig(bundledDefaultConfigPath) ?? {}) as ExtensionConfig;
		const userConfig = readJsonConfig(configPath);
		const result = loadEffectiveConfig(bundledDefaults, userConfig);
		const message = result.diagnostics.length
			? formatConfigDiagnostics(result.diagnostics, { configPath, examplePath })
			: "";
		return { ...result, message, configPath, examplePath };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const diagnostics: ConfigDiagnostic[] = [{
			level: "error",
			code: "config_load_failed",
			path: "config.json",
			message,
		}];
		return {
			config: {},
			blocked: true,
			diagnostics,
			message: formatConfigDiagnostics(diagnostics, { configPath, examplePath }),
			configPath,
			examplePath,
		};
	}
}
```

Add this helper:

```ts
/**
 * Apply the safe empty-override migration for a copied default config.
 *
 * @param state Current loaded config state.
 * @returns Tool result describing the migration outcome.
 */
function migrateCopiedDefaultConfig(state: LoadedConfigState): AgentToolResult<Details> {
	const canMigrate = state.diagnostics.some((diagnostic) => diagnostic.action === "replace_with_empty_override");
	if (!canMigrate) {
		return {
			content: [{ type: "text", text: "No safe config migration is available for the current config.json." }],
			isError: true,
			details: { mode: "single", results: [] },
		};
	}
	const backupPath = `${state.configPath}.bak-${Date.now()}`;
	fs.copyFileSync(state.configPath, backupPath);
	fs.writeFileSync(state.configPath, "{}\n", "utf-8");
	return {
		content: [{ type: "text", text: `Migrated config.json to an empty override. Backup: ${backupPath}\nRestart or reload Pi to use the updated config.` }],
		details: { mode: "single", results: [] },
	};
}
```

In `registerSubagentExtension()`, replace:

```ts
const config = loadConfig();
```

with:

```ts
const configState = loadConfigState();
const config = configState.config;
```

Initialize `state.configGate`:

```ts
configGate: {
	blocked: configState.blocked,
	diagnostics: configState.diagnostics,
	message: configState.message,
},
```

- [ ] **Step 7: Block tool execution when config is invalid**

Add this helper in `src/extension/index.ts` near the tool definitions:

```ts
/**
 * Build a blocking tool result for invalid config.
 *
 * @param message User-facing config diagnostic message.
 * @returns Tool result that refuses execution.
 */
function configBlockedResult(message: string): AgentToolResult<Details> {
	return {
		content: [{ type: "text", text: message }],
		isError: true,
		details: { mode: "single", results: [] },
	};
}
```

At the start of the `subagent` tool `execute()`:

```ts
if (state.configGate.blocked) {
	return Promise.resolve(configBlockedResult(state.configGate.message));
}
```

At the start of the `subagent_status` tool `execute()`, add:

```ts
if (params.action === "config") {
	return {
		content: [{ type: "text", text: state.configGate.message || "pi-superagents config is valid." }],
		isError: state.configGate.blocked,
		details: { mode: "single" as const, results: [] },
	};
}
if (params.action === "migrate-config") {
	return migrateCopiedDefaultConfig(configState);
}
```

- [ ] **Step 8: Notify once per session**

In `registerSubagentExtension()`, add a local notification guard:

```ts
let configDiagnosticNotifiedForSession: string | null = null;
```

Inside the existing `session_start` handler, after `resetSessionState(ctx)`:

```ts
if (
	state.configGate.message
	&& ctx.hasUI
	&& configDiagnosticNotifiedForSession !== state.currentSessionId
) {
	configDiagnosticNotifiedForSession = state.currentSessionId;
	ctx.ui.notify(state.configGate.message, state.configGate.blocked ? "error" : "warning");
}
```

- [ ] **Step 9: Block slash launchers**

In `src/slash/slash-commands.ts`, add:

```ts
/**
 * Notify the user when config errors disable execution.
 *
 * @param state Shared extension state containing the config gate.
 * @param ctx Current extension context.
 * @returns True when execution should stop.
 */
function notifyIfConfigBlocked(state: SubagentState, ctx: ExtensionContext): boolean {
	if (!state.configGate.blocked) return false;
	if (ctx.hasUI) ctx.ui.notify(state.configGate.message, "error");
	return true;
}
```

Call it at the top of `/run`, `/chain`, `/parallel`, and `/superpowers` handlers:

```ts
if (notifyIfConfigBlocked(state, ctx)) return;
```

- [ ] **Step 10: Run gating tests and verify they pass**

Run:

```bash
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/config-gating.test.ts test/integration/slash-commands.test.ts
```

Expected: pass.

- [ ] **Step 11: Run focused unit tests**

Run:

```bash
node --experimental-strip-types --test test/unit/config-validation.test.ts test/unit/schemas.test.ts test/unit/superagents-config.test.ts
```

Expected: pass.

- [ ] **Step 12: Commit**

```bash
git add src/extension/index.ts src/slash/slash-commands.ts src/shared/types.ts src/shared/schemas.ts test/integration/config-gating.test.ts test/integration/slash-commands.test.ts
git commit -m "feat: fail closed on invalid config"
```

## Task 4: Update Installers For Empty Overrides

**Files:**
- Modify: `install.mjs`
- Modify: `scripts/local-extension-install.ts`
- Modify: `test/unit/local-extension-install.test.ts`

- [ ] **Step 1: Write failing local installer preservation tests**

In `test/unit/local-extension-install.test.ts`, add this test:

```ts
it("preserves user-owned config while refreshing package-owned files", () => {
	const sourceRoot = createTempDir("pi-local-install-src-");
	const targetRoot = createTempDir("pi-local-install-dst-");
	tempDirs.push(sourceRoot, targetRoot);

	fs.writeFileSync(path.join(sourceRoot, "package.json"), "{\n  \"name\": \"pi-superagents\"\n}\n", "utf-8");
	fs.writeFileSync(path.join(sourceRoot, "config.example.json"), "{\n  \"asyncByDefault\": false\n}\n", "utf-8");
	fs.writeFileSync(path.join(sourceRoot, "default-config.json"), "{\n  \"asyncByDefault\": false\n}\n", "utf-8");
	fs.mkdirSync(targetRoot, { recursive: true });
	fs.writeFileSync(path.join(targetRoot, "config.json"), "{\n  \"asyncByDefault\": true\n}\n", "utf-8");
	fs.writeFileSync(path.join(targetRoot, "config.example.json"), "{\n  \"old\": true\n}\n", "utf-8");
	fs.writeFileSync(path.join(targetRoot, "stale.ts"), "old\n", "utf-8");

	installLocalExtensionFiles({
		sourceRoot,
		targetRoot,
		relativePaths: ["package.json", "default-config.json", "config.example.json"],
	});

	assert.equal(fs.readFileSync(path.join(targetRoot, "config.json"), "utf-8"), "{\n  \"asyncByDefault\": true\n}\n");
	assert.equal(fs.readFileSync(path.join(targetRoot, "config.example.json"), "utf-8"), "{\n  \"asyncByDefault\": false\n}\n");
	assert.equal(fs.existsSync(path.join(targetRoot, "stale.ts")), false);
});
```

Add another test:

```ts
it("creates an empty user config when the target config is missing", () => {
	const sourceRoot = createTempDir("pi-local-install-src-");
	const targetRoot = createTempDir("pi-local-install-dst-");
	tempDirs.push(sourceRoot, targetRoot);

	fs.writeFileSync(path.join(sourceRoot, "package.json"), "{\n  \"name\": \"pi-superagents\"\n}\n", "utf-8");
	fs.writeFileSync(path.join(sourceRoot, "config.example.json"), "{\n  \"asyncByDefault\": false\n}\n", "utf-8");

	installLocalExtensionFiles({
		sourceRoot,
		targetRoot,
		relativePaths: ["package.json", "config.example.json"],
	});

	assert.equal(fs.readFileSync(path.join(targetRoot, "config.json"), "utf-8"), "{}\n");
});
```

- [ ] **Step 2: Run local installer tests and verify they fail**

Run:

```bash
node --experimental-strip-types --test test/unit/local-extension-install.test.ts
```

Expected: fail because the installer deletes `config.json` during refresh and does not create `{}`.

- [ ] **Step 3: Preserve `config.json` in local installer**

In `scripts/local-extension-install.ts`, add constants:

```ts
const USER_CONFIG_FILE = "config.json";
```

At the beginning of `installLocalExtensionFiles()`, before `fs.rmSync(targetRoot, ...)`, capture the existing user config:

```ts
const userConfigPath = path.join(targetRoot, USER_CONFIG_FILE);
const existingUserConfig = fs.existsSync(userConfigPath)
	? fs.readFileSync(userConfigPath, "utf-8")
	: undefined;
```

After copying packaged files, restore or create user config:

```ts
const finalUserConfigPath = path.join(targetRoot, USER_CONFIG_FILE);
if (existingUserConfig !== undefined) {
	fs.writeFileSync(finalUserConfigPath, existingUserConfig, "utf-8");
} else if (!fs.existsSync(finalUserConfigPath)) {
	fs.writeFileSync(finalUserConfigPath, "{}\n", "utf-8");
}
```

Ensure `config.json` is not part of `relativePaths`; package metadata should not include it.

- [ ] **Step 4: Update `install.mjs` constants and install behavior**

In `install.mjs`, add:

```js
const USER_CONFIG_PATH = path.join(EXTENSION_DIR, "config.json");
const EXAMPLE_CONFIG_PATH = path.join(EXTENSION_DIR, "config.example.json");
```

Replace `ensureUserConfig()` with:

```js
/**
 * Ensure the user-owned override config exists without copying defaults.
 *
 * @returns `true` when a new empty config file was created.
 */
function ensureUserConfig() {
	if (fs.existsSync(USER_CONFIG_PATH)) return false;
	fs.writeFileSync(USER_CONFIG_PATH, "{}\n", "utf-8");
	return true;
}

/**
 * Validate that the user config is parseable enough for install-time guidance.
 *
 * Runtime validation remains authoritative and checks the complete schema.
 *
 * @returns Install-time diagnostics split by severity.
 */
function validateUserConfigForInstall() {
	const result = { errors: [], warnings: [] };
	if (!fs.existsSync(USER_CONFIG_PATH)) return result;
	try {
		const parsed = JSON.parse(fs.readFileSync(USER_CONFIG_PATH, "utf-8"));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			result.errors.push("config.json must contain a JSON object. pi-superagents will stay disabled until this is fixed.");
			return result;
		}
		if (fs.existsSync(DEFAULT_CONFIG_PATH)) {
			const defaults = JSON.parse(fs.readFileSync(DEFAULT_CONFIG_PATH, "utf-8"));
			if (JSON.stringify(parsed) === JSON.stringify(defaults)) {
				result.warnings.push("config.json appears to duplicate bundled defaults. Replace it with {} and keep only local overrides.");
			}
		}
		return result;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		result.errors.push(`config.json is not valid JSON: ${message}. pi-superagents will stay disabled until this is fixed.`);
		return result;
	}
}
```

Update final output to mention both files and diagnostics:

```js
const createdUserConfig = ensureUserConfig();
const installDiagnostics = validateUserConfigForInstall();

console.log(`
The extension is now available in pi. Tools added:
  • subagent       - Delegate tasks to agents (single, chain, parallel)
  • subagent_status - Check async run status and config diagnostics

Documentation: ${EXTENSION_DIR}/README.md
Config override file: ${USER_CONFIG_PATH}${createdUserConfig ? " (created empty)" : ""}
Config examples:       ${EXAMPLE_CONFIG_PATH}
`);

if (installDiagnostics.errors.length || installDiagnostics.warnings.length) {
	console.log("Config diagnostics:");
	for (const diagnostic of installDiagnostics.errors) console.log(`  • ERROR: ${diagnostic}`);
	for (const diagnostic of installDiagnostics.warnings) console.log(`  • WARNING: ${diagnostic}`);
}
```

- [ ] **Step 5: Add installer diagnostic and migration flags**

In `install.mjs`, support `--check-config` and `--migrate-config`:

```js
const isCheckConfig = args.includes("--check-config");
const isMigrateConfig = args.includes("--migrate-config");
```

Add a safe migration helper:

```js
/**
 * Replace an unchanged copied default config with an empty override.
 *
 * @returns Migration result for installer output.
 */
function migrateUserConfigForInstall() {
	if (!fs.existsSync(USER_CONFIG_PATH)) return { changed: false, message: "config.json does not exist." };
	if (!fs.existsSync(DEFAULT_CONFIG_PATH)) return { changed: false, message: "default-config.json is missing; cannot compare safely." };
	const parsed = JSON.parse(fs.readFileSync(USER_CONFIG_PATH, "utf-8"));
	const defaults = JSON.parse(fs.readFileSync(DEFAULT_CONFIG_PATH, "utf-8"));
	if (JSON.stringify(parsed) !== JSON.stringify(defaults)) {
		return { changed: false, message: "No safe migration is available. Edit config.json manually using config.example.json." };
	}
	const backupPath = `${USER_CONFIG_PATH}.bak-${Date.now()}`;
	fs.copyFileSync(USER_CONFIG_PATH, backupPath);
	fs.writeFileSync(USER_CONFIG_PATH, "{}\n", "utf-8");
	return { changed: true, message: `Migrated config.json to {}; backup written to ${backupPath}` };
}
```

After help/remove handling and before install, add:

```js
if (isCheckConfig) {
	const diagnostics = validateUserConfigForInstall();
	if (diagnostics.errors.length === 0 && diagnostics.warnings.length === 0) {
		console.log(`Config is parseable: ${USER_CONFIG_PATH}`);
		process.exit(0);
	}
	for (const diagnostic of diagnostics.errors) console.error(`ERROR: ${diagnostic}`);
	for (const diagnostic of diagnostics.warnings) console.error(`WARNING: ${diagnostic}`);
	process.exit(diagnostics.errors.length ? 1 : 0);
}

if (isMigrateConfig) {
	try {
		const result = migrateUserConfigForInstall();
		console.log(result.message);
		process.exit(result.changed ? 0 : 1);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`Failed to migrate config.json: ${message}`);
		process.exit(1);
	}
}
```

Update help text:

```text
npx @teelicht/pi-superagents --check-config Check user config parseability
npx @teelicht/pi-superagents --migrate-config Apply safe config migrations
```

- [ ] **Step 6: Run local installer tests**

Run:

```bash
node --experimental-strip-types --test test/unit/local-extension-install.test.ts
```

Expected: pass.

- [ ] **Step 7: Run installer flags manually**

Run:

```bash
node install.mjs --help
```

Expected: output includes `--check-config` and `--migrate-config`. `Config override file` and `Config examples` language should appear in normal install output only.

Run the safe migration flag against a temporary home:

```bash
tmp_home="$(mktemp -d)"
mkdir -p "$tmp_home/.pi/agent/extensions/subagent"
cp default-config.json "$tmp_home/.pi/agent/extensions/subagent/default-config.json"
cp default-config.json "$tmp_home/.pi/agent/extensions/subagent/config.json"
HOME="$tmp_home" node install.mjs --migrate-config
cat "$tmp_home/.pi/agent/extensions/subagent/config.json"
```

Expected: command prints a migration message with a backup path, and `cat` prints `{}`.

- [ ] **Step 8: Commit**

```bash
git add install.mjs scripts/local-extension-install.ts test/unit/local-extension-install.test.ts
git commit -m "feat: install empty config overrides"
```

## Task 5: Update Package And Sandbox Install Verification

**Files:**
- Modify: `test/e2e/e2e-sandbox-install.test.ts`
- Modify: `test/unit/package-manifest.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Extend sandbox install expectations**

In `test/e2e/e2e-sandbox-install.test.ts`, after the existing assertions, add package file checks if the harness exposes an install directory. Use defensive checks so the test remains compatible with the current harness shape:

```ts
const installDir = (result as { installDir?: string; packageDir?: string }).installDir
	?? (result as { packageDir?: string }).packageDir;
if (installDir) {
	assert.ok(fs.existsSync(path.join(installDir, "config.example.json")), "config.example.json should be installed");
	assert.equal(fs.existsSync(path.join(installDir, "config.json")), false, "config.json should not be a packaged file");
}
```

Add imports:

```ts
import * as fs from "node:fs";
```

- [ ] **Step 2: Verify package manifest still passes**

Run:

```bash
node --experimental-strip-types --test test/unit/package-manifest.test.ts
```

Expected: pass.

- [ ] **Step 3: Run sandbox install test**

Run:

```bash
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/e2e/e2e-sandbox-install.test.ts
```

Expected: pass, or skip with `pi-test-harness not available` if the optional harness is absent.

- [ ] **Step 4: Commit**

```bash
git add test/e2e/e2e-sandbox-install.test.ts test/unit/package-manifest.test.ts package.json
git commit -m "test: verify config package assets"
```

## Task 6: Update User Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/reference/configuration.md`

- [ ] **Step 1: Update README configuration section**

In `README.md`, add this after Installation and before Optional pi-prompt-template-model:

````md
## Configuration

On install, `pi-superagents` creates an empty user override file:

```text
~/.pi/agent/extensions/subagent/config.json
```

Keep this file small. Add only the settings you want to change. The bundled defaults continue to come from `default-config.json`, and the full user-facing reference lives at:

```text
~/.pi/agent/extensions/subagent/config.example.json
```

If `config.json` contains invalid JSON, unknown keys, or unsupported values, `pi-superagents` disables subagent execution until the file is fixed. Pi shows the config error when the extension loads, and `subagent_status` can inspect config diagnostics.

If your `config.json` is still an unchanged copy of the bundled defaults, run:

```bash
npx @teelicht/pi-superagents --migrate-config
```

or use `subagent_status` with `{ "action": "migrate-config" }` to replace it with `{}` after writing a backup.

See [Configuration Reference](docs/reference/configuration.md) for examples and repair guidance.
````

- [ ] **Step 2: Replace configuration reference opening**

In `docs/reference/configuration.md`, replace the current intro and precedence section with:

````md
# Configuration Reference

`pi-superagents` reads user overrides from:

```text
~/.pi/agent/extensions/subagent/config.json
```

This file is user-owned and should usually contain only the settings you want to change. A fresh install creates it as:

```json
{}
```

Full parseable examples are available in:

```text
~/.pi/agent/extensions/subagent/config.example.json
```

Runtime config precedence:

1. Bundled [default-config.json](../../default-config.json) always loads first.
2. User `config.json` overrides bundled defaults.
3. Empty `{}` means “use all bundled defaults.”

`default-config.json` and `config.example.json` are package-owned files and may be refreshed during updates. Do not edit them for local overrides.

## Validation And Repair

`pi-superagents` fails closed when `config.json` cannot be trusted. If the file has invalid JSON, unknown keys, wrong value types, invalid enum values, or unsupported stale settings, subagent execution is disabled until the file is fixed.

When Pi starts, the extension shows a notification with the config path and exact diagnostics. You can also inspect diagnostics with:

```json
{
  "action": "config"
}
```

using the `subagent_status` tool.

If diagnostics say your config duplicates the bundled defaults, apply the safe empty-override migration:

```bash
npx @teelicht/pi-superagents --migrate-config
```

or call `subagent_status` with:

```json
{
  "action": "migrate-config"
}
```

Both migration paths write a timestamped backup before replacing `config.json` with `{}`.

Common repairs:

- Remove misspelled or unknown keys.
- Compare your file with `config.example.json`.
- Delete a key to fall back to the bundled default.
- Keep `config.json` as a small override file instead of copying the full example.
````

- [ ] **Step 3: Add targeted examples to configuration reference**

Keep the existing config key sections, but add these examples under a new `## Common Override Examples` section before `## Config Keys`:

````md
## Common Override Examples

Enable background execution by default:

```json
{
  "asyncByDefault": true
}
```

Set a default session directory:

```json
{
  "defaultSessionDir": "~/.pi/agent/sessions/subagent/"
}
```

Disable Superpowers worktree defaults:

```json
{
  "superagents": {
    "worktrees": {
      "enabled": false
    }
  }
}
```

Override one model tier while inheriting the rest:

```json
{
  "superagents": {
    "modelTiers": {
      "max": {
        "model": "openai/gpt-5.4",
        "thinking": "high"
      }
    }
  }
}
```

Add a custom model tier:

```json
{
  "superagents": {
    "modelTiers": {
      "free": {
        "model": "google/gemini-flash"
      }
    }
  }
}
````

- [ ] **Step 4: Remove stale install-seeding language**

In `docs/reference/configuration.md`, remove any sentence that says the installer seeds `config.json` from `default-config.json`. Replace it with:

```md
On install, `config.json` is created as an empty override file when missing.
```

- [ ] **Step 5: Commit**

```bash
git add README.md docs/reference/configuration.md
git commit -m "docs: explain config override model"
```

## Task 7: Add Changelog Notes After Implementation

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add `0.2.0` changelog entry**

At the top of `CHANGELOG.md`, above `0.1.0`, add:

```md
## [0.2.0] - 2026-04-11

### Changed

- **Config install model** — fresh installs now create an empty user-owned `config.json` override file instead of copying the full bundled defaults.
- **Config reference file** — installs now include `config.example.json` as the package-owned reference for all supported settings.
- **Fail-closed config validation** — invalid JSON, unknown config keys, stale removed settings, and unsupported values disable `pi-superagents` execution until fixed.
- **Pi-visible diagnostics** — config problems are reported when Pi starts, and `subagent_status` can inspect config diagnostics.
- **Safe config migration** — unchanged full-default config files can be backed up and replaced with `{}` through `--migrate-config` or `subagent_status`.

### Migration Notes

- Existing `config.json` files are preserved during install/update.
- Keep only local overrides in `config.json`; compare with `config.example.json` for the current supported shape.
- If Pi reports that `pi-superagents` is disabled, fix or remove the reported keys to fall back to bundled defaults.
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: add 0.2.0 changelog"
```

## Task 8: Full Verification

**Files:**
- No code changes expected.

- [ ] **Step 1: Run all unit tests**

Run:

```bash
npm run test:unit
```

Expected: all unit tests pass.

- [ ] **Step 2: Run all integration tests**

Run:

```bash
npm run test:integration
```

Expected: all integration tests pass, with optional dependency skips only where already expected.

- [ ] **Step 3: Run install-oriented e2e tests**

Run:

```bash
npm run test:e2e
```

Expected: all e2e tests pass, or optional harness-dependent tests skip with explicit skip messages.

- [ ] **Step 4: Inspect package contents**

Run:

```bash
npm pack --dry-run --json
```

Expected: output includes:

```text
config.example.json
default-config.json
src/extension/index.ts
src/extension/notify.ts
```

and does not include:

```text
config.json
```

- [ ] **Step 5: Verify final git state**

Run:

```bash
git status --short
git log --oneline -8
```

Expected:

- `git status --short` is clean.
- Recent commits include the task commits above.
