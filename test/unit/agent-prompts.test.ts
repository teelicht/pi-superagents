import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";

const agentsDir = path.resolve(import.meta.dirname, "../../agents");
function read(name: string): string {
	return fs.readFileSync(path.join(agentsDir, name), "utf-8");
}

void describe("bounded role agent prompts", () => {
	void it("sp-implementer instructs reading the brief and writing the report by path", () => {
		const body = read("sp-implementer.md");
		assert.match(body, /brief.*path given in your task/i);
		assert.match(body, /report.*path given in your task/i);
	});

	void it("sp-spec-review and sp-code-review instruct reading brief, report, and diff by path", () => {
		for (const name of ["sp-spec-review.md", "sp-code-review.md"]) {
			const body = read(name);
			assert.match(body, /brief/i);
			assert.match(body, /report/i);
			assert.match(body, /diff/i);
			assert.match(body, /paths given in your task/i);
		}
	});

	void it("sp-debug does not reference a debug-brief file", () => {
		const body = read("sp-debug.md");
		assert.doesNotMatch(body, /debug-brief/i);
		assert.match(body, /task packet/i);
	});
});
