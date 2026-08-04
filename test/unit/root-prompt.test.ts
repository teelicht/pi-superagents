import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSuperpowersRootPrompt, buildSuperpowersVisiblePromptSummary } from "../../src/superpowers/root-prompt.ts";

const base = { task: "do the thing", fork: false } as const;

void describe("root prompt SDD adapter contract", () => {
	void it("emits the upstream-authoritative SDD adapter when useSubagents is true", () => {
		const prompt = buildSuperpowersRootPrompt({ ...base, useSubagents: true });
		assert.match(prompt, /Superpowers SDD Adapter Contract/);
		assert.match(prompt, /selected upstream.*subagent-driven-development.*authoritative/i);
		assert.match(prompt, /Review scope: task/);
		assert.match(prompt, /Review scope: re-review/);
		assert.match(prompt, /Review scope: branch/);
		assert.match(prompt, /resumeSession/);
		assert.match(prompt, /upstream requests resuming the original implementer/i);
		assert.match(prompt, /final cleanup step/i);
		assert.match(prompt, /before invoking.*finishing-a-development-branch/i);
		assert.doesNotMatch(prompt, /scripts\/task-brief/);
		assert.doesNotMatch(prompt, /scripts\/review-package/);
		assert.doesNotMatch(prompt, /rm -f/);
		assert.doesNotMatch(prompt, /progress\.md/);
	});

	void it("omits the SDD adapter when useSubagents is false or undefined", () => {
		assert.doesNotMatch(buildSuperpowersRootPrompt({ ...base, useSubagents: false }), /Superpowers SDD Adapter Contract/);
		assert.doesNotMatch(buildSuperpowersRootPrompt({ ...base }), /Superpowers SDD Adapter Contract/);
	});
});

void describe("root prompt task scheduling contract", () => {
	void it("emits the sequential scheduling contract when taskScheduling is sequential", () => {
		const prompt = buildSuperpowersRootPrompt({ ...base, taskScheduling: "sequential" });
		assert.match(prompt, /Task scheduling is SEQUENTIAL by config/);
		assert.match(prompt, /scheduling controls Task order only/i);
		assert.match(prompt, /follow the selected upstream SDD workflow/i);
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

	void it("parallel contract specifies persistent worktrees, complete Tasks, and upstream SDD flow", () => {
		const prompt = buildSuperpowersRootPrompt({ ...base, taskScheduling: "parallel" });
		assert.match(prompt, /persistent worktree per Task/);
		assert.match(prompt, /A Task includes all of its Steps\. Never dispatch or review individual Steps/);
		assert.match(prompt, /scheduling controls Task order and isolation only/i);
		assert.match(prompt, /follow the selected upstream SDD workflow/i);
		assert.match(prompt, /Review scope: branch/);
		assert.doesNotMatch(prompt, /Resume Critical or Important fixes/);
		assert.doesNotMatch(prompt, /parent progress ledger/);
	});

	void it("parallel contract demands deterministic, ordered integration", () => {
		const prompt = buildSuperpowersRootPrompt({ ...base, taskScheduling: "parallel" });
		assert.match(prompt, /Integrate upstream-approved Task commits in Task-number order/);
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
