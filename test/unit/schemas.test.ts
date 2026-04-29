/**
 * Unit tests for public TypeBox schema metadata.
 *
 * Responsibilities:
 * - verify user-visible descriptions stay aligned with supported execution modes
 * - guard parameter metadata used by tool callers and docs
 * - keep command-scoped Superpowers wording explicit
 * - enforce that the subagent schema exposes only Superpowers role execution fields
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { Value } from "typebox/value";
import type { ExtensionConfig } from "../../src/shared/types.ts";
import type { MockPi } from "../support/helpers.ts";
import { createMockPi, createTempDir, removeTempDir, tryImport } from "../support/helpers.ts";

interface SubagentParamsSchema {
	anyOf?: Array<{
		required?: string[];
	}>;
	oneOf?: unknown;
	allOf?: unknown;
	not?: unknown;
	additionalProperties?: boolean;
	dependentRequired?: Record<string, string[]>;
	properties?: {
		workflow?: {
			type?: string;
			enum?: string[];
			description?: string;
		};
		sessionMode?: {
			type?: string;
			enum?: string[];
			description?: string;
		};

		tasks?: {
			minItems?: number;
			items?: {
				properties?: {
					agent?: {
						description?: string;
					};
					count?: {
						minimum?: number;
						description?: string;
					};
				};
			};
		};
		agent?: unknown;
		task?: unknown;
		useTestDrivenDevelopment?: unknown;
		action?: unknown;
		chainName?: unknown;
		config?: unknown;
		chain?: unknown;
		share?: unknown;
	};
}

let SubagentParams: SubagentParamsSchema | undefined;
let available = true;
try {
	({ SubagentParams } = (await import("../../src/shared/schemas.ts")) as { SubagentParams: SubagentParamsSchema });
} catch {
	// Skip in environments that do not install typebox.
	available = false;
}

interface ExecutorModule {
	createSubagentExecutor?: (...args: unknown[]) => {
		execute: (
			id: string,
			params: Record<string, unknown>,
			signal: AbortSignal,
			onUpdate: ((result: unknown) => void) | undefined,
			ctx: unknown,
		) => Promise<{ content: Array<{ text?: string }>; details?: { sessionMode?: string; results?: unknown[] } }>;
	};
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

const executorMod = await tryImport<ExecutorModule>("./src/execution/subagent-executor.ts");
const executorAvailable = !!executorMod?.createSubagentExecutor;

/**
 * Create the minimum executor state required for compatibility tests.
 *
 * @param cwd Workspace root used by the executor under test.
 * @returns State object compatible with the current executor wiring.
 */
function makeState(cwd: string) {
	return {
		baseCwd: cwd,
		currentSessionId: null,
		lastUiContext: null,
		configGate: {
			blocked: false,
			diagnostics: [],
			message: "",
		},
	};
}

/**
 * Build a session manager stub that records requested fork operations.
 *
 * @param options Optional parent-session overrides for individual tests.
 * @returns Recorder state and a compatible session manager implementation.
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
 * Create a minimal extension context for executor tests.
 *
 * @param cwd Workspace root used during execution.
 * @param sessionManager Session manager stub for fork compatibility assertions.
 * @returns Context object matching the executor's runtime expectations.
 */
function makeCtx(cwd: string, sessionManager: SessionManagerStub) {
	return {
		cwd,
		hasUI: false,
		ui: {},
		modelRegistry: { getAvailable: () => [] },
		sessionManager,
	};
}

/**
 * Construct a subagent executor with a tiny in-memory agent catalog.
 *
 * @param cwd Workspace root for the run.
 * @param config Optional extension config overrides.
 * @returns Executor instance under test.
 */
function makeExecutor(cwd: string, config: ExtensionConfig = {}): NonNullable<ExecutorModule["createSubagentExecutor"]> extends (...args: unknown[]) => infer R ? R : never {
	return executorMod!.createSubagentExecutor!({
		state: makeState(cwd),
		getConfig: () => config,
		getSubagentSessionRoot: () => cwd,
		discoverAgents: () => ({
			agents: [{ name: "echo", description: "Echo test agent" }],
		}),
	});
}

/**
 * Read the JSON header written into a seeded lineage-only child session.
 *
 * @param sessionFile Absolute session file path returned by the executor.
 * @returns Parsed session header object.
 */
function readSessionHeader(sessionFile: string): Record<string, unknown> {
	const firstLine = fs.readFileSync(sessionFile, "utf-8").trim().split("\n")[0];
	return JSON.parse(firstLine);
}

/**
 * Recursively collect seeded child session files from a fixture root.
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

void describe("SubagentParams schema", { skip: !available ? "typebox not available" : undefined }, () => {
	void it("includes sessionMode field for standalone, lineage-only, and fork", () => {
		const sessionModeSchema = SubagentParams?.properties?.sessionMode;
		assert.ok(sessionModeSchema, "sessionMode schema should exist");
		assert.equal(sessionModeSchema.type, "string");
		assert.deepEqual(sessionModeSchema.enum, ["standalone", "lineage-only", "fork"]);
		assert.match(String(sessionModeSchema.description ?? ""), /lineage-only/);
		assert.match(String(sessionModeSchema.description ?? ""), /fork/);
	});

	void it("does not expose deprecated context field on the schema", () => {
		const properties = (SubagentParams as { properties?: Record<string, unknown> }).properties ?? {};
		assert.equal("context" in properties, false);
	});

	void it("describes workflow as superpowers-only role execution", () => {
		const workflowSchema = SubagentParams?.properties?.workflow;
		assert.ok(workflowSchema, "workflow schema should exist");
		assert.equal(workflowSchema.type, "string");
		assert.deepEqual(workflowSchema.enum, ["superpowers"]);
		assert.match(String(workflowSchema.description ?? ""), /superpowers/i);
		assert.match(String(workflowSchema.description ?? ""), /only 'superpowers' is supported/i);
	});

	void it("includes agent field with superpowers role description", () => {
		const agentSchema = SubagentParams?.properties?.agent;
		assert.ok(agentSchema, "agent schema should exist");
		assert.match(String((agentSchema as { description?: string })?.description ?? ""), /discovered agent|sp-recon|sp-implementer|superpowers role/i);
	});

	void it("includes task field", () => {
		const taskSchema = SubagentParams?.properties?.task;
		assert.ok(taskSchema, "task schema should exist");
	});

	void it("keeps the machine-readable schema compatible with Pi tool registration", () => {
		assert.equal(SubagentParams?.additionalProperties, false);
		assert.equal(SubagentParams?.anyOf, undefined);
		assert.equal(SubagentParams?.oneOf, undefined);
		assert.equal(SubagentParams?.allOf, undefined);
		assert.equal(SubagentParams?.not, undefined);
		assert.equal(SubagentParams?.dependentRequired, undefined);
		assert.equal(SubagentParams?.properties?.tasks?.minItems, 1);
		assert.equal(Value.Check(SubagentParams as object, { tasks: [] }), false);
		assert.equal(Value.Check(SubagentParams as object, { agent: "sp-recon", task: "Investigate", extra: true }), false);
	});

	void it("includes useTestDrivenDevelopment field", () => {
		const schema = SubagentParams?.properties?.useTestDrivenDevelopment;
		assert.ok(schema, "useTestDrivenDevelopment schema should exist");
	});

	void it("includes tasks field for parallel role execution", () => {
		const tasksSchema = SubagentParams?.properties?.tasks;
		assert.ok(tasksSchema, "tasks schema should exist");
	});

	void it("does not expose generic management actions on the subagent schema", () => {
		const properties = (SubagentParams as { properties?: Record<string, unknown> }).properties ?? {};
		assert.equal("action" in properties, false);
		assert.equal("chainName" in properties, false);
		assert.equal("config" in properties, false);
	});

	void it("keeps only Superpowers role execution fields", () => {
		const properties = (SubagentParams as { properties?: Record<string, unknown> }).properties ?? {};
		assert.equal("agent" in properties, true);
		assert.equal("task" in properties, true);
		assert.equal("tasks" in properties, true);
		assert.equal("workflow" in properties, true);
		assert.equal("useTestDrivenDevelopment" in properties, true);
		assert.equal("implementerMode" in properties, false);
		assert.equal("chain" in properties, false);
		assert.equal("share" in properties, false);
	});

	void it("tasks items use SuperpowersRoleNameSchema for agent", () => {
		const tasksSchema = SubagentParams?.properties?.tasks;
		assert.ok(tasksSchema, "tasks schema should exist");
		const itemAgent = tasksSchema?.items?.properties?.agent;
		assert.ok(itemAgent, "tasks[].agent schema should exist");
		assert.match(String(itemAgent.description ?? ""), /sp-recon|superpowers role/i);
	});

	void it("tasks items do not include count field", () => {
		const tasksSchema = SubagentParams?.properties?.tasks;
		assert.ok(tasksSchema, "tasks schema should exist");
		const itemCount = tasksSchema?.items?.properties?.count;
		assert.equal(itemCount, undefined, "tasks[].count should not exist");
	});
});

let savedDepth: string | undefined;
let savedMaxDepth: string | undefined;

void describe("sessionMode runtime compatibility", { skip: !executorAvailable ? "subagent executor not importable" : undefined }, () => {
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

		tempDir = createTempDir("pi-session-mode-test-");
		mockPi.reset();
		mockPi.onCall({ output: "ok" });
	});

	afterEach(() => {
		removeTempDir(tempDir);
		// Restore recursion env vars
		if (savedDepth === undefined) delete process.env.PI_SUBAGENT_DEPTH;
		else process.env.PI_SUBAGENT_DEPTH = savedDepth;
		if (savedMaxDepth === undefined) delete process.env.PI_SUBAGENT_MAX_DEPTH;
		else process.env.PI_SUBAGENT_MAX_DEPTH = savedMaxDepth;
	});

	void it("accepts sessionMode=fork as the current fork behavior", async () => {
		const { manager, calls } = makeSessionManagerRecorder({
			sessionFile: "/tmp/parent.jsonl",
			leafId: "leaf-fork",
		});
		const executor = makeExecutor(tempDir);

		const result = await executor.execute("id", { agent: "echo", task: "test", sessionMode: "fork" }, new AbortController().signal, undefined, makeCtx(tempDir, manager));

		assert.ok(result.content[0]?.text, "expected non-empty response content");
		assert.deepEqual(calls, ["leaf-fork"]);
		assert.equal(result.details?.sessionMode, "fork");
	});

	void it("treats sessionMode=standalone as non-fork behavior", async () => {
		const { manager, calls } = makeSessionManagerRecorder({ sessionFile: undefined, leafId: null });
		const executor = makeExecutor(tempDir);

		const result = await executor.execute("id", { agent: "echo", task: "test", sessionMode: "standalone" }, new AbortController().signal, undefined, makeCtx(tempDir, manager));

		assert.ok(result.content[0]?.text, "expected non-empty response content");
		assert.deepEqual(calls, []);
		assert.equal(result.details?.sessionMode, "standalone");
	});

	void it("seeds a linked child session for sessionMode=lineage-only", async () => {
		const parentSessionFile = path.join(tempDir, "parent.jsonl");
		fs.writeFileSync(parentSessionFile, '{"type":"session"}\n', "utf-8");
		const { manager, calls } = makeSessionManagerRecorder({ sessionFile: parentSessionFile, leafId: null });
		const executor = makeExecutor(tempDir);

		const result = await executor.execute("id", { agent: "echo", task: "test", sessionMode: "lineage-only" }, new AbortController().signal, undefined, makeCtx(tempDir, manager));

		assert.ok(result.content[0]?.text, "expected non-empty response content");
		assert.deepEqual(calls, []);
		assert.equal(result.details?.sessionMode, "lineage-only");
		const sessionFiles = findChildSessionFiles(tempDir);
		assert.equal(sessionFiles.length, 1, "expected one seeded session file");
		assert.equal(readSessionHeader(sessionFiles[0]).parentSession, parentSessionFile);
		assert.equal(fs.readFileSync(sessionFiles[0], "utf-8").trim().split("\n").length, 1);
	});
});
