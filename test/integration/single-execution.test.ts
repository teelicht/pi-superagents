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
import { createMockPi, createTempDir, events, makeAgent, makeAgentConfigs, removeTempDir, tryImport } from "../support/helpers.ts";

// Top-level await: try importing pi-dependent modules
const execution = await tryImport<any>("./src/execution/execution.ts");
const runHistory = await tryImport<any>("./src/execution/run-history.ts");
const utils = await tryImport<any>("./src/shared/utils.ts");
const available = !!(execution && runHistory && utils);

const runSync = execution?.runSync;
const globalRunHistory = runHistory?.globalRunHistory;
const getFinalOutput = utils?.getFinalOutput;

// Saved env vars for hermetic test isolation
let savedDepth: string | undefined;
let savedMaxDepth: string | undefined;

/**
 * Write a test skill into the workspace-local skill directory.
 *
 * @param cwd Workspace root used for runtime skill discovery.
 * @param name Skill name to make available for the test.
 */
function writeSkill(cwd: string, name: string): void {
	const skillsDir = path.join(cwd, ".agents", "skills");
	fs.mkdirSync(skillsDir, { recursive: true });
	fs.writeFileSync(path.join(skillsDir, `${name}.md`), `---\nname: ${name}\ndescription: test skill\n---\nUse ${name}.`, "utf-8");
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
		// Hermetic: save and clear recursion env vars so the executor doesn't block.
		// Tests intentionally exercise subagent depth 0 → the executor runs normally.
		savedDepth = process.env.PI_SUBAGENT_DEPTH;
		savedMaxDepth = process.env.PI_SUBAGENT_MAX_DEPTH;
		delete process.env.PI_SUBAGENT_DEPTH;
		delete process.env.PI_SUBAGENT_MAX_DEPTH;

		tempDir = createTempDir();
		mockPi.reset();
	});

	afterEach(() => {
		// Restore recursion env vars
		if (savedDepth === undefined) delete process.env.PI_SUBAGENT_DEPTH;
		else process.env.PI_SUBAGENT_DEPTH = savedDepth;
		if (savedMaxDepth === undefined) delete process.env.PI_SUBAGENT_MAX_DEPTH;
		else process.env.PI_SUBAGENT_MAX_DEPTH = savedMaxDepth;

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

	void it("disables extension discovery for agents without explicit extensions", async () => {
		mockPi.onCall({ echoArgs: true });
		const agents = makeAgentConfigs(["echo"]);

		const result = await runSync(tempDir, agents, "echo", "Task", {});

		assert.equal(result.exitCode, 0);
		const output = getFinalOutput(result.messages);
		const args = JSON.parse(output) as string[];
		assert.ok(args.includes("--no-extensions"), `expected --no-extensions in ${output}`);
	});

	void it("emits --no-extensions when extensions is explicitly undefined", async () => {
		mockPi.onCall({ echoArgs: true });
		const agents = [makeAgent("echo", { extensions: undefined })];

		const result = await runSync(tempDir, agents, "echo", "Task", {});

		assert.equal(result.exitCode, 0);
		const output = getFinalOutput(result.messages);
		const args = JSON.parse(output) as string[];
		assert.ok(args.includes("--no-extensions"), `expected --no-extensions in ${output}`);
	});

	void it("passes explicit extension through to child process with --no-extensions guard", async () => {
		const extPath = path.join(tempDir, "my-ext.ts");
		fs.writeFileSync(extPath, "export default function () {}\n", "utf-8");
		mockPi.onCall({ echoArgs: true });
		const agents = [makeAgent("echo", { extensions: ["./my-ext.ts"] })];

		const result = await runSync(tempDir, agents, "echo", "Task", {});

		assert.equal(result.exitCode, 0);
		const output = getFinalOutput(result.messages);
		const args = JSON.parse(output) as string[];
		assert.ok(args.includes("--no-extensions"), `expected --no-extensions guard in ${output}`);
		assert.ok(args.includes("--extension"), `expected --extension flag in ${output}`);
		const extIndex = args.indexOf("--extension");
		assert.equal(args[extIndex + 1], "./my-ext.ts", `expected ./my-ext.ts, got args: ${output}`);
	});

	void it("handles agents with multiple explicit extensions", async () => {
		const extA = path.join(tempDir, "ext-a.ts");
		const extB = path.join(tempDir, "ext-b.ts");
		fs.writeFileSync(extA, "export default function () {}\n", "utf-8");
		fs.writeFileSync(extB, "export default function () {}\n", "utf-8");
		mockPi.onCall({ echoArgs: true });
		const agents = [makeAgent("echo", { extensions: ["./ext-a.ts", "./ext-b.ts"] })];

		const result = await runSync(tempDir, agents, "echo", "Task", {});

		assert.equal(result.exitCode, 0);
		const output = getFinalOutput(result.messages);
		const args = JSON.parse(output) as string[];
		assert.ok(args.includes("--no-extensions"), "expected --no-extensions guard");
		assert.ok(args.includes("--extension"), "expected --extension flag");
		const extIndex = args.indexOf("--extension");
		assert.equal(args[extIndex + 1], "./ext-a.ts");
		assert.ok(args.includes("--extension"), "expected second --extension flag");
		const extIndex2 = args.indexOf("--extension", extIndex + 1);
		assert.equal(args[extIndex2 + 1], "./ext-b.ts");
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

	void it("fails before spawning when a global subagent extension path is missing", async () => {
		const agents = makeAgentConfigs(["echo"]);

		const result = await runSync(tempDir, agents, "echo", "Task", {
			config: { superagents: { extensions: ["./missing-global-extension.ts"] } },
		});

		assert.equal(result.exitCode, 1);
		assert.equal(mockPi.callCount(), 0);
		assert.match(result.error ?? "", /superagents\.extensions\[0\]/);
		assert.match(result.error ?? "", /missing-global-extension\.ts/);
	});

	void it("fails before spawning when an agent extension path is missing", async () => {
		const agents = [makeAgent("echo", { extensions: ["./missing-agent-extension.ts"] })];

		const result = await runSync(tempDir, agents, "echo", "Task", {});

		assert.equal(result.exitCode, 1);
		assert.equal(mockPi.callCount(), 0);
		assert.match(result.error ?? "", /agent\.extensions\[0\]/);
		assert.match(result.error ?? "", /missing-agent-extension\.ts/);
	});

	void it("passes existing global and agent extensions through in order", async () => {
		const globalExtensionPath = path.join(tempDir, "global-extension.ts");
		const agentExtensionPath = path.join(tempDir, "agent-extension.ts");
		fs.writeFileSync(globalExtensionPath, "export default function () {}\n", "utf-8");
		fs.writeFileSync(agentExtensionPath, "export default function () {}\n", "utf-8");
		mockPi.onCall({ echoArgs: true });
		const agents = [makeAgent("echo", { extensions: [agentExtensionPath] })];

		const result = await runSync(tempDir, agents, "echo", "Task", {
			config: { superagents: { extensions: [globalExtensionPath] } },
		});

		assert.equal(result.exitCode, 0);
		const output = getFinalOutput(result.messages);
		const args = JSON.parse(output) as string[];
		const firstExtension = args.indexOf("--extension");
		const secondExtension = args.indexOf("--extension", firstExtension + 1);
		assert.equal(args[firstExtension + 1], globalExtensionPath);
		assert.equal(args[secondExtension + 1], agentExtensionPath);
	});
});
