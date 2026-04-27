/**
 * Integration tests for single (sync) agent execution.
 *
 * Uses createMockPi() from @marcfargas/pi-test-harness to simulate the pi CLI.
 * Tests the full spawn→parse→result pipeline in runSync without a real LLM.
 *
 * These tests require pi packages to be importable (they run inside a pi
 * environment or with pi packages installed). If unavailable, tests skip
 * gracefully.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import type { MockPi } from "../support/helpers.ts";
import {
	createMockPi,
	createTempDir,
	events,
	makeAgent,
	makeAgentConfigs,
	removeTempDir,
	tryImport,
} from "../support/helpers.ts";

// Top-level await: try importing pi-dependent modules
const execution = await tryImport<any>("./src/execution/execution.ts");
const runHistory = await tryImport<any>("./src/execution/run-history.ts");
const utils = await tryImport<any>("./src/shared/utils.ts");
const available = !!(execution && runHistory && utils);

const runSync = execution?.runSync;
const globalRunHistory = runHistory?.globalRunHistory;
const getFinalOutput = utils?.getFinalOutput;

/**
 * Write a test skill into the workspace-local skill directory.
 *
 * @param cwd Workspace root used for runtime skill discovery.
 * @param name Skill name to make available for the test.
 */
function writeSkill(cwd: string, name: string): void {
	const skillsDir = path.join(cwd, ".agents", "skills");
	fs.mkdirSync(skillsDir, { recursive: true });
	fs.writeFileSync(
		path.join(skillsDir, `${name}.md`),
		`---\nname: ${name}\ndescription: test skill\n---\nUse ${name}.`,
		"utf-8",
	);
}

function assertModelArg(messages: unknown[], expectedModel: string): void {
	const args = JSON.parse(getFinalOutput(messages)) as string[];
	const index = args.indexOf("--models");
	assert.notEqual(index, -1, `expected --models in ${JSON.stringify(args)}`);
	assert.deepEqual(args.slice(index, index + 2), ["--models", expectedModel]);
}

void describe("single sync execution", { skip: !available ? "pi packages not available" : undefined }, () => {
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

	void it("spawns agent and captures output", async () => {
		mockPi.onCall({ output: "Hello from mock agent" });
		const agents = makeAgentConfigs(["echo"]);

		const result = await runSync(tempDir, agents, "echo", "Say hello", {});

		assert.equal(result.exitCode, 0);
		assert.equal(result.agent, "echo");
		assert.ok(result.messages.length > 0, "should have messages");

		const output = getFinalOutput(result.messages);
		assert.equal(output, "Hello from mock agent");
	});

	void it("returns error for unknown agent", async () => {
		const agents = makeAgentConfigs(["echo"]);
		const result = await runSync(tempDir, agents, "nonexistent", "Do something", {});

		assert.equal(result.exitCode, 1);
		assert.ok(result.error?.includes("Unknown agent"));
	});

	void it("captures non-zero exit code", async () => {
		mockPi.onCall({ exitCode: 1, stderr: "Something went wrong" });
		const agents = makeAgentConfigs(["fail"]);

		const result = await runSync(tempDir, agents, "fail", "Do something", {});

		assert.equal(result.exitCode, 1);
		assert.ok(result.error?.includes("Something went wrong"));
	});

	void it("handles long tasks via temp file (ENAMETOOLONG prevention)", async () => {
		mockPi.onCall({ output: "Got it" });
		const longTask = "Analyze ".repeat(2000); // ~16KB
		const agents = makeAgentConfigs(["echo"]);

		const result = await runSync(tempDir, agents, "echo", longTask, {});

		assert.equal(result.exitCode, 0);
		const output = getFinalOutput(result.messages);
		assert.equal(output, "Got it");
	});

	void it("uses agent model config", async () => {
		mockPi.onCall({ echoArgs: true });
		const agents = [makeAgent("echo", { model: "anthropic/claude-sonnet-4" })];

		const result = await runSync(tempDir, agents, "echo", "Task", {});

		assert.equal(result.exitCode, 0);
		assertModelArg(result.messages, "anthropic/claude-sonnet-4");
	});

	void it("model override from options takes precedence", async () => {
		mockPi.onCall({ echoArgs: true });
		const agents = [makeAgent("echo", { model: "anthropic/claude-sonnet-4" })];

		const result = await runSync(tempDir, agents, "echo", "Task", {
			modelOverride: "openai/gpt-4o",
		});

		assert.equal(result.exitCode, 0);
		assertModelArg(result.messages, "openai/gpt-4o");
	});

	void it("records the actual model emitted by child pi", async () => {
		mockPi.onCall({
			jsonl: [
				{
					type: "message_end",
					message: {
						role: "assistant",
						content: [{ type: "text", text: "Done" }],
						model: "openai-codex/gpt-5.5",
						usage: {
							input: 100,
							output: 50,
							cacheRead: 0,
							cacheWrite: 0,
							cost: { total: 0.001 },
						},
					},
				},
			],
		});
		const agents = [makeAgent("echo", { model: "sonnet" })];

		const result = await runSync(tempDir, agents, "echo", "Task", {});

		assert.equal(result.exitCode, 0);
		assert.equal(result.model, "openai-codex/gpt-5.5");
	});

	void it("keeps requested model when child pi emits a synthetic error model", async () => {
		mockPi.onCall({
			exitCode: 1,
			jsonl: [
				{
					type: "message_end",
					message: {
						role: "assistant",
						content: [{ type: "text", text: "" }],
						model: "err",
						errorMessage: "No models match pattern",
						stopReason: "error",
						usage: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							cost: { total: 0 },
						},
					},
				},
			],
		});
		const agents = [makeAgent("echo", { model: "sonnet" })];

		const result = await runSync(tempDir, agents, "echo", "Task", {});

		assert.equal(result.exitCode, 1);
		assert.equal(result.model, "sonnet");
	});

	void it("applies superpowers tier thinking when the tier config provides it", async () => {
		mockPi.onCall({ echoArgs: true });
		const agents = [makeAgent("sp-code-review", { model: "balanced" })];

		const result = await runSync(tempDir, agents, "sp-code-review", "Review task", {
			workflow: "superpowers",
			config: {
				superagents: {
					modelTiers: {
						balanced: {
							model: "openai/gpt-5.4",
							thinking: "medium",
						},
					},
				},
			},
		});

		assert.equal(result.exitCode, 0);
		assertModelArg(result.messages, "openai/gpt-5.4:medium");
	});

	void it("uses changed model tier config for later single executions", async () => {
		const agents = [makeAgent("sp-code-review", { model: "balanced" })];

		mockPi.onCall({ echoArgs: true });
		const first = await runSync(tempDir, agents, "sp-code-review", "first", {
			workflow: "superpowers",
			runId: "first",
			config: {
				superagents: {
					modelTiers: {
						balanced: { model: "openai/gpt-5.4" },
					},
				},
			},
		});

		mockPi.onCall({ echoArgs: true });
		const second = await runSync(tempDir, agents, "sp-code-review", "second", {
			workflow: "superpowers",
			runId: "second",
			config: {
				superagents: {
					modelTiers: {
						balanced: { model: "anthropic/claude-opus-4.6" },
					},
				},
			},
		});

		assertModelArg(first.messages, "openai/gpt-5.4");
		assertModelArg(second.messages, "anthropic/claude-opus-4.6");
	});

	void it("tracks usage from message events", async () => {
		mockPi.onCall({ output: "Done" });
		const agents = makeAgentConfigs(["echo"]);

		const result = await runSync(tempDir, agents, "echo", "Task", {});

		assert.equal(result.usage.turns, 1);
		assert.equal(result.usage.input, 100); // from mock
		assert.equal(result.usage.output, 50); // from mock
	});

	void it("tracks progress during execution", async () => {
		mockPi.onCall({ output: "Done" });
		const agents = makeAgentConfigs(["echo"]);

		const result = await runSync(tempDir, agents, "echo", "Task", { index: 3 });

		assert.ok(result.progress, "should have progress");
		assert.equal(result.progress.agent, "echo");
		assert.equal(result.progress.index, 3);
		assert.equal(result.progress.status, "completed");
		assert.ok(result.progress.durationMs > 0, "should track duration");
	});

	void it("sets progress.status to failed on non-zero exit", async () => {
		mockPi.onCall({ exitCode: 1 });
		const agents = makeAgentConfigs(["fail"]);

		const result = await runSync(tempDir, agents, "fail", "Task", {});

		assert.equal(result.progress.status, "failed");
	});

	void it("handles multi-turn conversation from JSONL", async () => {
		mockPi.onCall({
			jsonl: [
				events.toolStart("bash", { command: "ls" }),
				events.toolEnd("bash"),
				events.toolResult("bash", "file1.txt\nfile2.txt"),
				events.assistantMessage("Found 2 files: file1.txt and file2.txt"),
			],
		});
		const agents = makeAgentConfigs(["scout"]);

		const result = await runSync(tempDir, agents, "scout", "List files", {});

		assert.equal(result.exitCode, 0);
		const output = getFinalOutput(result.messages);
		assert.ok(output.includes("file1.txt"), "should capture assistant text");
		assert.equal(result.progress.toolCount, 1, "should count tool calls");
	});

	void it("writes artifacts when configured", async () => {
		mockPi.onCall({ output: "Result text" });
		const agents = makeAgentConfigs(["echo"]);
		const artifactsDir = path.join(tempDir, "artifacts");

		const result = await runSync(tempDir, agents, "echo", "Task", {
			runId: "test-run",
			artifactsDir,
			artifactConfig: { enabled: true, includeInput: true, includeOutput: true, includeMetadata: true },
		});

		assert.equal(result.exitCode, 0);
		assert.ok(result.artifactPaths, "should have artifact paths");
		assert.ok(fs.existsSync(artifactsDir), "artifacts dir should exist");
	});

	void it("passes maxSubagentDepth through to child execution env", async () => {
		mockPi.onCall({ echoEnv: ["PI_SUBAGENT_DEPTH", "PI_SUBAGENT_MAX_DEPTH"] });
		const agents = makeAgentConfigs(["echo"]);

		const result = await runSync(tempDir, agents, "echo", "Task", {
			runId: "depth-env",
			maxSubagentDepth: 1,
		});

		assert.equal(result.exitCode, 0);
		assert.deepEqual(JSON.parse(result.finalOutput ?? "{}"), {
			PI_SUBAGENT_DEPTH: "1",
			PI_SUBAGENT_MAX_DEPTH: "1",
		});
	});

	void it("launches superpowers recon without mutation-capable tools", async () => {
		mockPi.onCall({ echoArgs: true });
		const agents = [makeAgent("sp-recon")];

		const result = await runSync(tempDir, agents, "sp-recon", "Inspect the repo and report findings", {
			runId: "recon-tools",
			workflow: "superpowers",
		});

		assert.equal(result.exitCode, 0);
		const args = JSON.parse(result.finalOutput ?? "[]") as string[];
		const toolsFlagIndex = args.indexOf("--tools");
		assert.notEqual(toolsFlagIndex, -1, "should pass an explicit tools allowlist");
		const toolsArg = args[toolsFlagIndex + 1] ?? "";
		assert.equal(toolsArg, "read,grep,find,ls");
		assert.doesNotMatch(toolsArg, /\bbash\b/);
		assert.doesNotMatch(toolsArg, /\bwrite\b/);
	});

	void it("replaces agent default skills when a runtime skill override is provided", async () => {
		mockPi.onCall({ output: "Done" });
		writeSkill(tempDir, "default-skill");
		writeSkill(tempDir, "override-skill");
		const agents = [makeAgent("worker", { skills: ["default-skill"] })];

		const result = await runSync(tempDir, agents, "worker", "Task", {
			skills: ["override-skill"],
		});

		assert.equal(result.exitCode, 0);
		assert.deepEqual(result.skills, ["override-skill"]);
	});

	void it("adds resolved skills to the active run history entry", async () => {
		mockPi.onCall({ output: "Done" });
		writeSkill(tempDir, "default-skill");
		writeSkill(tempDir, "overlay-skill");
		const agents = [makeAgent("worker", { skills: ["default-skill"] })];
		const seenSkillSets: string[][] = [];

		globalRunHistory.activeRuns.clear();
		const result = await runSync(tempDir, agents, "worker", "Task", {
			runId: "history-skills",
			skills: ["overlay-skill"],
			onUpdate: () => {
				for (const entry of globalRunHistory.activeRuns.values()) {
					seenSkillSets.push([...(entry.skills ?? [])]);
				}
			},
		});

		assert.equal(result.exitCode, 0);
		assert.deepEqual(seenSkillSets.at(-1), ["overlay-skill"]);
		assert.equal(globalRunHistory.activeRuns.size, 0);
	});

	void it("disables agent default skills when runtime skills are explicitly false", async () => {
		mockPi.onCall({ output: "Done" });
		writeSkill(tempDir, "default-skill");
		const agents = [makeAgent("worker", { skills: ["default-skill"] })];

		const result = await runSync(tempDir, agents, "worker", "Task", {
			skills: false,
		});

		assert.equal(result.exitCode, 0);
		assert.equal(result.skills, undefined);
	});

	void it("handles abort signal (completes faster than delay)", async () => {
		mockPi.onCall({ delay: 10000 }); // Long delay — process should be killed before this
		const agents = makeAgentConfigs(["slow"]);
		const controller = new AbortController();

		const start = Date.now();
		setTimeout(() => controller.abort(), 200);

		const _result = await runSync(tempDir, agents, "slow", "Slow task", {
			signal: controller.signal,
		});
		const elapsed = Date.now() - start;

		// The key assertion: the run should complete much faster than the 10s delay,
		// proving the abort signal terminated the process early.
		assert.ok(elapsed < 5000, `should abort early, took ${elapsed}ms`);
		// Exit code is platform-dependent (Windows: often 1 or 0, Linux: null/143)
	});

	void it("handles stderr without exit code as info (not error)", async () => {
		mockPi.onCall({ output: "Success", stderr: "Warning: something", exitCode: 0 });
		const agents = makeAgentConfigs(["echo"]);

		const result = await runSync(tempDir, agents, "echo", "Task", {});

		assert.equal(result.exitCode, 0);
	});
});
