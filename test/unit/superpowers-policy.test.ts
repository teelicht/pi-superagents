/**
 * Unit tests for command-scoped Superpowers policy resolution.
 *
 * Responsibilities:
 * - verify workflow gating for role-specific model resolution
 * - verify role overlay skill merging for Superpowers runs
 * - verify implementer mode skill injection behavior
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	resolveModelForAgent,
	resolveRoleSkillSet,
	resolveImplementerSkillSet,
	resolveRoleTools,
} from "../../superpowers-policy.ts";

describe("superpowers policy", () => {
	it("resolves tiers in default workflow when configured", () => {
		assert.deepEqual(
			resolveModelForAgent({
				workflow: "default",
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

	it("returns undefined for unconfigured tiers", () => {
		assert.equal(
			resolveModelForAgent({
				workflow: "default",
				agentModel: "unconfigured-tier",
				config: {},
			}),
			undefined,
		);
	});

	it("resolves balanced tier model and thinking from agent frontmatter", () => {
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

	it("supports string shorthand tier mappings without thinking", () => {
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

	it("supports custom tier names when configured", () => {
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

	it("returns undefined for unconfigured custom tiers", () => {
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

	it("resolves overlays only for command-scoped superpowers runs", () => {
		const skills = resolveRoleSkillSet({
			workflow: "superpowers",
			role: "sp-spec-review",
			config: {
				superagents: {
					roleSkillOverlays: {
						"sp-spec-review": ["vercel-react-native-skills"],
					},
				},
			},
			agentSkills: [],
			stepSkills: [],
			availableSkills: new Set(["vercel-react-native-skills"]),
		});

		assert.deepEqual(skills, ["vercel-react-native-skills"]);
	});

	it("adds test-driven-development only in tdd implementer mode", () => {
		assert.deepEqual(
			resolveImplementerSkillSet({
				workflow: "superpowers",
				implementerMode: "tdd",
				config: {},
				agentSkills: [],
				stepSkills: [],
				availableSkills: new Set(["test-driven-development"]),
			}),
			["test-driven-development"],
		);
	});

	it("assigns a non-delegating default tool set to bounded superpowers roles", () => {
		assert.deepEqual(
			resolveRoleTools({
				workflow: "superpowers",
				role: "sp-recon",
			}),
			["read", "grep", "find", "ls"],
		);
	});

	it("strips subagent tools from explicit bounded-role tool lists", () => {
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
