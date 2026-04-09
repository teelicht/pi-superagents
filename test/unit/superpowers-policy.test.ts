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

	it("resolves overlays only for command-scoped superpowers runs", () => {
		const skills = resolveRoleSkillSet({
			workflow: "superpowers",
			role: "sp-spec-review",
			config: {
				superpowers: {
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
