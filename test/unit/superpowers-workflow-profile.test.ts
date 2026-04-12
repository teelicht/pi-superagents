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

void describe("Superpowers workflow profile", () => {
	void it("uses global defaults when no preset or inline token is present", () => {
		const parsed = parseSuperpowersWorkflowArgs("fix auth")!;
		assert.deepEqual(parsed, {
			task: "fix auth",
			overrides: {},
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
			fork: false,
		});
	});

	void it("applies command preset values before inline tokens", () => {
		const parsed = parseSuperpowersWorkflowArgs("tdd fix auth")!;
		assert.deepEqual(resolveSuperpowersRunProfile({
			config,
			commandName: "superpowers-lean",
			parsed,
		}), {
			commandName: "superpowers-lean",
			task: "fix auth",
			useSubagents: false,
			useTestDrivenDevelopment: true,
			fork: false,
		});
	});

	void it("parses lean, full, direct, tdd, subagents, no-subagents, and inline tokens", () => {
		assert.deepEqual(parseSuperpowersWorkflowArgs("lean fix auth")?.overrides, {
			useSubagents: false,
			useTestDrivenDevelopment: false,
		});
		assert.deepEqual(parseSuperpowersWorkflowArgs("full fix auth")?.overrides, {
			useSubagents: true,
			useTestDrivenDevelopment: true,
		});
		assert.deepEqual(parseSuperpowersWorkflowArgs("direct no-subagents fix auth")?.overrides, {
			useSubagents: false,
			useTestDrivenDevelopment: false,
		});
		assert.deepEqual(parseSuperpowersWorkflowArgs("tdd subagents fix auth")?.overrides, {
			useSubagents: true,
			useTestDrivenDevelopment: true,
		});
		assert.deepEqual(parseSuperpowersWorkflowArgs("inline fix auth")?.overrides, {
			useSubagents: false,
		});
	});

	void it("carries fork flags in either order", () => {
		assert.deepEqual(parseSuperpowersWorkflowArgs("direct fix auth --fork"), {
			task: "fix auth",
			overrides: { useTestDrivenDevelopment: false },
			fork: true,
		});
	});

	void it("returns null when only workflow tokens are provided", () => {
		assert.equal(parseSuperpowersWorkflowArgs("direct no-subagents"), null);
		assert.equal(parseSuperpowersWorkflowArgs("--fork"), null);
		assert.equal(parseSuperpowersWorkflowArgs(""), null);
	});
});