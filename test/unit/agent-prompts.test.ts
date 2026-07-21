/**
 * Unit tests for the bounded Superpowers role agent prompts.
 *
 * Responsibilities:
 * - verify each built-in bounded role prompt carries the contract its dispatch
 *   requires (path-based brief/report handoff, read-only enforcement, etc.)
 * - guard the unified `sp-review` role (max tier, lineage-only session) so
 *   a future addition cannot accidentally re-spawn the legacy two-reviewer split
 * - keep the discoverable `sp-*` role set in sync with the agents/ directory
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";

const agentsDir = path.resolve(import.meta.dirname, "../../agents");
/**
 * Read the contents of a bounded agent prompt from the agents/ directory.
 *
 * @param name Agent file name (e.g. "sp-review.md").
 * @returns UTF-8 contents of the agent prompt.
 */
function read(name: string): string {
	return fs.readFileSync(path.join(agentsDir, name), "utf-8");
}

void describe("bounded role agent prompts", () => {
	void it("sp-implementer instructs reading the brief and writing the report by path", () => {
		const body = read("sp-implementer.md");
		assert.match(body, /brief.*path given in your task/i);
		assert.match(body, /report.*path given in your task/i);
	});

	void it("exposes one max-tier reviewer for task and branch scopes", () => {
		assert.equal(fs.existsSync(path.join(agentsDir, "sp-spec-review.md")), false);
		assert.equal(fs.existsSync(path.join(agentsDir, "sp-code-review.md")), false);

		const body = read("sp-review.md");
		assert.match(body, /name: sp-review/);
		assert.match(body, /model: max/);
		assert.match(body, /session-mode: lineage-only/);
		assert.match(body, /maxSubagentDepth: 0/);
		assert.match(body, /Review scope: task/);
		assert.match(body, /Review scope: branch/);
		assert.match(body, /brief/i);
		assert.match(body, /report/i);
		assert.match(body, /diff/i);
		assert.match(body, /read-only/i);
	});

	void it("sp-debug does not reference a debug-brief file", () => {
		const body = read("sp-debug.md");
		assert.doesNotMatch(body, /debug-brief/i);
		assert.match(body, /task packet/i);
	});
});
