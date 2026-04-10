/**
 * Integration coverage for Superpowers packet defaults.
 *
 * Responsibilities:
 * - verify the command-scoped packet names used by Superpowers roles
 * - guard against fallback to legacy context/plan/progress conventions
 */

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
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

const chainMod = await tryImport<any>("./src/execution/chain-execution.ts");
const asyncMod = await tryImport<any>("./src/execution/async-execution.ts");
const executorMod = await tryImport<any>("./src/execution/subagent-executor.ts");
const chainAvailable = !!chainMod;
const asyncAvailable = !!asyncMod;
const executeChain = chainMod?.executeChain;
const executeAsyncChain = asyncMod?.executeAsyncChain;
const createSubagentExecutor = executorMod?.createSubagentExecutor;

describe("superpowers packets", () => {
	/**
	 * Verifies the implementer role uses Superpowers packet names instead of legacy defaults.
	 *
	 * Inputs/outputs:
	 * - no runtime inputs beyond the built-in role name
	 * - expects the packet plan for `sp-implementer`
	 *
	 * Invariants:
	 * - the plan must read `task-brief.md`
	 * - the plan must write `implementer-report.md`
	 * - progress tracking must stay disabled
	 */
	it("uses task and review packet names instead of context.md/plan.md/progress.md", () => {
		const packets = buildSuperpowersPacketPlan("sp-implementer");
		assert.deepEqual(packets.reads, ["task-brief.md"]);
		assert.equal(packets.output, "implementer-report.md");
		assert.equal(packets.progress, false);
	});

	/**
	 * Verifies the built-in review and debug roles receive their canonical packet defaults.
	 *
	 * Inputs/outputs:
	 * - resolves packet plans for the remaining Task 3 roles plus a default case
	 * - expects exact packet filenames from the implementation plan
	 *
	 * Invariants:
	 * - all packet defaults keep progress disabled
	 * - unknown roles must not read or write any packet files
	 */
	it("maps review, debug, and default roles to the expected packet defaults", () => {
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
	 *
	 * Inputs/outputs:
	 * - resolves behavior with step overrides, packet defaults, and agent defaults present
	 * - expects explicit overrides to win, packet defaults to backfill missing values, and agent defaults to remain the fallback
	 *
	 * Invariants:
	 * - explicit step settings must always win
	 * - packet defaults must not erase unspecified agent defaults outside their fields
	 */
	it("prefers explicit step overrides, then packet defaults, then agent defaults", () => {
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
			undefined,
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

describe("superpowers packets in real execution paths", {
	skip: !chainAvailable || !asyncAvailable || !createSubagentExecutor ? "pi packages not available" : undefined,
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
		artifactsDir = path.join(tempDir, "artifacts");
		mockPi.reset();
	});

	afterEach(() => {
		removeTempDir(tempDir);
	});

	/**
	 * Builds a minimal chain execution payload for packet regression coverage.
	 *
	 * Inputs/outputs:
	 * - takes a chain and agent list
	 * - returns executeChain-compatible params rooted in a temp directory
	 */
	function makeChainParams(chain: any[], agents: any[]) {
		return {
			chain,
			task: "Fix the auth bug",
			agents,
			ctx: makeMinimalCtx(tempDir),
			runId: `packet-${Date.now().toString(36)}`,
			shareEnabled: false,
			sessionDirForIndex: () => undefined,
			artifactsDir,
			artifactConfig: { enabled: false },
			clarify: false,
			workflow: "superpowers",
			implementerMode: "tdd",
			config: {},
			maxSubagentDepth: 0,
		};
	}

	/**
	 * Reads the temp async runner config written by executeAsyncChain.
	 *
	 * Inputs/outputs:
	 * - accepts the async run id used for the temp config filename
	 * - returns the parsed runner config JSON
	 *
	 * Failure modes:
	 * - throws if the config file was not created
	 */
	function readAsyncConfig(id: string): any {
		const cfgPath = path.join(os.tmpdir(), `pi-async-cfg-${id}.json`);
		return JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
	}

	/**
	 * Creates a minimal subagent executor for async wiring regressions.
	 *
	 * Inputs/outputs:
	 * - accepts the agent inventory available to the executor
	 * - returns a configured executor with async enabled
	 */
	function makeAsyncExecutor(agents: any[], config: Record<string, unknown> = {}) {
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
			},
			config,
			asyncByDefault: false,
			tempArtifactsDir: tempDir,
			getSubagentSessionRoot: () => tempDir,
			expandTilde: (filePath: string) => filePath,
			discoverAgents: () => ({ agents }),
		});
	}

	/**
	 * Creates the minimal extension context required by the executor.
	 *
	 * Inputs/outputs:
	 * - returns a non-UI context rooted in the current temp directory
	 * - exposes a stable session file so async runs can derive a session root
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

	it("injects superpowers packet instructions into foreground chain tasks", async () => {
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

		const result = await executeChain(
			makeChainParams([{ agent: "sp-implementer", task: "Implement the selected task." }], agents),
		);

		assert.ok(!result.isError, JSON.stringify(result.content));
		const taskText = result.details.results[0].task;
		assert.ok(taskText.includes("task-brief.md"), taskText);
		assert.ok(taskText.includes("implementer-report.md"), taskText);
		assert.ok(!taskText.includes("plan.md"), taskText);
		assert.ok(!taskText.includes("progress.md"), taskText);
	});

	it("injects superpowers packet instructions into async chain runner tasks", () => {
		mockPi.onCall({ output: "Async implemented task" });
		const id = `async-packets-${Date.now().toString(36)}`;
		const ctx = {
			pi: { events: new EventEmitter() },
			cwd: tempDir,
			currentSessionId: "session-test",
		};

		executeAsyncChain(id, {
			chain: [{ agent: "sp-implementer", task: "Implement the selected task." }],
			agents: [
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
			],
			ctx,
			cwd: tempDir,
			artifactConfig: { enabled: false },
			shareEnabled: false,
			workflow: "superpowers",
			maxSubagentDepth: 0,
		});

		const cfg = readAsyncConfig(id);
		assert.match(cfg.steps[0].task, /task-brief\.md/);
		assert.match(cfg.steps[0].task, /implementer-report\.md/);
		assert.doesNotMatch(cfg.steps[0].task, /plan\.md/);
		assert.doesNotMatch(cfg.steps[0].task, /progress\.md/);
	});

	it("threads explicit workflow metadata through async executor chain runs", async () => {
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
			"packet-executor",
			{
				async: true,
				clarify: false,
				workflow: "superpowers",
				chain: [{ agent: "sp-implementer", task: "Implement the selected task." }],
			},
			new AbortController().signal,
			undefined,
			makeExecutorCtx(),
		);

		assert.ok(!result.isError, JSON.stringify(result.content));
		const cfg = readAsyncConfig(result.details.asyncId);
		assert.match(cfg.steps[0].task, /task-brief\.md/);
		assert.match(cfg.steps[0].task, /implementer-report\.md/);
		assert.doesNotMatch(cfg.steps[0].task, /plan\.md/);
	});

	it("keeps executor async chains on default workflow agent defaults", async () => {
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
			"packet-executor-default",
			{
				async: true,
				clarify: false,
				workflow: "default",
				chain: [{ agent: "sp-implementer", task: "Implement the selected task." }],
			},
			new AbortController().signal,
			undefined,
			makeExecutorCtx(),
		);

		assert.ok(!result.isError, JSON.stringify(result.content));
		const cfg = readAsyncConfig(result.details.asyncId);
		assert.match(cfg.steps[0].task, /plan\.md/);
		assert.match(cfg.steps[0].task, /context\.md/);
		assert.match(cfg.steps[0].task, /progress\.md/);
		assert.doesNotMatch(cfg.steps[0].task, /task-brief\.md/);
		assert.doesNotMatch(cfg.steps[0].task, /implementer-report\.md/);
	});

	it("keeps default-workflow async chains on agent defaults instead of superpowers packets", () => {
		mockPi.onCall({ output: "Async implemented task" });
		const id = `async-default-${Date.now().toString(36)}`;
		const ctx = {
			pi: { events: new EventEmitter() },
			cwd: tempDir,
			currentSessionId: "session-test",
		};

		executeAsyncChain(id, {
			chain: [{ agent: "sp-implementer", task: "Implement the selected task." }],
			agents: [
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
			],
			ctx,
			cwd: tempDir,
			artifactConfig: { enabled: false },
			shareEnabled: false,
			workflow: "default",
			maxSubagentDepth: 0,
		});

		const cfg = readAsyncConfig(id);
		assert.match(cfg.steps[0].task, /plan\.md/);
		assert.match(cfg.steps[0].task, /context\.md/);
		assert.match(cfg.steps[0].task, /progress\.md/);
		assert.doesNotMatch(cfg.steps[0].task, /task-brief\.md/);
		assert.doesNotMatch(cfg.steps[0].task, /implementer-report\.md/);
	});

	it("preserves async parallel reads and progress overrides per task", () => {
		mockPi.onCall({ output: "Async review complete" });
		const id = `async-parallel-${Date.now().toString(36)}`;
		const ctx = {
			pi: { events: new EventEmitter() },
			cwd: tempDir,
			currentSessionId: "session-test",
		};

		executeAsyncChain(id, {
			chain: [
				{
					parallel: [
						{
							agent: "sp-implementer",
							task: "Implement the selected task.",
							reads: ["custom-brief.md"],
							progress: true,
						},
					],
				},
			],
			agents: [
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
			],
			ctx,
			cwd: tempDir,
			artifactConfig: { enabled: false },
			shareEnabled: false,
			workflow: "superpowers",
			maxSubagentDepth: 0,
		});

		const cfg = readAsyncConfig(id);
		assert.match(cfg.steps[0].parallel[0].task, /custom-brief\.md/);
		assert.match(cfg.steps[0].parallel[0].task, /progress\.md/);
		assert.doesNotMatch(cfg.steps[0].parallel[0].task, /task-brief\.md/);
	});

	it("preserves top-level parallel clarify background output, reads, and progress overrides", async () => {
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
		const executor = makeAsyncExecutor(agents);

		const result = await executor.execute(
			"packet-parallel-clarify",
			{
				tasks: [{ agent: "sp-implementer", task: "Implement the selected task." }],
				clarify: true,
				workflow: "superpowers",
			},
			new AbortController().signal,
			undefined,
			makeExecutorCtx({
				hasUI: true,
				ui: {
					custom: async () => ({
						confirmed: true,
						templates: ["Clarified implementation task."],
						behaviorOverrides: [
							{
								output: "custom-report.md",
								reads: ["custom-brief.md"],
								progress: true,
							},
						],
						runInBackground: true,
					}),
				},
			}),
		);

		assert.ok(!result.isError, JSON.stringify(result.content));
		const cfg = readAsyncConfig(result.details.asyncId);
		assert.match(cfg.steps[0].parallel[0].task, /Clarified implementation task\./);
		assert.match(cfg.steps[0].parallel[0].task, /custom-brief\.md/);
		assert.match(cfg.steps[0].parallel[0].task, /custom-report\.md/);
		assert.match(cfg.steps[0].parallel[0].task, /progress\.md/);
			assert.ok(
				String(cfg.steps[0].parallel[0].outputPath).endsWith(path.join("custom-report.md")),
				String(cfg.steps[0].parallel[0].outputPath),
			);
		});

		it("defaults async top-level parallel worktrees on for superpowers using superagents config", async () => {
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
			});

			const result = await executor.execute(
				"packet-parallel-worktree-default",
				{
					async: true,
					clarify: false,
					workflow: "superpowers",
					tasks: [{ agent: "sp-implementer", task: "Implement the selected task." }],
				},
				new AbortController().signal,
				undefined,
				makeExecutorCtx(),
			);

			assert.ok(!result.isError, JSON.stringify(result.content));
			const cfg = readAsyncConfig(result.details.asyncId);
			assert.equal(cfg.steps[0].worktree, true);
			assert.equal(cfg.worktreeRootDir, ".worktrees");
			assert.equal(cfg.worktreeRequireIgnoredRoot, true);
			assert.equal(cfg.worktreeSetupHook, "./scripts/setup-worktree.mjs");
			assert.equal(cfg.worktreeSetupHookTimeoutMs, 45000);
		});
	});
