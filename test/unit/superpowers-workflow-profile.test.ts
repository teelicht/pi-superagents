/**
 * Unit tests for Superpowers workflow profile resolution.
 *
 * Responsibilities:
 * - verify inline workflow token parsing
 * - verify custom command presets override global defaults
 * - verify inline tokens override custom command presets
 * - verify entry skill metadata and overlay skill names are resolved
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
		useBranches: false,
		useSubagents: true,
		useTestDrivenDevelopment: true,
		worktrees: {
			enabled: false,
		},
		commands: {
			"superpowers-lean": {
				description: "Lean mode",
				useBranches: true,
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
			useBranches: false,
			useSubagents: true,
			useTestDrivenDevelopment: true,
			usePlannotatorReview: false,
			worktreesEnabled: false,
			fork: false,
			overlaySkillNames: [],
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
			useBranches: true,
			useSubagents: false,
			useTestDrivenDevelopment: true,
			usePlannotatorReview: false,
			worktreesEnabled: false,
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

	void it("resolves branch policy from root config and command presets without inline token overrides", () => {
		const parsed = parseSuperpowersWorkflowArgs("branches fix auth")!;
		assert.equal(parsed.task, "branches fix auth");
		assert.deepEqual(parsed.overrides, {});

		assert.equal(resolveSuperpowersRunProfile({
			config: {
				superagents: {
					useBranches: true,
					commands: {
						"superpowers-no-branch": {
							useBranches: false,
						},
					},
				},
			},
			commandName: "superpowers",
			parsed,
		}).useBranches, true);

		assert.equal(resolveSuperpowersRunProfile({
			config: {
				superagents: {
					useBranches: true,
					commands: {
						"superpowers-no-branch": {
							useBranches: false,
						},
					},
				},
			},
			commandName: "superpowers-no-branch",
			parsed,
		}).useBranches, false);
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

	void it("resolves brainstorming entry skill metadata and overlays", () => {
		const parsed = parseSuperpowersWorkflowArgs("design onboarding")!;
		const profile = resolveSuperpowersRunProfile({
			config: {
				superagents: {
					useSubagents: true,
					useTestDrivenDevelopment: true,
					usePlannotator: true,
					skillOverlays: {
						brainstorming: ["react-native-best-practices"],
					},
				},
			},
			commandName: "sp-brainstorm",
			parsed,
			entrySkill: {
				name: "brainstorming",
				source: "command",
			},
		});

		assert.equal(profile.entrySkill?.name, "brainstorming");
		assert.equal(profile.entrySkill?.source, "command");
		assert.deepEqual(profile.overlaySkillNames, ["react-native-best-practices"]);
		assert.equal(profile.usePlannotatorReview, true);
	});

	void it("resolves intercepted entry skill source metadata", () => {
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
			entrySkill: {
				name: "brainstorming",
				source: "intercepted-skill",
			},
		});

		assert.deepEqual(profile.entrySkill, {
			name: "brainstorming",
			source: "intercepted-skill",
		});
		assert.deepEqual(profile.overlaySkillNames, ["react-native-best-practices"]);
	});

	void it("resolves invocation overlays from superpowersSkills without entry skill", () => {
		const parsed = parseSuperpowersWorkflowArgs("fix auth")!;
		const profile = resolveSuperpowersRunProfile({
			config: {
				superagents: {
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
					skillOverlays: {
						brainstorming: ["react-native-best-practices"],
						"writing-plans": ["supabase-postgres-best-practices"],
					},
					superpowersSkills: ["writing-plans", "executing-plans"],
				},
			},
			commandName: "sp-brainstorm",
			parsed,
			entrySkill: {
				name: "brainstorming",
				source: "command",
			},
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
					skillOverlays: {
						brainstorming: ["react-native-best-practices"],
					},
					superpowersSkills: ["brainstorming", "writing-plans"],
				},
			},
			commandName: "sp-brainstorm",
			parsed,
			entrySkill: {
				name: "brainstorming",
				source: "command",
			},
		});
		assert.deepEqual(profile.overlaySkillNames, ["react-native-best-practices"]);
	});

	void it("returns empty overlays when superpowersSkills and entrySkill are absent", () => {
		const parsed = parseSuperpowersWorkflowArgs("fix auth")!;
		const profile = resolveSuperpowersRunProfile({
			config: {
				superagents: {
					skillOverlays: {
						brainstorming: ["react-native-best-practices"],
					},
				},
			},
			commandName: "sp-implement",
			parsed,
		});
		assert.deepEqual(profile.overlaySkillNames, []);
	});
});
