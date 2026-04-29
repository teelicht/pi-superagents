/**
 * Unit tests for safe Superpowers config text updates.
 *
 * Responsibilities:
 * - verify config text parsing and serialization
 * - verify boolean toggles write only behavior flags
 * - verify worktree toggles write only worktrees settings
 * - verify model tier updates
 * - verify behavior-only command block output (no description/entrySkill/skillOverlays)
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setSuperpowersModelTierModel, toggleSuperpowersBoolean, toggleSuperpowersWorktrees, updateSuperpowersConfigText } from "../../src/superpowers/config-writer.ts";

void describe("Superpowers config writer", () => {
	void it("toggles useSubagents without changing other settings", () => {
		const updated = updateSuperpowersConfigText(
			'{\n  "superagents": {\n    "commands": {\n      "sp-implement": {\n        "useSubagents": true,\n        "useTestDrivenDevelopment": true\n      }\n    }\n  }\n}\n',
			(config) => toggleSuperpowersBoolean(config, "useSubagents"),
		);
		assert.deepEqual(JSON.parse(updated), {
			superagents: {
				commands: {
					"sp-implement": {
						useSubagents: false,
						useTestDrivenDevelopment: true,
					},
				},
			},
		});
	});

	void it("toggles a boolean setting on a selected command", () => {
		const updated = updateSuperpowersConfigText(
			'{\n  "superagents": {\n    "commands": {\n      "sp-plan": {\n        "usePlannotator": true\n      },\n      "sp-implement": {\n        "useSubagents": true\n      }\n    }\n  }\n}\n',
			(config) => toggleSuperpowersBoolean(config, "sp-plan", "usePlannotator"),
		);
		assert.deepEqual(JSON.parse(updated), {
			superagents: {
				commands: {
					"sp-plan": { usePlannotator: false },
					"sp-implement": { useSubagents: true },
				},
			},
		});
	});

	void it("toggles worktrees on a selected command", () => {
		const updated = updateSuperpowersConfigText(
			'{\n  "superagents": {\n    "commands": {\n      "sp-custom": {\n        "worktrees": { "enabled": false }\n      },\n      "sp-implement": {\n        "worktrees": { "enabled": false }\n      }\n    }\n  }\n}\n',
			(config) => toggleSuperpowersWorktrees(config, "sp-custom"),
		);
		assert.deepEqual(JSON.parse(updated), {
			superagents: {
				commands: {
					"sp-custom": { worktrees: { enabled: true } },
					"sp-implement": { worktrees: { enabled: false } },
				},
			},
		});
	});

	void it("toggles usePlannotator without changing other settings", () => {
		const updated = updateSuperpowersConfigText(
			'{\n  "superagents": {\n    "commands": {\n      "sp-implement": {\n        "usePlannotator": true,\n        "useSubagents": false\n      }\n    }\n  }\n}\n',
			(config) => toggleSuperpowersBoolean(config, "usePlannotator"),
		);
		assert.deepEqual(JSON.parse(updated), {
			superagents: {
				commands: {
					"sp-implement": {
						usePlannotator: false,
						useSubagents: false,
					},
				},
			},
		});
	});

	void it("creates superagents settings from an empty override", () => {
		const updated = updateSuperpowersConfigText("{}", (config) => toggleSuperpowersBoolean(config, "useTestDrivenDevelopment"));
		assert.deepEqual(JSON.parse(updated), {
			superagents: {
				commands: {
					"sp-implement": {
						useTestDrivenDevelopment: false,
					},
				},
			},
		});
	});

	void it("toggles Superpowers worktrees without changing model tiers", () => {
		const updated = updateSuperpowersConfigText(
			'{\n  "superagents": {\n    "worktrees": { "enabled": false, "root": null },\n    "modelTiers": { "cheap": { "model": "a" } }\n  }\n}\n',
			(config) => toggleSuperpowersWorktrees(config),
		);
		assert.deepEqual(JSON.parse(updated), {
			superagents: {
				worktrees: { enabled: false, root: null },
				modelTiers: { cheap: { model: "a" } },
				commands: {
					"sp-implement": {
						worktrees: { enabled: true },
					},
				},
			},
		});
	});

	void it("throws a readable error for malformed JSON", () => {
		assert.throws(() => updateSuperpowersConfigText("{", (config) => config), /Superpowers config is not valid JSON/);
	});

	void it("updates an object model tier while preserving thinking", () => {
		const updated = updateSuperpowersConfigText('{\n  "superagents": {\n    "modelTiers": {\n      "fast": { "model": "a", "thinking": "low" }\n    }\n  }\n}\n', (config) =>
			setSuperpowersModelTierModel(config, "fast", "b"),
		);
		assert.deepEqual(JSON.parse(updated), {
			superagents: {
				modelTiers: {
					fast: { model: "b", thinking: "low" },
				},
			},
		});
	});

	void it("converts a string model tier to object form", () => {
		const updated = updateSuperpowersConfigText('{\n  "superagents": {\n    "modelTiers": { "fast": "a" }\n  }\n}\n', (config) =>
			setSuperpowersModelTierModel(config, "fast", "b"),
		);
		assert.deepEqual(JSON.parse(updated), {
			superagents: {
				modelTiers: {
					fast: { model: "b" },
				},
			},
		});
	});

	void it("creates missing model tier containers", () => {
		const updated = updateSuperpowersConfigText('{\n  "superagents": {}\n}\n', (config) => setSuperpowersModelTierModel(config, "fast", "b"));
		assert.deepEqual(JSON.parse(updated), {
			superagents: {
				modelTiers: {
					fast: { model: "b" },
				},
			},
		});
	});

	void it("toggles write behavior-only command blocks, never description", () => {
		const updated = updateSuperpowersConfigText(
			'{"superagents":{"commands":{"sp-implement":{"description":"Implement tasks via superagents","entrySkill":"implement","skillOverlays":["test"],"useSubagents":true}}}}',
			(config) => toggleSuperpowersBoolean(config, "sp-implement", "useSubagents"),
		);
		const parsed = JSON.parse(updated);
		assert.ok(!("description" in parsed.superagents.commands["sp-implement"]), "toggle must not write description");
		assert.ok(!("entrySkill" in parsed.superagents.commands["sp-implement"]), "toggle must not write entrySkill");
		assert.ok(!("skillOverlays" in parsed.superagents.commands["sp-implement"]), "toggle must not write skillOverlays");
		assert.strictEqual(parsed.superagents.commands["sp-implement"].useSubagents, false);
	});

	void it("toggles worktrees writes behavior-only command blocks, never description", () => {
		const updated = updateSuperpowersConfigText(
			'{"superagents":{"commands":{"sp-implement":{"description":"Implement tasks","entrySkill":"implement","skillOverlays":["test"]}}}}',
			(config) => toggleSuperpowersWorktrees(config, "sp-implement"),
		);
		const parsed = JSON.parse(updated);
		assert.ok(!("description" in parsed.superagents.commands["sp-implement"]), "worktrees toggle must not write description");
		assert.ok(!("entrySkill" in parsed.superagents.commands["sp-implement"]), "worktrees toggle must not write entrySkill");
		assert.ok(!("skillOverlays" in parsed.superagents.commands["sp-implement"]), "worktrees toggle must not write skillOverlays");
		assert.ok("worktrees" in parsed.superagents.commands["sp-implement"]);
	});
});
