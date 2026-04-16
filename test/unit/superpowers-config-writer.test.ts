/**
 * Unit tests for safe Superpowers config text updates.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	toggleSuperpowersBoolean,
	toggleSuperpowersWorktrees,
	updateSuperpowersConfigText,
} from "../../src/superpowers/config-writer.ts";

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
		const updated = updateSuperpowersConfigText("{}", (config) =>
			toggleSuperpowersBoolean(config, "useTestDrivenDevelopment"),
		);
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
});
