import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSuperpowersRootPrompt } from "../../src/superpowers/root-prompt.ts";

const base = { task: "do the thing", fork: false } as const;

void describe("root prompt file handoff contract", () => {
	void it("emits the File Handoff Contract when useSubagents is true", () => {
		const prompt = buildSuperpowersRootPrompt({ ...base, useSubagents: true });
		assert.match(prompt, /File Handoff Contract/);
		assert.match(prompt, /scripts\/task-brief/);
		assert.match(prompt, /scripts\/review-package/);
		assert.match(prompt, /rm -f/);
		assert.match(prompt, /progress\.md/);
	});

	void it("omits the File Handoff Contract when useSubagents is false", () => {
		const prompt = buildSuperpowersRootPrompt({ ...base, useSubagents: false });
		assert.doesNotMatch(prompt, /File Handoff Contract/);
	});

	void it("omits the File Handoff Contract when useSubagents is undefined", () => {
		const prompt = buildSuperpowersRootPrompt({ ...base });
		assert.doesNotMatch(prompt, /File Handoff Contract/);
	});
});
