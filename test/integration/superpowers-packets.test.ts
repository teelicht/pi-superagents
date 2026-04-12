/**
 * Integration coverage for Superpowers packet defaults.
 *
 * Responsibilities:
 * - verify the command-scoped packet names used by Superpowers roles
 * - guard against fallback to legacy context/plan/progress conventions
 */

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { resolveStepBehavior } from "../../src/execution/settings.ts";
import { buildSuperpowersPacketPlan } from "../../src/execution/superpowers-packets.ts";
import type { MockPi } from "../support/helpers.ts";
import {
	createMockPi,
	createTempDir,
	makeMinimalCtx,
	removeTempDir,
	tryImport,
} from "../support/helpers.ts";

const executorMod = await tryImport<any>("./src/execution/subagent-executor.ts");
const createSubagentExecutor = executorMod?.createSubagentExecutor;

void describe("superpowers packets", () => {
	/**
	 * Verifies the implementer role uses Superpowers packet names instead of legacy defaults.
	 */
	void it("uses task and review packet names instead of context.md/plan.md/progress.md", () => {
		const packets = buildSuperpowersPacketPlan("sp-implementer");
		assert.deepEqual(packets.reads, ["task-brief.md"]);
		assert.equal(packets.output, "implementer-report.md");
		assert.equal(packets.progress, false);
	});

	/**
	 * Verifies the built-in review and debug roles receive their canonical packet defaults.
	 */
	void it("maps review, debug, and default roles to the expected packet defaults", () => {
		assert.deepEqual(buildSuperpowersPacketPlan("sp-spec-review"), {
			reads: ["task-brief.md", "implementer-report.md"],
			output: "spec-review.md",
			progress: false,
		});
		assert.deepEqual(buildSuperpowersPacketPlan("sp-code-review"), {
			reads: ["task-brief.md", "spec-review.md"],
			output: "code-review.md",
			progress: false,
		});
		assert.deepEqual(buildSuperpowersPacketPlan("sp-debug"), {
			reads: ["debug-brief.md"],
			output: "debug-brief.md",
			progress: false,
		});
		assert.deepEqual(buildSuperpowersPacketPlan("sp-recon"), {
			reads: [],
			output: false,
			progress: false,
		});
	});

	/**
	 * Verifies packet defaults sit between explicit step overrides and agent frontmatter defaults.
	 */
	void it("prefers explicit step overrides, then packet defaults, then agent defaults", () => {
		const behavior = resolveStepBehavior(
			{
				name: "sp-implementer",
				description: "Implementer",
				systemPrompt: "Implement one task.",
				source: "builtin",
				filePath: "/tmp/sp-implementer.md",
				output: "legacy-report.md",
				defaultReads: ["context.md"],
				defaultProgress: true,
			},
			{
				output: "step-output.md",
			},
			{
				reads: ["task-brief.md"],
				output: "implementer-report.md",
				progress: false,
			},
		);

		assert.equal(behavior.output, "step-output.md");
		assert.deepEqual(behavior.reads, ["task-brief.md"]);
		assert.equal(behavior.progress, false);
	});
});

void describe("superpowers packets in real execution paths", {
	skip: !createSubagentExecutor ? "pi packages not available" : undefined,
}, () => {
	let tempDir: string;
	let artifactsDir: string;
	let mockPi: MockPi;

	before(() => {
		mockPi = createMockPi();
		mockPi.install();
	});

	after(() => {
		mockPi.uninstall();
	});

	beforeEach(() => {
		tempDir = createTempDir("pi-superpowers-packets-");
		// Init git repo for worktree support
		execSync("git init", { cwd: tempDir, stdio: "ignore" });
		execSync("git config user.email 'test@example.com'", { cwd: tempDir, stdio: "ignore" });
		execSync("git config user.name 'Test User'", { cwd: tempDir, stdio: "ignore" });
		execSync("git commit --allow-empty -m 'initial commit'", { cwd: tempDir, stdio: "ignore" });

		artifactsDir = path.join(tempDir, "artifacts");
		mockPi.reset();
	});

	afterEach(() => {
		removeTempDir(tempDir);
	});

	/**
	 * Reads the temp async runner config written by executeAsyncSingle.
	 */
	function readAsyncConfig(id: string): any {
		const cfgPath = path.join(os.tmpdir(), `pi-async-cfg-${id}.json`);
		return JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
	}

	/**
	 * Creates a minimal subagent executor for async wiring regressions.
	 */
	function makeAsyncExecutor(agents: any[], config: Record<string, unknown> = {}, asyncByDefault = false) {
		return createSubagentExecutor({
			pi: { events: new EventEmitter() },
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
			config,
			asyncByDefault,
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

	void it("injects superpowers packet instructions into foreground tasks", async () => {
		mockPi.onCall({ output: "Implemented task" });
		const agents = [
			{
				name: "sp-implementer",
				description: "Test agent: sp-implementer",
				systemPrompt: "Implement the task.",
				source: "builtin",
				filePath: "/tmp/sp-implementer.md",
				output: "context.md",
				defaultReads: ["plan.md"],
				defaultProgress: true,
			},
		];
		const executor = makeAsyncExecutor(agents);

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
		const taskText = result.details.results[0].task;
		assert.ok(taskText.includes("task-brief.md"), taskText);
		assert.ok(taskText.includes("implementer-report.md"), taskText);
		assert.ok(!taskText.includes("plan.md"), taskText);
		assert.ok(!taskText.includes("progress.md"), taskText);
	});

	void it("injects superpowers packet instructions into async runner tasks", async () => {
		mockPi.onCall({ output: "Async implemented task" });
		const agents = [
			{
				name: "sp-implementer",
				description: "Test agent: sp-implementer",
				systemPrompt: "Implement the task.",
				source: "builtin",
				filePath: "/tmp/sp-implementer.md",
				output: "context.md",
				defaultReads: ["plan.md"],
				defaultProgress: true,
			},
		];
		const executor = makeAsyncExecutor(agents, {}, true);

		const result = await executor.execute(
			"packet-async",
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
		const cfg = readAsyncConfig(result.details.asyncId);
		assert.match(cfg.step.task, /task-brief\.md/);
		assert.match(cfg.step.task, /implementer-report\.md/);
		assert.doesNotMatch(cfg.step.task, /plan\.md/);
		assert.doesNotMatch(cfg.step.task, /progress\.md/);
	});

	void it("preserves async reads and progress overrides per task", async () => {
		mockPi.onCall({ output: "Async review complete" });
		const agents = [
			{
				name: "sp-implementer",
				description: "Test agent: sp-implementer",
				systemPrompt: "Implement the task.",
				source: "builtin",
				filePath: "/tmp/sp-implementer.md",
				output: "context.md",
				defaultReads: ["plan.md"],
				defaultProgress: false,
			},
		];
		const executor = makeAsyncExecutor(agents, {}, true);

		const result = await executor.execute(
			"packet-overrides",
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
		const cfg = readAsyncConfig(result.details.asyncId);
		assert.match(cfg.step.task, /task-brief\.md/);
		assert.match(cfg.step.task, /implementer-report\.md/);
	});

	void it("defaults async top-level parallel worktrees on for superpowers using superagents config", async () => {
		const agents = [
			{
				name: "sp-implementer",
				description: "Test agent: sp-implementer",
				systemPrompt: "Implement the task.",
				source: "builtin",
				filePath: "/tmp/sp-implementer.md",
				output: "context.md",
				defaultReads: ["plan.md"],
				defaultProgress: false,
			},
		];
		const executor = makeAsyncExecutor(agents, {
			superagents: {
				worktrees: {
					enabled: true,
					root: ".worktrees",
					setupHook: "./scripts/setup-worktree.mjs",
					setupHookTimeoutMs: 45000,
				},
			},
		}, true);

		const scriptsDir = path.join(tempDir, "scripts");
		fs.mkdirSync(scriptsDir, { recursive: true });
		const hookPath = path.join(scriptsDir, "setup-worktree.mjs");
		fs.writeFileSync(hookPath, "#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({}));\n");
		fs.chmodSync(hookPath, 0o755);
		fs.writeFileSync(path.join(tempDir, ".gitignore"), ".worktrees\n");
		execSync("git add scripts/setup-worktree.mjs .gitignore && git commit -m 'add hook and ignore'", { cwd: tempDir, stdio: "ignore" });

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

		assert.ok(!result.isError, JSON.stringify(result.content));
		const cfg = readAsyncConfig(result.details.asyncId);
		assert.equal(cfg.step.worktree, true);
		assert.equal(cfg.worktreeRootDir, ".worktrees");
		assert.equal(cfg.worktreeRequireIgnoredRoot, true);
		assert.equal(cfg.worktreeSetupHook, "./scripts/setup-worktree.mjs");
		assert.equal(cfg.worktreeSetupHookTimeoutMs, 45000);
	});
});
