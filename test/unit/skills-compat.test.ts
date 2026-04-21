/**
 * Unit coverage for PI skill loader compatibility options.
 *
 * Responsibilities:
 * - verify explicit cwd and agent-dir values are forwarded to PI
 * - keep skill loader call construction stable across PI 0.67/0.68 APIs
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildLoadSkillsOptionsForPi } from "../../src/shared/skills.ts";

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
