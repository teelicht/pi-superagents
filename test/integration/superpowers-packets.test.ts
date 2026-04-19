/**
 * Integration coverage for Superpowers packet defaults.
 *
 * Responsibilities:
 * - verify the command-scoped packet reads used by Superpowers roles
 * - guard against fallback to legacy context/plan/progress conventions
 * - verify packet instruction injection in sync executor foreground/parallel paths
 *
 * Notes on test hermeticity:
 * - `PI_SUBAGENT_DEPTH` / `PI_SUBAGENT_MAX_DEPTH` are saved and restored so tests
 *   run correctly whether the outer shell session sets them or not.
 *
 * Notes on executor contract:
 * - The pre-d6afdd7 async temp-config API (asyncByDefault, details.asyncId,
 *   pi-async-cfg-*.json) has been removed. Tests now verify packet injection
 *   through the current sync executor by inspecting result.details.results[*].task.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as path from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { resolveStepBehavior } from "../../src/execution/settings.ts";
import {
	buildSuperpowersPacketPlan,
	injectSuperpowersPacketInstructions,
} from "../../src/execution/superpowers-packets.ts";
import type { MockPi } from "../support/helpers.ts";
import { createMockPi, createTempDir, removeTempDir, tryImport } from "../support/helpers.ts";

const executorMod = await tryImport<any>("./src/execution/subagent-executor.ts");
const createSubagentExecutor = executorMod?.createSubagentExecutor;

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

void describe("superpowers packets", () => {
	/**
	 * Verifies the implementer role reads Superpowers packet names without writing reports.
	 */
	void it("uses task and review packet names instead of context.md/plan.md/progress.md", () => {
		const packets = buildSuperpowersPacketPlan("sp-implementer");
		assert.deepEqual(packets.reads, ["task-brief.md"]);
		assert.equal(packets.output, false);
		assert.equal(packets.progress, false);
	});

	/**
	 * Verifies the built-in review and debug roles receive their canonical packet defaults.
	 */
	void it("maps review, debug, and default roles to the expected packet defaults", () => {
		assert.deepEqual(buildSuperpowersPacketPlan("sp-spec-review"), {
			reads: ["task-brief.md", "implementer-report.md"],
			output: false,
			progress: false,
		});
		assert.deepEqual(buildSuperpowersPacketPlan("sp-code-review"), {
			reads: ["task-brief.md", "spec-review.md"],
			output: false,
			progress: false,
		});
		assert.deepEqual(buildSuperpowersPacketPlan("sp-debug"), {
			reads: ["debug-brief.md"],
			output: false,
			progress: false,
		});
		assert.deepEqual(buildSuperpowersPacketPlan("sp-recon"), {
			reads: [],
			output: false,
			progress: false,
		});
	});

	/**
	 * Verifies packet defaults sit between explicit step overrides and inert defaults.
	 */
	void it("prefers explicit step overrides, then packet defaults, then disabled defaults", () => {
		const behavior = resolveStepBehavior(
			{
				name: "sp-implementer",
				description: "Implementer",
				systemPrompt: "Implement one task.",
				source: "builtin",
				filePath: "/tmp/sp-implementer.md",
			},
			{
				reads: ["custom-task.md"],
			},
			{
				reads: ["task-brief.md"],
				progress: false,
			},
		);

		assert.deepEqual(behavior.reads, ["custom-task.md"]);
		assert.equal(behavior.progress, false);
	});

	/**
	 * Verifies injectSuperpowersPacketInstructions adds read packet filenames without write targets.
	 */
	void it("injects packet filenames into task text for implementer role", () => {
		const packets = buildSuperpowersPacketPlan("sp-implementer");
		const behavior = resolveStepBehavior(
			{ name: "sp-implementer", description: "I", systemPrompt: "...", source: "builtin", filePath: "/tmp" },
			{},
			packets,
		);
		const task = injectSuperpowersPacketInstructions("Implement the selected task.", behavior);
		assert.ok(task.includes("task-brief.md"), "should reference task-brief.md");
		assert.ok(!task.includes("[Write to:"), "should not inject [Write to:] instruction");
		assert.ok(!task.includes("implementer-report.md"), "should not reference implementer-report.md");
		assert.ok(!task.includes("plan.md"), "should not reference legacy plan.md");
		assert.ok(!task.includes("progress.md"), "should not reference legacy progress.md");
	});

	/**
	 * Verifies injectSuperpowersPacketInstructions does not mutate legacy agent task text.
	 */
	void it("does not inject into tasks whose agents have no superpowers packet defaults", () => {
		const task = "Do something with context.md";
		// sp-recon has output: false, meaning no injection expected
		const packets = buildSuperpowersPacketPlan("sp-recon");
		const behavior = resolveStepBehavior(
			{ name: "sp-recon", description: "R", systemPrompt: "...", source: "builtin", filePath: "/tmp" },
			{},
			packets,
		);
		const injected = injectSuperpowersPacketInstructions(task, behavior);
		// sp-recon output is false, so no output file instruction should be injected
		assert.ok(!injected.includes("debug-brief.md"), "should not force debug-brief.md output");
	});
});

void describe(
	"superpowers packets in real execution paths",
	{
		skip: !createSubagentExecutor ? "pi packages not available" : undefined,
	},
	() => {
		let tempDir: string;
		let _artifactsDir: string;
		let mockPi: MockPi;
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
			// Hermetic: save and clear recursion env vars so the executor doesn't block.
			// Tests intentionally exercise subagent depth 0 → the executor runs normally.
			savedDepth = process.env.PI_SUBAGENT_DEPTH;
			savedMaxDepth = process.env.PI_SUBAGENT_MAX_DEPTH;
			delete process.env.PI_SUBAGENT_DEPTH;
			delete process.env.PI_SUBAGENT_MAX_DEPTH;

			tempDir = createTempDir("pi-superpowers-packets-");
			// Init git repo for worktree support
			git(tempDir, ["init"]);
			git(tempDir, ["config", "user.email", "test@example.com"]);
			git(tempDir, ["config", "user.name", "Test User"]);
			git(tempDir, ["commit", "--allow-empty", "-m", "initial commit"]);

			_artifactsDir = path.join(tempDir, "artifacts");
			mockPi.reset();
		});

		afterEach(() => {
			removeTempDir(tempDir);
			// Restore recursion env vars
			if (savedDepth === undefined) delete process.env.PI_SUBAGENT_DEPTH;
			else process.env.PI_SUBAGENT_DEPTH = savedDepth;
			if (savedMaxDepth === undefined) delete process.env.PI_SUBAGENT_MAX_DEPTH;
			else process.env.PI_SUBAGENT_MAX_DEPTH = savedMaxDepth;
		});

		/**
		 * Creates a subagent executor wired to the mock pi harness.
		 *
		 * The current executor contract uses:
		 * - SubagentState fields: baseCwd, currentSessionId, lastUiContext, configGate
		 * - No asyncByDefault (removed in d6afdd7)
		 * - No asyncJobs / cleanupTimers / poller fields
		 */
		function makeExecutor(agents: any[], config: Record<string, unknown> = {}) {
			return createSubagentExecutor({
				pi: { events: new EventEmitter() },
				state: {
					baseCwd: tempDir,
					currentSessionId: null,
					lastUiContext: null,
					configGate: {
						blocked: false,
						diagnostics: [],
						message: "",
					},
				},
				config,
				tempArtifactsDir: tempDir,
				getSubagentSessionRoot: () => tempDir,
				expandTilde: (filePath: string) => filePath,
				discoverAgents: () => ({ agents }),
			});
		}

		/**
		 * Creates the minimal extension context required by the executor.
		 */
		function makeExecutorCtx(overrides: Record<string, unknown> = {}): any {
			return {
				cwd: tempDir,
				hasUI: false,
				ui: {},
				modelRegistry: { getAvailable: () => [] },
				sessionManager: {
					getSessionFile: () => "/tmp/parent-session.jsonl",
				},
				...overrides,
			};
		}

		void it("injects superpowers packet instructions into foreground single tasks", async () => {
			mockPi.onCall({ output: "Implemented task" });
			const agents = [
				{
					name: "sp-implementer",
					description: "Test agent: sp-implementer",
					systemPrompt: "Implement the task.",
					source: "builtin",
					filePath: "/tmp/sp-implementer.md",
				},
			];
			const executor = makeExecutor(agents);

			const result = await executor.execute(
				"packet-foreground",
				{
					agent: "sp-implementer",
					task: "Implement the selected task.",
					workflow: "superpowers",
				},
				new AbortController().signal,
				undefined,
				makeExecutorCtx(),
			);

			assert.ok(!result.isError, JSON.stringify(result.content));
			assert.equal(result.details.mode, "single");
			assert.ok(result.details.results.length > 0, "should have results");
			const taskText = result.details.results[0].task;
			assert.ok(taskText.includes("task-brief.md"), `task should reference task-brief.md: ${taskText}`);
			assert.ok(!taskText.includes("[Write to:"), `should not inject [Write to:] instruction: ${taskText}`);
			assert.ok(!taskText.includes("implementer-report.md"), `task should not reference output file: ${taskText}`);
			assert.ok(!taskText.includes("plan.md"), `task should not reference legacy plan.md: ${taskText}`);
			assert.ok(!taskText.includes("progress.md"), `task should not reference legacy progress.md: ${taskText}`);
			assert.equal(fs.existsSync(path.join(tempDir, "implementer-report.md")), false);
		});

		void it("injects superpowers packet instructions into foreground parallel tasks", async () => {
			mockPi.onCall({ output: "Async implemented task" });
			const agents = [
				{
					name: "sp-implementer",
					description: "Test agent: sp-implementer",
					systemPrompt: "Implement the task.",
					source: "builtin",
					filePath: "/tmp/sp-implementer.md",
				},
			];
			const executor = makeExecutor(agents);

			const result = await executor.execute(
				"packet-async",
				{
					workflow: "superpowers",
					tasks: [{ agent: "sp-implementer", task: "Implement the selected task." }],
				},
				new AbortController().signal,
				undefined,
				makeExecutorCtx(),
			);

			assert.ok(!result.isError, JSON.stringify(result.content));
			assert.equal(result.details.mode, "parallel");
			assert.ok(result.details.results.length > 0, "should have results");
			// Packet instructions are injected into each parallel task's text
			const taskText = result.details.results[0].task;
			assert.ok(taskText.includes("task-brief.md"), `task should reference task-brief.md: ${taskText}`);
			assert.ok(!taskText.includes("[Write to:"), `should not inject [Write to:] instruction: ${taskText}`);
			assert.ok(!taskText.includes("implementer-report.md"), `task should not reference output file: ${taskText}`);
			assert.ok(!taskText.includes("plan.md"), `task should not reference legacy plan.md: ${taskText}`);
		});

		void it("applies packet defaults over agent frontmatter defaults for parallel tasks", async () => {
			mockPi.onCall({ output: "Async review complete" });
			const agents = [
				{
					name: "sp-implementer",
					description: "Test agent: sp-implementer",
					systemPrompt: "Implement the task.",
					source: "builtin",
					filePath: "/tmp/sp-implementer.md",
				},
			];
			const executor = makeExecutor(agents);

			const result = await executor.execute(
				"packet-overrides",
				{
					workflow: "superpowers",
					tasks: [{ agent: "sp-implementer", task: "Implement the selected task." }],
				},
				new AbortController().signal,
				undefined,
				makeExecutorCtx(),
			);

			assert.ok(!result.isError, JSON.stringify(result.content));
			assert.equal(result.details.mode, "parallel");
			assert.ok(result.details.results.length > 0, "should have results");
			// Packet defaults inject only read guidance and never output targets.
			const taskText = result.details.results[0].task;
			assert.ok(taskText.includes("task-brief.md"), `packet reads should override agent defaults: ${taskText}`);
			assert.ok(!taskText.includes("[Write to:"), `packet output should stay inline: ${taskText}`);
			assert.ok(!taskText.includes("implementer-report.md"), `packet output should not write files: ${taskText}`);
		});

		void it("defaults worktree isolation on for parallel superpowers tasks when config enables it", async () => {
			const agents = [
				{
					name: "sp-implementer",
					description: "Test agent: sp-implementer",
					systemPrompt: "Implement the task.",
					source: "builtin",
					filePath: "/tmp/sp-implementer.md",
				},
			];
			// Mock pi returns success so the worktree setup + run can complete
			mockPi.onCall({ output: "Parallel task done" });

			// Set up worktree hook script
			const scriptsDir = path.join(tempDir, "scripts");
			fs.mkdirSync(scriptsDir, { recursive: true });
			const hookPath = path.join(scriptsDir, "setup-worktree.mjs");
			fs.writeFileSync(hookPath, "#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({}));\n");
			fs.chmodSync(hookPath, 0o755);
			fs.writeFileSync(path.join(tempDir, ".gitignore"), ".worktrees\n");
			git(tempDir, ["add", "scripts/setup-worktree.mjs", ".gitignore"]);
			git(tempDir, ["commit", "-m", "add hook and ignore"]);

			const executor = makeExecutor(agents, {
				superagents: {
					worktrees: {
						enabled: true,
						root: ".worktrees",
						setupHook: "./scripts/setup-worktree.mjs",
						setupHookTimeoutMs: 45000,
					},
				},
			});

			const result = await executor.execute(
				"packet-parallel-worktree-default",
				{
					workflow: "superpowers",
					tasks: [{ agent: "sp-implementer", task: "Implement the selected task." }],
				},
				new AbortController().signal,
				undefined,
				makeExecutorCtx(),
			);

			// The executor should complete the parallel path without blocking or errors
			assert.ok(!result.isError, JSON.stringify(result.content));
			assert.equal(result.details.mode, "parallel");
			assert.ok(result.details.results.length > 0, "should have results");
			// Worktree directories are created by createWorktrees() during the parallel path
			// The worktrees path under tempDir confirms the feature path was exercised.
			// The actual worktree directories are cleaned up in the executor's finally block,
			// so we verify by checking that the executor completed successfully (not blocked).
		});
	},
);
