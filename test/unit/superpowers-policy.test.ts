/**
 * Unit tests for command-scoped Superpowers policy resolution.
 *
 * Responsibilities:
 * - verify workflow gating for role-specific model resolution
 * - verify role skill merging for Superpowers runs
 * - verify TDD skill injection behavior based on useTestDrivenDevelopment
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	resolveModelForAgent,
	resolveRoleSkillSet,
	resolveImplementerSkillSet,
	resolveRoleTools,
} from "../../src/execution/superpowers-policy.ts";

void describe("superpowers policy", () => {
	void it("resolves tiers in default workflow when configured", () => {
		assert.deepEqual(
			resolveModelForAgent({
				workflow: "superpowers",
				agentModel: "balanced",
				config: {
					superagents: {
						modelTiers: {
							balanced: {
								model: "openai/gpt-5.4",
								thinking: "medium",
							},
						},
					},
				},
			}),
			{
				model: "openai/gpt-5.4",
				thinking: "medium",
			},
		);
	});

	void it("returns undefined for unconfigured tiers", () => {
		assert.equal(
			resolveModelForAgent({
				workflow: "superpowers",
				agentModel: "unconfigured-tier",
				config: {},
			}),
			undefined,
		);
	});

	void it("resolves balanced tier model and thinking from agent frontmatter", () => {
		assert.deepEqual(
			resolveModelForAgent({
				workflow: "superpowers",
				agentModel: "balanced",
				config: {
					superagents: {
						modelTiers: {
							balanced: {
								model: "openai/gpt-5.4",
								thinking: "medium",
							},
						},
					},
				},
			}),
			{
				model: "openai/gpt-5.4",
				thinking: "medium",
			},
		);
	});

	void it("supports string shorthand tier mappings without thinking", () => {
		assert.deepEqual(
			resolveModelForAgent({
				workflow: "superpowers",
				agentModel: "balanced",
				config: {
					superagents: {
						modelTiers: {
							balanced: "openai/gpt-5.4",
						},
					},
				},
			}),
			{
				model: "openai/gpt-5.4",
			},
		);
	});

	void it("supports custom tier names when configured", () => {
		assert.deepEqual(
			resolveModelForAgent({
				workflow: "superpowers",
				agentModel: "creative",
				config: {
					superagents: {
						modelTiers: {
							creative: {
								model: "openai/gpt-5.4",
								thinking: "high",
							},
						},
					},
				},
			}),
			{
				model: "openai/gpt-5.4",
				thinking: "high",
			},
		);
	});

	void it("returns undefined for unconfigured custom tiers", () => {
		assert.deepEqual(
			resolveModelForAgent({
				workflow: "superpowers",
				agentModel: "unconfigured-custom",
				config: {
					superagents: {
						modelTiers: {
							balanced: {
								model: "openai/gpt-5.4",
							},
						},
					},
				},
			}),
			undefined,
		);
	});

	void it("resolves sp role agent frontmatter model tiers without role config", () => {
		assert.deepEqual(
			resolveModelForAgent({
				workflow: "superpowers",
				agentModel: "balanced",
				config: {
					superagents: {
						modelTiers: {
							balanced: {
								model: "openai/gpt-5.4",
								thinking: "medium",
							},
						},
					},
				},
			}),
			{ model: "openai/gpt-5.4", thinking: "medium" },
		);
	});

	void it("ignores config overlays and merges only agent and step skills for superpowers runs", () => {
		const skills = resolveRoleSkillSet({
			workflow: "superpowers",
			role: "sp-spec-review",
			config: {
				superagents: {
					roleSkillOverlays: {
						"sp-spec-review": ["ignored-config-skill"],
					},
				},
			} as never,
			agentSkills: ["vercel-react-native-skills"],
			stepSkills: ["react-native-best-practices"],
			availableSkills: new Set([
				"ignored-config-skill",
				"vercel-react-native-skills",
				"react-native-best-practices",
			]),
		});

		assert.deepEqual(skills, ["vercel-react-native-skills", "react-native-best-practices"]);
	});

	void it("adds test-driven-development only when useTestDrivenDevelopment is true", () => {
		assert.deepEqual(
			resolveImplementerSkillSet({
				workflow: "superpowers",
				useTestDrivenDevelopment: true,
				config: {},
				agentSkills: [],
				stepSkills: [],
				availableSkills: new Set(["test-driven-development"]),
			}),
			["test-driven-development"],
		);
		assert.deepEqual(
			resolveImplementerSkillSet({
				workflow: "superpowers",
				useTestDrivenDevelopment: false,
				config: {},
				agentSkills: [],
				stepSkills: [],
				availableSkills: new Set(["test-driven-development"]),
			}),
			[],
		);
	});

	void it("assigns a non-delegating default tool set to bounded superpowers roles", () => {
		assert.deepEqual(
			resolveRoleTools({
				workflow: "superpowers",
				role: "sp-recon",
			}),
			["read", "grep", "find", "ls"],
		);
	});

	void it("strips subagent tools from explicit bounded-role tool lists", () => {
		assert.deepEqual(
			resolveRoleTools({
				workflow: "superpowers",
				role: "sp-implementer",
				agentTools: ["read", "subagent", "write", "subagent_status", "bash"],
			}),
			["read", "write", "bash"],
		);
	});
});