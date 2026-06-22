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
import {
	inferExecutionRole,
	RESERVED_MODEL_TIERS,
	resolveEffectiveModel,
	resolveImplementerSkillSet,
	resolveModelForAgent,
	resolveRoleSkillSet,
	resolveRoleTools,
} from "../../src/execution/superpowers-policy.ts";
import { CHILD_LIFECYCLE_TOOLS, READ_ONLY_TOOLS } from "../../src/shared/tool-registry.ts";

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

	void it("appends configured global tools to bounded role tools without duplicates", () => {
		assert.deepEqual(
			resolveRoleTools({
				workflow: "superpowers",
				role: "sp-implementer",
				agentTools: ["read", "write"],
				configTools: ["write", "./tools/shared-tool.ts"],
			}),
			["read", "write", "./tools/shared-tool.ts"],
		);
	});

	void it("strips delegation tools from configured global tools for bounded roles", () => {
		assert.deepEqual(
			resolveRoleTools({
				workflow: "superpowers",
				role: "sp-research",
				agentTools: ["read"],
				configTools: ["subagent", "grep", "subagent_status"],
			}),
			["read", "grep"],
		);
	});

	void it("appends configured global tools to bounded role fallback tools", () => {
		assert.deepEqual(
			resolveRoleTools({
				workflow: "superpowers",
				role: "sp-recon",
				configTools: ["bash"],
			}),
			[...READ_ONLY_TOOLS, ...CHILD_LIFECYCLE_TOOLS, "bash"],
		);
	});

	void it("appends configured global tools for root-planning roles", () => {
		assert.deepEqual(
			resolveRoleTools({
				workflow: "superpowers",
				role: "root-planning",
				agentTools: ["read"],
				configTools: ["grep"],
			}),
			["read", "grep"],
		);
	});

	void it("keeps child lifecycle tools while stripping delegation tools", () => {
		const tools = resolveRoleTools({
			workflow: "superpowers",
			role: "sp-research",
			agentTools: ["read", "subagent", "subagent_done", "caller_ping"],
		});
		assert.deepEqual(tools, ["read", "subagent_done", "caller_ping"]);
	});

	void it("includes lifecycle tools in fallback for bounded roles without explicit tools", () => {
		const tools = resolveRoleTools({
			workflow: "superpowers",
			role: "sp-recon",
		});
		const expected = [...READ_ONLY_TOOLS, ...CHILD_LIFECYCLE_TOOLS];
		assert.deepEqual(tools, expected);
	});

	void it("keeps root-planning tool access when workflow is superpowers", () => {
		assert.equal(
			resolveRoleTools({
				workflow: "superpowers",
				role: "root-planning",
			}),
			undefined,
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

	void it("injects systematic-debugging when sp-debug declares it in agent frontmatter", () => {
		const skills = resolveRoleSkillSet({
			workflow: "superpowers",
			role: "sp-debug",
			config: {},
			agentSkills: ["systematic-debugging"],
			stepSkills: [],
			availableSkills: new Set(["systematic-debugging"]),
			rootOnlySkills: new Set(),
		});
		assert.deepEqual(skills, ["systematic-debugging"]);
	});

	void it("infers sp-roles from sp- prefix convention", () => {
		assert.equal(inferExecutionRole("sp-recon"), "sp-recon");
		assert.equal(inferExecutionRole("sp-research"), "sp-research");
		assert.equal(inferExecutionRole("sp-implementer"), "sp-implementer");
		assert.equal(inferExecutionRole("sp-custom-role"), "sp-custom-role");
		assert.equal(inferExecutionRole("root"), "root-planning");
		assert.equal(inferExecutionRole("any-other-name"), "root-planning");
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

void describe("resolveEffectiveModel", () => {
	void it("exposes the reserved built-in tier names", () => {
		assert.deepEqual([...RESERVED_MODEL_TIERS], ["cheap", "balanced", "max", "reasoning"]);
	});

	void it("returns the configured model and thinking when a reserved tier resolves", () => {
		const config = { superagents: { modelTiers: { cheap: { model: "openai/gpt-4o-mini", thinking: "low" } } } } as const;
		assert.deepEqual(resolveEffectiveModel({ agentModel: "cheap", config }), {
			model: "openai/gpt-4o-mini",
			thinking: "low",
		});
	});

	void it("marks a reserved tier as unresolved when no modelTiers are configured", () => {
		assert.deepEqual(resolveEffectiveModel({ agentModel: "cheap", config: {} }), { unresolvedTier: "cheap" });
	});

	void it("marks a reserved tier as unresolved when config.superagents is absent", () => {
		assert.deepEqual(resolveEffectiveModel({ agentModel: "cheap", config: {} }), { unresolvedTier: "cheap" });
	});

	void it("marks a configured tier key as unresolved when its model is empty", () => {
		const config = { superagents: { modelTiers: { creative: { model: "" } } } };
		assert.deepEqual(resolveEffectiveModel({ agentModel: "creative", config }), { unresolvedTier: "creative" });
	});

	void it("resolves a custom tier when its model is configured", () => {
		const config = { superagents: { modelTiers: { creative: { model: "anthropic/claude-opus-4.6", thinking: "high" } } } } as const;
		assert.deepEqual(resolveEffectiveModel({ agentModel: "creative", config }), {
			model: "anthropic/claude-opus-4.6",
			thinking: "high",
		});
	});

	void it("lets a runtime model override win over a reserved tier", () => {
		const config = { superagents: { modelTiers: { cheap: { model: "openai/gpt-4o-mini" } } } };
		assert.deepEqual(resolveEffectiveModel({ agentModel: "cheap", modelOverride: "anthropic/claude-sonnet", config }), {
			model: "anthropic/claude-sonnet",
		});
	});

	void it("lets a runtime model override win even when the tier would be unresolved", () => {
		assert.deepEqual(resolveEffectiveModel({ agentModel: "cheap", modelOverride: "anthropic/claude-sonnet", config: {} }), {
			model: "anthropic/claude-sonnet",
		});
	});

	void it("passes a non-tier concrete model string through unchanged", () => {
		assert.deepEqual(resolveEffectiveModel({ agentModel: "anthropic/claude-sonnet", config: {} }), {
			model: "anthropic/claude-sonnet",
		});
	});

	void it("returns no model when the agent declares no model and nothing is configured", () => {
		assert.deepEqual(resolveEffectiveModel({ agentModel: undefined, config: {} }), {});
	});
});
