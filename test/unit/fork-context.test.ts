import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createForkContextResolver, resolveSubagentContext } from "../../src/execution/fork-context.ts";

void describe("resolveSubagentContext", () => {
	void it("defaults to fresh", () => {
		assert.equal(resolveSubagentContext(undefined), "fresh");
		assert.equal(resolveSubagentContext("anything"), "fresh");
	});

	void it("accepts fork", () => {
		assert.equal(resolveSubagentContext("fork"), "fork");
	});
});

void describe("createForkContextResolver", () => {
	void it("fresh mode never calls createBranchedSession", () => {
		let calls = 0;
		const resolver = createForkContextResolver(
			{
				getSessionFile: () => "/tmp/parent.jsonl",
				getLeafId: () => "leaf-123",
				createBranchedSession: () => {
					calls++;
					return "/tmp/child.jsonl";
				},
			},
			"fresh",
		);

		assert.equal(resolver.sessionFileForIndex(0), undefined);
		assert.equal(calls, 0);
	});

	void it("fails fast when parent session file is missing", () => {
		assert.throws(
			() =>
				createForkContextResolver(
					{
						getSessionFile: () => undefined,
						getLeafId: () => "leaf-123",
						createBranchedSession: () => "/tmp/child.jsonl",
					},
					"fork",
				),
			/Forked subagent context requires a persisted parent session\./,
		);
	});

	void it("fails fast when leaf id is missing", () => {
		assert.throws(
			() =>
				createForkContextResolver(
					{
						getSessionFile: () => "/tmp/parent.jsonl",
						getLeafId: () => null,
						createBranchedSession: () => "/tmp/child.jsonl",
					},
					"fork",
				),
			/Forked subagent context requires a current leaf to fork from\./,
		);
	});

	void it("uses the exact current leaf id when creating branched sessions", () => {
		const seenLeafIds: string[] = [];
		const resolver = createForkContextResolver(
			{
				getSessionFile: () => "/tmp/parent.jsonl",
				getLeafId: () => "leaf-xyz",
				createBranchedSession: (leafId) => {
					seenLeafIds.push(leafId);
					return `/tmp/child-${seenLeafIds.length}.jsonl`;
				},
			},
			"fork",
		);

		resolver.sessionFileForIndex(0);
		resolver.sessionFileForIndex(1);
		resolver.sessionFileForIndex(2);

		assert.deepEqual(seenLeafIds, ["leaf-xyz", "leaf-xyz", "leaf-xyz"]);
	});

	void it("creates isolated branched sessions per index (parallel and chain compatible)", () => {
		let count = 0;
		const resolver = createForkContextResolver(
			{
				getSessionFile: () => "/tmp/parent.jsonl",
				getLeafId: () => "leaf-abc",
				createBranchedSession: () => {
					count++;
					return `/tmp/fork-${count}.jsonl`;
				},
			},
			"fork",
		);

		const singleSession = resolver.sessionFileForIndex(0);
		const parallelSessions = [resolver.sessionFileForIndex(1), resolver.sessionFileForIndex(2)];
		const chainSessions = [resolver.sessionFileForIndex(3), resolver.sessionFileForIndex(4)];

		assert.equal(singleSession, "/tmp/fork-1.jsonl");
		assert.deepEqual(parallelSessions, ["/tmp/fork-2.jsonl", "/tmp/fork-3.jsonl"]);
		assert.deepEqual(chainSessions, ["/tmp/fork-4.jsonl", "/tmp/fork-5.jsonl"]);
		assert.equal(count, 5);
	});

	void it("memoizes per index to keep behavior deterministic", () => {
		let count = 0;
		const resolver = createForkContextResolver(
			{
				getSessionFile: () => "/tmp/parent.jsonl",
				getLeafId: () => "leaf-abc",
				createBranchedSession: () => {
					count++;
					return `/tmp/fork-${count}.jsonl`;
				},
			},
			"fork",
		);

		const first = resolver.sessionFileForIndex(7);
		const second = resolver.sessionFileForIndex(7);
		assert.equal(first, second);
		assert.equal(count, 1);
	});

	void it("does not silently fallback to fresh when branch extraction fails", () => {
		const resolver = createForkContextResolver(
			{
				getSessionFile: () => "/tmp/parent.jsonl",
				getLeafId: () => "leaf-abc",
				createBranchedSession: () => undefined,
			},
			"fork",
		);

		assert.throws(
			() => resolver.sessionFileForIndex(0),
			/Failed to create forked subagent session: Session manager did not return a session file\./,
		);
	});
});
