# Session Modes And Packet Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current `fresh | fork`-only subagent launch model with `standalone | lineage-only | fork`, default bounded Superpowers roles to `lineage-only`, and deliver bounded child instructions through runtime-managed packet artifacts with guaranteed cleanup.

**Architecture:** Add `session-mode` as machine-readable agent frontmatter plus a new public `sessionMode` tool parameter, keep `context` as a compatibility alias, and move launch preparation into a child-specific resolver that decides both session seeding and task delivery. Non-inheriting launches write a scoped Markdown packet into the session artifact directory, launch the child against that packet file, and delete the packet in runtime `finally` paths so cleanup does not depend on model behavior.

**Tech Stack:** TypeScript, Node.js `fs/path/crypto`, Pi session JSONL files, Vitest/unit tests via Node test runner

---

## File Map

- `src/shared/types.ts` — canonical `SessionMode`, compatibility types, packet/task-delivery runtime types, and `RunSyncOptions` additions.
- `src/agents/agents.ts` — parse `session-mode` frontmatter into `AgentConfig.sessionMode`.
- `src/shared/schemas.ts` — expose the new `sessionMode` tool parameter and retain deprecated `context`.
- `src/execution/session-mode.ts` — new launch-policy module that resolves `sessionMode`, maps legacy `context`, seeds `lineage-only` child sessions, and preserves `fork` behavior.
- `src/execution/superpowers-packets.ts` — packet envelope rendering and packet file helpers for bounded roles.
- `src/shared/artifacts.ts` — packet directory helpers plus recursive stale-cleanup support for nested artifact directories.
- `src/execution/pi-args.ts` — allow direct `@packet-file` task delivery without re-wrapping the packet into a temp task file.
- `src/execution/execution.ts` — pass `taskFilePath` through to the Pi CLI and record `sessionMode` on results.
- `src/execution/subagent-executor.ts` — compute effective launch behavior per child, create packet files for non-inheriting modes, and clean them up in success/failure/abort paths.
- `src/superpowers/root-prompt.ts` — switch hidden/user-visible prompt metadata from `context: fresh|fork` to explicit `sessionMode: standalone | lineage-only | fork` wording.
- `src/ui/subagent-result-lines.ts` — keep the `[fork]` badge based on actual inherited-context mode instead of the old `details.context` flag alone.
- `agents/sp-*.md` — add `session-mode: lineage-only` to bounded Superpowers role definitions.
- `test/unit/session-mode.test.ts` — focused unit coverage for mode resolution and session seeding.
- `test/unit/schemas.test.ts` — public schema contract for `sessionMode` plus deprecated `context`.
- `test/unit/path-resolution.test.ts` — frontmatter parsing coverage for `session-mode`.
- `test/unit/pi-args.test.ts` — packet-file CLI argument coverage.
- `test/unit/superpowers-root-prompt.test.ts` — prompt metadata terminology update.
- `test/unit/subagent-result-lines.test.ts` and `test/integration/render-fork-badge.test.ts` — UI behavior for `fork` badges under the new result fields.
- `test/integration/fork-context-execution.test.ts` — broaden to session-mode execution wiring, especially `lineage-only`.
- `test/integration/superpowers-packets.test.ts` — packet creation, filename uniqueness, delivery mode, and cleanup.
- `README.md`, `docs/configuration.md`, `docs/worktrees.md`, `docs/parameters.md`, `docs/skills.md`, `CHANGELOG.md` — required user-facing documentation and release notes.

## Task 1: Add Public `sessionMode` Contract And Agent Defaults

**Files:**
- Create: `test/unit/session-mode.test.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/agents/agents.ts`
- Modify: `src/shared/schemas.ts`
- Modify: `test/unit/schemas.test.ts`
- Modify: `test/unit/path-resolution.test.ts`
- Modify: `test/support/helpers.ts`
- Modify: `agents/sp-recon.md`
- Modify: `agents/sp-research.md`
- Modify: `agents/sp-implementer.md`
- Modify: `agents/sp-spec-review.md`
- Modify: `agents/sp-code-review.md`
- Modify: `agents/sp-debug.md`

- [x] **Step 1: Write the failing schema and frontmatter tests**

Add these assertions to `test/unit/schemas.test.ts`:

```ts
void it("includes sessionMode field for standalone, lineage-only, and fork", () => {
	const sessionModeSchema = SubagentParams?.properties?.sessionMode;
	assert.ok(sessionModeSchema, "sessionMode schema should exist");
	assert.equal(sessionModeSchema.type, "string");
	assert.deepEqual(sessionModeSchema.enum, ["standalone", "lineage-only", "fork"]);
	assert.match(String(sessionModeSchema.description ?? ""), /lineage-only/);
	assert.match(String(sessionModeSchema.description ?? ""), /fork/);
});

void it("keeps deprecated context field as a compatibility alias", () => {
	const contextSchema = SubagentParams?.properties?.context;
	assert.ok(contextSchema, "context schema should exist");
	assert.deepEqual(contextSchema.enum, ["fresh", "fork"]);
	assert.match(String(contextSchema.description ?? ""), /deprecated/i);
	assert.match(String(contextSchema.description ?? ""), /sessionMode/i);
});
```

Add this discovery test to `test/unit/path-resolution.test.ts`:

```ts
void test("should parse session-mode from project agent frontmatter", () => {
	assertModulesLoaded();

	const agentsDir = path.join(cwdDir, ".agents");
	fs.mkdirSync(agentsDir, { recursive: true });
	fs.writeFileSync(
		path.join(agentsDir, "test-agent-session-mode.md"),
		"---\nname: test-agent-session-mode\ndescription: Test agent\nsession-mode: lineage-only\n---\nAgent content",
	);

	const result = discoverAgents!(cwdDir, "project");
	const agent = result.agents.find((candidate: any) => candidate.name === "test-agent-session-mode");
	assert.ok(agent);
	assert.strictEqual((agent as any).sessionMode, "lineage-only");
});
```

- [x] **Step 2: Run the failing contract tests**

Run:

```bash
npm run test:unit -- test/unit/schemas.test.ts test/unit/path-resolution.test.ts
```

Expected: FAIL because `sessionMode` is not yet defined in the public schema or parsed from frontmatter.

- [x] **Step 3: Add the shared types and agent-frontmatter support**

Update `src/shared/types.ts` and `src/agents/agents.ts` with these exact additions:

```ts
export type SessionMode = "standalone" | "lineage-only" | "fork";
export type LegacyExecutionContext = "fresh" | "fork";
export type TaskDeliveryMode = "direct" | "artifact";
```

```ts
export interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	mcpDirectTools?: string[];
	model?: string;
	thinking?: string;
	systemPrompt: string;
	source: AgentSource;
	filePath: string;
	skills?: string[];
	extensions?: string[];
	interactive?: boolean;
	maxSubagentDepth?: number;
	sessionMode?: SessionMode;
	extraFields?: Record<string, string>;
}
```

```ts
export const KNOWN_FIELDS = new Set([
	"name",
	"description",
	"tools",
	"model",
	"thinking",
	"skills",
	"extensions",
	"interactive",
	"maxSubagentDepth",
	"session-mode",
]);
```

```ts
sessionMode:
	frontmatter["session-mode"] === "standalone" ||
	frontmatter["session-mode"] === "lineage-only" ||
	frontmatter["session-mode"] === "fork"
		? frontmatter["session-mode"]
		: undefined,
```

Also extend `test/support/helpers.ts` so test agents can carry the same field:

```ts
interface AgentConfig {
	name: string;
	description?: string;
	systemPrompt?: string;
	model?: string;
	tools?: string[];
	extensions?: string[];
	skills?: string[];
	thinking?: string;
	scope?: string;
	reads?: string[] | false;
	progress?: boolean;
	mcpDirectTools?: string[];
	maxSubagentDepth?: number;
	sessionMode?: "standalone" | "lineage-only" | "fork";
}
```

- [x] **Step 4: Add the new schema field and keep `context` as deprecated compatibility**

Replace the current `context` section in `src/shared/schemas.ts` with:

```ts
	sessionMode: Type.Optional(
		Type.String({
			enum: ["standalone", "lineage-only", "fork"],
			description:
				"Subagent session mode. 'standalone' has no parent link, 'lineage-only' links to the parent session without inheriting turns, and 'fork' inherits the parent session branch.",
		}),
	),
	context: Type.Optional(
		Type.String({
			enum: ["fresh", "fork"],
			description:
				"Deprecated compatibility alias for sessionMode. 'fresh' maps to 'standalone' and 'fork' maps to 'fork'. Prefer sessionMode for new callers.",
		}),
	),
```

- [x] **Step 5: Add `session-mode: lineage-only` to the bounded Superpowers agents**

Insert this frontmatter line into each built-in bounded role agent:

```md
session-mode: lineage-only
```

Example target in `agents/sp-implementer.md`:

```md
---
name: sp-implementer
description: Superpowers-native implementer for one bounded plan task
model: cheap
tools: read, grep, find, ls, bash, write
maxSubagentDepth: 0
session-mode: lineage-only
---
```

- [x] **Step 6: Re-run the contract tests**

Run:

```bash
npm run test:unit -- test/unit/schemas.test.ts test/unit/path-resolution.test.ts
```

Expected: PASS.

- [x] **Step 7: Commit the contract and defaulting groundwork**

```bash
git add src/shared/types.ts src/agents/agents.ts src/shared/schemas.ts test/unit/schemas.test.ts test/unit/path-resolution.test.ts test/support/helpers.ts agents/sp-recon.md agents/sp-research.md agents/sp-implementer.md agents/sp-spec-review.md agents/sp-code-review.md agents/sp-debug.md
git commit -m "feat: add session-mode contract and bounded role defaults"
```

## Task 2: Implement Session-Mode Resolution And `lineage-only` Session Seeding

**Files:**
- Create: `src/execution/session-mode.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/execution/subagent-executor.ts`
- Modify: `test/unit/session-mode.test.ts`
- Modify: `test/integration/fork-context-execution.test.ts`

- [x] **Step 1: Write the failing resolver and seeding tests**

Create `test/unit/session-mode.test.ts` with these core assertions:

```ts
assert.equal(resolveRequestedSessionMode({}), "standalone");
assert.equal(resolveRequestedSessionMode({ sessionMode: "lineage-only" }), "lineage-only");
assert.equal(resolveRequestedSessionMode({ context: "fresh" }), "standalone");
assert.equal(resolveRequestedSessionMode({ context: "fork" }), "fork");
assert.equal(resolveRequestedSessionMode({ agentSessionMode: "lineage-only" }), "lineage-only");
```

Add a lineage-only session seed test:

```ts
seedLineageOnlySessionFile({
	parentSessionFile,
	childSessionFile,
	childCwd: "/tmp/child-cwd",
});

const raw = fs.readFileSync(childSessionFile, "utf-8").trim().split("\n");
assert.equal(raw.length, 1);
const header = JSON.parse(raw[0]);
assert.equal(header.type, "session");
assert.equal(header.parentSession, parentSessionFile);
assert.equal(header.cwd, "/tmp/child-cwd");
```

Add an integration assertion to `test/integration/fork-context-execution.test.ts` that `context: "fresh"` plus an agent default of `sessionMode: "lineage-only"` creates a seeded child session file rather than calling `createBranchedSession()`.

- [x] **Step 2: Run the failing session-mode tests**

Run:

```bash
npm run test:unit -- test/unit/session-mode.test.ts
npm run test:integration -- test/integration/fork-context-execution.test.ts
```

Expected: FAIL because `src/execution/session-mode.ts` does not exist and the executor still resolves only `fresh | fork`.

- [x] **Step 3: Add the new launch-policy module**

Create `src/execution/session-mode.ts` with this structure:

```ts
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentConfig } from "../agents/agents.ts";
import type { LegacyExecutionContext, SessionMode, TaskDeliveryMode } from "../shared/types.ts";

export interface SessionLaunchManager {
	getSessionFile(): string | undefined;
	getLeafId(): string | null;
	createBranchedSession(leafId: string): string | undefined;
}

export function resolveRequestedSessionMode(input: {
	sessionMode?: unknown;
	context?: unknown;
	agentSessionMode?: SessionMode;
	defaultSessionMode?: SessionMode;
}): SessionMode {
	if (input.sessionMode === "standalone" || input.sessionMode === "lineage-only" || input.sessionMode === "fork") {
		return input.sessionMode;
	}
	if (input.context === "fork") return "fork";
	if (input.context === "fresh") return "standalone";
	return input.agentSessionMode ?? input.defaultSessionMode ?? "standalone";
}

export function resolveTaskDeliveryMode(sessionMode: SessionMode): TaskDeliveryMode {
	return sessionMode === "fork" ? "direct" : "artifact";
}
```

- [x] **Step 4: Implement deterministic lineage-only session seeding**

In the same file, add this helper implementation:

```ts
export function seedLineageOnlySessionFile(params: {
	parentSessionFile: string;
	childSessionFile: string;
	childCwd: string;
}): void {
	const header = {
		type: "session",
		version: 3,
		id: randomUUID(),
		timestamp: new Date().toISOString(),
		cwd: params.childCwd,
		parentSession: params.parentSessionFile,
	};

	fs.mkdirSync(path.dirname(params.childSessionFile), { recursive: true });
	fs.writeFileSync(params.childSessionFile, `${JSON.stringify(header)}\n`, "utf-8");
}
```

Then add a resolver that seeds one child session file per index for `lineage-only`, calls `createBranchedSession()` for `fork`, and returns `undefined` for `standalone`.

- [x] **Step 5: Swap the executor over to the new resolver entry points**

In `src/execution/subagent-executor.ts`, replace:

```ts
import { createForkContextResolver, type ForkableSessionManager } from "./fork-context.ts";
```

with:

```ts
import {
	createSessionLaunchResolver,
	resolveRequestedSessionMode,
	type SessionLaunchManager,
} from "./session-mode.ts";
```

Then resolve the effective mode from:

```ts
resolveRequestedSessionMode({
	sessionMode: params.sessionMode,
	context: params.context,
	agentSessionMode: agentConfig.sessionMode,
	defaultSessionMode: "standalone",
})
```

instead of the old top-level `createForkContextResolver(params.context)`.

- [x] **Step 6: Re-run the mode-resolution tests**

Run:

```bash
npm run test:unit -- test/unit/session-mode.test.ts
npm run test:integration -- test/integration/fork-context-execution.test.ts
```

Expected: PASS, including a lineage-only child session file with `parentSession` and no copied message lines.

- [x] **Step 7: Commit the session-mode resolver**

```bash
git add src/execution/session-mode.ts src/execution/subagent-executor.ts src/shared/types.ts test/unit/session-mode.test.ts test/integration/fork-context-execution.test.ts
git commit -m "feat: add session-mode resolution and lineage-only session seeding"
```

## Task 3: Add Packet Artifact Helpers And Runtime Cleanup Primitives

**Files:**
- Modify: `src/shared/artifacts.ts`
- Modify: `src/execution/superpowers-packets.ts`
- Modify: `test/integration/superpowers-packets.test.ts`

- [x] **Step 1: Write the failing packet-path and cleanup tests**

In `test/integration/superpowers-packets.test.ts`, add assertions for:

```ts
assert.equal(
	getPacketPath("/tmp/subagent-artifacts", "a1b2c3d4", "sp-implementer", 0),
	"/tmp/subagent-artifacts/packets/a1b2c3d4_0_sp-implementer_packet.md",
);
assert.equal(
	getPacketPath("/tmp/subagent-artifacts", "a1b2c3d4", "sp-code/review", 2),
	"/tmp/subagent-artifacts/packets/a1b2c3d4_2_sp-code_review_packet.md",
);
```

Add a stale-cleanup assertion that a nested file under `packets/` is deleted by `cleanupOldArtifacts()`.

- [x] **Step 2: Run the failing packet tests**

Run:

```bash
npm run test:integration -- test/integration/superpowers-packets.test.ts
```

Expected: FAIL because packet path helpers and nested artifact cleanup do not exist.

- [x] **Step 3: Add dedicated packet-directory helpers**

Extend `src/shared/artifacts.ts` with:

```ts
export function getPacketsDir(artifactsDir: string): string {
	return path.join(artifactsDir, "packets");
}

export function getPacketPath(artifactsDir: string, runId: string, agent: string, index = 0): string {
	const safeAgent = agent.replace(/[^\w.-]/g, "_");
	return path.join(getPacketsDir(artifactsDir), `${runId}_${index}_${safeAgent}_packet.md`);
}

export function removeArtifactFile(filePath: string | undefined): void {
	if (!filePath) return;
	try {
		fs.rmSync(filePath, { force: true });
	} catch {
		// Cleanup is best effort.
	}
}
```

- [x] **Step 4: Convert packet rendering from filename hints to a real packet envelope**

Replace the current filename-only logic in `src/execution/superpowers-packets.ts` with a packet envelope builder:

```ts
import type { SessionMode } from "../shared/types.ts";

export function buildSuperpowersPacketContent(input: {
	agent: string;
	sessionMode: SessionMode;
	task: string;
	useTestDrivenDevelopment: boolean;
}): string {
	const modeLine =
		input.agent === "sp-implementer" ? `Implementer Mode: ${input.useTestDrivenDevelopment ? "tdd" : "direct"}` : null;

	return [
		"# Superpowers Work Packet",
		"",
		`Agent: ${input.agent}`,
		`Session Mode: ${input.sessionMode}`,
		"Use only the information in this packet. Do not rely on parent-session history that is not included here.",
		modeLine,
		"",
		input.task.trim(),
	]
		.filter((line): line is string => Boolean(line))
		.join("\n");
}
```

- [x] **Step 5: Make stale cleanup recursive enough for nested packet directories**

Replace the flat-file loop in `cleanupOldArtifacts()` with a recursive walk:

```ts
function cleanupPath(targetPath: string, cutoff: number): void {
	const stat = fs.statSync(targetPath);
	if (stat.isDirectory()) {
		for (const child of fs.readdirSync(targetPath)) {
			cleanupPath(path.join(targetPath, child), cutoff);
		}
		if (fs.readdirSync(targetPath).length === 0) {
			fs.rmdirSync(targetPath);
		}
		return;
	}
	if (stat.mtimeMs < cutoff) {
		fs.unlinkSync(targetPath);
	}
}
```

Keep `.last-cleanup` at the root untouched and call `cleanupPath()` for every other entry.

- [x] **Step 6: Re-run the packet helper tests**

Run:

```bash
npm run test:integration -- test/integration/superpowers-packets.test.ts
```

Expected: PASS for packet naming, packet envelope content, and nested stale cleanup.

- [x] **Step 7: Commit the packet helper layer**

```bash
git add src/shared/artifacts.ts src/execution/superpowers-packets.ts test/integration/superpowers-packets.test.ts
git commit -m "feat: add packet artifact helpers and cleanup primitives"
```

## Task 4: Wire Packet Delivery And Cleanup Into The Executor And Pi Launch Path

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/execution/pi-args.ts`
- Modify: `src/execution/execution.ts`
- Modify: `src/execution/subagent-executor.ts`
- Modify: `test/unit/pi-args.test.ts`
- Modify: `test/integration/single-execution.test.ts`
- Modify: `test/integration/superpowers-packets.test.ts`

- [ ] **Step 1: Write the failing launch-path tests**

Add this to `test/unit/pi-args.test.ts`:

```ts
void it("passes packet task files through as direct @file arguments", () => {
	const { args } = buildPiArgs({
		baseArgs: ["-p"],
		task: "unused direct string",
		taskFilePath: "/tmp/packets/run_0_sp-implementer_packet.md",
		sessionEnabled: true,
	});

	assert.ok(args.includes("@/tmp/packets/run_0_sp-implementer_packet.md"));
	assert.ok(!args.includes("Task: unused direct string"));
});
```

In `test/integration/single-execution.test.ts`, add an assertion that a lineage-only launch records `result.sessionMode === "lineage-only"` and that the packet file is removed after the run completes.

- [ ] **Step 2: Run the failing launch-path tests**

Run:

```bash
npm run test:unit -- test/unit/pi-args.test.ts
npm run test:integration -- test/integration/single-execution.test.ts test/integration/superpowers-packets.test.ts
```

Expected: FAIL because `taskFilePath`, `sessionMode`, and runtime packet cleanup are not implemented.

- [ ] **Step 3: Extend the runtime option types**

In `src/shared/types.ts`, add:

```ts
export interface RunSyncOptions {
	cwd?: string;
	signal?: AbortSignal;
	onUpdate?: (r: import("@mariozechner/pi-agent-core").AgentToolResult<Details>) => void;
	maxOutput?: MaxOutputConfig;
	artifactsDir?: string;
	artifactConfig?: ArtifactConfig;
	runId: string;
	index?: number;
	sessionFile?: string;
	sessionMode?: SessionMode;
	taskDelivery?: TaskDeliveryMode;
	taskFilePath?: string;
	maxSubagentDepth?: number;
	modelOverride?: string;
	skills?: string[] | false;
	config?: ExtensionConfig;
	workflow?: WorkflowMode;
	useTestDrivenDevelopment?: boolean;
}
```

Also add `sessionMode?: SessionMode` to `SingleResult`.

- [x] **Step 4: Teach `buildPiArgs()` to use packet files directly**

In `src/execution/pi-args.ts`, add the new input field and prefer it before the long-task temp-file branch:

```ts
export interface BuildPiArgsInput {
	baseArgs: string[];
	task: string;
	taskFilePath?: string;
	sessionEnabled: boolean;
	sessionFile?: string;
	model?: string;
	thinking?: string;
	tools?: string[];
	extensions?: string[];
	skills?: string[];
	systemPrompt?: string | null;
	mcpDirectTools?: string[];
	promptFileStem?: string;
}
```

```ts
	if (input.taskFilePath) {
		args.push(`@${input.taskFilePath}`);
	} else if (input.task.length > TASK_ARG_LIMIT) {
		if (!tempDir) {
			tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-"));
		}
		const taskFilePath = path.join(tempDir, "task.md");
		fs.writeFileSync(taskFilePath, `Task: ${input.task}`, { mode: 0o600 });
		args.push(`@${taskFilePath}`);
	} else {
		args.push(`Task: ${input.task}`);
	}
```

- [x] **Step 5: Record the effective mode on each child result**

In `src/execution/execution.ts`, thread the new values through:

```ts
	const {
		cwd,
		signal,
		onUpdate,
		maxOutput,
		artifactsDir,
		artifactConfig,
		runId,
		index,
		modelOverride,
		sessionMode,
		taskDelivery,
		taskFilePath,
	} = options;
```

```ts
	const result: SingleResult = {
		agent: agentName,
		task,
		exitCode: 0,
		messages: [],
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
		model: modelArg,
		skills: resolvedSkillNames,
		skillsWarning,
		sessionMode,
	};
```

And pass `taskFilePath` into `buildPiArgs()`.

- [x] **Step 6: Create packets in the executor and delete them in `finally`**

In `src/execution/subagent-executor.ts`, add a helper shaped like this:

```ts
interface PreparedLaunch {
	sessionMode: SessionMode;
	taskDelivery: TaskDeliveryMode;
	sessionFile?: string;
	taskText: string;
	taskFilePath?: string;
	packetFile?: string;
	cleanup(): void;
}
```

Implementation requirements:

```ts
const sessionMode = resolveRequestedSessionMode({
	sessionMode: params.sessionMode,
	context: params.context,
	agentSessionMode: agentConfig.sessionMode,
	defaultSessionMode: "standalone",
});
const taskDelivery = resolveTaskDeliveryMode(sessionMode);
```

For `fork`:

```ts
return {
	sessionMode,
	taskDelivery,
	sessionFile: sessionResolver.sessionFileForIndex(index),
	taskText: wrapForkTask(rawTask),
	cleanup() {},
};
```

For `lineage-only` and `standalone`:

```ts
const packetFile = getPacketPath(artifactsDir, runId, agentConfig.name, index);
ensureArtifactsDir(path.dirname(packetFile));
writeArtifact(
	packetFile,
	buildSuperpowersPacketContent({
		agent: agentConfig.name,
		sessionMode,
		task: rawTask,
		useTestDrivenDevelopment,
	}),
);
return {
	sessionMode,
	taskDelivery,
	sessionFile: sessionResolver.sessionFileForIndex(index),
	taskText: rawTask,
	taskFilePath: packetFile,
	packetFile,
	cleanup() {
		removeArtifactFile(packetFile);
	},
};
```

Wrap every `runSync()` call in:

```ts
const prepared = prepareLaunch({
	agentConfig,
	rawTask: task,
	params,
	ctx,
	artifactsDir,
	runId,
	index: 0,
	sessionResolver,
	useTestDrivenDevelopment,
});

try {
	return await runSync(runtimeCwd, agents, params.agent!, prepared.taskText, {
		cwd: params.cwd,
		signal,
		runId,
		index: 0,
		sessionFile: prepared.sessionFile,
		sessionMode: prepared.sessionMode,
		taskDelivery: prepared.taskDelivery,
		taskFilePath: prepared.taskFilePath,
		artifactsDir: artifactConfig.enabled ? artifactsDir : undefined,
		artifactConfig,
		maxOutput: params.maxOutput,
		maxSubagentDepth,
		onUpdate,
		modelOverride,
		skills: effectiveSkills,
		config,
		workflow,
		useTestDrivenDevelopment,
	});
} finally {
	prepared.cleanup();
}
```

- [ ] **Step 7: Re-run the executor and launch tests**

Run:

```bash
npm run test:unit -- test/unit/pi-args.test.ts
npm run test:integration -- test/integration/single-execution.test.ts test/integration/superpowers-packets.test.ts test/integration/fork-context-execution.test.ts
```

Expected: PASS, including packet-file CLI usage, lineage-only session seeding, packet deletion on completion, and preserved fork behavior.

- [ ] **Step 8: Commit the integrated runtime path**

```bash
git add src/shared/types.ts src/execution/pi-args.ts src/execution/execution.ts src/execution/subagent-executor.ts test/unit/pi-args.test.ts test/integration/single-execution.test.ts test/integration/superpowers-packets.test.ts test/integration/fork-context-execution.test.ts
git commit -m "feat: deliver lineage-only tasks through managed packet artifacts"
```

## Task 5: Update Prompt Metadata, Renderer Behavior, And User Documentation

**Files:**
- Modify: `src/superpowers/root-prompt.ts`
- Modify: `src/ui/subagent-result-lines.ts`
- Modify: `test/unit/superpowers-root-prompt.test.ts`
- Modify: `test/unit/subagent-result-lines.test.ts`
- Modify: `test/integration/render-fork-badge.test.ts`
- Modify: `README.md`
- Modify: `docs/configuration.md`
- Modify: `docs/worktrees.md`
- Modify: `docs/parameters.md`
- Modify: `docs/skills.md`
- Modify: `CHANGELOG.md`

- [x] **Step 1: Write the failing prompt and renderer tests**

Update `test/unit/superpowers-root-prompt.test.ts` so it expects:

```ts
assert.match(prompt, /sessionMode: fork/);
assert.match(summary, /sessionMode: fork/);
assert.match(summary, /sessionMode: lineage-only/);
assert.doesNotMatch(summary, /context: fresh/);
```

Update `test/unit/subagent-result-lines.test.ts` and `test/integration/render-fork-badge.test.ts` to populate `sessionMode: "fork"` on the result/details fixture and keep the `[fork]` badge expectation.

- [x] **Step 2: Run the failing prompt and renderer tests**

Run:

```bash
npm run test:unit -- test/unit/superpowers-root-prompt.test.ts test/unit/subagent-result-lines.test.ts
npm run test:integration -- test/integration/render-fork-badge.test.ts
```

Expected: FAIL because prompt metadata still emits `context: fresh|fork` and the renderer still keys only off `details.context`.

- [x] **Step 3: Switch prompt metadata to `sessionMode` wording**

In `src/superpowers/root-prompt.ts`, replace:

```ts
	if (input.fork) lines.push('context: "fork"');
```

with:

```ts
	lines.push(`sessionMode: ${input.fork ? "fork" : "lineage-only"}`);
```

And replace:

```ts
	configLines.push(`context: ${input.fork ? "fork" : "fresh"}`);
```

with:

```ts
	configLines.push(`sessionMode: ${input.fork ? "fork" : "lineage-only"}`);
```

- [x] **Step 4: Keep the fork badge but derive it from the new result field**

In `src/ui/subagent-result-lines.ts`, replace:

```ts
	const prefix = details?.context === "fork" ? "[fork] " : "";
```

with:

```ts
	const prefix = details?.sessionMode === "fork" || details?.context === "fork" ? "[fork] " : "";
```

And replace:

```ts
		contextLabel: details.context === "fork" ? " [fork]" : "",
```

with:

```ts
		contextLabel: details.sessionMode === "fork" || details.context === "fork" ? " [fork]" : "",
```

- [x] **Step 5: Update the required user documentation**

Apply these documentation changes:

`README.md`

```md
Bounded Superpowers roles now default to `session-mode: lineage-only`: child sessions stay linked to the parent for `/tree`, but they do not inherit parent conversation turns. Their work brief is delivered through a runtime-managed packet artifact under the session artifact directory and cleaned up automatically after the child exits.
```

`docs/parameters.md`

```md
| `sessionMode`     | `"standalone" \| "lineage-only" \| "fork"` | agent/default-derived | Launch mode for the child session. |
| `context`         | `"fresh" \| "fork"`                        | deprecated            | Compatibility alias for older callers. `fresh -> standalone`, `fork -> fork`. |
```

```md
`lineage-only` creates a linked child session with `parentSession` metadata but no inherited conversation turns. This is the default for bounded Superpowers roles.
```

```md
Packet artifacts are written under `<session-artifacts-dir>/packets/` while the child is running and are removed by runtime cleanup after completion, failure, or cancellation.
```

`docs/configuration.md`

```md
Agent frontmatter may declare `session-mode: standalone | lineage-only | fork`. Built-in bounded roles ship with `lineage-only`.
```

`docs/worktrees.md`

```md
Worktree isolation and session mode are separate concerns: packet handoff files live in the session artifact directory, not inside the worktree, and are cleaned up by the runtime.
```

`docs/skills.md`

```md
Skills should assume bounded Superpowers roles receive curated packet input, not inherited parent-session history, unless a run explicitly opts into `fork`.
```

Also add a concise release note to `CHANGELOG.md`.

- [x] **Step 6: Run the targeted prompt/UI tests and a docs sanity scan**

Run:

```bash
npm run test:unit -- test/unit/superpowers-root-prompt.test.ts test/unit/subagent-result-lines.test.ts
npm run test:integration -- test/integration/render-fork-badge.test.ts
rg -n "context: fresh|context: fork|task-brief\\.md|implementer-report\\.md" README.md docs src/agents
```

Expected: tests PASS, and the grep output should contain only intentional compatibility mentions or historical spec/plan files.

- [x] **Step 7: Commit the prompt, renderer, and documentation updates**

```bash
git add src/superpowers/root-prompt.ts src/ui/subagent-result-lines.ts test/unit/superpowers-root-prompt.test.ts test/unit/subagent-result-lines.test.ts test/integration/render-fork-badge.test.ts README.md docs/configuration.md docs/worktrees.md docs/parameters.md docs/skills.md CHANGELOG.md
git commit -m "docs: document session-mode lineage-only packet handoff"
```

## Task 6: Run Full Verification Before Declaring The Feature Complete

**Files:**
- Modify: none

- [x] **Step 1: Run the complete automated test suite**

```bash
npm run test:all
```

Expected: PASS across unit, integration, and e2e suites.

- [x] **Step 2: Run type and formatting validation**

```bash
npm run typecheck
npm run lint
```

Expected: PASS with no TypeScript or Biome errors.

- [x] **Step 3: Inspect the final diff for accidental regressions**

```bash
git diff --stat HEAD~5..HEAD
git diff -- src/execution src/shared src/superpowers agents README.md docs
```

Expected: session-mode, packet-lifecycle, and documentation changes only.

- [x] **Step 4: Create the final completion commit**

```bash
git add -A
git commit -m "feat: add lineage-only session mode and packet-backed subagent handoff"
```
