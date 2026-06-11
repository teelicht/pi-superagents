import assert from "node:assert/strict";
import * as fs from "node:fs";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { buildPiArgs } from "../../src/execution/pi-args.ts";
import { getChildRunnerExports } from "../support/child-runner-helpers.ts";
import type { MockPi } from "../support/helpers.ts";
import { createMockPi, createTempDir, removeTempDir } from "../support/helpers.ts";
import type { AgentConfig } from "../../src/agents/agents.ts";

/**
 * Extracts extension argument values from the full args array.
 * Each occurrence of "--extension" is paired with the following value.
 */
function extractExtensions(args: string[]): string[] {
	const result: string[] = [];
	for (let i = 0; i < args.length - 1; i++) {
		if (args[i] === "--extension") {
			result.push(args[i + 1]);
		}
	}
	return result;
}

/**
 * Build a minimal agent config for child-runner integration tests.
 *
 * @param name Agent name used to address the agent through the tool.
 * @param overrides Optional field overrides to apply to the default config.
 * @returns Agent config suitable for `runPreparedChild` invocations.
 */
function makeAgent(name: string, overrides: Partial<AgentConfig> = {}): AgentConfig {
	return {
		name,
		description: `Test agent: ${name}`,
		source: "user",
		filePath: `/tmp/${name}.md`,
		systemPrompt: "",
		...overrides,
	};
}

/**
 * Create a stub extension file inside the temp dir so child-runner preflight
 * accepts the path as a local extension.
 *
 * @param tempDir Temp dir used as the runtime cwd for the test.
 * @param relativePath Path relative to `tempDir` where the stub should be created.
 * @returns Absolute path to the created stub file.
 */
function createExtensionStub(tempDir: string, relativePath: string): string {
	const fullPath = `${tempDir}/${relativePath}`;
	const parentDir = fullPath.substring(0, fullPath.lastIndexOf("/"));
	fs.mkdirSync(parentDir, { recursive: true });
	fs.writeFileSync(fullPath, "// stub extension");
	return fullPath;
}

void describe("buildPiArgs session wiring", () => {
	void it("uses --session when sessionFile is provided", () => {
		const { args } = buildPiArgs({
			baseArgs: ["-p"],
			task: "hello",
			sessionEnabled: true,
			sessionFile: "/tmp/forked-session.jsonl",
		});

		assert.ok(args.includes("--session"));
		assert.ok(args.includes("/tmp/forked-session.jsonl"));
		assert.ok(!args.includes("--session-dir"), "--session-dir should not be emitted with --session");
		assert.ok(!args.includes("--no-session"), "--no-session should not be emitted with --session");
	});

	void it("keeps fresh mode behavior (no session file)", () => {
		const { args } = buildPiArgs({
			baseArgs: ["-p"],
			task: "hello",
			sessionEnabled: true,
		});

		assert.ok(!args.includes("--session"));
	});

	void it("emits --no-extensions when an explicit empty extension list is provided", () => {
		const { args } = buildPiArgs({
			baseArgs: ["--mode", "json", "-p"],
			task: "hello",
			sessionEnabled: false,
			extensions: [],
		});

		assert.ok(args.includes("--no-extensions"));
		assert.equal(args.includes("--extension"), false);
	});

	void it("keeps path-like tool extensions when explicit extensions are provided", () => {
		const { args } = buildPiArgs({
			baseArgs: ["--mode", "json", "-p"],
			task: "hello",
			sessionEnabled: false,
			tools: ["read", "./tools/custom-tool.ts"],
			extensions: ["./extensions/global.ts"],
		});

		assert.ok(args.includes("--no-extensions"));
		assert.deepEqual(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2), ["--tools", "read"]);
		assert.deepEqual(extractExtensions(args), ["./extensions/global.ts", "./tools/custom-tool.ts"]);
	});

	void it("emits path-like tools as extensions when extensions is undefined (legacy behavior)", () => {
		const { args } = buildPiArgs({
			baseArgs: ["-p"],
			task: "hello",
			sessionEnabled: false,
			tools: ["read", "./tools/custom-tool.ts"],
		});

		// --no-extensions should NOT be emitted; undefined means Pi default discovery stays enabled
		assert.ok(!args.includes("--no-extensions"), "should not emit --no-extensions when extensions is undefined");
		// Path-like tool should still be emitted as --extension for availability
		assert.deepEqual(extractExtensions(args), ["./tools/custom-tool.ts"]);
		// Builtin tool should be listed via --tools
		assert.deepEqual(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2), ["--tools", "read"]);
	});

	void it("emits --approve when the parent project is trusted", () => {
		const { args } = buildPiArgs({
			baseArgs: ["--mode", "json", "-p"],
			task: "hello",
			sessionEnabled: false,
			projectTrusted: true,
		});

		assert.ok(args.includes("--approve"));
		assert.equal(args.includes("--no-approve"), false);
	});

	void it("emits --no-approve when the parent project is not trusted", () => {
		const { args } = buildPiArgs({
			baseArgs: ["--mode", "json", "-p"],
			task: "hello",
			sessionEnabled: false,
			projectTrusted: false,
		});

		assert.ok(args.includes("--no-approve"));
		assert.equal(args.includes("--approve"), false);
	});

	void it("omits trust flags when project trust is unspecified", () => {
		const { args } = buildPiArgs({
			baseArgs: ["--mode", "json", "-p"],
			task: "hello",
			sessionEnabled: false,
		});

		assert.equal(args.includes("--approve"), false);
		assert.equal(args.includes("--no-approve"), false);
	});
});

void describe("child-runner prepared child args", () => {
	let mockPi: MockPi;
	let tempDir: string;
	interface CapturedResult {
		exitCode: number;
		error?: string;
		messages: Array<{ role: string; content: Array<{ type: string; text?: string }> }>;
	}
	let runPreparedChild: (
		runtimeCwd: string,
		agents: AgentConfig[],
		agentName: string,
		task: string,
		options: Record<string, unknown>,
	) => Promise<CapturedResult>;

	before(async () => {
		mockPi = createMockPi();
		mockPi.install();
		const exports = await getChildRunnerExports();
		runPreparedChild = exports.runPreparedChild as unknown as typeof runPreparedChild;
	});

	after(() => {
		mockPi.uninstall();
	});

	beforeEach(() => {
		mockPi.reset();
		tempDir = createTempDir("pi-args-child-runner-");
	});

	afterEach(() => {
		removeTempDir(tempDir);
	});

	/**
	 * Run one prepared child with the mock pi echoing the args, and return
	 * the parsed arg array emitted by the mock.
	 *
	 * @param agent Agent config used for the launched child.
	 * @param options Optional launch options including trust and extension config.
	 * @returns Parsed arg array as JSON-decoded by the mock pi harness.
	 */
	async function runAndCaptureArgs(agent: AgentConfig, options: Record<string, unknown> = {}): Promise<string[]> {
		mockPi.onCall({ echoArgs: true });
		const result = await runPreparedChild(tempDir, [agent], agent.name, "Task", { runId: "args-capture", ...options });
		if (result.exitCode !== 0) { throw new Error("child exited with code " + result.exitCode + ": " + (result.error ?? "unknown error")); }
		const assistant = result.messages.find((message) => message.role === "assistant");
		const text = assistant?.content.find((part) => part.type === "text")?.text ?? "[]";
		return JSON.parse(text) as string[];
	}

	void it("includes --approve in child args when projectTrusted is true", async () => {
		const globalExt = createExtensionStub(tempDir, "extensions/global.ts");
		const agent = makeAgent("echo");

		const args = await runAndCaptureArgs(agent, {
			projectTrusted: true,
			config: { superagents: { extensions: [globalExt] } },
		});

		assert.ok(args.includes("--approve"), `expected --approve in args: ${args.join(" ")}`);
		assert.equal(args.includes("--no-approve"), false);
	});

	void it("includes --no-approve in child args when projectTrusted is false", async () => {
		const globalExt = createExtensionStub(tempDir, "extensions/global.ts");
		const agent = makeAgent("echo");

		const args = await runAndCaptureArgs(agent, {
			projectTrusted: false,
			config: { superagents: { extensions: [globalExt] } },
		});

		assert.ok(args.includes("--no-approve"), `expected --no-approve in args: ${args.join(" ")}`);
		assert.equal(args.includes("--approve"), false);
	});

	void it("omits trust flags from child args when projectTrusted is undefined", async () => {
		const agent = makeAgent("echo");

		const args = await runAndCaptureArgs(agent);

		assert.equal(args.includes("--approve"), false);
		assert.equal(args.includes("--no-approve"), false);
	});

	void it("excludes project agent frontmatter extensions when projectTrusted is false", async () => {
		const globalExt = createExtensionStub(tempDir, "extensions/global.ts");
		const agentExt = createExtensionStub(tempDir, "agent/project-ext.ts");
		const agent = makeAgent("echo", { source: "project", extensions: [agentExt] });

		const args = await runAndCaptureArgs(agent, {
			projectTrusted: false,
			config: { superagents: { extensions: [globalExt] } },
		});

		// Global extension should be present; project agent extension should be dropped.
		assert.ok(args.includes(globalExt), `expected global extension ${globalExt} in args: ${args.join(" ")}`);
		assert.equal(args.includes(agentExt), false, `expected project extension ${agentExt} to be excluded`);
	});

	void it("includes project agent frontmatter extensions when projectTrusted is true", async () => {
		const globalExt = createExtensionStub(tempDir, "extensions/global.ts");
		const agentExt = createExtensionStub(tempDir, "agent/project-ext.ts");
		const agent = makeAgent("echo", { source: "project", extensions: [agentExt] });

		const args = await runAndCaptureArgs(agent, {
			projectTrusted: true,
			config: { superagents: { extensions: [globalExt] } },
		});

		assert.ok(args.includes(globalExt), `expected global extension ${globalExt} in args: ${args.join(" ")}`);
		assert.ok(args.includes(agentExt), `expected project extension ${agentExt} in args: ${args.join(" ")}`);
	});

	void it("keeps user and builtin agent frontmatter extensions regardless of trust", async () => {
		const globalExt = createExtensionStub(tempDir, "extensions/global.ts");
		const userAgentExt = createExtensionStub(tempDir, "user/user-ext.ts");
		const userAgent = makeAgent("echo", { source: "user", extensions: [userAgentExt] });
		const builtinAgentExt = createExtensionStub(tempDir, "user/builtin-ext.ts");
		const builtinAgent = makeAgent("builtin-echo", { source: "builtin", extensions: [builtinAgentExt] });

		const userArgs = await runAndCaptureArgs(userAgent, {
			projectTrusted: false,
			config: { superagents: { extensions: [globalExt] } },
		});
		assert.ok(userArgs.includes(userAgentExt), `expected user extension ${userAgentExt} in args: ${userArgs.join(" ")}`);

		const builtinArgs = await runAndCaptureArgs(builtinAgent, {
			projectTrusted: false,
			config: { superagents: { extensions: [globalExt] } },
		});
		assert.ok(builtinArgs.includes(builtinAgentExt), `expected builtin extension ${builtinAgentExt} in args: ${builtinArgs.join(" ")}`);
	});
});
