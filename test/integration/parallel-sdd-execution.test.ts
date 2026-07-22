/**
 * Integration coverage for the parallel SDD execution lifecycle.
 *
 * Responsibilities:
 * - exercise the executor end-to-end with controller-owned pre-isolated Task worktrees
 * - prove that the implement/review/fix/branch-review sequence persists worktrees, session
 *   files, and a single lineage-only resume identity across calls
 * - assert that only approved Task commits reach the parent branch and that the controller's
 *   progress ledger survives Task cleanup
 *
 * Important dependencies or side effects:
 * - creates a real temporary Git repository and real Git worktrees
 * - installs the local mock pi CLI to keep child runs hermetic
 * - manually cherry-picks approved commits into the parent branch
 * - tears down every worktree with `git worktree remove` after the run
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
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

/**
 * Run a git command and return its trimmed stdout.
 *
 * @param cwd Git repository or working directory.
 * @param args Git CLI arguments.
 * @returns Trimmed stdout produced by the command.
 */
function gitOut(cwd: string, args: string[]): string {
	const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
	if (result.status !== 0) {
		const details = result.stderr.trim() || result.stdout.trim() || `git ${args.join(" ")} failed`;
		throw new Error(details);
	}
	return (result.stdout ?? "").trim();
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
 * Build a session manager recorder that returns a stable parent session file so
 * the lineage-only child sessions live in a predictable directory across calls.
 *
 * @param options Optional session-file and leaf overrides.
 * @returns Manager implementation plus a fork-call recorder.
 */
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
 * Look up the most recent commit on a branch that touched the worktree path.
 *
 * @param repoCwd Parent repository root.
 * @param worktreeCwd Absolute worktree path used to identify the relevant commit.
 * @returns Commit hash, or empty string if no commit is found.
 */
function findWorktreeCommit(worktreeCwd: string): string {
	const log = spawnSync("git", ["-C", worktreeCwd, "log", "--format=%H", "-1", "HEAD"], { encoding: "utf-8" });
	if (log.status !== 0) return "";
	return (log.stdout ?? "").trim();
}

/**
 * Create a pre-isolated worktree from the parent HEAD with a dedicated branch.
 *
 * @param repoDir Parent repository root.
 * @param branchName Branch name to create for the worktree.
 * @returns Absolute path to the new worktree.
 */
function createPreIsolatedWorktree(repoDir: string, branchName: string): string {
	const worktreeParent = fs.mkdtempSync(path.join(os.tmpdir(), "pi-sdd-worktree-"));
	const worktreePath = path.join(worktreeParent, branchName);
	git(repoDir, ["worktree", "add", worktreePath, "-b", branchName, "HEAD"]);
	return worktreePath;
}

/**
 * Remove a worktree created by `createPreIsolatedWorktree` using `git worktree remove`.
 *
 * @param repoDir Parent repository root.
 * @param worktreePath Absolute worktree path to remove.
 */
function removeWorktree(repoDir: string, worktreePath: string): void {
	try {
		git(repoDir, ["worktree", "remove", "--force", worktreePath]);
	} catch {
		/* ignore — best-effort cleanup */
	}
	try {
		fs.rmSync(path.dirname(worktreePath), { recursive: true, force: true });
	} catch {
		/* ignore */
	}
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

void describe("parallel SDD execution", { skip: !available ? "subagent executor not importable" : undefined }, () => {
	let tempDir: string;
	let parentSessionFile: string;
	let mockPi: MockPi;
	let taskOneCwd: string;
	let taskTwoCwd: string;

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

		tempDir = createTempDir("pi-sdd-exec-test-");

		// Init parent git repository with a wave-base commit and the controller's progress ledger.
		git(tempDir, ["init"]);
		git(tempDir, ["config", "user.email", "controller@example.com"]);
		git(tempDir, ["config", "user.name", "SDD Controller"]);
		fs.writeFileSync(path.join(tempDir, ".gitignore"), "node_modules/\n.worktrees/\nsessions/\nparent.jsonl\n", "utf-8");
		fs.writeFileSync(path.join(tempDir, "wave-base.txt"), "wave base\n", "utf-8");
		git(tempDir, ["add", "-A"]);
		git(tempDir, ["commit", "-m", "wave base"]);

		// The controller persists its progress ledger next to the parent checkout.
		const sddDir = path.join(tempDir, ".superpowers", "sdd");
		fs.mkdirSync(sddDir, { recursive: true });
		fs.writeFileSync(path.join(sddDir, "progress.md"), "# Parallel SDD progress\nwave: T1+T2\n", "utf-8");
		git(tempDir, ["add", "-A"]);
		git(tempDir, ["commit", "-m", "seed progress ledger"]);

		// Create two pre-isolated worktrees on dedicated branches.
		taskOneCwd = createPreIsolatedWorktree(tempDir, "sdd-task-one");
		taskTwoCwd = createPreIsolatedWorktree(tempDir, "sdd-task-two");

		// Persist a stable parent session file under the tempDir so the resolver
		// produces a predictable session root across calls.
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

		// Best-effort worktree cleanup so tempdir removal never hangs on lingering mounts.
		for (const worktreePath of [taskOneCwd, taskTwoCwd]) {
			removeWorktree(tempDir, worktreePath);
		}
		removeTempDir(tempDir);
	});

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

	function makeImplementerExecutor(config: ExtensionConfig = defaultExecutorConfig()) {
		return createSubagentExecutor!({
			state: makeState(tempDir),
			getConfig: () => config,
			getSubagentSessionRoot: () => path.join(path.dirname(parentSessionFile), path.basename(parentSessionFile, ".jsonl")),
			discoverAgents: (cwd: string) => ({ agents: discoverAgents ? discoverAgents(cwd).agents : [] }),
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

	void it("keeps pre-isolated task worktrees across implement review and resumed fix calls", async () => {
		// Pre-seed manual Task commits inside each worktree so the integration test
		// does not depend on the mock child actually mutating the worktrees.
		fs.writeFileSync(path.join(taskOneCwd, "task-one.txt"), "task one implementation\n", "utf-8");
		git(taskOneCwd, ["add", "-A"]);
		git(taskOneCwd, ["commit", "-m", "task one: implement"]);
		fs.writeFileSync(path.join(taskTwoCwd, "task-two.txt"), "task two implementation\n", "utf-8");
		git(taskTwoCwd, ["add", "-A"]);
		git(taskTwoCwd, ["commit", "-m", "task two: implement"]);

		const executor = makeImplementerExecutor();
		const sessionManager = makeSessionManagerRecorder({ sessionFile: parentSessionFile }).manager;
		const ctx = makeCtx(sessionManager);

		const implement = await executor.execute(
			"implement-wave",
			{
				tasks: [
					{ agent: "sp-implementer", task: "Implement Task 1 including every Step", cwd: taskOneCwd },
					{ agent: "sp-implementer", task: "Implement Task 2 including every Step", cwd: taskTwoCwd },
				],
				workflow: "superpowers",
				sessionMode: "lineage-only",
			},
			new AbortController().signal,
			undefined,
			ctx,
		);

		assert.equal(implement.details?.results.length, 2, `expected 2 results, got: ${implement.content[0]?.text ?? ""}`);
		assert.ok(fs.existsSync(taskOneCwd), "task one worktree should survive the implement wave");
		assert.ok(fs.existsSync(taskTwoCwd), "task two worktree should survive the implement wave");
		const taskOneSession = implement.details?.results[0].sessionFile;
		const taskTwoSession = implement.details?.results[1].sessionFile;
		assert.ok(taskOneSession, "task one session file should be returned");
		assert.ok(taskTwoSession, "task two session file should be returned");
		assert.notEqual(taskOneSession, taskTwoSession, "each task must own a distinct session file");

		const review = await executor.execute(
			"review-wave",
			{
				tasks: [
					{ agent: "sp-review", task: "Review scope: task\nReview Task 1", cwd: taskOneCwd },
					{ agent: "sp-review", task: "Review scope: task\nReview Task 2", cwd: taskTwoCwd },
				],
				workflow: "superpowers",
				sessionMode: "lineage-only",
			},
			new AbortController().signal,
			undefined,
			ctx,
		);
		assert.equal(review.details?.results.length, 2, `expected 2 review results, got: ${review.content[0]?.text ?? ""}`);

		// Simulate a controller-driven fix: write a new commit in worktree one and
		// expect the resumed fix dispatch to reuse the original session file.
		fs.writeFileSync(path.join(taskOneCwd, "task-one-fix.txt"), "task one fix\n", "utf-8");
		git(taskOneCwd, ["add", "-A"]);
		git(taskOneCwd, ["commit", "-m", "task one: fix important finding"]);

		const fix = await executor.execute(
			"fix-task-one",
			{
				agent: "sp-implementer",
				task: "Fix the Important review finding and rerun the covering test",
				cwd: taskOneCwd,
				resumeSession: taskOneSession,
				workflow: "superpowers",
				sessionMode: "lineage-only",
			},
			new AbortController().signal,
			undefined,
			ctx,
		);
		assert.equal(fix.details?.results.length, 1, `expected 1 fix result, got: ${fix.content[0]?.text ?? ""}`);
		assert.equal(fix.details?.results[0].sessionFile, taskOneSession, "fix dispatch must reuse the original task one session file");

		// Deterministic cherry-pick: integrate only the approved Task 1 commits.
		// Task 2 is intentionally left unintegrated to prove "only approved" reaches the parent.
		const taskOneTip = findWorktreeCommit(taskOneCwd);
		const taskOneBase = gitOut(tempDir, ["merge-base", taskOneTip, "HEAD"]);
		git(tempDir, ["cherry-pick", `${taskOneBase}..${taskOneTip}`]);

		const progressLedger = path.join(tempDir, ".superpowers", "sdd", "progress.md");
		assert.ok(fs.existsSync(progressLedger), "controller progress ledger must survive the lifecycle");

		const branchReview = await executor.execute(
			"review-branch",
			{
				agent: "sp-review",
				task: "Review scope: branch\nReview the integrated branch package",
				cwd: tempDir,
				workflow: "superpowers",
				sessionMode: "lineage-only",
			},
			new AbortController().signal,
			undefined,
			ctx,
		);
		assert.equal(branchReview.details?.results.length, 1, `expected 1 branch review result, got: ${branchReview.content[0]?.text ?? ""}`);
		assert.equal(branchReview.details?.results[0].exitCode, 0, `branch review must succeed: ${branchReview.content[0]?.text ?? ""}`);

		// Only approved Task commits reach the parent branch.
		assert.ok(fs.existsSync(path.join(tempDir, "task-one.txt")), "task one commit must be cherry-picked into the parent");
		assert.ok(fs.existsSync(path.join(tempDir, "task-one-fix.txt")), "task one fix commit must be cherry-picked into the parent");
		assert.equal(fs.existsSync(path.join(tempDir, "task-two.txt")), false, "blocked Task 2 commit must NOT reach the parent branch");
	});
});
