/**
 * Unit tests for subagent execution planning.
 *
 * Responsibilities:
 * - verify validated tool/executor inputs become conservative child plans
 * - preserve packet/fork/session/model/skill behavior before child process launch
 * - prove async/blocking controls are not part of planning
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import type { AgentConfig } from "../../src/agents/agents.ts";
import { planChildRun } from "../../src/execution/execution-planner.ts";

const tempDirs: string[] = [];

/**
 * Create a temporary directory registered for afterEach cleanup.
 *
 * @returns Absolute path to a unique temporary directory.
 */
function tempDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-superagents-plan-"));
	tempDirs.push(dir);
	return dir;
}

/**
 * Create minimal agent configs for testing.
 * Each name becomes an agent with required fields for planner compatibility.
 */
function makeAgentConfigs(names: string[]): AgentConfig[] {
	return names.map((name) => ({
		name,
		description: `Test agent: ${name}`,
		systemPrompt: `You are ${name}.`,
		source: "builtin" as const,
		filePath: `/test/${name}.md`,
	}));
}

/**
 * Create an agent config with specific settings.
 */
function makeAgent(name: string, overrides: Partial<AgentConfig> = {}): AgentConfig {
	return {
		name,
		description: `Test agent: ${name}`,
		systemPrompt: `You are ${name}.`,
		source: "builtin",
		filePath: `/test/${name}.md`,
		...overrides,
	};
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

void describe("execution planner", () => {
	void it("plans lineage-only child with packet delivery", () => {
		const cwd = tempDir();
		const artifactsDir = path.join(cwd, "artifacts");
		const plan = planChildRun({
			id: "child-1",
			index: 0,
			runtimeCwd: cwd,
			childCwd: cwd,
			agents: makeAgentConfigs(["sp-research"]),
			agentName: "sp-research",
			task: "Inspect auth",
			runId: "run-1",
			artifactsDir,
			sessionMode: "lineage-only",
			sessionFile: path.join(cwd, "child.jsonl"),
			workflow: "superpowers",
			useTestDrivenDevelopment: false,
			includeProgress: false,
			config: {},
		});

		assert.equal(plan.taskDelivery, "artifact");
		assert.equal(plan.taskText, "Inspect auth");
		assert.ok(plan.taskFilePath?.endsWith("_sp-research_packet.md"));
		assert.ok(plan.taskFilePath);
		assert.ok(fs.existsSync(plan.taskFilePath));
		assert.match(fs.readFileSync(plan.taskFilePath, "utf-8"), /Inspect auth/);
		plan.cleanupLaunchArtifacts();
		plan.cleanupLaunchArtifacts();
		assert.equal(fs.existsSync(plan.taskFilePath), false);
	});

	void it("plans fork child with wrapped direct task and no packet", () => {
		const cwd = tempDir();
		const plan = planChildRun({
			id: "child-1",
			index: 0,
			runtimeCwd: cwd,
			childCwd: cwd,
			agents: makeAgentConfigs(["sp-research"]),
			agentName: "sp-research",
			task: "Inspect auth",
			runId: "run-1",
			artifactsDir: path.join(cwd, "artifacts"),
			sessionMode: "fork",
			sessionFile: path.join(cwd, "child.jsonl"),
			workflow: "superpowers",
			useTestDrivenDevelopment: false,
			includeProgress: false,
			config: {},
		});

		assert.equal(plan.taskDelivery, "direct");
		assert.match(plan.taskText, /Task:\nInspect auth/);
		assert.equal(plan.taskFilePath, undefined);
	});

	void it("throws for unknown agent names", () => {
		const cwd = tempDir();
		assert.throws(
			() => planChildRun({
				id: "child-1",
				index: 0,
				runtimeCwd: cwd,
				childCwd: cwd,
				agents: makeAgentConfigs(["sp-research"]),
				agentName: "sp-missing",
				task: "Inspect auth",
				runId: "run-1",
				artifactsDir: path.join(cwd, "artifacts"),
				sessionMode: "lineage-only",
				workflow: "superpowers",
				useTestDrivenDevelopment: false,
				includeProgress: false,
				config: {},
			}),
			/Unknown agent: sp-missing/,
		);
	});

	void it("preserves model and skill overrides", () => {
		const cwd = tempDir();
		const plan = planChildRun({
			id: "child-1",
			index: 2,
			runtimeCwd: cwd,
			childCwd: path.join(cwd, "worktree"),
			agents: [makeAgent("sp-implementer", { skills: ["test-driven-development"], model: "balanced" })],
			agentName: "sp-implementer",
			task: "Implement",
			runId: "run-1",
			artifactsDir: path.join(cwd, "artifacts"),
			sessionMode: "lineage-only",
			workflow: "superpowers",
			modelOverride: "openai/gpt-4o",
			skills: ["context-map"],
			useTestDrivenDevelopment: true,
			includeProgress: true,
			config: {},
		});

		assert.equal(plan.index, 2);
		assert.equal(plan.modelOverride, "openai/gpt-4o");
		assert.deepEqual(plan.skills, ["context-map"]);
		assert.equal(plan.includeProgress, true);
		assert.equal(plan.childCwd.endsWith("worktree"), true);
		assert.ok(plan.taskFilePath);
		assert.match(fs.readFileSync(plan.taskFilePath, "utf-8"), /TDD/i);
	});
});
