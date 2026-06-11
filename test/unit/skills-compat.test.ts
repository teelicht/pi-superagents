/**
 * Unit coverage for PI skill loader compatibility options.
 *
 * Responsibilities:
 * - verify explicit cwd and agent-dir values are forwarded to PI
 * - keep skill loader call construction stable across PI 0.67/0.68 APIs
 * - verify project-local skill inputs are gated on project trust
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildLoadSkillsOptionsForPi, buildSkillPathsForTest } from "../../src/shared/skills.ts";

void describe("PI skill loader compatibility", () => {
	void it("includes explicit cwd and agentDir in loadSkills options", () => {
		const options = buildLoadSkillsOptionsForPi({
			cwd: "/project",
			agentDir: "/home/user/.pi/agent",
			skillPaths: ["/project/.pi/skills"],
		});

		assert.deepEqual(options, {
			cwd: "/project",
			agentDir: "/home/user/.pi/agent",
			skillPaths: ["/project/.pi/skills"],
			includeDefaults: false,
		});
	});
});

void describe("buildSkillPathsForTest trust policy", () => {
	void it("excludes project-local skill paths when project inputs are not trusted", () => {
		const paths = buildSkillPathsForTest("/repo", { includeProject: false });

		assert.equal(paths.includes("/repo/.pi/skills"), false);
		assert.equal(paths.includes("/repo/.agents/skills"), false);
		assert.ok(paths.some((entry) => entry.endsWith("/.pi/agent/skills")));
		assert.ok(paths.some((entry) => entry.endsWith("/.agents/skills")));
	});

	void it("includes project-local skill paths when project inputs are trusted", () => {
		const paths = buildSkillPathsForTest("/repo", { includeProject: true });

		assert.ok(paths.includes("/repo/.pi/skills"));
		assert.ok(paths.includes("/repo/.agents/skills"));
	});
});
