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
	resolveModelForRole,
	resolveRoleSkillSet,
	resolveImplementerSkillSet,
} from "../../superpowers-policy.ts";

describe("superpowers policy", () => {
	it("does nothing when workflow is default", () => {
		assert.equal(
			resolveModelForRole({
				workflow: "default",
				role: "sp-code-review",
				config: {},
			}),
			undefined,
		);
	});

	it("resolves balanced tier model and thinking for superpowers roles", () => {
		assert.deepEqual(
			resolveModelForRole({
				workflow: "superpowers",
				role: "sp-code-review",
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
			resolveModelForRole({
				workflow: "superpowers",
				role: "sp-code-review",
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

	it("falls back to the legacy superpowers root for existing configs", () => {
		assert.deepEqual(
			resolveModelForRole({
				workflow: "superpowers",
				role: "sp-code-review",
				config: {
					superpowers: {
						modelTiers: {
							balanced: {
								model: "openai/gpt-5.4",
							},
						},
					},
				},
			}),
			{
				model: "openai/gpt-5.4",
			},
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
});
