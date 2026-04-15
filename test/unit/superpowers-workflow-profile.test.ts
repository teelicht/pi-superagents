/**
 * Unit tests for Superpowers workflow profile resolution.
 *
 * Responsibilities:
 * - verify inline workflow token parsing
 * - verify command presets are resolved correctly
 * - verify inline tokens override command presets
 * - verify entry skill name and overlay skill names are resolved
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
		commands: {
			"sp-implement": {
				entrySkill: "using-superpowers",
				useSubagents: true,
				useTestDrivenDevelopment: true,
				useBranches: false,
				worktrees: { enabled: false },
			},
			"superpowers-lean": {
				description: "Lean mode",
				entrySkill: "using-superpowers",
				useBranches: true,
				useSubagents: false,
				useTestDrivenDevelopment: false,
			},
			"superpowers-direct": {
				description: "Direct mode",
				entrySkill: "using-superpowers",
				useSubagents: true,
				useTestDrivenDevelopment: false,
			},
		},
	},
};

void describe("Superpowers workflow profile", () => {
	void it("uses sp-implement preset as default for sp-implement command", () => {
		const parsed = parseSuperpowersWorkflowArgs("fix auth")!;
		assert.deepEqual(parsed, {
			task: "fix auth",
			overrides: {},
			fork: false,
		});
		assert.deepEqual(resolveSuperpowersRunProfile({
			config,
			commandName: "sp-implement",
			parsed,
		}), {
			commandName: "sp-implement",
			task: "fix auth",
			entrySkill: "using-superpowers",
			useSubagents: true,
			useTestDrivenDevelopment: true,
			useBranches: false,
			worktrees: { enabled: false },
			fork: false,
			overlaySkillNames: [],
		});
	});

	void it("applies command preset values with inline tokens overriding preset", () => {
		const parsed = parseSuperpowersWorkflowArgs("tdd fix auth")!;
		assert.deepEqual(resolveSuperpowersRunProfile({
			config,
			commandName: "superpowers-lean",
			parsed,
		}), {
			commandName: "superpowers-lean",
			task: "fix auth",
			entrySkill: "using-superpowers",
			useBranches: true,
			useSubagents: false, // from preset
			useTestDrivenDevelopment: true, // from inline token
			fork: false,
			overlaySkillNames: [],
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

	void it("resolves entry skill from sp-implement preset", () => {
		const parsed = parseSuperpowersWorkflowArgs("fix auth")!;
		const profile = resolveSuperpowersRunProfile({
			config,
			commandName: "sp-implement",
			parsed,
		});
		assert.equal(profile.entrySkill, "using-superpowers");
		assert.deepEqual(profile.overlaySkillNames, []);
	});

	void it("resolves brainstorming entry skill with overlays", () => {
		const parsed = parseSuperpowersWorkflowArgs("design onboarding")!;
		const profile = resolveSuperpowersRunProfile({
			config: {
				superagents: {
					commands: {
						"sp-brainstorm": {
							entrySkill: "brainstorming",
							usePlannotator: true,
						},
					},
					skillOverlays: {
						brainstorming: ["react-native-best-practices"],
					},
				},
			},
			commandName: "sp-brainstorm",
			parsed,
		});

		assert.equal(profile.entrySkill, "brainstorming");
		assert.deepEqual(profile.overlaySkillNames, ["react-native-best-practices"]);
		assert.equal(profile.usePlannotatorReview, true);
	});

	void it("accepts entry skill override via parameter", () => {
		const parsed = parseSuperpowersWorkflowArgs("design middleware")!;
		const profile = resolveSuperpowersRunProfile({
			config: {
				superagents: {
					skillOverlays: {
						brainstorming: ["react-native-best-practices"],
					},
				},
			},
			commandName: "skill:brainstorming",
			parsed,
			entrySkill: "brainstorming",
		});

		assert.equal(profile.entrySkill, "brainstorming");
		assert.deepEqual(profile.overlaySkillNames, ["react-native-best-practices"]);
	});

	void it("resolves invocation overlays from superpowersSkills without entry skill", () => {
		const parsed = parseSuperpowersWorkflowArgs("fix auth")!;
		const profile = resolveSuperpowersRunProfile({
			config: {
				superagents: {
					commands: {
						"sp-implement": {
							entrySkill: "using-superpowers",
						},
					},
					skillOverlays: {
						"writing-plans": ["supabase-postgres-best-practices"],
					},
					superpowersSkills: ["writing-plans", "executing-plans"],
				},
			},
			commandName: "sp-implement",
			parsed,
		});
		assert.deepEqual(profile.overlaySkillNames, ["supabase-postgres-best-practices"]);
	});

	void it("merges entry overlays with invocation overlays from superpowersSkills", () => {
		const parsed = parseSuperpowersWorkflowArgs("design onboarding")!;
		const profile = resolveSuperpowersRunProfile({
			config: {
				superagents: {
					commands: {
						"sp-brainstorm": {
							entrySkill: "brainstorming",
						},
					},
					skillOverlays: {
						brainstorming: ["react-native-best-practices"],
						"writing-plans": ["supabase-postgres-best-practices"],
					},
					superpowersSkills: ["writing-plans", "executing-plans"],
				},
			},
			commandName: "sp-brainstorm",
			parsed,
		});
		assert.deepEqual(profile.overlaySkillNames, [
			"react-native-best-practices",
			"supabase-postgres-best-practices",
		]);
	});

	void it("deduplicates overlays when entry skill overlaps with superpowersSkills", () => {
		const parsed = parseSuperpowersWorkflowArgs("design onboarding")!;
		const profile = resolveSuperpowersRunProfile({
			config: {
				superagents: {
					commands: {
						"sp-brainstorm": {
							entrySkill: "brainstorming",
						},
					},
					skillOverlays: {
						brainstorming: ["react-native-best-practices"],
					},
					superpowersSkills: ["brainstorming", "writing-plans"],
				},
			},
			commandName: "sp-brainstorm",
			parsed,
		});
		assert.deepEqual(profile.overlaySkillNames, ["react-native-best-practices"]);
	});

	void it("returns empty overlays when superpowersSkills and skillOverlays are absent", () => {
		const parsed = parseSuperpowersWorkflowArgs("fix auth")!;
		const profile = resolveSuperpowersRunProfile({
			config: {
				superagents: {
					commands: {
						"sp-implement": {
							entrySkill: "using-superpowers",
						},
					},
				},
			},
			commandName: "sp-implement",
			parsed,
		});
		assert.deepEqual(profile.overlaySkillNames, []);
	});

	void it("defaults to using-superpowers entry skill for unknown commands", () => {
		const parsed = parseSuperpowersWorkflowArgs("fix auth")!;
		const profile = resolveSuperpowersRunProfile({
			config: {
				superagents: {
					commands: {},
				},
			},
			commandName: "sp-custom",
			parsed,
		});
		assert.equal(profile.entrySkill, "using-superpowers");
	});

	void it("uses entry skill from preset for unknown command", () => {
		const parsed = parseSuperpowersWorkflowArgs("fix auth")!;
		const profile = resolveSuperpowersRunProfile({
			config: {
				superagents: {
					commands: {
						"sp-custom": {
							entrySkill: "brainstorming",
						},
					},
				},
			},
			commandName: "sp-custom",
			parsed,
		});
		assert.equal(profile.entrySkill, "brainstorming");
	});
});
