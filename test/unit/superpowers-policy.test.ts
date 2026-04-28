/**
 * Unit tests for command-scoped Superpowers policy resolution.
 *
 * Responsibilities:
 * - verify workflow gating for role-specific model resolution
 * - verify role skill merging for Superpowers runs
 * - verify TDD skill injection behavior based on useTestDrivenDevelopment
 * - verify tool resolution with read-only fallback for bounded roles
 * - verify root-only skill enforcement
 * - verify execution role inference from agent name convention
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inferExecutionRole, resolveImplementerSkillSet, resolveModelForAgent, resolveRoleSkillSet, resolveRoleTools } from "../../src/execution/superpowers-policy.ts";
import { READ_ONLY_TOOLS } from "../../src/shared/tool-registry.ts";

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
			availableSkills: new Set(["ignored-config-skill", "vercel-react-native-skills", "react-native-best-practices"]),
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

	void it("falls back to READ_ONLY_TOOLS for bounded roles without explicit tools", () => {
		assert.deepEqual(
			resolveRoleTools({
				workflow: "superpowers",
				role: "sp-recon",
			}),
			[...READ_ONLY_TOOLS],
		);
	});

	void it("rejects root-scoped skills for bounded roles when rootOnlySkills is provided", () => {
		assert.throws(() => {
			resolveRoleSkillSet({
				workflow: "superpowers",
				role: "sp-recon",
				config: {},
				agentSkills: [],
				stepSkills: ["brainstorming"],
				availableSkills: new Set(["brainstorming"]),
				rootOnlySkills: new Set(["brainstorming"]),
			});
		}, /cannot receive root-only workflow skill/);
	});

	void it("allows root-scoped skills for root-planning role", () => {
		const skills = resolveRoleSkillSet({
			workflow: "superpowers",
			role: "root-planning",
			config: {},
			agentSkills: ["brainstorming"],
			stepSkills: [],
			availableSkills: new Set(["brainstorming"]),
			rootOnlySkills: new Set(["brainstorming"]),
		});
		assert.deepEqual(skills, ["brainstorming"]);
	});

	void it("allows agent-scoped skills for bounded roles when not in rootOnlySkills", () => {
		const skills = resolveRoleSkillSet({
			workflow: "superpowers",
			role: "sp-recon",
			config: {},
			agentSkills: ["test-driven-development"],
			stepSkills: [],
			availableSkills: new Set(["test-driven-development"]),
			rootOnlySkills: new Set(["brainstorming"]),
		});
		assert.deepEqual(skills, ["test-driven-development"]);
	});

	void it("infers sp-roles from sp- prefix convention", () => {
		assert.equal(inferExecutionRole("sp-recon"), "sp-recon");
		assert.equal(inferExecutionRole("sp-research"), "sp-research");
		assert.equal(inferExecutionRole("sp-implementer"), "sp-implementer");
		assert.equal(inferExecutionRole("sp-custom-role"), "sp-custom-role");
		assert.equal(inferExecutionRole("root"), "root-planning");
		assert.equal(inferExecutionRole("any-other-name"), "root-planning");
	});

	void it("uses READ_ONLY_TOOLS as fallback for any bounded role without explicit tools", () => {
		assert.deepEqual(
			resolveRoleTools({
				workflow: "superpowers",
				role: "sp-implementer",
			}),
			[...READ_ONLY_TOOLS],
		);
	});

	void it("prefers agent-declared tools over fallback for bounded roles", () => {
		assert.deepEqual(
			resolveRoleTools({
				workflow: "superpowers",
				role: "sp-implementer",
				agentTools: ["read", "grep", "find", "ls", "bash", "write"],
			}),
			["read", "grep", "find", "ls", "bash", "write"],
		);
	});

	void it("resolves later model tier values from a changed runtime config", () => {
		const firstConfig = {
			superagents: {
				modelTiers: {
					balanced: { model: "openai/gpt-5.4" },
				},
			},
		};
		const secondConfig = {
			superagents: {
				modelTiers: {
					balanced: { model: "anthropic/claude-opus-4.6" },
				},
			},
		};

		assert.deepEqual(resolveModelForAgent({ workflow: "superpowers", agentModel: "balanced", config: firstConfig }), {
			model: "openai/gpt-5.4",
		});
		assert.deepEqual(resolveModelForAgent({ workflow: "superpowers", agentModel: "balanced", config: secondConfig }), {
			model: "anthropic/claude-opus-4.6",
		});
	});
});
