/**
 * Unit tests for the runtime config store.
 *
 * Responsibilities:
 * - verify startup config loading produces valid state and diagnostics
 * - verify reload produces fresh config state without restarting
 * - verify diagnostics capture validation outcome
 * - verify ConfigGateState maintains stable object identity across operations
 * - verify stale command warnings propagate through config store
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { createRuntimeConfigStore, loadRuntimeConfigState } from "../../src/extension/config-store.ts";

/**
 * Create a temporary directory with config files for testing.
 *
 * @param files File contents to write (relative paths -> content).
 * @returns Absolute path to the created temporary directory.
 */
function createTempConfigDir(files: Record<string, string>): string {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-config-store-test-"));
	for (const [relativePath, content] of Object.entries(files)) {
		const filePath = path.join(tempDir, relativePath);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, content, "utf-8");
	}
	return tempDir;
}

/**
 * Create a tempdir containing bundled defaults and an empty user config.
 *
 * @returns Path to the temp directory.
 */
function createMinimalConfigDir(): string {
	const defaults = {
		superagents: {
			commands: { "sp-test": { useSubagents: true } },
			modelTiers: { cheap: { model: "test/model" } },
			superpowersSkills: ["using-superpowers"],
		},
	};
	return createTempConfigDir({
		"default-config.json": JSON.stringify(defaults),
		"config.json": "{}",
	});
}

void describe("createRuntimeConfigStore", () => {
	it("produces a store with getConfig and getGateState accessors", () => {
		const configDir = createMinimalConfigDir();
		const store = createRuntimeConfigStore(configDir);
		assert.equal(typeof store.getConfig, "function");
		assert.equal(typeof store.getGateState, "function");
		assert.equal(typeof store.reloadConfig, "function");
	});

	it("loads runtime config at startup", () => {
		const configDir = createMinimalConfigDir();
		const store = createRuntimeConfigStore(configDir);
		const config = store.getConfig();
		assert.ok(config?.superagents?.commands?.["sp-test"]);
	});

	it("produces a ConfigGateState with diagnostics and paths at startup", () => {
		const configDir = createMinimalConfigDir();
		const store = createRuntimeConfigStore(configDir);
		const gateState = store.getGateState();
		assert.equal(gateState.configPath?.endsWith("config.json"), true);
		assert.equal(gateState.examplePath?.endsWith("config.example.json"), true);
		assert.ok(Array.isArray(gateState.diagnostics));
	});

	it("produces a ConfigGateState that is NOT blocked when config is valid", () => {
		const configDir = createMinimalConfigDir();
		const store = createRuntimeConfigStore(configDir);
		const gateState = store.getGateState();
		assert.equal(gateState.blocked, false);
	});

	it("accepts a getEntrypointCommands callback for stale command warnings", () => {
		const configDir = createTempConfigDir({
			"default-config.json": JSON.stringify({
				superagents: {
					commands: {
						"sp-implement": { useSubagents: true },
					},
				},
			}),
			"config.json": JSON.stringify({
				superagents: {
					commands: {
						"sp-implement": { useSubagents: false },
						"sp-missing": { useSubagents: false },
					},
				},
			}),
		});

		const store = createRuntimeConfigStore(configDir, configDir, () => ["sp-implement", "sp-plan"]);
		const gateState = store.getGateState();

		// sp-missing is not in entrypointCommands so should produce a warning
		assert.equal(gateState.blocked, false, "Expected config NOT to be blocked by warning");
		assert.ok(
			gateState.diagnostics.some((d) => d.path === "superagents.commands.sp-missing" && d.level === "warning"),
			"Expected warning for sp-missing command not in entrypointCommands",
		);
	});
});

void describe("RuntimeConfigStore", () => {
	it("provides fresh config via getConfig after reload", () => {
		const configDir = createTempConfigDir({
			"default-config.json": JSON.stringify({ superagents: {} }),
			"config.json": JSON.stringify({ superagents: { modelTiers: { cheap: { model: "initial" } } } }),
		});

		const store = createRuntimeConfigStore(configDir);
		const initialConfig = store.getConfig();
		// ModelTierSetting can be string | ModelTierConfig - check both possibilities
		const initialTier = initialConfig?.superagents?.modelTiers?.cheap;
		const initialModel = typeof initialTier === "object" ? initialTier?.model : initialTier;
		assert.equal(initialModel, "initial");

		// Write a new config file
		const userConfigPath = path.join(configDir, "config.json");
		const newConfig = JSON.stringify({ superagents: { modelTiers: { cheap: { model: "updated" } } } });
		fs.writeFileSync(userConfigPath, newConfig, "utf-8");

		store.reloadConfig();
		const reloadedConfig = store.getConfig();
		// ModelTierSetting can be string | ModelTierConfig - check both possibilities
		const updatedTier = reloadedConfig?.superagents?.modelTiers?.cheap;
		const updatedModel = typeof updatedTier === "object" ? updatedTier?.model : updatedTier;
		assert.equal(updatedModel, "updated");
	});

	it("reloads config with fresh entrypoint commands after reload", () => {
		const configDir = createTempConfigDir({
			"default-config.json": JSON.stringify({
				superagents: {
					commands: {
						"sp-implement": { useSubagents: true },
					},
				},
			}),
			"config.json": JSON.stringify({
				superagents: {
					commands: {
						"sp-implement": { useSubagents: false },
						"sp-stale": { useSubagents: false },
					},
				},
			}),
		});

		// Create store that initially knows only sp-implement
		const store = createRuntimeConfigStore(configDir, configDir, () => ["sp-implement"]);

		const initialGate = store.getGateState();
		assert.ok(initialGate.diagnostics.some((d) => d.path === "superagents.commands.sp-stale"), "sp-stale should warn on initial load");

		// Simulate adding a new entrypoint agent by changing the callback
		// (In real usage this would be a new discoverAgents result)
		store.reloadConfig();

		// After reload, same warnings should still be present if callback unchanged
		const reloadedGate = store.getGateState();
		assert.ok(reloadedGate.diagnostics.some((d) => d.path === "superagents.commands.sp-stale"), "sp-stale should still warn after reload");
	});
});

void describe("loadRuntimeConfigState", () => {
	it("loads config from specified directory", () => {
		const configDir = createMinimalConfigDir();
		const state = loadRuntimeConfigState(configDir);
		assert.ok(state.config);
		assert.equal(state.configPath?.endsWith("config.json"), true);
		assert.ok(Array.isArray(state.diagnostics));
	});

	it("loads bundled defaults and user overrides from separate directories", () => {
		const defaultConfigDir = createTempConfigDir({
			"default-config.json": JSON.stringify({
				superagents: {
					commands: {
						"sp-plan": {
							usePlannotator: false,
						},
					},
				},
			}),
		});
		const userConfigDir = createTempConfigDir({
			"config.json": JSON.stringify({
				superagents: {
					commands: {
						"sp-plan": {
							usePlannotator: true,
						},
					},
				},
			}),
		});

		const state = loadRuntimeConfigState(defaultConfigDir, userConfigDir);

		assert.equal(state.config.superagents?.commands?.["sp-plan"]?.usePlannotator, true);
		assert.equal(state.configPath, path.join(userConfigDir, "config.json"));
		assert.equal(state.examplePath, path.join(userConfigDir, "config.example.json"));
	});

	it("produces diagnostics for invalid config", () => {
		const configDir = createTempConfigDir({
			"default-config.json": JSON.stringify({ superagents: {} }),
			"config.json": JSON.stringify({ invalidKey: "value" }),
		});

		const state = loadRuntimeConfigState(configDir);
		assert.equal(state.blocked, true, "Expected config to be blocked due to invalid key");
		assert.ok(
			state.diagnostics.some((d) => d.code === "unknown_key"),
			"Expected unknown_key diagnostic",
		);
	});

	it("returns a valid state when user config is absent", () => {
		const configDir = createTempConfigDir({
			"default-config.json": JSON.stringify({ superagents: {} }),
		});

		const state = loadRuntimeConfigState(configDir);
		assert.equal(state.blocked, false, "Expected config NOT to be blocked when absent");
		assert.deepEqual(state.config, { superagents: {} });
	});

	it("produces fresh ConfigGateState object from LoadedConfigState", () => {
		const configDir = createMinimalConfigDir();
		const state = loadRuntimeConfigState(configDir);

		// Gate state should be a fresh object with the state data copied in
		const gateState = state.asGateState();
		assert.ok(gateState);
		assert.equal(gateState.configPath, state.configPath);
		assert.deepEqual(gateState.diagnostics, state.diagnostics);
		assert.equal(gateState.blocked, state.blocked);
	});

	it("returns SAME gate object reference across reloads", () => {
		const testConfig = { superagents: { modelTiers: { cheap: { model: "initial" } } } };
		const configDir = createTempConfigDir({
			"default-config.json": JSON.stringify({ superagents: {} }),
			"config.json": JSON.stringify(testConfig),
		});

		const store = createRuntimeConfigStore(configDir);
		const gate1 = store.getGateState();
		assert.equal(gate1.blocked, false);

		// Update config to be invalid
		const userConfigPath = path.join(configDir, "config.json");
		fs.writeFileSync(userConfigPath, JSON.stringify({ invalidKey: "value" }), "utf-8");

		store.reloadConfig();
		const gate2 = store.getGateState();

		// Same object reference
		assert.equal(gate1, gate2, "Expected the SAME gate object reference after reload");
		// But with updated data
		assert.equal(gate2.blocked, true, "Expected gate to be blocked after invalid config");
	});

	it("produces diagnostics for invalid model tier values", () => {
		const testConfig = { superagents: { modelTiers: { balanced: { invalidField: "value" } } } };
		const configDir = createTempConfigDir({
			"default-config.json": JSON.stringify({ superagents: {} }),
			// Invalid: missing required 'model' field in tier config
			"config.json": JSON.stringify(testConfig),
		});

		const state = loadRuntimeConfigState(configDir);
		assert.equal(state.blocked, true, "Expected config to be blocked due to invalid tier");
		// Check for diagnostic with the specific path
		const tierDiagnostic = state.diagnostics.find((d) => d.path === "superagents.modelTiers.balanced" || d.path === "superagents.modelTiers.balanced.model");
		assert.ok(tierDiagnostic, "Expected diagnostic for invalid model tier");
	});

	it("warns for stale commands when entrypointCommands are provided", () => {
		const configDir = createTempConfigDir({
			"default-config.json": JSON.stringify({
				superagents: {
					commands: {
						"sp-implement": { useSubagents: true },
					},
				},
			}),
			"config.json": JSON.stringify({
				superagents: {
					commands: {
						"sp-implement": { useSubagents: false },
						"sp-missing": { useSubagents: false },
					},
				},
			}),
		});

		const state = loadRuntimeConfigState(configDir, configDir, ["sp-implement"]);

		// sp-missing is not in entrypointCommands so should produce a warning
		assert.equal(state.blocked, false, "Expected config NOT to be blocked by warning");
		assert.ok(
			state.diagnostics.some((d) => d.path === "superagents.commands.sp-missing" && d.level === "warning"),
			"Expected warning for sp-missing command not in entrypointCommands",
		);
		assert.ok(
			state.diagnostics.some((d) => d.code === "unknown_entrypoint_command"),
			"Expected unknown_entrypoint_command diagnostic code",
		);
		// sp-implement should NOT warn
		assert.ok(
			!state.diagnostics.some((d) => d.path === "superagents.commands.sp-implement" && d.level === "warning"),
			"sp-implement should NOT produce warning since it matches entrypointCommands",
		);
	});

	it("does not warn when entrypointCommands includes all config commands", () => {
		const configDir = createTempConfigDir({
			"default-config.json": JSON.stringify({
				superagents: {
					commands: {
						"sp-implement": { useSubagents: true },
					},
				},
			}),
			"config.json": JSON.stringify({
				superagents: {
					commands: {
						"sp-implement": { useSubagents: false },
					},
				},
			}),
		});

		const state = loadRuntimeConfigState(configDir, configDir, ["sp-implement", "sp-plan"]);

		assert.equal(state.blocked, false);
		assert.ok(!state.diagnostics.some((d) => d.code === "unknown_entrypoint_command"), "Should not warn when all commands match");
	});
});

void describe("RuntimeConfigStore reload", () => {
	it("updates gate state diagnostics on reload after config fix", () => {
		const configDir = createTempConfigDir({
			"default-config.json": JSON.stringify({ superagents: {} }),
			"config.json": JSON.stringify({ invalidKey: "value" }),
		});

		const store = createRuntimeConfigStore(configDir);
		let gateState = store.getGateState();
		assert.equal(gateState.blocked, true);

		// Fix the config
		const userConfigPath = path.join(configDir, "config.json");
		const fixedConfig = JSON.stringify({ superagents: {} });
		fs.writeFileSync(userConfigPath, fixedConfig, "utf-8");

		store.reloadConfig();
		gateState = store.getGateState();
		assert.equal(gateState.blocked, false);
	});
});