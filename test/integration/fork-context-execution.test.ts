import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import type { ExtensionConfig } from "../../src/shared/types.ts";
import type { MockPi } from "../support/helpers.ts";
import { createMockPi, createTempDir, removeTempDir, tryImport } from "../support/helpers.ts";

/**
 * Local view of the subagent executor module under test.
 *
 * `isError` was removed from AgentToolResult; error paths are now
 * distinguished solely by content text (and by empty details.results).
 */
interface ExecutorModule {
	createSubagentExecutor?: (...args: unknown[]) => {
		execute: (
			id: string,
			params: Record<string, unknown>,
			signal: AbortSignal,
			onUpdate: ((result: unknown) => void) | undefined,
			ctx: unknown,
		) => Promise<{ content: Array<{ text?: string }>; details?: any }>;
	};
}

interface AgentDiscoveryModule {
	discoverAgents?: (cwd: string) => {
		agents: Array<{ name: string; description: string; sessionMode?: "standalone" | "lineage-only" | "fork" }>;
	};
}

const executorMod = await tryImport<ExecutorModule>("./src/execution/subagent-executor.ts");
const available = !!executorMod;
const createSubagentExecutor = executorMod?.createSubagentExecutor;
const agentDiscoveryMod = await tryImport<AgentDiscoveryModule>("./src/agents/agents.ts");
const discoverAgents = agentDiscoveryMod?.discoverAgents;

/**
 * Run a git command without shell quoting so fixtures work on Windows and POSIX.
 *
 * @param cwd Git repository or working directory.
 * @param args Git CLI arguments.
 */
function git(cwd: string, args: string[]): void {
	const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
	if (result.status !== 0) {
		const details = result.stderr.trim() || result.stdout.trim() || `git ${args.join(" ")} failed`;
		throw new Error(details);
	}
}

interface SessionStubOptions {
	sessionFile?: string;
	leafId?: string | null;
}

interface SessionManagerStub {
	getSessionFile(): string | undefined;
	getLeafId(): string | null;
	createBranchedSession(leafId: string): string;
}

/**
 * Recursively collect child session files created under a fixture root.
 *
 * @param root Directory tree to scan.
 * @returns Matching child session files.
 */
function findChildSessionFiles(root: string): string[] {
	const matches: string[] = [];
	for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
		const entryPath = path.join(root, entry.name);
		if (entry.isDirectory()) {
			matches.push(...findChildSessionFiles(entryPath));
			continue;
		}
		if (entry.isFile() && entry.name.startsWith("child-") && entry.name.endsWith(".jsonl")) {
			matches.push(entryPath);
		}
	}
	return matches;
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

/**
 * Read the seeded child-session header written by lineage-only launches.
 *
 * @param sessionFile Absolute child session path.
 * @returns Parsed JSON header from the first line of the JSONL file.
 */
function readSessionHeader(sessionFile: string): Record<string, unknown> {
	const firstLine = fs.readFileSync(sessionFile, "utf-8").trim().split("\n")[0];
	return JSON.parse(firstLine);
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
		configGate: {
			blocked: false,
			diagnostics: [],
			message: "",
		},
	};
}

void describe("fork context execution wiring", { skip: !available ? "subagent executor not importable" : undefined }, () => {
	let tempDir: string;
	let mockPi: MockPi;

	/** Saved env vars — restored after every test to keep runs hermetic. */
	let savedDepth: string | undefined;
	let savedMaxDepth: string | undefined;

	before(() => {
		mockPi = createMockPi();
		mockPi.install();
	});

	after(() => {
		mockPi.uninstall();
	});

	beforeEach(() => {
		// Save and clear PI_SUBAGENT_DEPTH / PI_SUBAGENT_MAX_DEPTH so tests are
		// hermetic regardless of whether they run inside a pi session or CI
		// environment that already has these variables set.
		savedDepth = process.env.PI_SUBAGENT_DEPTH;
		savedMaxDepth = process.env.PI_SUBAGENT_MAX_DEPTH;
		delete process.env.PI_SUBAGENT_DEPTH;
		delete process.env.PI_SUBAGENT_MAX_DEPTH;

		tempDir = createTempDir("pi-subagent-fork-test-");
		// Init git repo for worktree support
		git(tempDir, ["init"]);
		git(tempDir, ["config", "user.email", "test@example.com"]);
		git(tempDir, ["config", "user.name", "Test User"]);
		git(tempDir, ["commit", "--allow-empty", "-m", "initial commit"]);

		mockPi.reset();
		mockPi.onCall({ output: "ok" });
	});

	afterEach(() => {
		// Restore PI_SUBAGENT_DEPTH / PI_SUBAGENT_MAX_DEPTH to their pre-test values.
		if (savedDepth !== undefined) {
			process.env.PI_SUBAGENT_DEPTH = savedDepth;
		} else {
			delete process.env.PI_SUBAGENT_DEPTH;
		}
		if (savedMaxDepth !== undefined) {
			process.env.PI_SUBAGENT_MAX_DEPTH = savedMaxDepth;
		} else {
			delete process.env.PI_SUBAGENT_MAX_DEPTH;
		}

		removeTempDir(tempDir);
	});

	function makeExecutor(
		config: ExtensionConfig = { superagents: { commands: { "sp-implement": { worktrees: { enabled: false } } } } },
		agents: Array<{ name: string; description: string; sessionMode?: "standalone" | "lineage-only" | "fork" }> = [
			{ name: "echo", description: "Echo test agent" },
			{ name: "second", description: "Second test agent" },
		],
		discoverAgentsImpl: (cwd: string) => {
			agents: Array<{ name: string; description: string; sessionMode?: "standalone" | "lineage-only" | "fork" }>;
		} = () => ({ agents }),
	) {
		return createSubagentExecutor!({
			state: makeState(tempDir),
			getConfig: () => config,
			getSubagentSessionRoot: () => tempDir,
			discoverAgents: discoverAgentsImpl,
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

	void it("fails fast when sessionMode=fork and parent session is missing", async () => {
		const { manager } = makeSessionManagerRecorder({ sessionFile: undefined, leafId: "leaf-current" });
		const executor = makeExecutor();

		const result = await executor.execute("id", { agent: "echo", task: "test", sessionMode: "fork" }, new AbortController().signal, undefined, makeCtx(manager));

		// No isError field — verify the error message is present and no results returned.
		assert.match(result.content[0]?.text ?? "", /persisted parent session/);
		assert.equal(result.details?.results?.length ?? 0, 0);
	});

	void it("fails fast when sessionMode=fork and leaf is missing", async () => {
		const { manager } = makeSessionManagerRecorder({ sessionFile: "/tmp/parent.jsonl", leafId: null });
		const executor = makeExecutor();

		const result = await executor.execute("id", { agent: "echo", task: "test", sessionMode: "fork" }, new AbortController().signal, undefined, makeCtx(manager));

		// No isError field — verify the error message is present and no results returned.
		assert.match(result.content[0]?.text ?? "", /current leaf/);
		assert.equal(result.details?.results?.length ?? 0, 0);
	});

	void it("returns a tool error (instead of throwing) when branch creation fails", async () => {
		const executor = makeExecutor();
		const manager = {
			getSessionFile: () => "/tmp/parent.jsonl",
			getLeafId: () => "leaf-fail",
			createBranchedSession: () => {
				throw new Error("branch write failed");
			},
		};

		const result = await executor.execute("id", { agent: "echo", task: "test", sessionMode: "fork" }, new AbortController().signal, undefined, makeCtx(manager));

		// No isError field — verify the error message is present and no results returned.
		assert.match(result.content[0]?.text ?? "", /Failed to create forked subagent session/);
		assert.match(result.content[0]?.text ?? "", /branch write failed/);
		assert.equal(result.details?.results?.length ?? 0, 0);
	});

	void it("creates one forked session for single mode", async () => {
		const { manager, calls } = makeSessionManagerRecorder({
			sessionFile: "/tmp/parent.jsonl",
			leafId: "leaf-123",
		});
		const executor = makeExecutor();

		const result = await executor.execute("id", { agent: "echo", task: "single task", sessionMode: "fork" }, new AbortController().signal, undefined, makeCtx(manager));

		// Success path — one branched session must have been created.
		assert.ok(result.content[0]?.text, "expected non-empty response content");
		assert.equal(calls.length, 1);
		assert.deepEqual(calls, ["leaf-123"]);
	});

	void it("treats sessionMode=standalone explicitly even when the agent default is lineage-only", async () => {
		const parentSessionFile = path.join(tempDir, "parent.jsonl");
		fs.writeFileSync(parentSessionFile, '{"type":"session"}\n', "utf-8");
		const { manager, calls } = makeSessionManagerRecorder({
			sessionFile: parentSessionFile,
			leafId: "leaf-unused",
		});
		const executor = makeExecutor({ superagents: { commands: { "sp-implement": { worktrees: { enabled: false } } } } }, [
			{ name: "echo", description: "Echo test agent", sessionMode: "lineage-only" },
		]);

		const result = await executor.execute("id", { agent: "echo", task: "single task", sessionMode: "standalone" }, new AbortController().signal, undefined, makeCtx(manager));

		assert.ok(result.content[0]?.text, "expected non-empty response content");
		assert.deepEqual(calls, []);
		const sessionFiles = findChildSessionFiles(tempDir);
		assert.deepEqual(sessionFiles, [], "expected no seeded child session files");
		assert.equal(result.details?.sessionMode, "standalone");
	});

	void it("seeds a linked child session when a built-in bounded agent defaults to lineage-only", async () => {
		assert.ok(discoverAgents, "expected agent discovery module to be available");
		const parentSessionFile = path.join(tempDir, "parent.jsonl");
		fs.writeFileSync(parentSessionFile, '{"type":"session"}\n', "utf-8");
		const { manager, calls } = makeSessionManagerRecorder({
			sessionFile: parentSessionFile,
			leafId: "leaf-unused",
		});
		const executor = makeExecutor({ superagents: { commands: { "sp-implement": { worktrees: { enabled: false } } } } }, [], (cwd) => discoverAgents!(cwd));

		const result = await executor.execute("id", { agent: "sp-implementer", task: "Implement the selected task." }, new AbortController().signal, undefined, makeCtx(manager));

		assert.ok(result.content[0]?.text, "expected non-empty response content");
		assert.deepEqual(calls, []);
		assert.equal(result.details?.sessionMode, "lineage-only");
		assert.equal(result.details?.results?.[0]?.sessionMode, "lineage-only");
		const sessionFiles = findChildSessionFiles(tempDir);
		assert.equal(sessionFiles.length, 1, "expected one seeded session file");
		assert.equal(readSessionHeader(sessionFiles[0]).parentSession, parentSessionFile);
		assert.equal(fs.readFileSync(sessionFiles[0], "utf-8").trim().split("\n").length, 1);
	});

	void it("creates isolated forked sessions per parallel task", async () => {
		const { manager, calls } = makeSessionManagerRecorder({
			sessionFile: "/tmp/parent.jsonl",
			leafId: "leaf-777",
		});
		const executor = makeExecutor();

		const result = await executor.execute(
			"id",
			{
				tasks: [
					{ agent: "echo", task: "task one" },
					{ agent: "second", task: "task two" },
				],
				sessionMode: "fork",
			},
			new AbortController().signal,
			undefined,
			makeCtx(manager),
		);

		// Success path — one branched session per parallel task must have been created.
		assert.ok(result.content[0]?.text, "expected non-empty response content");
		assert.equal(calls.length, 2);
		assert.deepEqual(calls, ["leaf-777", "leaf-777"]);
	});

	void it("rejects top-level parallel worktree runs with a conflicting task cwd", async () => {
		const { manager } = makeSessionManagerRecorder({ sessionFile: "/tmp/parent.jsonl", leafId: "leaf-777" });
		const executor = makeExecutor({
			superagents: { commands: { "sp-implement": { worktrees: { enabled: true } } } },
		});

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

		// No isError field — verify the error message is present and no results returned.
		assert.match(result.content[0]?.text ?? "", /worktree isolation uses the shared cwd/i);
		assert.match(result.content[0]?.text ?? "", /task 2 \(second\) sets cwd/i);
		assert.equal(result.details?.results?.length ?? 0, 0);
	});

	void it("rejects parallel runs that exceed MAX_PARALLEL", async () => {
		const executor = makeExecutor();
		const tasks = [];
		for (let i = 0; i < 10; i++) {
			tasks.push({ agent: "echo", task: `task ${i}` });
		}

		const result = await executor.execute("id", { tasks }, new AbortController().signal, undefined, makeCtx(makeSessionManagerRecorder().manager));

		// No isError field — verify the error message is present and no results returned.
		assert.match(result.content[0]?.text ?? "", /Max 8 tasks/);
		assert.equal(result.details?.results?.length ?? 0, 0);
	});
});
