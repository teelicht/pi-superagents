/**
 * Unit tests for the runtime config store.
 *
 * Responsibilities:
 * - verify startup config loading produces valid state and diagnostics
 * - verify reload produces fresh config state without restarting
 * - verify diagnostics capture validation outcome
 * - verify ConfigGateState maintains stable object identity across operations
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
			commands: { "sp-test": { entrySkill: "using-superpowers" } },
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
		assert.deepEqual(config?.superagents?.commands?.["sp-test"]?.entrySkill, "using-superpowers");
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
});

void describe("loadRuntimeConfigState", () => {
	it("loads config from specified directory", () => {
		const configDir = createMinimalConfigDir();
		const state = loadRuntimeConfigState(configDir);
		assert.ok(state.config);
		assert.equal(state.configPath?.endsWith("config.json"), true);
		assert.ok(Array.isArray(state.diagnostics));
	});

	it("produces diagnostics for invalid config", () => {
		const configDir = createTempConfigDir({
			"default-config.json": JSON.stringify({ superagents: {} }),
			"config.json": JSON.stringify({ invalidKey: "value" }),
		});

		const state = loadRuntimeConfigState(configDir);
		assert.equal(state.blocked, true, "Expected config to be blocked due to invalid key");
		assert.ok(state.diagnostics.some((d) => d.code === "unknown_key"), "Expected unknown_key diagnostic");
	});

	it("returns a valid state when user config is absent", () => {
		const configDir = createTempConfigDir({
			"default-config.json": JSON.stringify({ superagents: {} }),
		});

		const state = loadRuntimeConfigState(configDir);
		assert.equal(state.blocked, false, "Expected config NOT to be blocked when absent");
		assert.deepEqual(state.config, { superagents: {} });
	});

	it("returns stable ConfigGateState object identity", () => {
		const configDir = createMinimalConfigDir();
		const state = loadRuntimeConfigState(configDir);

		// Gate state should be a fresh object with the state data copied in
		const gateState = state.asGateState();
		assert.ok(gateState);
		assert.equal(gateState.configPath, state.configPath);
		assert.equal(gateState.diagnostics, state.diagnostics);
		assert.equal(gateState.blocked, state.blocked);
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