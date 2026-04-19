# Live Model Tier Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `/sp-settings` change Superpowers model tier mappings from PI's available model list and apply those changes to future subagents in the same PI session.

**Architecture:** Add a live runtime config store that owns the effective merged config and gate diagnostics, then thread a `getConfig()` accessor through command and executor code instead of closing over a startup snapshot. Extend the settings overlay with a tier-selection and model-selection flow that writes `config.json`, reloads the store, and rerenders from live state.

**Tech Stack:** TypeScript, Node.js built-in test runner, PI extension API, `@mariozechner/pi-tui` components, existing JSON config validation and writer helpers.

---

## File Structure

- Create `src/extension/config-store.ts`
  - Own extension-level config paths, effective config loading, gate diagnostics, and in-place gate mutation.
  - Export `createRuntimeConfigStore()`, `loadRuntimeConfigState()`, and `RuntimeConfigStore`.
- Create `test/unit/config-store.test.ts`
  - Unit coverage for startup load, reload, diagnostics, and stable `ConfigGateState` object identity.
- Modify `src/extension/index.ts`
  - Replace local `loadConfigState()` with the runtime config store.
  - Pass config accessors into the executor, slash commands, settings overlay, and runtime checks.
- Modify `src/execution/subagent-executor.ts`
  - Accept `getConfig()` in dependencies.
  - Resolve config at execution time and pass the fresh config through single/parallel execution.
- Modify `src/slash/slash-commands.ts`
  - Accept `getConfig()` and a settings overlay dependency object.
  - Resolve command profiles and settings overlay content from live config.
- Modify `src/ui/sp-settings.ts`
  - Render from `getConfig()`.
  - Add tier selection and model picker paths.
  - Write model tier changes and call the config store reload callback.
- Modify `src/superpowers/config-writer.ts`
  - Add `setSuperpowersModelTierModel()` helper.
- Modify tests:
  - `test/unit/superpowers-config-writer.test.ts`
  - `test/unit/sp-settings.test.ts`
  - `test/unit/superpowers-policy.test.ts`
  - `test/integration/slash-commands.test.ts`
- Modify docs after code is passing:
  - `README.md`
  - `docs/configuration.md`
  - `docs/parameters.md`
  - `docs/skills.md`
  - `docs/worktrees.md`

## Task 1: Add Runtime Config Store

**Files:**
- Create: `src/extension/config-store.ts`
- Test: `test/unit/config-store.test.ts`

- [ ] **Step 1: Write failing config store tests**

Create `test/unit/config-store.test.ts` with this content:

```typescript
/**
 * Unit tests for the live runtime config store.
 *
 * Responsibilities:
 * - verify config defaults and user overrides load through one runtime owner
 * - verify reload updates effective config without replacing the gate object
 * - verify invalid config produces the same blocked diagnostics shape as startup
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import { createRuntimeConfigStore, loadRuntimeConfigState } from "../../src/extension/config-store.ts";
import type { ExtensionConfig } from "../../src/shared/types.ts";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * Create isolated config paths for one config-store test.
 *
 * @param defaults Bundled default config object.
 * @param user User override text, or undefined to omit the user config file.
 * @returns Absolute config paths for store creation.
 */
function createConfigFixture(defaults: ExtensionConfig, user?: string) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-config-store-"));
	tempDirs.push(dir);
	const defaultConfigPath = path.join(dir, "default-config.json");
	const configPath = path.join(dir, "config.json");
	const examplePath = path.join(dir, "config.example.json");
	fs.writeFileSync(defaultConfigPath, `${JSON.stringify(defaults, null, 2)}\n`, "utf-8");
	fs.writeFileSync(examplePath, "{}\n", "utf-8");
	if (user !== undefined) fs.writeFileSync(configPath, user, "utf-8");
	return { defaultConfigPath, configPath, examplePath };
}

void describe("runtime config store", () => {
	void it("loads defaults when no user config exists", () => {
		const paths = createConfigFixture({
			superagents: {
				modelTiers: {
					cheap: { model: "openai/gpt-5.4" },
				},
			},
		});

		const state = loadRuntimeConfigState(paths);

		assert.equal(state.blocked, false);
		assert.equal(state.message, "");
		assert.deepEqual(state.config.superagents?.modelTiers?.cheap, { model: "openai/gpt-5.4" });
		assert.equal(state.configPath, paths.configPath);
		assert.equal(state.examplePath, paths.examplePath);
	});

	void it("reloads user overrides while preserving the same gate object", () => {
		const paths = createConfigFixture(
			{
				superagents: {
					modelTiers: {
						balanced: { model: "openai/gpt-5.4" },
					},
				},
			},
			'{"superagents":{"modelTiers":{"balanced":{"model":"anthropic/claude-opus-4.6"}}}}\n',
		);
		const store = createRuntimeConfigStore(paths);
		const gate = store.getGate();

		assert.equal(store.getConfig().superagents?.modelTiers?.balanced?.["model"], "anthropic/claude-opus-4.6");

		fs.writeFileSync(
			paths.configPath,
			'{"superagents":{"modelTiers":{"balanced":{"model":"openai/gpt-5.3"}}}}\n',
			"utf-8",
		);
		const reloadedGate = store.reload();

		assert.equal(reloadedGate, gate);
		assert.equal(store.getGate(), gate);
		assert.equal(store.getConfig().superagents?.modelTiers?.balanced?.["model"], "openai/gpt-5.3");
		assert.equal(store.getGate().blocked, false);
	});

	void it("blocks invalid JSON and keeps a formatted diagnostic message", () => {
		const paths = createConfigFixture(
			{
				superagents: {
					modelTiers: {
						balanced: { model: "openai/gpt-5.4" },
					},
				},
			},
			"{",
		);

		const store = createRuntimeConfigStore(paths);

		assert.equal(store.getGate().blocked, true);
		assert.match(store.getGate().message, /pi-superagents is disabled because config\.json needs attention/);
		assert.match(store.getGate().message, /Path:/);
		assert.equal(store.getConfig().superagents, undefined);
	});

	void it("blocks invalid model tier values through normal validation", () => {
		const paths = createConfigFixture(
			{
				superagents: {
					modelTiers: {
						balanced: { model: "openai/gpt-5.4" },
					},
				},
			},
			'{"superagents":{"modelTiers":{"balanced":{"model":""}}}}\n',
		);

		const store = createRuntimeConfigStore(paths);

		assert.equal(store.getGate().blocked, true);
		assert.match(store.getGate().message, /superagents\.modelTiers\.balanced\.model/);
		assert.equal(store.getConfig().superagents?.modelTiers?.balanced?.["model"], "openai/gpt-5.4");
	});
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm run test:unit -- test/unit/config-store.test.ts
```

Expected: fail because `../../src/extension/config-store.ts` does not exist.

- [ ] **Step 3: Implement `src/extension/config-store.ts`**

Create `src/extension/config-store.ts` with this content:

```typescript
/**
 * Live runtime config store for the Superagents extension.
 *
 * Responsibilities:
 * - load bundled defaults and user overrides into one effective ExtensionConfig
 * - preserve startup-style config gate diagnostics for runtime consumers
 * - support in-session reloads after settings writes without reloading PI
 *
 * Important side effects:
 * - reads JSON config files from disk when loading or reloading
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { formatConfigDiagnostics, loadEffectiveConfig } from "../execution/config-validation.ts";
import type { ConfigDiagnostic, ConfigGateState, ExtensionConfig } from "../shared/types.ts";

export interface RuntimeConfigPaths {
	defaultConfigPath: string;
	configPath: string;
	examplePath: string;
}

export interface LoadedConfigState {
	config: ExtensionConfig;
	blocked: boolean;
	diagnostics: ConfigDiagnostic[];
	message: string;
	configPath: string;
	examplePath: string;
}

export interface RuntimeConfigStore {
	getConfig(): ExtensionConfig;
	getGate(): ConfigGateState;
	reload(): ConfigGateState;
}

/**
 * Build the default config paths used by the installed extension.
 *
 * @returns Absolute paths for bundled defaults, user config, and example config.
 */
export function resolveRuntimeConfigPaths(): RuntimeConfigPaths {
	const extensionDir = path.dirname(fileURLToPath(import.meta.url));
	const packageRoot = path.resolve(extensionDir, "..", "..");
	return {
		defaultConfigPath: path.join(packageRoot, "default-config.json"),
		configPath: path.join(os.homedir(), ".pi", "agent", "extensions", "subagent", "config.json"),
		examplePath: path.join(os.homedir(), ".pi", "agent", "extensions", "subagent", "config.example.json"),
	};
}

/**
 * Read one JSON config file from disk.
 *
 * @param filePath Absolute path to the JSON file.
 * @returns Parsed JSON value or undefined when the file is absent.
 */
function readJsonConfig(filePath: string): unknown {
	if (!fs.existsSync(filePath)) return undefined;
	return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

/**
 * Load and validate extension config, preserving diagnostics for user display.
 *
 * @param paths Optional config paths for tests or installed runtime.
 * @returns Validated config state for runtime registration.
 */
export function loadRuntimeConfigState(paths: RuntimeConfigPaths = resolveRuntimeConfigPaths()): LoadedConfigState {
	try {
		const bundledDefaults = (readJsonConfig(paths.defaultConfigPath) ?? {}) as ExtensionConfig;
		const userConfig = readJsonConfig(paths.configPath);
		const result = loadEffectiveConfig(bundledDefaults, userConfig);
		const message = result.diagnostics.length
			? formatConfigDiagnostics(result.diagnostics, { configPath: paths.configPath, examplePath: paths.examplePath })
			: "";
		return {
			config: result.config,
			blocked: result.blocked,
			diagnostics: result.diagnostics,
			message,
			configPath: paths.configPath,
			examplePath: paths.examplePath,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const diagnostics: ConfigDiagnostic[] = [
			{
				level: "error",
				code: "config_load_failed",
				path: "config.json",
				message,
			},
		];
		return {
			config: {},
			blocked: true,
			diagnostics,
			message: formatConfigDiagnostics(diagnostics, {
				configPath: paths.configPath,
				examplePath: paths.examplePath,
			}),
			configPath: paths.configPath,
			examplePath: paths.examplePath,
		};
	}
}

/**
 * Copy one loaded config state into a stable ConfigGateState object.
 *
 * @param target Mutable gate object shared with extension state.
 * @param source Freshly loaded config state.
 */
function assignGate(target: ConfigGateState, source: LoadedConfigState): void {
	target.blocked = source.blocked;
	target.diagnostics = source.diagnostics;
	target.message = source.message;
	target.configPath = source.configPath;
	target.examplePath = source.examplePath;
}

/**
 * Create the live runtime config store used by the extension.
 *
 * @param paths Optional config paths for tests or installed runtime.
 * @returns Runtime store exposing current effective config and gate state.
 */
export function createRuntimeConfigStore(paths: RuntimeConfigPaths = resolveRuntimeConfigPaths()): RuntimeConfigStore {
	let loaded = loadRuntimeConfigState(paths);
	const gate: ConfigGateState = {
		blocked: loaded.blocked,
		diagnostics: loaded.diagnostics,
		message: loaded.message,
		configPath: loaded.configPath,
		examplePath: loaded.examplePath,
	};

	return {
		getConfig() {
			return loaded.config;
		},
		getGate() {
			return gate;
		},
		reload() {
			loaded = loadRuntimeConfigState(paths);
			assignGate(gate, loaded);
			return gate;
		},
	};
}
```

- [ ] **Step 4: Run the config store test**

Run:

```bash
npm run test:unit -- test/unit/config-store.test.ts
```

Expected: pass all tests in `config-store.test.ts`.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add src/extension/config-store.ts test/unit/config-store.test.ts
git commit -m "feat: add live config store"
```

Expected: commit succeeds.

## Task 2: Thread Live Config Through Extension Runtime

**Files:**
- Modify: `src/extension/index.ts`
- Modify: `src/execution/subagent-executor.ts`
- Modify: `src/slash/slash-commands.ts`
- Test: `test/integration/slash-commands.test.ts`

- [ ] **Step 1: Write failing slash-command live-config test**

In `test/integration/slash-commands.test.ts`, update `RegisterSlashCommandsModule.registerSlashCommands` so the third parameter can be either an `ExtensionConfig` or a config accessor:

```typescript
type ConfigInput = ExtensionConfig | (() => ExtensionConfig);
```

Change the register signature to:

```typescript
registerSlashCommands?: (
	pi: {
		events: EventBus;
		registerCommand(
			name: string,
			spec: { description?: string; handler(args: string, ctx: unknown): Promise<void> },
		): void;
		registerShortcut(name: string, spec: ShortcutSpec): void;
		sendMessage(message: unknown): void;
		sendUserMessage(content: string | unknown[], options?: { deliverAs?: "steer" | "followUp" }): void;
	},
	state: {
		baseCwd: string;
		currentSessionId: string | null;
		asyncJobs: Map<string, unknown>;
		cleanupTimers: Map<string, ReturnType<typeof setTimeout>>;
		lastUiContext: unknown;
		poller: NodeJS.Timeout | null;
		completionSeen: Map<string, number>;
		watcher: unknown;
		watcherRestartTimer: ReturnType<typeof setTimeout> | null;
		resultFileCoalescer: { schedule(file: string, delayMs?: number): boolean; clear(): void };
		configGate: {
			blocked: boolean;
			diagnostics: unknown[];
			message: string;
			configPath?: string;
			examplePath?: string;
		};
	},
	config: ConfigInput,
) => void;
```

Add this test near the other slash command tests:

```typescript
void it("resolves command profiles from the latest config accessor value", async () => {
	const cwd = createSkillFixtureCwd();
	const { commands, userMessages, pi } = createPiHarness();
	let config = createEffectiveConfig({
		superagents: {
			commands: {
				"sp-live": {
					description: "Live config command",
					entrySkill: "using-superpowers",
					useSubagents: false,
				},
			},
		},
	});

	registerSlashCommands!(pi, createState(cwd), () => config);
	config = createEffectiveConfig({
		superagents: {
			commands: {
				"sp-live": {
					description: "Live config command",
					entrySkill: "using-superpowers",
					useSubagents: true,
				},
			},
		},
	});

	await commands.get("sp-live")!.handler("fix runtime config", createCommandContext({ cwd }));

	assert.equal(userMessages.length, 1);
	assert.match(String(userMessages[0].content), /useSubagents: true/);
});
```

- [ ] **Step 2: Run the failing slash-command test**

Run:

```bash
npm run test:integration -- test/integration/slash-commands.test.ts
```

Expected: fail because `registerSlashCommands()` still expects a config object and resolves the original snapshot.

- [ ] **Step 3: Update `src/slash/slash-commands.ts` to accept live config**

Add this type and helper after imports:

```typescript
type ConfigSource = ExtensionConfig | (() => ExtensionConfig);

/**
 * Resolve the current effective extension config from a config object or accessor.
 *
 * @param source Config object or callback supplied by extension registration.
 * @returns Current effective extension config.
 */
function readConfig(source: ConfigSource): ExtensionConfig {
	return typeof source === "function" ? source() : source;
}
```

Change `openSuperpowersSettingsOverlay()` to accept `configSource: ConfigSource` for now:

```typescript
async function openSuperpowersSettingsOverlay(
	ctx: ExtensionContext,
	state: SubagentState,
	configSource: ConfigSource,
): Promise<void> {
	if (!ctx.hasUI) return;
	await ctx.ui.custom<void>(
		(tui, theme, _kb, done) =>
			new SuperpowersSettingsComponent(tui, theme, state, readConfig(configSource), () => done(undefined)),
		{ overlay: true, overlayOptions: { anchor: "center", width: 92, maxHeight: "80%" } },
	);
}
```

Change `registerSuperpowersCommand()` to receive `configSource: ConfigSource` and read it inside the handler:

```typescript
function registerSuperpowersCommand(
	pi: ExtensionAPI,
	dispatcher: ReturnType<typeof createSuperpowersPromptDispatcher>,
	state: SubagentState,
	configSource: ConfigSource,
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
					ctx.ui.notify(
						`Usage: /${commandName} [lean|full|tdd|direct|subagents|no-subagents] <task> [--fork]`,
						"error",
					);
				}
				return Promise.resolve();
			}
			const config = readConfig(configSource);
			const currentPreset = config.superagents?.commands?.[commandName] ?? preset;
			const profile = resolveSuperpowersRunProfile({
				config,
				commandName,
				parsed,
				entrySkill: currentPreset.entrySkill,
			});
			sendSkillEntryPrompt(dispatcher, ctx, profile);
			return Promise.resolve();
		},
	});
}
```

Change `registerSlashCommands()` signature and registration loop:

```typescript
export function registerSlashCommands(pi: ExtensionAPI, state: SubagentState, configSource: ConfigSource): void {
	const dispatcher = createSuperpowersPromptDispatcher(pi);
	const startupConfig = readConfig(configSource);

	for (const [commandName, preset] of Object.entries(startupConfig.superagents?.commands ?? {})) {
		registerSuperpowersCommand(pi, dispatcher, state, configSource, commandName, preset);
	}
```

Change the `/sp-settings` handler:

```typescript
pi.registerCommand("sp-settings", {
	description: "Show Superpowers and subagent workflow settings",
	handler: async (_args, ctx) => {
		await openSuperpowersSettingsOverlay(ctx, state, configSource);
	},
});
```

- [ ] **Step 4: Update `src/execution/subagent-executor.ts` to use `getConfig()`**

Change `ExecutorDeps`:

```typescript
interface ExecutorDeps {
	pi: ExtensionAPI;
	state: SubagentState;
	getConfig: () => ExtensionConfig;
	tempArtifactsDir: string;
	getSubagentSessionRoot: (parentSessionFile: string | null) => string;
	expandTilde: (p: string) => string;
	discoverAgents: (cwd: string, scope: AgentScope) => { agents: AgentConfig[] };
}
```

In `execute()`, add:

```typescript
const config = deps.getConfig();
```

Use `config` instead of `deps.config` in the whole function and downstream calls:

```typescript
const { blocked, depth, maxDepth } = checkSubagentDepth(config.maxSubagentDepth);
```

```typescript
useTestDrivenDevelopment:
	params.useTestDrivenDevelopment ??
	config.superagents?.commands?.["sp-implement"]?.useTestDrivenDevelopment ??
	true,
```

Change calls in `runParallelPath()` and `runSinglePath()` by reading fresh config at the top of each helper:

```typescript
const config = deps.getConfig();
```

Then replace helper usages:

```typescript
const currentMaxSubagentDepth = resolveCurrentMaxSubagentDepth(config.maxSubagentDepth);
const effectiveWorktree = resolveSuperagentWorktreeEnabled(params.worktree, workflow, config);
```

```typescript
deps.config
```

becomes:

```typescript
config
```

when passing `config` to `createParallelWorktreeSetup()`, `runForegroundParallelTasks()`, and `runSync()`.

- [ ] **Step 5: Update `src/extension/index.ts` to create and pass the store**

Remove the local `readJsonConfig()`, `LoadedConfigState`, and `loadConfigState()` definitions from `src/extension/index.ts`.

Add this import:

```typescript
import { createRuntimeConfigStore, type LoadedConfigState } from "./config-store.ts";
```

Keep `_migrateCopiedDefaultConfig()` compiling by importing `LoadedConfigState`.

Replace startup config creation:

```typescript
const configState = loadConfigState();
const config = configState.config;
```

with:

```typescript
const configStore = createRuntimeConfigStore();
```

Build `state` from the store gate:

```typescript
const state: SubagentState = {
	baseCwd: process.cwd(),
	currentSessionId: null,
	lastUiContext: null,
	configGate: configStore.getGate(),
};
```

Create executor with:

```typescript
const executor = createSubagentExecutor({
	pi,
	state,
	getConfig: () => configStore.getConfig(),
	tempArtifactsDir,
	getSubagentSessionRoot,
	expandTilde,
	discoverAgents,
});
```

Replace Plannotator config reads:

```typescript
if (configStore.getConfig().superagents?.commands?.["sp-plan"]?.usePlannotator !== true) {
```

and any other local `config` references with `configStore.getConfig()`.

Register slash commands with:

```typescript
registerSlashCommands(pi, state, () => configStore.getConfig());
```

Change skill interception calls to read current config:

```typescript
const config = configStore.getConfig();
if (!shouldInterceptSkillCommand(parsedSkillCommand.skillName, config)) {
	return { action: "continue" as const };
}
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm run test:unit -- test/unit/config-store.test.ts
npm run test:integration -- test/integration/slash-commands.test.ts
```

Expected: both commands pass.

- [ ] **Step 7: Commit Task 2**

Run:

```bash
git add src/extension/index.ts src/execution/subagent-executor.ts src/slash/slash-commands.ts test/integration/slash-commands.test.ts
git commit -m "feat: read superagents config live"
```

Expected: commit succeeds.

## Task 3: Add Model Tier Config Writer Helper

**Files:**
- Modify: `src/superpowers/config-writer.ts`
- Test: `test/unit/superpowers-config-writer.test.ts`

- [ ] **Step 1: Write failing config writer tests**

Update the import in `test/unit/superpowers-config-writer.test.ts`:

```typescript
import {
	setSuperpowersModelTierModel,
	toggleSuperpowersBoolean,
	toggleSuperpowersWorktrees,
	updateSuperpowersConfigText,
} from "../../src/superpowers/config-writer.ts";
```

Add these tests inside the existing `describe` block:

```typescript
void it("updates an object model tier while preserving thinking", () => {
	const updated = updateSuperpowersConfigText(
		'{\n  "superagents": {\n    "modelTiers": {\n      "balanced": { "model": "openai/gpt-5.4", "thinking": "medium" }\n    }\n  }\n}\n',
		(config) => setSuperpowersModelTierModel(config, "balanced", "anthropic/claude-opus-4.6"),
	);
	assert.deepEqual(JSON.parse(updated), {
		superagents: {
			modelTiers: {
				balanced: { model: "anthropic/claude-opus-4.6", thinking: "medium" },
			},
		},
	});
});

void it("converts a string model tier to object form", () => {
	const updated = updateSuperpowersConfigText(
		'{\n  "superagents": {\n    "modelTiers": {\n      "cheap": "openai/gpt-5.4"\n    }\n  }\n}\n',
		(config) => setSuperpowersModelTierModel(config, "cheap", "opencode-go/glm-5.1"),
	);
	assert.deepEqual(JSON.parse(updated), {
		superagents: {
			modelTiers: {
				cheap: { model: "opencode-go/glm-5.1" },
			},
		},
	});
});

void it("creates missing model tier containers", () => {
	const updated = updateSuperpowersConfigText("{}", (config) =>
		setSuperpowersModelTierModel(config, "max", "openai/gpt-5.4"),
	);
	assert.deepEqual(JSON.parse(updated), {
		superagents: {
			modelTiers: {
				max: { model: "openai/gpt-5.4" },
			},
		},
	});
});
```

- [ ] **Step 2: Run the failing config writer tests**

Run:

```bash
npm run test:unit -- test/unit/superpowers-config-writer.test.ts
```

Expected: fail because `setSuperpowersModelTierModel` is not exported.

- [ ] **Step 3: Implement `setSuperpowersModelTierModel()`**

In `src/superpowers/config-writer.ts`, add `ModelTierSetting` to the import:

```typescript
import type { ExtensionConfig, ModelTierSetting } from "../shared/types.ts";
```

Add this helper after `ensureSuperagents()`:

```typescript
/**
 * Ensure a mutable Superpowers model tier map exists.
 *
 * @param config - Mutable config object to ensure the modelTiers map on.
 * @returns The mutable model tier map.
 */
function ensureModelTiers(config: MutableConfig): Record<string, ModelTierSetting> {
	const settings = ensureSuperagents(config);
	settings.modelTiers ??= {};
	return settings.modelTiers;
}
```

Add this exported function after `toggleSuperpowersWorktrees()`:

```typescript
/**
 * Set the concrete model for one Superpowers model tier.
 *
 * Preserves an existing tier thinking value when the tier is already stored as
 * an object. String shorthand tiers are converted to object form because the
 * settings editor always writes through the structured tier shape.
 *
 * @param config - Mutable config object to modify in place.
 * @param tierName - Non-empty tier name to update.
 * @param model - Non-empty concrete model string in provider/model format.
 * @returns The same config reference, modified.
 * @throws Error when tierName or model is empty.
 */
export function setSuperpowersModelTierModel(
	config: MutableConfig,
	tierName: string,
	model: string,
): MutableConfig {
	const normalizedTierName = tierName.trim();
	const normalizedModel = model.trim();
	if (!normalizedTierName) throw new Error("Model tier name must be non-empty.");
	if (!normalizedModel) throw new Error("Model tier model must be non-empty.");

	const modelTiers = ensureModelTiers(config);
	const existing = modelTiers[normalizedTierName];
	if (existing && typeof existing === "object" && !Array.isArray(existing)) {
		modelTiers[normalizedTierName] = { ...existing, model: normalizedModel };
		return config;
	}

	modelTiers[normalizedTierName] = { model: normalizedModel };
	return config;
}
```

- [ ] **Step 4: Run config writer tests**

Run:

```bash
npm run test:unit -- test/unit/superpowers-config-writer.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add src/superpowers/config-writer.ts test/unit/superpowers-config-writer.test.ts
git commit -m "feat: write model tier overrides"
```

Expected: commit succeeds.

## Task 4: Add Settings Overlay Model Picker

**Files:**
- Modify: `src/slash/slash-commands.ts`
- Modify: `src/ui/sp-settings.ts`
- Test: `test/unit/sp-settings.test.ts`
- Test: `test/integration/slash-commands.test.ts`

- [ ] **Step 1: Write failing settings overlay tests**

In `test/unit/sp-settings.test.ts`, replace `createTuiMock()` with:

```typescript
function createTuiMock() {
	return { requestRender: () => {} };
}

function createModel(provider: string, id: string, name = id) {
	return {
		provider,
		id,
		name,
	};
}
```

Add this test:

```typescript
void test("SuperpowersSettingsComponent writes model tier selections and reloads config", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-settings-model-"));
	const configPath = path.join(dir, "config.json");
	fs.writeFileSync(
		configPath,
		'{\n  "superagents": {\n    "modelTiers": {\n      "balanced": { "model": "openai/gpt-5.4", "thinking": "medium" }\n    }\n  }\n}\n',
		"utf-8",
	);
	let reloadCount = 0;
	const component = new SuperpowersSettingsComponent(
		createTuiMock() as never,
		createThemeMock() as never,
		createState(configPath) as never,
		() => ({
			superagents: {
				modelTiers: {
					balanced: { model: "openai/gpt-5.4", thinking: "medium" },
				},
			},
		}),
		() => {},
		{
			models: [createModel("anthropic", "claude-opus-4.6")],
			reloadConfig: () => {
				reloadCount++;
			},
			modelRegistryError: undefined,
		} as never,
	);

	component.selectTierForTest("balanced");
	component.selectModelForTest("anthropic/claude-opus-4.6");

	assert.equal(reloadCount, 1);
	assert.deepStrictEqual(JSON.parse(fs.readFileSync(configPath, "utf-8")), {
		superagents: {
			modelTiers: {
				balanced: { model: "anthropic/claude-opus-4.6", thinking: "medium" },
			},
		},
	});
	assert.match(component.render(100).join("\n"), /Applied to this PI session/);
	fs.rmSync(dir, { recursive: true, force: true });
});

void test("SuperpowersSettingsComponent reports when no models are available", () => {
	const component = new SuperpowersSettingsComponent(
		createTuiMock() as never,
		createThemeMock() as never,
		createState("/tmp/config.json") as never,
		() => ({
			superagents: {
				modelTiers: {
					cheap: { model: "openai/gpt-5.4" },
				},
			},
		}),
		() => {},
		{
			models: [],
			reloadConfig: () => {},
			modelRegistryError: "models.json failed",
		} as never,
	);

	component.selectTierForTest("cheap");

	const rendered = component.render(100).join("\n");
	assert.match(rendered, /No authenticated models available/);
	assert.match(rendered, /models\.json failed/);
});
```

Update existing constructor calls in this file from passing a config object to passing a config accessor:

```typescript
() => ({
	superagents: {
		commands: {
			"sp-implement": {
				useSubagents: false,
				useTestDrivenDevelopment: true,
				worktrees: { enabled: true, root: "/tmp/superpowers-worktrees" },
			},
			"sp-review": { description: "Review", useSubagents: false },
		},
		modelTiers: { cheap: { model: "test-model" } },
	},
})
```

Use the same pattern for the other existing settings tests.

- [ ] **Step 2: Run the failing settings tests**

Run:

```bash
npm run test:unit -- test/unit/sp-settings.test.ts
```

Expected: fail because the settings component does not accept a config accessor, model options, or test selection helpers.

- [ ] **Step 3: Update `SuperpowersSettingsComponent` constructor and imports**

In `src/ui/sp-settings.ts`, add imports:

```typescript
import { setSuperpowersModelTierModel, toggleSuperpowersBoolean, toggleSuperpowersWorktrees, updateSuperpowersConfigText } from "../superpowers/config-writer.ts";
```

Replace the current config import block so `matchesKey` still comes from `@mariozechner/pi-tui`:

```typescript
import type { Component, TUI } from "@mariozechner/pi-tui";
import { matchesKey, SelectList } from "@mariozechner/pi-tui";
```

Add these types near the top:

```typescript
type ConfigAccessor = () => ExtensionConfig;

interface SettingsModelOption {
	provider: string;
	id: string;
	name?: string;
}

export interface SuperpowersSettingsModelPickerOptions {
	models?: SettingsModelOption[];
	modelRegistryError?: string;
	reloadConfig?: () => void;
}

type SettingsMode = "settings" | "tier-picker" | "model-picker";
```

Change class fields:

```typescript
private selectedTier: string | undefined;
private mode: SettingsMode = "settings";
private readonly getConfig: ConfigAccessor;
private readonly modelOptions: SettingsModelOption[];
private readonly modelRegistryError: string | undefined;
private readonly reloadConfig: () => void;
```

Change the constructor signature:

```typescript
constructor(
	tui: TUI,
	theme: Theme,
	state: SubagentState,
	config: ExtensionConfig | ConfigAccessor,
	done: () => void,
	options: SuperpowersSettingsModelPickerOptions = {},
) {
	this.tui = tui;
	this.theme = theme;
	this.state = state;
	this.getConfig = typeof config === "function" ? config : () => config;
	this.done = done;
	this.modelOptions = options.models ?? [];
	this.modelRegistryError = options.modelRegistryError;
	this.reloadConfig = options.reloadConfig ?? (() => {});
}
```

- [ ] **Step 4: Add tier/model mode rendering helpers**

In `src/ui/sp-settings.ts`, change `render()` to choose a title/footer:

```typescript
render(width: number): string[] {
	const title =
		this.mode === "model-picker"
			? `Select Model for ${this.selectedTier ?? "tier"}`
			: this.mode === "tier-picker"
				? "Select Model Tier"
				: "Superpowers Settings";
	const footer =
		this.mode === "settings"
			? "p plannotator | s subagents | t tdd | w worktrees | m models | q close"
			: "enter select | esc back";
	return renderFramedPanel(title, this.renderBody(), Math.min(width, 100), this.theme, footer);
}
```

Change the top of `handleInput()`:

```typescript
handleInput(data: string): void {
	if (this.mode !== "settings") {
		this.handlePickerInput(data);
		return;
	}
	if (matchesKey(data, "escape") || matchesKey(data, "q") || matchesKey(data, "ctrl+c")) {
		this.done();
		return;
	}
	if (matchesKey(data, "m")) {
		this.mode = "tier-picker";
		this.tui.requestRender();
		return;
	}
```

Add helper methods:

```typescript
/**
 * Handle keyboard input while one of the model picker screens is active.
 *
 * @param data Raw key data from the TUI.
 */
private handlePickerInput(data: string): void {
	if (matchesKey(data, "escape") || matchesKey(data, "q") || matchesKey(data, "ctrl+c")) {
		this.mode = "settings";
		this.selectedTier = undefined;
		this.tui.requestRender();
		return;
	}
	const list = this.createCurrentSelectList();
	list.handleInput(data);
	this.tui.requestRender();
}

/**
 * Create the SelectList for the active picker mode.
 *
 * @returns SelectList wired to update this component.
 */
private createCurrentSelectList(): SelectList {
	const list =
		this.mode === "model-picker"
			? this.createModelSelectList()
			: this.createTierSelectList();
	return list;
}

/**
 * Create the model-tier picker list.
 *
 * @returns SelectList of configured tier names.
 */
private createTierSelectList(): SelectList {
	const items = this.modelTierEntries().map(([name, value]) => ({
		value: name,
		label: name,
		description: tierModel(value),
	}));
	const list = new SelectList(items, Math.min(Math.max(items.length, 1), 10), this.selectTheme());
	list.onSelect = (item) => {
		this.selectedTier = item.value;
		this.mode = "model-picker";
	};
	list.onCancel = () => {
		this.mode = "settings";
	};
	return list;
}

/**
 * Create the concrete model picker list.
 *
 * @returns SelectList of PI model registry entries.
 */
private createModelSelectList(): SelectList {
	const items = this.modelOptions.map((model) => ({
		value: modelToValue(model),
		label: modelToValue(model),
		description: model.name && model.name !== model.id ? model.name : model.provider,
	}));
	const list = new SelectList(items, Math.min(Math.max(items.length, 1), 12), this.selectTheme(), {
		maxPrimaryColumnWidth: 48,
	});
	list.onSelect = (item) => {
		if (this.selectedTier) this.writeModelTier(this.selectedTier, item.value);
		this.mode = "settings";
		this.selectedTier = undefined;
	};
	list.onCancel = () => {
		this.mode = "tier-picker";
	};
	return list;
}

/**
 * Build SelectList theme functions from the active PI theme.
 *
 * @returns SelectList theme adapter.
 */
private selectTheme() {
	return {
		selectedPrefix: (text: string) => this.theme.fg("accent", text),
		selectedText: (text: string) => this.theme.fg("accent", text),
		description: (text: string) => this.theme.fg("muted", text),
		scrollInfo: (text: string) => this.theme.fg("dim", text),
		noMatch: (text: string) => this.theme.fg("warning", text),
	};
}
```

- [ ] **Step 5: Update settings body and write path**

Replace `const settings = this.config.superagents ?? {};` in `renderBody()` with:

```typescript
if (this.mode === "tier-picker") return this.renderTierPickerBody();
if (this.mode === "model-picker") return this.renderModelPickerBody();

const settings = this.getConfig().superagents ?? {};
```

Add body helpers:

```typescript
/**
 * Render the tier picker body.
 *
 * @returns Lines for the current tier picker.
 */
private renderTierPickerBody(): string[] {
	const entries = this.modelTierEntries();
	if (!entries.length) return ["No model tiers configured."];
	return this.createTierSelectList().render(96);
}

/**
 * Render the model picker body.
 *
 * @returns Lines for the concrete model picker.
 */
private renderModelPickerBody(): string[] {
	const lines: string[] = [];
	const currentTier = this.selectedTier;
	if (currentTier) {
		const current = this.getConfig().superagents?.modelTiers?.[currentTier];
		lines.push(`Current: ${tierModel(current)}`);
		lines.push("");
	}
	if (this.modelRegistryError) {
		lines.push(this.modelRegistryError);
		lines.push("");
	}
	if (!this.modelOptions.length) {
		lines.push("No authenticated models available.");
		return lines;
	}
	return [...lines, ...this.createModelSelectList().render(96)];
}

/**
 * Return configured model tier entries from the current config.
 *
 * @returns Tier entries sorted by tier name.
 */
private modelTierEntries(): Array<[string, unknown]> {
	return Object.entries(this.getConfig().superagents?.modelTiers ?? {}).sort(([left], [right]) =>
		left.localeCompare(right),
	);
}

/**
 * Write one model tier selection to disk and reload live config.
 *
 * @param tierName Tier name to update.
 * @param model Concrete provider/model value selected from PI.
 */
private writeModelTier(tierName: string, model: string): void {
	this.writeConfig((config) => setSuperpowersModelTierModel(config, tierName, model), {
		successMessage: "Applied to this PI session.",
	});
}
```

Change `writeConfig()` signature and body:

```typescript
private writeConfig(
	update: Parameters<typeof updateSuperpowersConfigText>[1],
	options: { successMessage?: string } = {},
): void {
	const configPath = this.state.configGate.configPath;
	if (!configPath) {
		this.lastWriteMessage = "Config path is unavailable. Restart Pi and try again.";
		return;
	}
	try {
		const current = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf-8") : "{}\n";
		const next = updateSuperpowersConfigText(current, update);
		fs.writeFileSync(configPath, next, "utf-8");
		this.reloadConfig();
		this.lastWriteMessage =
			options.successMessage ?? `Wrote ${configPath}. Restart or reload Pi to apply command registration changes.`;
	} catch (error) {
		this.lastWriteMessage = error instanceof Error ? error.message : String(error);
	}
}
```

Add test helpers before the closing class brace:

```typescript
/**
 * Test helper for selecting a tier without terminal key events.
 *
 * @param tierName Tier name to select.
 */
selectTierForTest(tierName: string): void {
	this.selectedTier = tierName;
	this.mode = "model-picker";
}

/**
 * Test helper for selecting a model without terminal key events.
 *
 * @param model Concrete provider/model value.
 */
selectModelForTest(model: string): void {
	if (!this.selectedTier) throw new Error("No model tier selected.");
	this.writeModelTier(this.selectedTier, model);
	this.mode = "settings";
	this.selectedTier = undefined;
}
```

Add helper below `tierModel()`:

```typescript
/**
 * Format a PI model registry entry as provider/model.
 *
 * @param model Model-like registry entry.
 * @returns Concrete model value for config.
 */
function modelToValue(model: SettingsModelOption): string {
	return `${model.provider}/${model.id}`;
}
```

- [ ] **Step 6: Pass model options from slash command overlay**

In `src/slash/slash-commands.ts`, update `openSuperpowersSettingsOverlay()`:

```typescript
async function openSuperpowersSettingsOverlay(
	ctx: ExtensionContext,
	state: SubagentState,
	configSource: ConfigSource,
	reloadConfig?: () => void,
): Promise<void> {
	if (!ctx.hasUI) return;
	ctx.modelRegistry.refresh();
	const models = ctx.modelRegistry.getAvailable().map((model) => ({
		provider: model.provider,
		id: model.id,
		name: model.name,
	}));
	const modelRegistryError = ctx.modelRegistry.getError();
	await ctx.ui.custom<void>(
		(tui, theme, _kb, done) =>
			new SuperpowersSettingsComponent(tui, theme, state, () => readConfig(configSource), () => done(undefined), {
				models,
				modelRegistryError,
				reloadConfig,
			}),
		{ overlay: true, overlayOptions: { anchor: "center", width: 100, maxHeight: "80%" } },
	);
}
```

Change `registerSlashCommands()` to accept an optional fourth parameter:

```typescript
export function registerSlashCommands(
	pi: ExtensionAPI,
	state: SubagentState,
	configSource: ConfigSource,
	reloadConfig?: () => void,
): void {
```

Change the `/sp-settings` handler:

```typescript
await openSuperpowersSettingsOverlay(ctx, state, configSource, reloadConfig);
```

In `src/extension/index.ts`, pass reload:

```typescript
registerSlashCommands(pi, state, () => configStore.getConfig(), () => {
	configStore.reload();
});
```

- [ ] **Step 7: Update integration test overlay constructor expectations**

In `test/integration/slash-commands.test.ts`, update the mock constructor for `SuperpowersSettingsComponent` near the `/sp-settings` test to accept the new argument shape. The test should assert the fourth constructor argument is a function:

```typescript
assert.equal(typeof constructorArgs[3], "function");
```

If the test stores no constructor args today, add a small capture:

```typescript
const constructorArgs: unknown[][] = [];
```

and in the mock constructor:

```typescript
constructor(...args: unknown[]) {
	constructorArgs.push(args);
}
```

- [ ] **Step 8: Run focused settings tests**

Run:

```bash
npm run test:unit -- test/unit/sp-settings.test.ts
npm run test:integration -- test/integration/slash-commands.test.ts
```

Expected: both pass.

- [ ] **Step 9: Commit Task 4**

Run:

```bash
git add src/ui/sp-settings.ts src/slash/slash-commands.ts src/extension/index.ts test/unit/sp-settings.test.ts test/integration/slash-commands.test.ts
git commit -m "feat: edit model tiers from settings"
```

Expected: commit succeeds.

## Task 5: Add End-to-End Live Tier Regression

**Files:**
- Modify: `test/unit/superpowers-policy.test.ts`
- Modify: `test/integration/single-execution.test.ts`

- [ ] **Step 1: Add policy regression for changed config object**

In `test/unit/superpowers-policy.test.ts`, add:

```typescript
void it("resolves later model tier values from a changed runtime config", () => {
	const firstConfig = {
		superagents: {
			modelTiers: {
				balanced: { model: "openai/gpt-5.4" },
			},
		},
	};
	const secondConfig = {
		superagents: {
			modelTiers: {
				balanced: { model: "anthropic/claude-opus-4.6" },
			},
		},
	};

	assert.deepEqual(
		resolveModelForAgent({ workflow: "superpowers", agentModel: "balanced", config: firstConfig }),
		{ model: "openai/gpt-5.4" },
	);
	assert.deepEqual(
		resolveModelForAgent({ workflow: "superpowers", agentModel: "balanced", config: secondConfig }),
		{ model: "anthropic/claude-opus-4.6" },
	);
});
```

- [ ] **Step 2: Add integration regression for subagent execution config**

In `test/integration/single-execution.test.ts`, add this new test immediately after the existing `"applies superpowers tier thinking when the tier config provides it"` test:

```typescript
void it("uses changed model tier config for later single executions", async () => {
	const agents = [makeAgent("sp-code-review", { model: "balanced" })];

	mockPi.onCall({ output: "Done" });
	const first = await runSync(tempDir, agents, "sp-code-review", "first", {
		workflow: "superpowers",
		runId: "first",
		config: {
			superagents: {
				modelTiers: {
					balanced: { model: "openai/gpt-5.4" },
				},
			},
		},
	});

	mockPi.onCall({ output: "Done" });
	const second = await runSync(tempDir, agents, "sp-code-review", "second", {
		workflow: "superpowers",
		runId: "second",
		config: {
			superagents: {
				modelTiers: {
					balanced: { model: "anthropic/claude-opus-4.6" },
				},
			},
		},
	});

	assert.equal(first.model, "openai/gpt-5.4");
	assert.equal(second.model, "anthropic/claude-opus-4.6");
});
```

- [ ] **Step 3: Run the regression tests**

Run:

```bash
npm run test:unit -- test/unit/superpowers-policy.test.ts
npm run test:integration -- test/integration/single-execution.test.ts
```

Expected: both pass.

- [ ] **Step 4: Commit Task 5**

Run:

```bash
git add test/unit/superpowers-policy.test.ts test/integration/single-execution.test.ts
git commit -m "test: cover live model tier resolution"
```

Expected: commit succeeds.

## Task 6: Update User Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/configuration.md`
- Modify: `docs/parameters.md`
- Modify: `docs/skills.md`
- Modify: `docs/worktrees.md`

- [ ] **Step 1: Update README configuration summary**

In `README.md`, add this sentence to the configuration/settings section that mentions model tiers:

```markdown
Open `/sp-settings` to inspect model tiers and change a tier to one of PI's authenticated models without restarting the current PI session.
```

- [ ] **Step 2: Update model tiers documentation**

In `docs/configuration.md`, after the Model Tiers JSON example, add:

```markdown
You can edit model tier mappings during an active PI session with `/sp-settings`. The model picker reads PI's authenticated model registry and writes the selected `provider/model` value back to `config.json`. Successful tier edits apply to future Superpowers subagents immediately; already-running subagents keep the model they were launched with.

Command registration still happens when the extension loads. If you add or rename slash commands in `config.json`, reload PI before using those new command names.
```

- [ ] **Step 3: Update parameters reference**

In `docs/parameters.md`, add this section before `## Release Notes`:

```markdown
## Settings Overlay

`/sp-settings` opens the Superpowers settings overlay. Use it to toggle supported workflow options and edit model tiers from PI's authenticated model list. Model tier edits are persisted to `config.json` and apply to future subagents in the current session.
```

- [ ] **Step 4: Update skills documentation**

In `docs/skills.md`, add this paragraph near the Superpowers role-agent discussion:

```markdown
Role agents use abstract tier names such as `cheap`, `balanced`, and `max`. You can change which concrete PI model a tier points to from `/sp-settings`; the change is saved to `config.json` and affects future delegated role agents without restarting PI.
```

- [ ] **Step 5: Update worktrees cross-reference**

In `docs/worktrees.md`, add this sentence near the configuration reference:

```markdown
The `/sp-settings` overlay also shows Superpowers model tiers; tier edits apply immediately to future subagents, while worktree command registration changes may still require a PI reload.
```

- [ ] **Step 6: Run docs diff check**

Run:

```bash
git diff -- README.md docs/configuration.md docs/parameters.md docs/skills.md docs/worktrees.md
```

Expected: diff only documents live model tier editing and the command-registration reload distinction.

- [ ] **Step 7: Commit Task 6**

Run:

```bash
git add README.md docs/configuration.md docs/parameters.md docs/skills.md docs/worktrees.md
git commit -m "docs: document live model tier editing"
```

Expected: commit succeeds.

## Task 7: Full Verification

**Files:**
- Verify only; no planned source edits.

- [ ] **Step 1: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: `tsc --noEmit` completes with exit code 0.

- [ ] **Step 2: Run unit tests**

Run:

```bash
npm run test:unit
```

Expected: all unit tests pass.

- [ ] **Step 3: Run integration tests**

Run:

```bash
npm run test:integration
```

Expected: all integration tests pass.

- [ ] **Step 4: Run e2e tests if local environment supports them**

Run:

```bash
npm run test:e2e
```

Expected: e2e tests pass. If the command fails because the local environment lacks a PI sandbox prerequisite, record the exact failure in the final implementation summary and keep unit plus integration evidence.

- [ ] **Step 5: Inspect git status**

Run:

```bash
git status --short
```

Expected: no unstaged or uncommitted changes after the task commits, unless verification produced ignored runtime artifacts.

## Self-Review

- Spec coverage: Tasks 1 and 2 cover the live config store and runtime consumers. Tasks 3 and 4 cover persistent model tier edits and PI model registry selection. Task 5 covers future subagent launches using changed tiers. Task 6 covers all required user docs. Task 7 covers final verification.
- Deferred-work scan: The plan contains no deferred implementation instructions.
- Type consistency: `RuntimeConfigStore`, `ConfigSource`, `getConfig()`, `reloadConfig`, `setSuperpowersModelTierModel()`, `selectTierForTest()`, and `selectModelForTest()` are introduced before later tasks reference them.
