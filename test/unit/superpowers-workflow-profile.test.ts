/**
 * Unit tests for Superpowers workflow profile resolution.
 *
 * Responsibilities:
 * - verify inline workflow token parsing
 * - verify command presets are resolved correctly
 * - verify inline tokens override command presets
 * - verify entry skill name is resolved from entrypoint agent or parameter
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionConfig } from "../../src/shared/types.ts";
import { parseSuperpowersWorkflowArgs, resolveSuperpowersRunProfile } from "../../src/superpowers/workflow-profile.ts";

const config: ExtensionConfig = {
	superagents: {
		commands: {
			"sp-implement": {
				useSubagents: true,
				useTestDrivenDevelopment: true,
				useBranches: false,
				worktrees: { enabled: false },
			},
			"superpowers-lean": {
				useBranches: true,
				useSubagents: false,
				useTestDrivenDevelopment: false,
			},
			"superpowers-direct": {
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
		assert.deepEqual(
			resolveSuperpowersRunProfile({
				config,
				commandName: "sp-implement",
				parsed,
				entrypointAgent: {
					name: "sp-implement",
					description: "Implementation entrypoint",
					kind: "entrypoint",
					execution: "interactive",
					command: "sp-implement",
					entrySkill: "using-superpowers",
					skills: ["verification-before-completion", "receiving-code-review", "finishing-a-development-branch"],
					systemPrompt: "Body",
					source: "builtin",
					filePath: "/agents/sp-implement.md",
				},
			}),
			{
				commandName: "sp-implement",
				task: "fix auth",
				entrySkill: "using-superpowers",
				useSubagents: true,
				useTestDrivenDevelopment: true,
				useBranches: false,
				worktrees: { enabled: false },
				fork: false,
				rootLifecycleSkillNames: ["verification-before-completion", "receiving-code-review", "finishing-a-development-branch"],
			},
		);
	});

	void it("applies command preset values with inline tokens overriding preset", () => {
		const parsed = parseSuperpowersWorkflowArgs("tdd fix auth")!;
		assert.deepEqual(
			resolveSuperpowersRunProfile({
				config,
				commandName: "superpowers-lean",
				parsed,
				entrypointAgent: {
					name: "superpowers-lean",
					description: "Lean mode",
					kind: "entrypoint",
					execution: "interactive",
					entrySkill: "using-superpowers",
					skills: [],
					systemPrompt: "Body",
					source: "builtin",
					filePath: "/agents/superpowers-lean.md",
				},
			}),
			{
				commandName: "superpowers-lean",
				task: "fix auth",
				entrySkill: "using-superpowers",
				useBranches: true,
				useSubagents: false, // from preset
				useTestDrivenDevelopment: true, // from inline token
				fork: false,
				rootLifecycleSkillNames: [],
			},
		);
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

	void it("resolves entry skill from the interactive entrypoint agent", () => {
		const parsed = parseSuperpowersWorkflowArgs("design onboarding")!;
		const profile = resolveSuperpowersRunProfile({
			config: {
				superagents: {
					commands: {
						"sp-brainstorm": { usePlannotator: true },
					},
				},
			},
			commandName: "sp-brainstorm",
			parsed,
			entrypointAgent: {
				name: "sp-brainstorm",
				description: "Brainstorm",
				kind: "entrypoint",
				execution: "interactive",
				command: "sp-brainstorm",
				entrySkill: "brainstorming",
				systemPrompt: "Body",
				source: "builtin",
				filePath: "/agents/sp-brainstorm.md",
			},
		});

		assert.equal(profile.entrySkill, "brainstorming");
		assert.equal(profile.usePlannotatorReview, true);
	});

	void it("resolves entry skill from explicit parameter over entrypoint agent", () => {
		const parsed = parseSuperpowersWorkflowArgs("fix auth")!;
		const profile = resolveSuperpowersRunProfile({
			config,
			commandName: "sp-implement",
			parsed,
			entrySkill: "brainstorming",
			entrypointAgent: {
				name: "sp-implement",
				description: "Implementation entrypoint",
				kind: "entrypoint",
				execution: "interactive",
				command: "sp-implement",
				entrySkill: "using-superpowers",
				skills: ["verification-before-completion"],
				systemPrompt: "Body",
				source: "builtin",
				filePath: "/agents/sp-implement.md",
			},
		});

		assert.equal(profile.entrySkill, "brainstorming"); // explicit param wins
	});

	void it("defaults to using-superpowers when no entrypoint agent and no explicit entry skill", () => {
		const parsed = parseSuperpowersWorkflowArgs("fix auth")!;
		const profile = resolveSuperpowersRunProfile({
			config: {
				superagents: {
					commands: {
						"sp-custom": { useSubagents: true },
					},
				},
			},
			commandName: "sp-custom",
			parsed,
		});

		assert.equal(profile.entrySkill, "using-superpowers");
	});

	void it("resolves root lifecycle skills from matching interactive entrypoint agents", () => {
		const parsed = parseSuperpowersWorkflowArgs("fix auth")!;
		const profile = resolveSuperpowersRunProfile({
			config,
			commandName: "sp-implement",
			parsed,
			entrypointAgent: {
				name: "sp-implement",
				description: "Implementation entrypoint",
				kind: "entrypoint",
				execution: "interactive",
				command: "sp-implement",
				entrySkill: "using-superpowers",
				skills: ["verification-before-completion", "receiving-code-review"],
				systemPrompt: "Body",
				source: "builtin",
				filePath: "/agents/sp-implement.md",
			},
		});
		assert.deepEqual(profile.rootLifecycleSkillNames, ["verification-before-completion", "receiving-code-review"]);
	});

	void it("resolves brainstorming entry skill with usePlannotator from config", () => {
		const parsed = parseSuperpowersWorkflowArgs("design onboarding")!;
		const profile = resolveSuperpowersRunProfile({
			config: {
				superagents: {
					commands: {
						"sp-brainstorm": {
							usePlannotator: true,
						},
					},
				},
			},
			commandName: "sp-brainstorm",
			parsed,
			entrypointAgent: {
				name: "sp-brainstorm",
				description: "Brainstorm",
				kind: "entrypoint",
				execution: "interactive",
				command: "sp-brainstorm",
				entrySkill: "brainstorming",
				systemPrompt: "Body",
				source: "builtin",
				filePath: "/agents/sp-brainstorm.md",
			},
		});

		assert.equal(profile.entrySkill, "brainstorming");
		assert.equal(profile.usePlannotatorReview, true);
	});

	void it("accepts entry skill override via parameter", () => {
		const parsed = parseSuperpowersWorkflowArgs("design middleware")!;
		const profile = resolveSuperpowersRunProfile({
			config: {
				superagents: {
					commands: {},
				},
			},
			commandName: "skill:brainstorming",
			parsed,
			entrySkill: "brainstorming",
		});

		assert.equal(profile.entrySkill, "brainstorming");
	});
});