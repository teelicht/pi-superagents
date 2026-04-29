/**
 * Unit coverage for extension config validation and merge behavior.
 *
 * Responsibilities:
 * - verify empty user overrides inherit bundled defaults
 * - verify unknown and malformed config blocks execution
 * - verify diagnostics are precise enough to show directly to users
 * - verify migration diagnostics identify copied full-default config
 * - verify skill overlays and interception config validation
 * - verify global subagent extensions validation and merge
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatConfigDiagnostics, loadEffectiveConfig, validateConfigObject } from "../../src/execution/config-validation.ts";
import type { ExtensionConfig } from "../../src/shared/types.ts";

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
		extensions: [],
	},
};

void describe("config validation", () => {
	void it("treats missing and empty user config as valid overrides", () => {
		assert.deepEqual(loadEffectiveConfig(defaults, undefined).config, defaults);
		assert.deepEqual(loadEffectiveConfig(defaults, {}).config, defaults);
		assert.equal(loadEffectiveConfig(defaults, {}).blocked, false);
	});

	void it("deep merges command presets and preserves built-in commands", () => {
		const result = loadEffectiveConfig(defaults, {
			superagents: {
				commands: {
					"sp-quick": { description: "Quick run", useSubagents: false },
					"superpowers-review": { useTestDrivenDevelopment: false },
				},
			},
		});

		assert.equal(result.blocked, false);
		assert.ok(result.config.superagents?.commands?.["sp-implement"]);
		assert.equal(result.config.superagents?.commands?.["sp-implement"]?.entrySkill, "using-superpowers");
		assert.ok(result.config.superagents?.commands?.["sp-brainstorm"]);
		assert.ok(result.config.superagents?.commands?.["sp-plan"]);
		assert.deepEqual(result.config.superagents?.commands?.["sp-quick"], {
			description: "Quick run",
			useSubagents: false,
		});
		assert.deepEqual(result.config.superagents?.commands?.["superpowers-review"], {
			useTestDrivenDevelopment: false,
		});
	});

	void it("deep merges model tiers while preserving defaults", () => {
		const result = loadEffectiveConfig(defaults, {
			superagents: {
				modelTiers: {
					max: { model: "openai/gpt-5.4", thinking: "high" },
					free: { model: "google/gemini-flash" },
				},
			},
		});

		assert.equal(result.blocked, false);
		assert.deepEqual(result.config.superagents?.modelTiers?.cheap, defaults.superagents?.modelTiers?.cheap);
		assert.deepEqual(result.config.superagents?.modelTiers?.max, {
			model: "openai/gpt-5.4",
			thinking: "high",
		});
		assert.deepEqual(result.config.superagents?.modelTiers?.free, {
			model: "google/gemini-flash",
		});
	});

	void it("merges worktree settings deeply inside command presets", () => {
		const result = loadEffectiveConfig(defaults, {
			superagents: {
				commands: {
					"sp-implement": {
						worktrees: { enabled: true, root: "/tmp/worktrees" },
					},
				},
			},
		});

		assert.equal(result.config.superagents?.commands?.["sp-implement"]?.worktrees?.enabled, true);
		assert.equal(result.config.superagents?.commands?.["sp-implement"]?.worktrees?.root, "/tmp/worktrees");
	});

	void it("blocks unknown top-level and nested keys", () => {
		const result = validateConfigObject({
			unknwonKey: true,
			superagents: {
				commands: {
					"sp-test": {
						unknownField: true,
					},
				},
			},
		});

		assert.equal(result.blocked, true);
		assert.deepEqual(
			result.diagnostics.map((diagnostic) => diagnostic.code),
			["unknown_key", "unknown_key"],
		);
		assert.deepEqual(
			result.diagnostics.map((diagnostic) => diagnostic.path),
			["unknwonKey", "superagents.commands.sp-test.unknownField"],
		);
	});

	void it("blocks wrong primitive types and invalid enum values in command presets", () => {
		const result = validateConfigObject({
			superagents: {
				commands: {
					"sp-test": {
						useSubagents: "yes",
						useTestDrivenDevelopment: 1,
						worktrees: {
							enabled: "yes",
						},
					},
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
		assert.deepEqual(
			result.diagnostics.map((diagnostic) => diagnostic.path),
			[
				"superagents.commands.sp-test.useSubagents",
				"superagents.commands.sp-test.useTestDrivenDevelopment",
				"superagents.commands.sp-test.worktrees.enabled",
				"superagents.modelTiers.max.model",
				"superagents.modelTiers.max.thinking",
			],
		);
	});

	void it("accepts custom commands with entrySkill", () => {
		const result = validateConfigObject({
			superagents: {
				commands: {
					"sp-custom": {
						description: "Custom command",
						entrySkill: "brainstorming",
						useSubagents: true,
					},
				},
			},
		});

		assert.equal(result.blocked, false);
		assert.deepEqual(result.diagnostics, []);
	});

	void it("rejects non-string entrySkill on command presets", () => {
		const result = validateConfigObject({
			superagents: {
				commands: {
					"sp-test": {
						entrySkill: 123,
					},
				},
			},
		});

		assert.equal(result.blocked, true);
		assert.deepEqual(
			result.diagnostics.map((diagnostic) => diagnostic.path),
			["superagents.commands.sp-test.entrySkill"],
		);
	});

	void it("accepts nullable path settings inside command presets", () => {
		const result = validateConfigObject({
			superagents: {
				commands: {
					"sp-test": {
						worktrees: {
							root: null,
						},
					},
				},
			},
		});

		assert.equal(result.blocked, false);
		assert.deepEqual(result.diagnostics, []);
	});

	void it("accepts writing-plans in interceptSkillCommands", () => {
		const result = validateConfigObject({
			superagents: {
				interceptSkillCommands: ["brainstorming", "writing-plans"],
			},
		});

		assert.equal(result.blocked, false);
		assert.deepEqual(result.diagnostics, []);
	});

	void it("rejects invalid custom command names and fields", () => {
		const result = validateConfigObject({
			superagents: {
				commands: {
					"SP-UPPER": { description: "Bad name" },
					"bad command": { useSubagents: true },
					"sp-": { description: "No trailing hyphen" },
					"sp-valid": { badField: true },
					"sp-also-valid": { useSubagents: "yes" },
				},
			},
		});

		assert.equal(result.blocked, true);
		const paths = result.diagnostics.map((d) => d.path);
		assert.ok(paths.includes("superagents.commands.SP-UPPER"));
		assert.ok(paths.includes("superagents.commands.bad command"));
		assert.ok(paths.includes("superagents.commands.sp-"));
		assert.ok(paths.includes("superagents.commands.sp-valid.badField"));
		assert.ok(paths.includes("superagents.commands.sp-also-valid.useSubagents"));
	});

	void it("formats diagnostics for Pi notifications and tool results", () => {
		const result = validateConfigObject({
			superagents: {
				commands: {
					"sp-test": {
						worktrees: {
							root: "",
						},
					},
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
				"- superagents.commands.sp-test.worktrees.root: must be a non-empty string or null.",
				"",
				"See ~/.pi/agent/extensions/subagent/config.example.json for the current config shape.",
			].join("\n"),
		);
	});

	void it("warns when config looks like a copied default file", () => {
		const result = loadEffectiveConfig(defaults, defaults);

		assert.equal(result.blocked, false);
		assert.ok(result.diagnostics.some((d) => d.code === "legacy_full_copy"));
		assert.ok(result.diagnostics.some((d) => d.code === "defaults_only_key"));
	});

	// -------------------------------------------------------------------------
	// Skill overlays and interception config (Task 1)
	// -------------------------------------------------------------------------

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
				interceptSkillCommands: ["", 7, "unsupported-skill"],
			},
		});

		assert.equal(result.blocked, true);
		assert.deepEqual(
			result.diagnostics.map((diagnostic) => diagnostic.path),
			[
				"superagents.skillOverlays.brainstorming",
				"superagents.skillOverlays.",
				"superagents.skillOverlays.writing-plans[0]",
				"superagents.skillOverlays.writing-plans[1]",
				"superagents.interceptSkillCommands[0]",
				"superagents.interceptSkillCommands[1]",
				"superagents.interceptSkillCommands[2]",
			],
		);
	});

	void it("deep merges skill overlays while replacing intercepted skill commands", () => {
		const result = loadEffectiveConfig(
			{
				superagents: {
					...defaults.superagents,
					skillOverlays: {
						brainstorming: ["react-native-best-practices"],
					},
					interceptSkillCommands: [],
				},
			},
			{
				superagents: {
					skillOverlays: {
						"writing-plans": ["supabase-postgres-best-practices"],
					},
					interceptSkillCommands: ["brainstorming"],
				},
			},
		);

		assert.equal(result.blocked, false);
		assert.deepEqual(result.config.superagents?.skillOverlays, {
			brainstorming: ["react-native-best-practices"],
			"writing-plans": ["supabase-postgres-best-practices"],
		});
		assert.deepEqual(result.config.superagents?.interceptSkillCommands, ["brainstorming"]);
	});

	// ---------------------------------------------------------------------------
	// superpowersSkills validation and merge (Task 2)
	// ---------------------------------------------------------------------------

	void it("warns about superpowersSkills in user overrides as not user-configurable", () => {
		const result = validateConfigObject({
			superagents: {
				superpowersSkills: ["writing-plans"],
			},
		});
		assert.equal(result.blocked, false);
		assert.ok(result.diagnostics.some((d) => d.path === "superagents.superpowersSkills" && d.code === "defaults_only_key"));
	});

	void it("passes superpowersSkills from defaults through to effective config", () => {
		const result = loadEffectiveConfig({ superagents: { ...defaults.superagents, superpowersSkills: ["using-superpowers", "brainstorming"] } }, {});
		assert.equal(result.blocked, false);
		assert.deepEqual(result.config.superagents?.superpowersSkills, ["using-superpowers", "brainstorming"]);
	});

	void it("warns about non-array superpowersSkills in user overrides", () => {
		const result = validateConfigObject({
			superagents: {
				superpowersSkills: "not-an-array",
			},
		});
		assert.equal(result.blocked, false);
		assert.ok(result.diagnostics.some((d) => d.path === "superagents.superpowersSkills"));
	});

	// ---------------------------------------------------------------------------
	// superagents.extensions validation and merge (Task 4)
	// ---------------------------------------------------------------------------

	void it("accepts and merges global subagent extensions with replace semantics", () => {
		const result = loadEffectiveConfig(
			{
				superagents: {
					...defaults.superagents,
					extensions: ["./default-extension.ts"],
				},
			},
			{
				superagents: {
					extensions: ["./user-extension.ts"],
				},
			},
		);

		assert.equal(result.blocked, false);
		assert.deepEqual(result.diagnostics, []);
		assert.deepEqual(result.config.superagents?.extensions, ["./user-extension.ts"]);
	});

	void it("rejects malformed global subagent extensions", () => {
		const result = validateConfigObject({
			superagents: {
				extensions: ["./ok.ts", "", 42],
			},
		});

		assert.equal(result.blocked, true);
		assert.deepEqual(
			result.diagnostics.map((diagnostic) => diagnostic.path),
			["superagents.extensions[1]", "superagents.extensions[2]"],
		);
	});

	void it("rejects non-array global subagent extensions", () => {
		const result = validateConfigObject({
			superagents: {
				extensions: "./not-an-array.ts",
			},
		});

		assert.equal(result.blocked, true);
		assert.deepEqual(
			result.diagnostics.map((diagnostic) => diagnostic.path),
			["superagents.extensions"],
		);
	});

	// ---------------------------------------------------------------------------
	// Task 4 follow-up: partial worktree override preserves defaults; non-object
	// worktrees rejected
	// ---------------------------------------------------------------------------

	void it("partial worktrees override preserves default root: null", () => {
		// defaults sp-implement has worktrees: { enabled: false, root: null }
		// override enables worktrees without specifying root
		// → merged result must have enabled: true AND root: null (from defaults)
		const result = loadEffectiveConfig(defaults, {
			superagents: {
				commands: {
					"sp-implement": {
						worktrees: { enabled: true },
					},
				},
			},
		});

		assert.equal(result.blocked, false);
		assert.equal(result.config.superagents?.commands?.["sp-implement"]?.worktrees?.enabled, true);
		assert.equal(result.config.superagents?.commands?.["sp-implement"]?.worktrees?.root, null);
	});

	void it("rejects non-object worktrees value in command preset", () => {
		// string or number worktrees value is invalid; must be an object
		const result = validateConfigObject({
			superagents: {
				commands: {
					"sp-test": {
						worktrees: "yes",
					},
				},
			},
		});

		assert.equal(result.blocked, true);
		assert.ok(
			result.diagnostics.some((d) => d.path === "superagents.commands.sp-test.worktrees"),
			"should report path superagents.commands.sp-test.worktrees",
		);
		assert.ok(
			result.diagnostics.some((d) => d.message === "must be an object."),
			"message should be 'must be an object.'",
		);
	});
});
