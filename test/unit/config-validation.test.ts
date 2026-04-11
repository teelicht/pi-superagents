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