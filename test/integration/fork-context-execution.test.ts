import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { MockPi } from "../support/helpers.ts";
import { createMockPi, createTempDir, removeTempDir, tryImport } from "../support/helpers.ts";

interface ExecutorModule {
	createSubagentExecutor?: (...args: unknown[]) => {
		execute: (
			id: string,
			params: Record<string, unknown>,
			signal: AbortSignal,
			onUpdate: ((result: unknown) => void) | undefined,
			ctx: unknown,
		) => Promise<{ isError?: boolean; content: Array<{ text?: string }> }>;
	};
}

const executorMod = await tryImport<ExecutorModule>("./src/execution/subagent-executor.ts");
const available = !!executorMod;
const createSubagentExecutor = executorMod?.createSubagentExecutor;

interface SessionStubOptions {
	sessionFile?: string;
	leafId?: string | null;
}

interface SessionManagerStub {
	getSessionFile(): string | undefined;
	getLeafId(): string | null;
	createBranchedSession(leafId: string): string;
}

function makeSessionManagerRecorder(options: SessionStubOptions = {}) {
	const calls: string[] = [];
	let counter = 0;
	const manager: SessionManagerStub = {
		getSessionFile: () => options.sessionFile,
		getLeafId: () => (options.leafId === undefined ? "leaf-current" : options.leafId),
		createBranchedSession: (leafId: string) => {
			calls.push(leafId);
			counter++;
			return `/tmp/subagent-fork-${counter}.jsonl`;
		},
	};
	return { manager, calls };
}

function makeState(cwd: string) {
	return {
		baseCwd: cwd,
		currentSessionId: null,
		asyncJobs: new Map(),
		cleanupTimers: new Map(),
		lastUiContext: null,
		poller: null,
		completionSeen: new Map(),
		watcher: null,
		watcherRestartTimer: null,
		resultFileCoalescer: {
			schedule: () => false,
			clear: () => {},
		},
	};
}

describe("fork context execution wiring", { skip: !available ? "subagent executor not importable" : undefined }, () => {
	let tempDir: string;
	let mockPi: MockPi;

	before(() => {
		mockPi = createMockPi();
		mockPi.install();
	});

	after(() => {
		mockPi.uninstall();
	});

	beforeEach(() => {
		tempDir = createTempDir("pi-subagent-fork-test-");
		mockPi.reset();
		mockPi.onCall({ output: "ok" });
	});

	afterEach(() => {
		removeTempDir(tempDir);
	});

	function makeExecutor() {
		return createSubagentExecutor({
			pi: { events: { emit: () => {} } },
			state: makeState(tempDir),
			config: {},
			asyncByDefault: false,
			tempArtifactsDir: tempDir,
			getSubagentSessionRoot: () => tempDir,
			expandTilde: (p: string) => p,
			discoverAgents: () => ({
				agents: [
					{ name: "echo", description: "Echo test agent" },
					{ name: "second", description: "Second test agent" },
				],
			}),
		});
	}

	function makeCtx(sessionManager: SessionManagerStub) {
		return {
			cwd: tempDir,
			hasUI: false,
			ui: {},
			modelRegistry: { getAvailable: () => [] },
			sessionManager,
		};
	}

	it("fails fast when context=fork and parent session is missing", async () => {
		const { manager } = makeSessionManagerRecorder({ sessionFile: undefined, leafId: "leaf-current" });
		const executor = makeExecutor();

		const result = await executor.execute(
			"id",
			{ agent: "echo", task: "test", context: "fork" },
			new AbortController().signal,
			undefined,
			makeCtx(manager),
		);

		assert.equal(result.isError, true);
		assert.match(result.content[0]?.text ?? "", /persisted parent session/);
	});

	it("fails fast when context=fork and leaf is missing", async () => {
		const { manager } = makeSessionManagerRecorder({ sessionFile: "/tmp/parent.jsonl", leafId: null });
		const executor = makeExecutor();

		const result = await executor.execute(
			"id",
			{ agent: "echo", task: "test", context: "fork" },
			new AbortController().signal,
			undefined,
			makeCtx(manager),
		);

		assert.equal(result.isError, true);
		assert.match(result.content[0]?.text ?? "", /current leaf/);
	});

	it("returns a tool error (instead of throwing) when branch creation fails", async () => {
		const executor = makeExecutor();
		const manager = {
			getSessionFile: () => "/tmp/parent.jsonl",
			getLeafId: () => "leaf-fail",
			createBranchedSession: () => {
				throw new Error("branch write failed");
			},
		};

		const result = await executor.execute(
			"id",
			{ agent: "echo", task: "test", context: "fork" },
			new AbortController().signal,
			undefined,
			makeCtx(manager),
		);

		assert.equal(result.isError, true);
		assert.match(result.content[0]?.text ?? "", /Failed to create forked subagent session/);
		assert.match(result.content[0]?.text ?? "", /branch write failed/);
	});

	it("creates one forked session for single mode", async () => {
		const { manager, calls } = makeSessionManagerRecorder({ sessionFile: "/tmp/parent.jsonl", leafId: "leaf-123" });
		const executor = makeExecutor();

		const result = await executor.execute(
			"id",
			{ agent: "echo", task: "single task", context: "fork" },
			new AbortController().signal,
			undefined,
			makeCtx(manager),
		);

		assert.equal(result.isError, undefined);
		assert.equal(calls.length, 1);
		assert.deepEqual(calls, ["leaf-123"]);
	});

	it("creates isolated forked sessions per parallel task", async () => {
		const { manager, calls } = makeSessionManagerRecorder({ sessionFile: "/tmp/parent.jsonl", leafId: "leaf-777" });
		const executor = makeExecutor();

		const result = await executor.execute(
			"id",
			{
				tasks: [
					{ agent: "echo", task: "task one" },
					{ agent: "second", task: "task two" },
				],
				context: "fork",
			},
			new AbortController().signal,
			undefined,
			makeCtx(manager),
		);

		assert.equal(result.isError, undefined);
		assert.equal(calls.length, 2);
		assert.deepEqual(calls, ["leaf-777", "leaf-777"]);
	});

	it("expands top-level parallel task counts before fork session allocation", async () => {
		const { manager, calls } = makeSessionManagerRecorder({ sessionFile: "/tmp/parent.jsonl", leafId: "leaf-count" });
		const executor = makeExecutor();

		const result = await executor.execute(
			"id",
			{
				tasks: [{ agent: "echo", task: "task one", count: 3 }],
				context: "fork",
			},
			new AbortController().signal,
			undefined,
			makeCtx(manager),
		);

		assert.equal(result.isError, undefined);
		assert.equal(calls.length, 3);
		assert.deepEqual(calls, ["leaf-count", "leaf-count", "leaf-count"]);
	});

	it("rejects top-level parallel worktree runs with a conflicting task cwd", async () => {
		const { manager } = makeSessionManagerRecorder({ sessionFile: "/tmp/parent.jsonl", leafId: "leaf-777" });
		const executor = makeExecutor();

		const result = await executor.execute(
			"id",
			{
				tasks: [
					{ agent: "echo", task: "task one" },
					{ agent: "second", task: "task two", cwd: `${tempDir}/other` },
				],
				worktree: true,
			},
			new AbortController().signal,
			undefined,
			makeCtx(manager),
		);

		assert.equal(result.isError, true);
		assert.match(result.content[0]?.text ?? "", /worktree isolation uses the shared cwd/i);
		assert.match(result.content[0]?.text ?? "", /task 2 \(second\) sets cwd/i);
	});

	it("rejects top-level parallel counts that expand past MAX_PARALLEL", async () => {
		const { manager } = makeSessionManagerRecorder({ sessionFile: "/tmp/parent.jsonl", leafId: "leaf-max" });
		const executor = makeExecutor();

		const result = await executor.execute(
			"id",
			{
				tasks: [{ agent: "echo", task: "task one", count: 9 }],
			},
			new AbortController().signal,
			undefined,
			makeCtx(manager),
		);

		assert.equal(result.isError, true);
		assert.match(result.content[0]?.text ?? "", /Max 8 tasks/);
	});

	it("rejects async chain worktree runs with a conflicting task cwd", async () => {
		const { manager } = makeSessionManagerRecorder({ sessionFile: "/tmp/parent.jsonl", leafId: "leaf-chain" });
		const executor = makeExecutor();

		const result = await executor.execute(
			"id",
			{
				chain: [
					{
						parallel: [
							{ agent: "echo", task: "p1" },
							{ agent: "second", task: "p2", cwd: `${tempDir}/other` },
						],
						worktree: true,
					},
				],
				async: true,
				clarify: false,
			},
			new AbortController().signal,
			undefined,
			makeCtx(manager),
		);

		assert.equal(result.isError, true);
		assert.match(result.content[0]?.text ?? "", /parallel chain step 1/i);
		assert.match(result.content[0]?.text ?? "", /task 2 \(second\) sets cwd/i);
	});

	it("creates isolated forked sessions per chain step (including counted parallel steps)", async () => {
		const { manager, calls } = makeSessionManagerRecorder({ sessionFile: "/tmp/parent.jsonl", leafId: "leaf-chain" });
		const executor = makeExecutor();

		const result = await executor.execute(
			"id",
			{
				chain: [
					{ agent: "echo", task: "step 1" },
					{ parallel: [{ agent: "echo", task: "p1", count: 2 }, { agent: "second", task: "p2", count: 2 }] },
					{ agent: "second", task: "step 3" },
				],
				context: "fork",
				clarify: false,
			},
			new AbortController().signal,
			undefined,
			makeCtx(manager),
		);

		assert.equal(result.isError, undefined);
		assert.equal(calls.length, 6, "1 sequential + 4 parallel + 1 sequential");
		assert.deepEqual(calls, ["leaf-chain", "leaf-chain", "leaf-chain", "leaf-chain", "leaf-chain", "leaf-chain"]);
	});
});
