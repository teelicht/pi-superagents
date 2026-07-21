import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSuperpowersRootPrompt, buildSuperpowersVisiblePromptSummary } from "../../src/superpowers/root-prompt.ts";

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

void describe("root prompt task scheduling contract", () => {
	void it("emits the sequential scheduling contract when taskScheduling is sequential", () => {
		const prompt = buildSuperpowersRootPrompt({ ...base, taskScheduling: "sequential" });
		assert.match(prompt, /Task scheduling is SEQUENTIAL by config/);
		assert.match(prompt, /use subagent-driven-development one complete Task at a time/);
		assert.match(prompt, /Dispatch the Task once, review it once with sp-review/);
		assert.doesNotMatch(prompt, /Task scheduling is PARALLEL by config/);
		assert.doesNotMatch(prompt, /dispatching-parallel-agents/);
		assert.doesNotMatch(prompt, /at most 8 Tasks/);
	});

	void it("emits the parallel scheduling contract with the three upstream skills when taskScheduling is parallel", () => {
		const prompt = buildSuperpowersRootPrompt({ ...base, taskScheduling: "parallel" });
		assert.match(prompt, /Task scheduling is PARALLEL by config/);
		assert.match(prompt, /subagent-driven-development/);
		assert.match(prompt, /dispatching-parallel-agents/);
		assert.match(prompt, /using-git-worktrees/);
	});

	void it("parallel contract specifies persistent worktrees, complete Tasks, and sp-review", () => {
		const prompt = buildSuperpowersRootPrompt({ ...base, taskScheduling: "parallel" });
		assert.match(prompt, /persistent worktree per Task/);
		assert.match(prompt, /A Task includes all of its Steps\. Never dispatch or review individual Steps/);
		assert.match(prompt, /task-scope sp-review per completed Task/);
		assert.match(prompt, /sp-review/);
	});

	void it("parallel contract mentions resumeSession for fixes through the affected Task", () => {
		const prompt = buildSuperpowersRootPrompt({ ...base, taskScheduling: "parallel" });
		assert.match(prompt, /resumeSession/);
		assert.match(prompt, /Critical or Important fixes through that Task's resumeSession/);
	});

	void it("parallel contract demands deterministic, ordered integration", () => {
		const prompt = buildSuperpowersRootPrompt({ ...base, taskScheduling: "parallel" });
		assert.match(prompt, /Integrate approved Task commits in Task-number order/);
		assert.match(prompt, /update the parent progress ledger/);
		assert.match(prompt, /clean the Task worktrees/);
		assert.match(prompt, /Never integrate a failed or blocked Task/);
	});

	void it("parallel contract caps parallel waves at eight Tasks", () => {
		const prompt = buildSuperpowersRootPrompt({ ...base, taskScheduling: "parallel" });
		assert.match(prompt, /at most 8 Tasks/);
		assert.match(prompt, /overlapping or ambiguous Tasks stay sequential/);
	});

	void it("parallel contract precedes the general worktree contract", () => {
		const prompt = buildSuperpowersRootPrompt({ ...base, taskScheduling: "parallel", worktrees: { enabled: true } });
		const schedulingIndex = prompt.indexOf("Task scheduling is PARALLEL by config");
		const worktreeIndex = prompt.indexOf("Worktree isolation is ENABLED by config");
		assert.ok(schedulingIndex >= 0, "expected scheduling contract to be present");
		assert.ok(worktreeIndex >= 0, "expected worktree contract to be present");
		assert.ok(schedulingIndex < worktreeIndex, "expected scheduling contract to precede the worktree contract");
	});

	void it("does not emit a scheduling contract when taskScheduling is undefined", () => {
		const prompt = buildSuperpowersRootPrompt({ ...base });
		assert.doesNotMatch(prompt, /Task scheduling is SEQUENTIAL by config/);
		assert.doesNotMatch(prompt, /Task scheduling is PARALLEL by config/);
	});
});

void describe("root prompt visible summary task scheduling", () => {
	void it("includes taskScheduling in the visible summary when provided", () => {
		const summary = buildSuperpowersVisiblePromptSummary({ ...base, taskScheduling: "parallel" });
		assert.match(summary, /taskScheduling: parallel/);
	});

	void it("includes taskScheduling: sequential in the visible summary", () => {
		const summary = buildSuperpowersVisiblePromptSummary({ ...base, taskScheduling: "sequential" });
		assert.match(summary, /taskScheduling: sequential/);
	});

	void it("does not include taskScheduling in the visible summary when undefined", () => {
		const summary = buildSuperpowersVisiblePromptSummary({ ...base });
		assert.doesNotMatch(summary, /taskScheduling/);
	});
});

void describe("root prompt metadata task scheduling", () => {
	void it("includes taskScheduling: parallel in the resolved options metadata", () => {
		const prompt = buildSuperpowersRootPrompt({ ...base, taskScheduling: "parallel" });
		assert.match(prompt, /taskScheduling: parallel/);
	});

	void it("includes taskScheduling: sequential in the resolved options metadata", () => {
		const prompt = buildSuperpowersRootPrompt({ ...base, taskScheduling: "sequential" });
		assert.match(prompt, /taskScheduling: sequential/);
	});
});
