/**
 * Integration tests for parallel execution.
 *
 * Tests the mapConcurrent utility and parallel agent spawning via runPreparedChild.
 * The top-level parallel mode (params.tasks) lives in index.ts and uses
 * mapConcurrent + runPreparedChild — we test both pieces here.
 *
 * mapConcurrent tests always run. runPreparedChild tests require pi packages.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import type { ExtensionConfig } from "../../src/shared/types.ts";
import type { MockPi } from "../support/helpers.ts";
import { createMockPi, createTempDir, makeAgentConfigs, removeTempDir, tryImport } from "../support/helpers.ts";

// Top-level await: try importing pi-dependent modules
const utils = await tryImport<any>("./src/shared/utils.ts");
const execution = await tryImport<any>("./src/execution/child-runner.ts");
const resultDelivery = await tryImport<any>("./src/execution/result-delivery.ts");
const executorMod = await tryImport<any>("./src/execution/subagent-executor.ts");
const agentsMod = await tryImport<any>("./src/agents/agents.ts");
const piAvailable = !!(execution && utils);
const executorAvailable = !!(executorMod?.createSubagentExecutor && agentsMod?.discoverAgents);

const runPreparedChild = execution?.runPreparedChild;
const mapConcurrent = utils?.mapConcurrent;
const createResultDeliveryStore = resultDelivery?.createResultDeliveryStore;
const createSubagentExecutor = executorMod?.createSubagentExecutor;
const discoverAgents = agentsMod?.discoverAgents;

// ---------------------------------------------------------------------------
// mapConcurrent — always runs (pure logic, no pi deps beyond utils.ts)
// ---------------------------------------------------------------------------

void describe("mapConcurrent", { skip: !mapConcurrent ? "utils not importable" : undefined }, () => {
	void it("processes all items", async () => {
		const items = [1, 2, 3, 4, 5];
		const results = await mapConcurrent(items, 2, async (item: number) => item * 2);
		assert.deepEqual(results, [2, 4, 6, 8, 10]);
	});

	void it("preserves order regardless of completion time", async () => {
		const items = [80, 10, 40]; // delays in ms
		const results = await mapConcurrent(items, 3, async (ms: number, i: number) => {
			await new Promise((r) => setTimeout(r, ms));
			return i;
		});
		assert.deepEqual(results, [0, 1, 2], "results should be in original order");
	});

	void it("respects concurrency limit", async () => {
		let running = 0;
		let maxRunning = 0;
		const items = [1, 2, 3, 4, 5, 6];

		await mapConcurrent(items, 2, async () => {
			running++;
			maxRunning = Math.max(maxRunning, running);
			await new Promise((r) => setTimeout(r, 20));
			running--;
		});

		assert.ok(maxRunning <= 2, `max concurrent should be ≤ 2, got ${maxRunning}`);
	});

	void it("handles empty array", async () => {
		const results = await mapConcurrent([], 4, async (item: unknown) => item);
		assert.deepEqual(results, []);
	});

	void it("propagates errors", async () => {
		await assert.rejects(
			() =>
				mapConcurrent([1, 2, 3], 2, async (item: number) => {
					if (item === 2) throw new Error("boom");
					return item;
				}),
			/boom/,
		);
	});

	void it("can isolate per-child launch failures before result delivery joins", { skip: !createResultDeliveryStore ? "result delivery not importable" : undefined }, async () => {
		const store = createResultDeliveryStore();
		const items = ["a", "b", "c"];
		const launchResults = mapConcurrent(items, 3, async (agent: string, index: number) => {
			try {
				if (agent === "b") throw new Error("launch failed for b");
				return {
					agent,
					task: `Task ${agent}`,
					exitCode: 0,
					messages: [{ role: "assistant", content: [{ type: "text", text: `ok ${agent}` }] }],
					usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
					index,
				};
			} catch (error) {
				return {
					agent,
					task: `Task ${agent}`,
					exitCode: 1,
					messages: [],
					usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
					error: error instanceof Error ? error.message : String(error),
					index,
				};
			}
		});

		for (let i = 0; i < items.length; i++) {
			store.register({ id: items[i], agent: items[i], task: `Task ${items[i]}`, completion: launchResults.then((results: any[]) => results[i]) });
		}

		const joined = await store.join(items);
		assert.equal("error" in joined, false);
		if ("error" in joined) return;
		assert.deepEqual(
			joined.results.map((result: any) => result.exitCode),
			[0, 1, 0],
		);
		assert.equal(joined.results[0].error, undefined);
		assert.match(joined.results[1].error, /launch failed for b/);
		assert.equal(joined.results[2].error, undefined);
	});
});

// ---------------------------------------------------------------------------
// Parallel agent execution via runPreparedChild
// ---------------------------------------------------------------------------

void describe("parallel agent execution", { skip: !piAvailable ? "pi packages not available" : undefined }, () => {
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
		tempDir = createTempDir();
		mockPi.reset();
	});

	afterEach(() => {
		removeTempDir(tempDir);
	});

	void it("runs multiple agents concurrently via mapConcurrent + runPreparedChild", async () => {
		mockPi.onCall({ output: "Done" });
		const agents = makeAgentConfigs(["agent-a", "agent-b", "agent-c"]);
		const tasks = ["Task A", "Task B", "Task C"];

		const results = await mapConcurrent(
			tasks.map((task, i) => ({ agent: agents[i].name, task, index: i })),
			3,
			async ({ agent, task, index }: any) => {
				return runPreparedChild(tempDir, agents, agent, task, { index });
			},
		);

		assert.equal(results.length, 3);
		assert.ok(results.every((r: any) => r.exitCode === 0));
		assert.equal(results[0].agent, "agent-a");
		assert.equal(results[1].agent, "agent-b");
		assert.equal(results[2].agent, "agent-c");
	});

	void it("all agents get independent results", async () => {
		mockPi.onCall({ output: "Result" });
		const agents = makeAgentConfigs(["a", "b"]);

		const results = await mapConcurrent(
			[
				{ agent: "a", task: "Task A" },
				{ agent: "b", task: "Task B" },
			],
			2,
			async ({ agent, task }: any, i: number) => runPreparedChild(tempDir, agents, agent, task, { index: i }),
		);

		assert.equal(results.length, 2);
		assert.equal(results[0].agent, "a");
		assert.equal(results[1].agent, "b");
		const ok = results.filter((r: any) => r.exitCode === 0).length;
		assert.equal(ok, 2);
	});
});

// ---------------------------------------------------------------------------
// Ordinary automatic worktree cleanup regression
// ---------------------------------------------------------------------------

/**
 * Default extension config that enables worktrees for `sp-implement` and seeds
 * mock model tiers so the executor does not reject tier names like `cheap`/`max`.
 *
 * @returns Worktree-enabled config with mock model tiers.
 */
function defaultExecutorConfig(): ExtensionConfig {
	return {
		superagents: {
			commands: { "sp-implement": { worktrees: { enabled: true } } },
			modelTiers: {
				cheap: { model: "mock/cheap-model", thinking: "low" },
				max: { model: "mock/max-model", thinking: "medium" },
			},
		},
	};
}

/**
 * Run a git command without shell quoting so fixtures work on Windows and POSIX.
 *
 * @param cwd Git repository or working directory.
 * @param args Git CLI arguments.
 */
function git(cwd: string, args: string[]): string {
	const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
	if (result.status !== 0) {
		const details = result.stderr.trim() || result.stdout.trim() || `git ${args.join(" ")} failed`;
		throw new Error(details);
	}
	return (result.stdout ?? "").trim();
}

void describe("parallel worktree cleanup", { skip: !executorAvailable ? "executor not importable" : undefined }, () => {
	let tempDir: string;
	let mockPi: MockPi;
	let parentSessionFile: string;

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

		tempDir = createTempDir("pi-parallel-worktree-test-");

		// Init a clean parent git repository so the automatic worktree path can run.
		git(tempDir, ["init"]);
		git(tempDir, ["config", "user.email", "controller@example.com"]);
		git(tempDir, ["config", "user.name", "Worktree Test"]);
		fs.writeFileSync(path.join(tempDir, ".gitignore"), "node_modules/\n.worktrees/\nsessions/\nparent.jsonl\n", "utf-8");
		fs.writeFileSync(path.join(tempDir, "wave-base.txt"), "wave base\n", "utf-8");
		git(tempDir, ["add", "-A"]);
		git(tempDir, ["commit", "-m", "wave base"]);

		// Stable parent session file so the executor session root is predictable.
		const parentSessionDir = path.join(tempDir, "sessions");
		fs.mkdirSync(parentSessionDir, { recursive: true });
		parentSessionFile = path.join(parentSessionDir, "parent.jsonl");
		fs.writeFileSync(parentSessionFile, '{"type":"session"}\n', "utf-8");

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

	/**
	 * Build an executor that uses real `sp-implementer` discovery and a worktree-enabled
	 * config so the ordinary automatic worktree path is exercised.
	 *
	 * @param config Optional extension config override.
	 * @returns Executor wired to the current tempDir and parent session.
	 */
	function makeExecutor(config: ExtensionConfig = defaultExecutorConfig()) {
		return createSubagentExecutor({
			state: {
				baseCwd: tempDir,
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
			},
			getConfig: () => config,
			getSubagentSessionRoot: () => path.join(path.dirname(parentSessionFile), path.basename(parentSessionFile, ".jsonl")),
			discoverAgents: (cwd: string) => ({ agents: discoverAgents ? discoverAgents(cwd).agents : [] }),
		});
	}

	function makeCtx(sessionManager: any) {
		return {
			cwd: tempDir,
			hasUI: false,
			ui: {},
			modelRegistry: { getAvailable: () => [] },
			sessionManager,
		};
	}

	void it("removes automatic ephemeral worktree paths after a parallel call without Task cwd", async () => {
		const executor = makeExecutor();
		const sessionManager = {
			getSessionFile: () => parentSessionFile,
			getLeafId: () => "leaf-current",
			createBranchedSession: (leafId: string) => `/tmp/subagent-fork-${leafId}.jsonl`,
		};
		const ctx = makeCtx(sessionManager);

		const result = await executor.execute(
			"ordinary-parallel",
			{
				tasks: [
					{ agent: "sp-implementer", task: "Ordinary task A" },
					{ agent: "sp-implementer", task: "Ordinary task B" },
				],
				workflow: "superpowers",
				sessionMode: "lineage-only",
			},
			new AbortController().signal,
			undefined,
			ctx,
		);

		assert.equal(result.details?.results.length, 2, `expected 2 results, got: ${result.content[0]?.text ?? ""}`);
		const listing = git(tempDir, ["worktree", "list", "--porcelain"]);
		const realTempDir = fs.realpathSync(tempDir);
		const remaining = listing
			.split("\n")
			.filter((line) => line.startsWith("worktree "))
			.map((line) => line.slice("worktree ".length))
			.filter((candidate) => {
				try {
					return fs.realpathSync(candidate) !== realTempDir;
				} catch {
					return candidate !== tempDir;
				}
			});
		assert.deepEqual(remaining, [], "automatic worktree paths must be removed after the parallel call");
	});
});
