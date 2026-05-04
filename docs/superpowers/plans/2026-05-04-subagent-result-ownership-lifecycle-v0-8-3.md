# Subagent Result Ownership and Lifecycle v0.8.3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the subagent execution-planning, child-runner, result-delivery, and lifecycle-signal seams from `docs/superpowers/specs/2026-05-04-subagent-async-result-delivery-lifecycle-design.md` for v0.8.3 while preserving current synchronous single/parallel behavior.

**Architecture:** Keep `subagent` user-visible behavior synchronous and backwards-compatible. Extract planning and process execution into focused modules, add an internal deterministic result ownership store, add child lifecycle sidecar parsing/tools, then delete `src/execution/execution.ts` instead of leaving a second execution path.

**Tech Stack:** TypeScript ESM, Node built-in test runner (`node:test`), Pi extension `ToolDefinition`, existing `typebox` schemas, existing mock Pi CLI test harness.

---

## Context Map

### Files to Modify
| File | Purpose | Changes Needed |
|------|---------|----------------|
| `src/shared/types.ts` | Shared runtime contracts | Add child plan, child runner, completion envelope, delivery store, lifecycle signal, and lifecycle tool result types. Keep `SingleResult` additive/backwards-compatible. |
| `src/shared/tool-registry.ts` | Tool policy constants | Add child lifecycle tool names and ensure bounded roles can receive `subagent_done`/`caller_ping` without receiving delegation tools. |
| `src/execution/execution-planner.ts` | New planning module | Create prepared child plans from validated executor inputs; own launch preparation, packet creation, session metadata, role policy, model/skill/tool resolution, cwd/worktree mapping fields. |
| `src/execution/child-runner.ts` | New process runner module | Move real `runSync()` implementation here as `runChild()`/`runPreparedChild()`; consume prepared plans; build args, spawn Pi, parse JSONL, handle progress/artifacts/abort, inspect lifecycle sidecars. |
| `src/execution/result-delivery.ts` | New ownership module | Register records, wait, join, detach, delivered-once enforcement, completion envelope derivation, stable errors. |
| `src/execution/lifecycle-signals.ts` | New sidecar module | Atomic sidecar write helper, sidecar path resolution, parser, consume/remove semantics, malformed/stale/missing fallback outcomes. |
| `src/execution/subagent-executor.ts` | Orchestration facade | Replace inline `prepareLaunch()` and direct `runSync()` calls with planner + result store + child runner + join; preserve output formatting. |
| `src/execution/execution.ts` | Legacy runner | Remove after callers/tests migrate to `child-runner.ts`; do not keep a permanent shim. |
| `src/extension/index.ts` | Tool registration | Register child lifecycle tools `subagent_done` and `caller_ping`; wire them to lifecycle sidecar writers. |
| `src/shared/schemas.ts` | Tool schemas | Add internal child lifecycle tool parameter schemas if colocated there; do not add `async` or `blocking` to `SubagentParams`. |
| `src/ui/render.ts`, `src/ui/subagent-result-lines.ts`, `src/ui/subagents-status.ts` | Result/status rendering | Preserve existing rendering; optionally surface `needs_parent` and envelope summary additively. |
| `README.md` | User docs | Document internal lifecycle/ownership capability and no user-facing async controls. |
| `docs/configuration.md` | Config docs | Document that no async config/frontmatter key exists and lifecycle tools are internal child tools. |
| `docs/parameters.md` | Tool parameter docs | Document unchanged `subagent` params, completion envelope metadata, wait/join/detach not exposed in v0.8.3 unless implemented. |
| `docs/worktrees.md` | Worktree docs | Reaffirm worktree-backed children are joined before cleanup. |
| `docs/skills.md` | Skills docs | Mention child lifecycle tools may be available to bounded roles for semantic completion/help requests. |
| `CHANGELOG.md` | Release notes | Add v0.8.3 compatibility entry. |
| `package.json` | Package version | Bump from `0.8.2` to `0.8.3`. |

### Dependencies (may need updates)
| File | Relationship |
|------|--------------|
| `src/execution/session-mode.ts` | Planner should call existing `createSessionLaunchResolver()`, `resolveRequestedSessionMode()`, and `resolveTaskDeliveryMode()`. |
| `src/execution/superpowers-policy.ts` | Planner/runner should use existing role model/tool/skill policy; may need lifecycle tool allowlist adjustment. |
| `src/execution/superpowers-packets.ts` | Planner should call existing packet content/instruction helpers. |
| `src/execution/worktree.ts` | Planner/executor should preserve current parallel worktree setup/cwd mapping. |
| `src/execution/pi-args.ts` | Child runner should keep using `buildPiArgs()`, `applyThinkingSuffix()`, `cleanupTempDir()`. |
| `src/execution/pi-spawn.ts` | Child runner should keep using `getPiSpawnCommand()`. |
| `src/execution/jsonl-writer.ts` | Child runner should preserve JSONL writer behavior. |
| `src/execution/run-history.ts` | Child runner/subagent executor should preserve run-history writes. |
| `src/shared/artifacts.ts` | Planner and lifecycle signal tests rely on atomic file writing patterns and packet paths. |
| `src/shared/utils.ts` | Child runner should keep final output/error/progress utility behavior. |

### Test Files
| Test | Coverage |
|------|----------|
| `test/unit/execution-planner.test.ts` | Planning: single, parallel, packet/fork, session mode, model/skills/tools, no async/blocking. |
| `test/unit/result-delivery.test.ts` | Deterministic state machine: wait/join/detach, duplicate delivery, timeout release, failures, envelopes. |
| `test/unit/lifecycle-signals.test.ts` | Atomic sidecar write, parse/consume done/ping, malformed/unreadable/stale/missing fallback. |
| `test/unit/child-runner.test.ts` | Runner with mocked spawn/event streams where possible: JSONL reduction, abort, stderr, cleanup, lifecycle sidecar metadata. |
| `test/integration/single-execution.test.ts` | Migrate imports from `execution.ts` to `child-runner.ts`; existing single behavior must pass. |
| `test/integration/parallel-execution.test.ts` | Migrate imports and keep concurrent child execution behavior. |
| `test/integration/fork-context-execution.test.ts` | Preserve fork/lineage-only session behavior through planner. |
| `test/integration/superpowers-packets.test.ts` | Preserve packet handoff behavior through planner. |
| `test/integration/error-handling.test.ts`, `test/integration/detect-error.test.ts` | Preserve error mapping after runner extraction. |
| `test/unit/tool-registry.test.ts` or `test/unit/superpowers-policy.test.ts` | Verify lifecycle tools are not stripped from bounded role tool lists while delegation tools still are. |
| `test/unit/package-manifest.test.ts` | Version/files sanity after `execution.ts` deletion and package bump. |

### Reference Patterns
| File | Pattern |
|------|---------|
| `test/support/mock-pi.ts` | Atomic temp-file-then-rename queue writes. Reuse style for sidecar write tests. |
| `src/execution/subagent-executor.ts` | Existing launch preparation, packet cleanup, worktree aggregation, and result formatting to preserve. |
| `src/execution/execution.ts` | Source for child-runner extraction; delete after migration. |
| `src/execution/session-mode.ts` | Existing session resolver interface and tests. |
| `src/execution/worktree.ts` | Existing worktree lifecycle, cleanup, and output suffix behavior. |
| `/Users/thomas/Documents/Dev/pi-subagents_edxeth/src/subagents/*.ts` | Protocol reference only for result ownership/lifecycle semantics; do not port UI/mux/pane code. |

### Risk Assessment
- [x] Breaking changes to public API: avoid by keeping `subagent` params and current result shape backwards-compatible; new metadata must be additive.
- [ ] Database migrations needed: none.
- [x] Configuration changes required: none; explicitly do not add async/blocking config keys.
- [x] Filesystem race risk: sidecars must be atomic temp-file-then-rename and parent parser must tolerate malformed/unreadable sidecars.
- [x] Architecture drift risk: delete `src/execution/execution.ts` once `child-runner.ts` is active; no production caller may keep importing `runSync()`.

---

## Task 1: Add Shared Execution Contracts

**Files:**
- Modify: `src/shared/types.ts`
- Test: `test/unit/schemas.test.ts` only if type exports affect schema expectations; otherwise typecheck is enough for this task

- [x] **Step 1: Add completion, lifecycle, planning, and delivery types to `src/shared/types.ts`**

Add these exports near the existing `SingleResult`/execution option contracts. Do not remove any existing fields.

```ts
export type SubagentCompletionStatus = "completed" | "blocked" | "needs_parent" | "failed" | "cancelled";

export interface SubagentCompletionEnvelope {
	status: SubagentCompletionStatus;
	summary: string;
	body: string;
	parentRequest?: string;
	artifacts?: string[];
	notes?: Record<string, unknown>;
}

export type LifecycleSignalType = "done" | "ping";

export interface DoneLifecycleSignal {
	type: "done";
	outputTokens?: number;
}

export interface PingLifecycleSignal {
	type: "ping";
	name?: string;
	message: string;
	outputTokens?: number;
}

export type LifecycleSignal = DoneLifecycleSignal | PingLifecycleSignal;

export type LifecycleReadStatus = "consumed" | "missing" | "malformed" | "unreadable" | "stale";

export interface LifecycleReadResult {
	status: LifecycleReadStatus;
	signal?: LifecycleSignal;
	path: string;
	diagnostic?: string;
}

export interface PlannedChildRun {
	id: string;
	index: number;
	agentName: string;
	task: string;
	runtimeCwd: string;
	childCwd: string;
	workflow: WorkflowMode;
	sessionMode: SessionMode;
	taskDelivery: TaskDeliveryMode;
	sessionFile?: string;
	taskText: string;
	taskFilePath?: string;
	packetFile?: string;
	modelOverride?: string;
	skills?: string[] | false;
	useTestDrivenDevelopment: boolean;
	maxSubagentDepth?: number;
	artifactsDir?: string;
	artifactConfig?: ArtifactConfig;
	maxOutput?: MaxOutputConfig;
	includeProgress: boolean;
	config: ExtensionConfig;
	cleanupLaunchArtifacts(): void;
}

export interface ChildRunResult extends SingleResult {
	completion?: SubagentCompletionEnvelope;
	lifecycle?: LifecycleReadResult;
}

export type DeliveryState = "detached" | "awaited" | "joined";
export type CompletedDelivery = "steer" | "wait" | "join";

export type ResultDeliveryErrorCode =
	| "not_found"
	| "already_delivered"
	| "already_owned"
	| "not_owned"
	| "duplicate_id"
	| "empty_id_list"
	| "timeout"
	| "interrupted";

export interface ResultDeliveryError {
	code: ResultDeliveryErrorCode;
	message: string;
	ids?: string[];
}
```

- [x] **Step 2: Extend `SingleResult` additively**

Add optional fields only. Existing callers must continue compiling.

```ts
export interface SingleResult {
	agent: string;
	task: string;
	exitCode: number;
	sessionMode?: SessionMode;
	messages: Message[];
	usage: Usage;
	model?: string;
	error?: string;
	sessionFile?: string;
	skills?: string[];
	skillsWarning?: string;
	progress?: AgentProgress;
	progressSummary?: ProgressSummary;
	artifactPaths?: ArtifactPaths;
	truncation?: TruncationResult;
	finalOutput?: string;
	completion?: SubagentCompletionEnvelope;
	lifecycle?: LifecycleReadResult;
}
```

- [x] **Step 3: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS. If this fails because the interface was duplicated instead of edited in place, merge the optional fields into the existing `SingleResult` declaration.

- [x] **Step 4: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add subagent lifecycle and delivery contracts"
```

---

## Task 2: Implement Lifecycle Sidecar Parsing and Atomic Writes

**Files:**
- Create: `src/execution/lifecycle-signals.ts`
- Create: `test/unit/lifecycle-signals.test.ts`

- [x] **Step 1: Write failing lifecycle signal tests**

Create `test/unit/lifecycle-signals.test.ts`:

```ts
/**
 * Unit tests for subagent lifecycle sidecar signal handling.
 *
 * Responsibilities:
 * - verify child `.exit` sidecars are written atomically
 * - verify parent-side parse/consume behavior for done and ping signals
 * - verify malformed, unreadable, stale, and missing sidecars never crash callers
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
	consumeLifecycleSignal,
	getLifecycleSidecarPath,
	writeLifecycleSignalAtomic,
} from "../../src/execution/lifecycle-signals.ts";

const tempDirs: string[] = [];

function tempSessionFile(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-superagents-life-"));
	tempDirs.push(dir);
	return path.join(dir, "child.jsonl");
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

void describe("lifecycle sidecar signals", () => {
	void it("writes done sidecars atomically and consumes them", () => {
		const sessionFile = tempSessionFile();
		writeLifecycleSignalAtomic(sessionFile, { type: "done", outputTokens: 42 });

		const sidecar = getLifecycleSidecarPath(sessionFile);
		assert.equal(fs.existsSync(sidecar), true);
		assert.equal(fs.readdirSync(path.dirname(sidecar)).some((name) => name.includes(".tmp-")), false);

		const result = consumeLifecycleSignal(sessionFile);
		assert.equal(result.status, "consumed");
		assert.deepEqual(result.signal, { type: "done", outputTokens: 42 });
		assert.equal(fs.existsSync(sidecar), false);
	});

	void it("writes ping sidecars atomically and consumes parent request text", () => {
		const sessionFile = tempSessionFile();
		writeLifecycleSignalAtomic(sessionFile, { type: "ping", name: "sp-research", message: "Need module name", outputTokens: 7 });

		const result = consumeLifecycleSignal(sessionFile);
		assert.equal(result.status, "consumed");
		assert.deepEqual(result.signal, { type: "ping", name: "sp-research", message: "Need module name", outputTokens: 7 });
	});

	void it("returns missing for absent sidecars", () => {
		const sessionFile = tempSessionFile();
		const result = consumeLifecycleSignal(sessionFile);
		assert.equal(result.status, "missing");
		assert.match(result.path, /child\.jsonl\.exit$/);
	});

	void it("returns malformed and removes invalid sidecars", () => {
		const sessionFile = tempSessionFile();
		const sidecar = getLifecycleSidecarPath(sessionFile);
		fs.writeFileSync(sidecar, "{ not json", "utf-8");

		const result = consumeLifecycleSignal(sessionFile);
		assert.equal(result.status, "malformed");
		assert.match(result.diagnostic ?? "", /JSON|Unexpected|malformed/i);
		assert.equal(fs.existsSync(sidecar), false);
	});

	void it("returns stale and removes sidecars older than max age", () => {
		const sessionFile = tempSessionFile();
		const sidecar = getLifecycleSidecarPath(sessionFile);
		fs.writeFileSync(sidecar, JSON.stringify({ type: "done" }), "utf-8");
		const old = new Date(Date.now() - 60_000);
		fs.utimesSync(sidecar, old, old);

		const result = consumeLifecycleSignal(sessionFile, { maxAgeMs: 1 });
		assert.equal(result.status, "stale");
		assert.equal(fs.existsSync(sidecar), false);
	});
});
```

- [x] **Step 2: Run lifecycle tests and verify failure**

Run:

```bash
node --experimental-strip-types --test test/unit/lifecycle-signals.test.ts
```

Expected: FAIL with module-not-found for `src/execution/lifecycle-signals.ts`.

- [x] **Step 3: Implement `src/execution/lifecycle-signals.ts`**

```ts
/**
 * Lifecycle sidecar helpers for child subagent processes.
 *
 * Responsibilities:
 * - derive `.exit` sidecar paths from child session files
 * - write child lifecycle signals atomically via temp-file-then-rename
 * - parse and consume parent-visible lifecycle sidecars without crashing execution
 *
 * Important dependencies and side effects:
 * - uses synchronous filesystem operations because lifecycle writes happen during tool shutdown
 * - removes consumed, malformed, and stale sidecars on a best-effort basis
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { LifecycleReadResult, LifecycleSignal } from "../shared/types.ts";

export interface ConsumeLifecycleSignalOptions {
	maxAgeMs?: number;
	removeMalformed?: boolean;
}

/**
 * Return the lifecycle sidecar path for a child session file.
 *
 * @param sessionFile Child Pi session JSONL path.
 * @returns Sidecar path with `.exit` suffix.
 */
export function getLifecycleSidecarPath(sessionFile: string): string {
	return `${sessionFile}.exit`;
}

/**
 * Validate unknown JSON as a supported lifecycle signal.
 *
 * @param value Parsed JSON value from the sidecar.
 * @returns Lifecycle signal when valid, otherwise `undefined`.
 */
function normalizeLifecycleSignal(value: unknown): LifecycleSignal | undefined {
	if (!value || typeof value !== "object") return undefined;
	const candidate = value as Record<string, unknown>;
	const outputTokens = typeof candidate.outputTokens === "number" && Number.isFinite(candidate.outputTokens) ? candidate.outputTokens : undefined;
	if (candidate.type === "done") return outputTokens === undefined ? { type: "done" } : { type: "done", outputTokens };
	if (candidate.type === "ping" && typeof candidate.message === "string" && candidate.message.trim().length > 0) {
		return {
			type: "ping",
			message: candidate.message,
			...(typeof candidate.name === "string" ? { name: candidate.name } : {}),
			...(outputTokens === undefined ? {} : { outputTokens }),
		};
	}
	return undefined;
}

/**
 * Best-effort removal helper used after sidecar consumption/fallback.
 *
 * @param filePath Path to remove.
 */
function removeBestEffort(filePath: string): void {
	try {
		fs.rmSync(filePath, { force: true });
	} catch {
		// Ignore cleanup failures; callers receive the original parse result.
	}
}

/**
 * Write a lifecycle signal using atomic temp-file-then-rename semantics.
 *
 * @param sessionFile Child session JSONL file path.
 * @param signal Lifecycle signal payload to write.
 */
export function writeLifecycleSignalAtomic(sessionFile: string, signal: LifecycleSignal): void {
	const sidecarPath = getLifecycleSidecarPath(sessionFile);
	fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
	const tempPath = `${sidecarPath}.tmp-${process.pid}-${randomUUID()}`;
	fs.writeFileSync(tempPath, JSON.stringify(signal), { encoding: "utf-8", mode: 0o600 });
	fs.renameSync(tempPath, sidecarPath);
}

/**
 * Consume and remove a lifecycle sidecar if one exists.
 *
 * @param sessionFile Child session JSONL file path.
 * @param options Parser behavior options, including stale max age.
 * @returns Controlled read result; never throws for expected filesystem races.
 */
export function consumeLifecycleSignal(sessionFile: string | undefined, options: ConsumeLifecycleSignalOptions = {}): LifecycleReadResult {
	const sidecarPath = getLifecycleSidecarPath(sessionFile ?? "");
	if (!sessionFile) return { status: "missing", path: sidecarPath, diagnostic: "No child session file was available." };
	if (!fs.existsSync(sidecarPath)) return { status: "missing", path: sidecarPath };

	try {
		const stat = fs.statSync(sidecarPath);
		if (options.maxAgeMs !== undefined && Date.now() - stat.mtimeMs > options.maxAgeMs) {
			removeBestEffort(sidecarPath);
			return { status: "stale", path: sidecarPath, diagnostic: `Lifecycle sidecar exceeded max age ${options.maxAgeMs}ms.` };
		}
	} catch (error) {
		return { status: "unreadable", path: sidecarPath, diagnostic: error instanceof Error ? error.message : String(error) };
	}

	let raw: string;
	try {
		raw = fs.readFileSync(sidecarPath, "utf-8");
	} catch (error) {
		return { status: "unreadable", path: sidecarPath, diagnostic: error instanceof Error ? error.message : String(error) };
	}

	try {
		const parsed = JSON.parse(raw) as unknown;
		const signal = normalizeLifecycleSignal(parsed);
		if (!signal) {
			removeBestEffort(sidecarPath);
			return { status: "malformed", path: sidecarPath, diagnostic: "Lifecycle sidecar has unsupported shape." };
		}
		removeBestEffort(sidecarPath);
		return { status: "consumed", path: sidecarPath, signal };
	} catch (error) {
		if (options.removeMalformed !== false) removeBestEffort(sidecarPath);
		return { status: "malformed", path: sidecarPath, diagnostic: error instanceof Error ? error.message : String(error) };
	}
}
```

- [x] **Step 4: Run lifecycle tests**

```bash
node --experimental-strip-types --test test/unit/lifecycle-signals.test.ts
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/execution/lifecycle-signals.ts test/unit/lifecycle-signals.test.ts
git commit -m "feat: add lifecycle sidecar signals"
```

---

## Task 3: Add Deterministic Result Delivery Store

**Files:**
- Create: `src/execution/result-delivery.ts`
- Create: `test/unit/result-delivery.test.ts`

- [x] **Step 1: Write failing deterministic state-machine tests**

Create `test/unit/result-delivery.test.ts`:

```ts
/**
 * Unit tests for subagent result ownership and delivery.
 *
 * Responsibilities:
 * - exercise wait/join/detach as a deterministic state machine
 * - prove completed results are delivered at most once
 * - avoid real child processes by using controlled completion promises
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChildRunResult } from "../../src/shared/types.ts";
import { createResultDeliveryStore, deriveCompletionEnvelope } from "../../src/execution/result-delivery.ts";

function result(agent = "sp-research", task = "Task", output = "Done"): ChildRunResult {
	return {
		agent,
		task,
		exitCode: 0,
		messages: [],
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
		finalOutput: output,
	};
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

void describe("result delivery store", () => {
	void it("waits for one running child and prevents duplicate delivery", async () => {
		const completion = deferred<ChildRunResult>();
		const store = createResultDeliveryStore();
		store.register({ id: "child-1", agent: "sp-research", task: "Inspect", completion: completion.promise });

		const waitPromise = store.wait("child-1");
		completion.resolve(result("sp-research", "Inspect", "Report"));
		const waited = await waitPromise;

		assert.equal("error" in waited, false);
		if ("error" in waited) return;
		assert.equal(waited.result.completion?.status, "completed");
		assert.equal(waited.result.completion?.body, "Report");

		const second = await store.wait("child-1");
		assert.deepEqual(second, { error: { code: "already_delivered", message: "Result for child-1 has already been delivered.", ids: ["child-1"] } });
	});

	void it("joins multiple children in requested order", async () => {
		const store = createResultDeliveryStore();
		store.register({ id: "a", agent: "sp-recon", task: "A", completion: Promise.resolve(result("sp-recon", "A", "A done")) });
		store.register({ id: "b", agent: "sp-debug", task: "B", completion: Promise.resolve(result("sp-debug", "B", "B done")) });

		const joined = await store.join(["b", "a"]);
		assert.equal("error" in joined, false);
		if ("error" in joined) return;
		assert.deepEqual(joined.results.map((item) => item.agent), ["sp-debug", "sp-recon"]);
		assert.equal((await store.wait("a") as any).error.code, "already_delivered");
	});

	void it("rejects duplicate and empty joins", async () => {
		const store = createResultDeliveryStore();
		assert.equal((await store.join([]) as any).error.code, "empty_id_list");
		assert.equal((await store.join(["x", "x"]) as any).error.code, "duplicate_id");
	});

	void it("rejects already owned records", async () => {
		const completion = deferred<ChildRunResult>();
		const store = createResultDeliveryStore();
		store.register({ id: "child-1", agent: "sp-research", task: "Inspect", completion: completion.promise });

		const waitPromise = store.wait("child-1");
		const second = await store.wait("child-1");
		assert.equal((second as any).error.code, "already_owned");

		completion.resolve(result());
		await waitPromise;
	});

	void it("detach releases ownership before completion", async () => {
		const completion = deferred<ChildRunResult>();
		const store = createResultDeliveryStore();
		store.register({ id: "child-1", agent: "sp-research", task: "Inspect", completion: completion.promise });

		const waitPromise = store.wait("child-1", { timeoutMs: 1 });
		const timedOut = await waitPromise;
		assert.equal((timedOut as any).error.code, "timeout");

		completion.resolve(result());
		const waited = await store.wait("child-1");
		assert.equal("error" in waited, false);
	});

	void it("derives needs_parent envelope from ping lifecycle", () => {
		const envelope = deriveCompletionEnvelope({
			...result("sp-research", "Inspect", "Partial notes"),
			lifecycle: { status: "consumed", path: "/tmp/session.exit", signal: { type: "ping", message: "Need target file" } },
		});
		assert.equal(envelope.status, "needs_parent");
		assert.equal(envelope.parentRequest, "Need target file");
		assert.equal(envelope.body, "Partial notes");
	});
});
```

- [x] **Step 2: Run tests and verify failure**

```bash
node --experimental-strip-types --test test/unit/result-delivery.test.ts
```

Expected: FAIL with module-not-found for `result-delivery.ts`.

- [x] **Step 3: Implement `src/execution/result-delivery.ts`**

```ts
/**
 * Result ownership store for subagent child runs.
 *
 * Responsibilities:
 * - register running child completion promises
 * - implement wait, join, and detach ownership semantics
 * - enforce delivered-once result retrieval
 * - derive thin completion envelopes without constraining child answer bodies
 *
 * Important dependencies and side effects:
 * - no child processes are spawned here; tests should use controlled promises
 * - state is in-memory and scoped to the current executor call/runtime instance
 */

import type {
	ChildRunResult,
	CompletedDelivery,
	DeliveryState,
	ResultDeliveryError,
	SubagentCompletionEnvelope,
} from "../shared/types.ts";
import { getSingleResultOutput } from "../shared/utils.ts";

export interface RegisterChildInput {
	id: string;
	agent: string;
	task: string;
	completion: Promise<ChildRunResult>;
}

export interface WaitOptions {
	timeoutMs?: number;
}

type WaitResult = { result: ChildRunResult } | { error: ResultDeliveryError };
type JoinResult = { results: ChildRunResult[] } | { error: ResultDeliveryError };
type DetachResult = { ok: true } | { error: ResultDeliveryError };

interface DeliveryRecord extends RegisterChildInput {
	state: DeliveryState;
	completed?: ChildRunResult;
	deliveredTo?: CompletedDelivery;
	ownerToken?: symbol;
}

/**
 * Build a stable delivery error object.
 *
 * @param code Machine-readable error code.
 * @param message Human-readable diagnostic.
 * @param ids Related child ids.
 * @returns Delivery error payload.
 */
function deliveryError(code: ResultDeliveryError["code"], message: string, ids?: string[]): { error: ResultDeliveryError } {
	return { error: { code, message, ...(ids ? { ids } : {}) } };
}

/**
 * Return a promise that rejects after `timeoutMs`.
 *
 * @param timeoutMs Timeout duration in milliseconds.
 * @returns Timeout promise.
 */
function timeoutPromise(timeoutMs: number): Promise<never> {
	return new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "timeout" })), timeoutMs));
}

/**
 * Derive a thin completion envelope from raw child output and lifecycle metadata.
 *
 * @param result Child run result.
 * @returns Completion envelope preserving flexible output in `body`.
 */
export function deriveCompletionEnvelope(result: ChildRunResult): SubagentCompletionEnvelope {
	const body = getSingleResultOutput(result);
	const lifecycleSignal = result.lifecycle?.status === "consumed" ? result.lifecycle.signal : undefined;
	if (lifecycleSignal?.type === "ping") {
		return {
			status: "needs_parent",
			summary: lifecycleSignal.message,
			body,
			parentRequest: lifecycleSignal.message,
			artifacts: result.artifactPaths ? Object.values(result.artifactPaths) : undefined,
		};
	}
	const status = result.exitCode === 0 ? "completed" : result.exitCode < 0 ? "cancelled" : "failed";
	const summary = body.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? (status === "completed" ? "Subagent completed." : result.error ?? "Subagent failed.");
	return {
		status,
		summary: summary.slice(0, 240),
		body,
		artifacts: result.artifactPaths ? Object.values(result.artifactPaths) : undefined,
		...(result.error ? { notes: { error: result.error } } : {}),
	};
}

/**
 * Attach a completion envelope to a result when one is not already present.
 *
 * @param result Raw child result.
 * @returns Child result with completion envelope.
 */
function withEnvelope(result: ChildRunResult): ChildRunResult {
	return result.completion ? result : { ...result, completion: deriveCompletionEnvelope(result) };
}

/**
 * Create an in-memory result delivery store.
 *
 * @returns Store operations for register, wait, join, detach, and inspect.
 */
export function createResultDeliveryStore() {
	const records = new Map<string, DeliveryRecord>();

	function getRecord(id: string): DeliveryRecord | { error: ResultDeliveryError } {
		const record = records.get(id);
		return record ?? deliveryError("not_found", `No child result found for ${id}.`, [id]).error;
	}

	async function awaitRecord(record: DeliveryRecord, ownerToken: symbol, deliveredTo: CompletedDelivery, options: WaitOptions = {}): Promise<WaitResult> {
		try {
			const raw = record.completed ?? (options.timeoutMs === undefined ? await record.completion : await Promise.race([record.completion, timeoutPromise(options.timeoutMs)]));
			if (record.ownerToken !== ownerToken) return deliveryError("not_owned", `Result for ${record.id} is no longer owned by this waiter.`, [record.id]);
			const completed = withEnvelope(raw);
			record.completed = completed;
			record.deliveredTo = deliveredTo;
			delete record.ownerToken;
			return { result: completed };
		} catch (error) {
			if ((error as { code?: string })?.code === "timeout") {
				if (record.ownerToken === ownerToken && !record.deliveredTo) {
					record.state = "detached";
					delete record.ownerToken;
				}
				return deliveryError("timeout", `Timed out waiting for ${record.id}.`, [record.id]);
			}
			const failed = withEnvelope({
				agent: record.agent,
				task: record.task,
				exitCode: 1,
				messages: [],
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
				error: error instanceof Error ? error.message : String(error),
			});
			record.completed = failed;
			record.deliveredTo = deliveredTo;
			delete record.ownerToken;
			return { result: failed };
		}
	}

	return {
		register(input: RegisterChildInput): void {
			if (records.has(input.id)) throw new Error(`Duplicate child id: ${input.id}`);
			records.set(input.id, { ...input, state: "detached" });
		},

		async wait(id: string, options: WaitOptions = {}): Promise<WaitResult> {
			const maybeRecord = getRecord(id);
			if ("code" in maybeRecord) return { error: maybeRecord };
			const record = maybeRecord;
			if (record.deliveredTo) return deliveryError("already_delivered", `Result for ${id} has already been delivered.`, [id]);
			if (record.state !== "detached") return deliveryError("already_owned", `Result for ${id} is already owned by ${record.state}.`, [id]);
			const ownerToken = Symbol(`wait:${id}`);
			record.state = "awaited";
			record.ownerToken = ownerToken;
			return awaitRecord(record, ownerToken, "wait", options);
		},

		async join(ids: string[], options: WaitOptions = {}): Promise<JoinResult> {
			if (ids.length === 0) return deliveryError("empty_id_list", "Join requires at least one child id.");
			if (new Set(ids).size !== ids.length) return deliveryError("duplicate_id", "Join child id list contains duplicates.", ids);
			const recordsToJoin: DeliveryRecord[] = [];
			for (const id of ids) {
				const maybeRecord = getRecord(id);
				if ("code" in maybeRecord) return { error: maybeRecord };
				if (maybeRecord.deliveredTo) return deliveryError("already_delivered", `Result for ${id} has already been delivered.`, [id]);
				if (maybeRecord.state !== "detached") return deliveryError("already_owned", `Result for ${id} is already owned by ${maybeRecord.state}.`, [id]);
				recordsToJoin.push(maybeRecord);
			}
			const ownerToken = Symbol(`join:${ids.join(",")}`);
			for (const record of recordsToJoin) {
				record.state = "joined";
				record.ownerToken = ownerToken;
			}
			const results: ChildRunResult[] = [];
			for (const record of recordsToJoin) {
				const waited = await awaitRecord(record, ownerToken, "join", options);
				if ("error" in waited) return waited;
				results.push(waited.result);
			}
			return { results };
		},

		detach(id: string): DetachResult {
			const maybeRecord = getRecord(id);
			if ("code" in maybeRecord) return { error: maybeRecord };
			if (maybeRecord.deliveredTo || maybeRecord.state === "detached") return deliveryError("not_owned", `Result for ${id} is not owned.`, [id]);
			maybeRecord.state = "detached";
			delete maybeRecord.ownerToken;
			return { ok: true };
		},

		inspect(id: string): DeliveryRecord | undefined {
			return records.get(id);
		},
	};
}
```

- [x] **Step 4: Run result-delivery tests**

```bash
node --experimental-strip-types --test test/unit/result-delivery.test.ts
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/execution/result-delivery.ts test/unit/result-delivery.test.ts
git commit -m "feat: add subagent result delivery store"
```

---

## Task 4: Extract Child Runner and Delete `execution.ts`

**Files:**
- Create: `src/execution/child-runner.ts`
- Delete: `src/execution/execution.ts`
- Modify: `test/integration/single-execution.test.ts`
- Modify: `test/integration/parallel-execution.test.ts`
- Modify: any test importing `./src/execution/execution.ts`

- [x] **Step 1: Find all legacy imports**

Run:

```bash
grep -R "execution/execution\.ts\|runSync" -n src test | cat
```

Expected current matches include `src/execution/subagent-executor.ts`, `test/integration/single-execution.test.ts`, and `test/integration/parallel-execution.test.ts`.

- [x] **Step 2: Create `src/execution/child-runner.ts` by moving the implementation**

Move the full contents of `src/execution/execution.ts` into `src/execution/child-runner.ts`, update the file header, and rename the public function from `runSync` to `runPreparedChild` initially accepting the same parameters. Keep a compatibility export inside `child-runner.ts` only for tests during this task:

```ts
/**
 * Child process runner for prepared subagent executions.
 *
 * Responsibilities:
 * - build Pi CLI arguments from resolved execution inputs
 * - spawn child Pi processes and parse JSONL event streams
 * - reduce child messages, usage, progress, artifacts, and errors into a result
 * - inspect lifecycle sidecars after process close
 *
 * Important dependencies and side effects:
 * - launches `pi` child processes
 * - writes optional artifacts and run-history records
 * - consumes `.exit` lifecycle sidecars when a session file is available
 */

// keep existing imports from execution.ts, then add:
import { consumeLifecycleSignal } from "./lifecycle-signals.ts";
import type { ChildRunResult } from "../shared/types.ts";

export async function runPreparedChild(runtimeCwd: string, agents: AgentConfig[], agentName: string, task: string, options: RunSyncOptions): Promise<ChildRunResult> {
	// body copied from old runSync()
}

export const runSync = runPreparedChild;
```

At the end of the function, before returning the result, consume the lifecycle sidecar additively:

```ts
const lifecycle = consumeLifecycleSignal(result.sessionFile ?? options.sessionFile);
if (lifecycle.status !== "missing") {
	result.lifecycle = lifecycle;
}
return result;
```

If the old function has multiple return points, introduce a small helper:

```ts
function attachLifecycle(result: ChildRunResult, sessionFile?: string): ChildRunResult {
	const lifecycle = consumeLifecycleSignal(result.sessionFile ?? sessionFile);
	return lifecycle.status === "missing" ? result : { ...result, lifecycle };
}
```

Use it for every successful process-close return. Unknown-agent and pre-spawn validation errors may return without lifecycle because no child session exists.

- [x] **Step 3: Update integration tests to import from `child-runner.ts`**

In `test/integration/single-execution.test.ts`, replace:

```ts
const execution = await tryImport<any>("./src/execution/execution.ts");
```

with:

```ts
const execution = await tryImport<any>("./src/execution/child-runner.ts");
```

Make the same replacement in `test/integration/parallel-execution.test.ts` and any other matching tests.

- [x] **Step 4: Update `subagent-executor.ts` import**

Replace:

```ts
import { runSync } from "./execution.ts";
```

with:

```ts
import { runPreparedChild } from "./child-runner.ts";
```

Temporarily replace call sites:

```ts
await runSync(runtimeCwd, agents, agentName, task, options)
```

with:

```ts
await runPreparedChild(runtimeCwd, agents, agentName, task, options)
```

- [x] **Step 5: Delete `src/execution/execution.ts`**

Run:

```bash
rm src/execution/execution.ts
```

Then verify no production caller imports it:

```bash
grep -R "execution/execution\.ts\|from \"\.\/execution\.ts\"\|from './execution\.ts'" -n src test || true
```

Expected: no output.

- [x] **Step 6: Run single and parallel integration tests**

```bash
npm run test:integration -- test/integration/single-execution.test.ts test/integration/parallel-execution.test.ts
```

If the script does not pass file args through on the current npm version, run:

```bash
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/single-execution.test.ts test/integration/parallel-execution.test.ts
```

Expected: PASS.

- [x] **Step 7: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS and no import errors for deleted `execution.ts`.

- [x] **Step 8: Commit**

```bash
git add src/execution/child-runner.ts src/execution/subagent-executor.ts test/integration/single-execution.test.ts test/integration/parallel-execution.test.ts
git rm src/execution/execution.ts
git commit -m "refactor: extract child runner and remove legacy execution module"
```

---

## Task 5: Add Execution Planner for Current Sync Baseline

**Files:**
- Create: `src/execution/execution-planner.ts`
- Create: `test/unit/execution-planner.test.ts`
- Modify: `src/execution/subagent-executor.ts`

- [x] **Step 1: Write planner tests for current behavior**

Create `test/unit/execution-planner.test.ts`:

```ts
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
import { makeAgent, makeAgentConfigs } from "../support/helpers.ts";
import { planChildRun } from "../../src/execution/execution-planner.ts";

const tempDirs: string[] = [];
function tempDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-superagents-plan-"));
	tempDirs.push(dir);
	return dir;
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
		assert.equal(fs.existsSync(plan.taskFilePath!), true);
		assert.match(fs.readFileSync(plan.taskFilePath!, "utf-8"), /Inspect auth/);
		plan.cleanupLaunchArtifacts();
		assert.equal(fs.existsSync(plan.taskFilePath!), false);
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
	});
});
```

- [x] **Step 2: Run planner tests and verify failure**

```bash
node --experimental-strip-types --test test/unit/execution-planner.test.ts
```

Expected: FAIL with module-not-found.

- [x] **Step 3: Implement `src/execution/execution-planner.ts`**

```ts
/**
 * Execution planning for subagent child runs.
 *
 * Responsibilities:
 * - turn validated executor inputs into prepared child run plans
 * - own task delivery decisions for fork/direct and packet/artifact modes
 * - create and clean packet artifacts for non-fork sessions
 * - carry runtime policy decisions to the child runner without spawning processes
 *
 * Important dependencies and side effects:
 * - writes temporary packet artifacts for non-fork launches
 * - does not spawn Pi child processes or own result delivery state
 */

import * as path from "node:path";
import type { AgentConfig } from "../agents/agents.ts";
import { ensureArtifactsDir, getPacketPath, removeArtifactFile, writeArtifact } from "../shared/artifacts.ts";
import type { ArtifactConfig, ExtensionConfig, MaxOutputConfig, PlannedChildRun, SessionMode, WorkflowMode } from "../shared/types.ts";
import { wrapForkTask } from "../shared/types.ts";
import { resolveTaskDeliveryMode } from "./session-mode.ts";
import { buildSuperpowersPacketContent } from "./superpowers-packets.ts";

export interface PlanChildRunInput {
	id: string;
	index: number;
	runtimeCwd: string;
	childCwd: string;
	agents: AgentConfig[];
	agentName: string;
	task: string;
	runId: string;
	artifactsDir: string;
	sessionMode: SessionMode;
	sessionFile?: string;
	workflow: WorkflowMode;
	modelOverride?: string;
	skills?: string[] | false;
	useTestDrivenDevelopment: boolean;
	includeProgress: boolean;
	config: ExtensionConfig;
	artifactConfig?: ArtifactConfig;
	maxOutput?: MaxOutputConfig;
	maxSubagentDepth?: number;
}

/**
 * Build a prepared child plan while preserving current synchronous launch semantics.
 *
 * @param input Validated child run planning input.
 * @returns Prepared child plan consumed by child-runner and result-delivery modules.
 * @throws When `agentName` does not exist in `agents`.
 */
export function planChildRun(input: PlanChildRunInput): PlannedChildRun {
	const agentConfig = input.agents.find((agent) => agent.name === input.agentName);
	if (!agentConfig) throw new Error(`Unknown agent: ${input.agentName}`);

	const taskDelivery = resolveTaskDeliveryMode(input.sessionMode);
	if (input.sessionMode === "fork") {
		return {
			id: input.id,
			index: input.index,
			agentName: input.agentName,
			task: input.task,
			runtimeCwd: input.runtimeCwd,
			childCwd: input.childCwd,
			workflow: input.workflow,
			sessionMode: input.sessionMode,
			taskDelivery,
			sessionFile: input.sessionFile,
			taskText: wrapForkTask(input.task),
			modelOverride: input.modelOverride,
			skills: input.skills,
			useTestDrivenDevelopment: input.useTestDrivenDevelopment,
			maxSubagentDepth: input.maxSubagentDepth,
			artifactsDir: input.artifactsDir,
			artifactConfig: input.artifactConfig,
			maxOutput: input.maxOutput,
			includeProgress: input.includeProgress,
			config: input.config,
			cleanupLaunchArtifacts() {},
		};
	}

	const packetFile = getPacketPath(input.artifactsDir, input.runId, input.agentName, input.index);
	ensureArtifactsDir(path.dirname(packetFile));
	writeArtifact(
		packetFile,
		buildSuperpowersPacketContent({
			agent: input.agentName,
			sessionMode: input.sessionMode,
			task: input.task,
			useTestDrivenDevelopment: input.useTestDrivenDevelopment,
		}),
	);

	return {
		id: input.id,
		index: input.index,
		agentName: input.agentName,
		task: input.task,
		runtimeCwd: input.runtimeCwd,
		childCwd: input.childCwd,
		workflow: input.workflow,
		sessionMode: input.sessionMode,
		taskDelivery,
		sessionFile: input.sessionFile,
		taskText: input.task,
		taskFilePath: packetFile,
		packetFile,
		modelOverride: input.modelOverride,
		skills: input.skills,
		useTestDrivenDevelopment: input.useTestDrivenDevelopment,
		maxSubagentDepth: input.maxSubagentDepth,
		artifactsDir: input.artifactsDir,
		artifactConfig: input.artifactConfig,
		maxOutput: input.maxOutput,
		includeProgress: input.includeProgress,
		config: input.config,
		cleanupLaunchArtifacts() {
			removeArtifactFile(packetFile);
		},
	};
}
```

- [x] **Step 4: Run planner tests**

```bash
node --experimental-strip-types --test test/unit/execution-planner.test.ts
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/execution/execution-planner.ts test/unit/execution-planner.test.ts
git commit -m "feat: add subagent execution planner"
```

---

## Task 6: Route Executor Through Planner, Child Runner, and Result Store

**Files:**
- Modify: `src/execution/subagent-executor.ts`
- Modify: `test/integration/single-execution.test.ts`
- Modify: `test/integration/parallel-execution.test.ts`
- Modify: `test/integration/fork-context-execution.test.ts`
- Modify: `test/integration/superpowers-packets.test.ts`

- [x] **Step 1: Replace inline `PreparedLaunch` and `prepareLaunch()` with planner calls**

In `src/execution/subagent-executor.ts`, delete the local `PreparedLaunch` interface and `prepareLaunch()` function. Add imports:

```ts
import { planChildRun } from "./execution-planner.ts";
import { createResultDeliveryStore } from "./result-delivery.ts";
import { runPreparedChild } from "./child-runner.ts";
```

Remove now-unused imports from `subagent-executor.ts`:

```ts
import * as path from "node:path";
import { getPacketPath, removeArtifactFile, writeArtifact } from "../shared/artifacts.ts";
import { wrapForkTask } from "../shared/types.ts";
import { resolveTaskDeliveryMode } from "./session-mode.ts";
import { buildSuperpowersPacketContent } from "./superpowers-packets.ts";
```

Keep `ensureArtifactsDir` and `getArtifactsDir` if still used for artifacts setup.

- [x] **Step 2: Update `runChild()` to consume a `PlannedChildRun`**

Refactor the existing shared child execution helper to this shape:

```ts
async function runPlannedChild(input: {
	plan: PlannedChildRun;
	agents: AgentConfig[];
	signal: AbortSignal;
	onUpdate?: (r: AgentToolResult<Details>) => void;
	runId: string;
}): Promise<ChildRunResult> {
	try {
		return await runPreparedChild(input.plan.runtimeCwd, input.agents, input.plan.agentName, input.plan.taskText, {
			cwd: input.plan.childCwd,
			signal: input.signal,
			onUpdate: input.onUpdate,
			maxOutput: input.plan.maxOutput,
			artifactsDir: input.plan.artifactsDir,
			artifactConfig: input.plan.artifactConfig,
			runId: input.runId,
			index: input.plan.index,
			sessionFile: input.plan.sessionFile,
			sessionMode: input.plan.sessionMode,
			taskDelivery: input.plan.taskDelivery,
			taskFilePath: input.plan.taskFilePath,
			maxSubagentDepth: input.plan.maxSubagentDepth,
			modelOverride: input.plan.modelOverride,
			skills: input.plan.skills,
			config: input.plan.config,
			workflow: input.plan.workflow,
			useTestDrivenDevelopment: input.plan.useTestDrivenDevelopment,
		});
	} finally {
		input.plan.cleanupLaunchArtifacts();
	}
}
```

- [x] **Step 3: Register and join one child for single execution**

In the single path, after validation/session resolution, create a store and plan:

```ts
const deliveryStore = createResultDeliveryStore();
const childId = `${runId}:0:${agentName}`;
const plan = planChildRun({
	id: childId,
	index: 0,
	runtimeCwd,
	childCwd,
	agents,
	agentName,
	task: preparedTaskTextBeforePacketInjection,
	runId,
	artifactsDir,
	sessionMode,
	sessionFile,
	workflow,
	modelOverride: params.model,
	skills: normalizedSkills,
	useTestDrivenDevelopment,
	includeProgress: params.includeProgress === true,
	config,
	artifactConfig,
	maxOutput: params.maxOutput,
	maxSubagentDepth,
});

deliveryStore.register({
	id: childId,
	agent: agentName,
	task: plan.task,
	completion: runPlannedChild({ plan, agents, signal, onUpdate, runId }),
});
const joined = await deliveryStore.join([childId]);
if ("error" in joined) return toExecutionErrorResult(joined.error.message);
const result = joined.results[0];
```

Use the executor's actual variable names; the key invariant is `single -> register -> run -> join one -> return`.

- [x] **Step 4: Register and join all children for parallel execution**

In the parallel path, create all plans before launch, respecting current worktree cwd mapping. Register each completion with the result store, then join in task order:

```ts
const deliveryStore = createResultDeliveryStore();
const plans = expandedTasks.map((task, index) => planChildRun({
	id: `${runId}:${index}:${task.agent}`,
	index,
	runtimeCwd: resolveParallelTaskRuntimeCwd(...),
	childCwd: resolveParallelTaskCwd(...),
	agents,
	agentName: task.agent,
	task: task.task,
	runId,
	artifactsDir,
	sessionMode,
	sessionFile: sessionFileForIndex({ index, childCwd, sessionMode }),
	workflow,
	modelOverride: task.model,
	skills: normalizeSkillInput(task.skill),
	useTestDrivenDevelopment,
	includeProgress: params.includeProgress === true,
	config,
	artifactConfig,
	maxOutput: params.maxOutput,
	maxSubagentDepth,
}));

for (const plan of plans) {
	deliveryStore.register({
		id: plan.id,
		agent: plan.agentName,
		task: plan.task,
		completion: runPlannedChild({ plan, agents, signal, onUpdate, runId }),
	});
}
const joined = await deliveryStore.join(plans.map((plan) => plan.id));
```

If current code relies on `mapConcurrent()` to limit child process concurrency, keep it: register completion promises produced by `mapConcurrent(plans, MAX_CONCURRENCY, ...)` or stage registration immediately before each launch. Do not increase concurrency beyond `MAX_CONCURRENCY`.

- [x] **Step 5: Preserve response formatting and progress details**

Keep existing calls to:

```ts
aggregateParallelOutputs(...)
withSingleResultSessionMode(...)
withProgressResultSessionMode(...)
withSessionModeDetails(...)
```

Only change their input source from direct `runSync()` results to joined `ChildRunResult`s.

- [x] **Step 6: Run integration regression tests**

```bash
node --experimental-transform-types --import ./test/support/register-loader.mjs --test \
  test/integration/single-execution.test.ts \
  test/integration/parallel-execution.test.ts \
  test/integration/fork-context-execution.test.ts \
  test/integration/superpowers-packets.test.ts \
  test/integration/error-handling.test.ts \
  test/integration/detect-error.test.ts
```

Expected: PASS. Single/parallel output text should remain unchanged except for additive `completion`/`lifecycle` fields in details.

- [x] **Step 7: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add src/execution/subagent-executor.ts test/integration/single-execution.test.ts test/integration/parallel-execution.test.ts test/integration/fork-context-execution.test.ts test/integration/superpowers-packets.test.ts
git commit -m "refactor: route executor through planning and result delivery"
```

---

## Task 7: Register Child Lifecycle Tools

**Files:**
- Modify: `src/shared/tool-registry.ts`
- Modify: `src/execution/superpowers-policy.ts`
- Modify: `src/extension/index.ts`
- Create or Modify: `test/unit/tool-registry.test.ts`
- Modify: `test/unit/superpowers-policy.test.ts`

- [x] **Step 1: Add lifecycle tool constants and policy tests**

In `src/shared/tool-registry.ts`, add:

```ts
/** Tool names that child subagents may use to report semantic lifecycle state. */
export const CHILD_LIFECYCLE_TOOLS: ReadonlySet<string> = Object.freeze(new Set(["subagent_done", "caller_ping"]));
```

Update `resolveRoleTools()` tests in `test/unit/superpowers-policy.test.ts` to assert lifecycle tools survive for bounded agents:

```ts
void it("keeps child lifecycle tools while stripping delegation tools", () => {
	const tools = resolveRoleTools({
		workflow: "superpowers",
		role: "sp-research",
		agentTools: ["read", "subagent", "subagent_done", "caller_ping"],
	});
	assert.deepEqual(tools, ["read", "subagent_done", "caller_ping"]);
});
```

- [x] **Step 2: Run policy test and verify failure if lifecycle tools are stripped**

```bash
node --experimental-strip-types --test test/unit/superpowers-policy.test.ts
```

Expected: FAIL if current filtering strips one of the lifecycle tools or if the test is not yet compiled.

- [x] **Step 3: Update delegation stripping only if needed**

Keep `DELEGATION_TOOLS` limited to delegation/status tools. Do not add lifecycle tools to `DELEGATION_TOOLS`.

```ts
export const DELEGATION_TOOLS: ReadonlySet<string> = Object.freeze(new Set(["subagent", "subagent_status"]));
export const CHILD_LIFECYCLE_TOOLS: ReadonlySet<string> = Object.freeze(new Set(["subagent_done", "caller_ping"]));
```

If bounded roles with no explicit tools should receive lifecycle tools by default, change the fallback in `superpowers-policy.ts`:

```ts
return [...READ_ONLY_TOOLS, ...CHILD_LIFECYCLE_TOOLS];
```

and import:

```ts
import { CHILD_LIFECYCLE_TOOLS, DELEGATION_TOOLS, READ_ONLY_TOOLS } from "../shared/tool-registry.ts";
```

- [x] **Step 4: Add tool schemas and registration in `src/extension/index.ts`**

Add parameter schemas near the review schemas:

```ts
const SubagentDoneParams = Type.Object({
	outputTokens: Type.Optional(Type.Number({ description: "Optional output-token count reported by the child runtime." })),
});

const CallerPingParams = Type.Object({
	message: Type.String({ description: "Concise question or blocked-state message for the parent agent." }),
	outputTokens: Type.Optional(Type.Number({ description: "Optional output-token count reported by the child runtime." })),
});
```

Add imports:

```ts
import { writeLifecycleSignalAtomic } from "../execution/lifecycle-signals.ts";
```

Add helper:

```ts
function getRequiredChildSessionFile(): string {
	const sessionFile = process.env.PI_SUBAGENT_SESSION;
	if (!sessionFile) throw new Error("PI_SUBAGENT_SESSION is not set; lifecycle tools only work inside parent-launched subagents.");
	return sessionFile;
}
```

Register tools before `subagent`:

```ts
const subagentDoneTool: ToolDefinition<typeof SubagentDoneParams, Details> = {
	name: "subagent_done",
	label: "Subagent Done",
	description: "Child-only lifecycle tool. Records intentional subagent completion and exits the child run into normal process shutdown.",
	parameters: SubagentDoneParams,
	execute(_id, params) {
		writeLifecycleSignalAtomic(getRequiredChildSessionFile(), {
			type: "done",
			...(typeof params.outputTokens === "number" ? { outputTokens: params.outputTokens } : {}),
		});
		return Promise.resolve(createTextToolResult("Subagent completion signal recorded. Finish your final response now."));
	},
};

const callerPingTool: ToolDefinition<typeof CallerPingParams, Details> = {
	name: "caller_ping",
	label: "Caller Ping",
	description: "Child-only lifecycle tool. Asks the parent for clarification and records a needs_parent sidecar.",
	parameters: CallerPingParams,
	execute(_id, params) {
		writeLifecycleSignalAtomic(getRequiredChildSessionFile(), {
			type: "ping",
			name: process.env.PI_SUBAGENT_NAME ?? process.env.PI_SUBAGENT_AGENT,
			message: params.message,
			...(typeof params.outputTokens === "number" ? { outputTokens: params.outputTokens } : {}),
		});
		return Promise.resolve(createTextToolResult(`Parent help requested: ${params.message}`));
	},
};

pi.registerTool(subagentDoneTool);
pi.registerTool(callerPingTool);
```

Do not make these tools visible as async launch controls. They are child lifecycle tools.

- [x] **Step 5: Pass lifecycle env vars from child runner**

In `src/execution/child-runner.ts`, when constructing the spawn environment, add:

```ts
const lifecycleEnv = options.sessionFile
	? {
			PI_SUBAGENT_SESSION: options.sessionFile,
			PI_SUBAGENT_NAME: agent.name,
			PI_SUBAGENT_AGENT: agent.name,
			PI_SUBAGENT_AUTO_EXIT: "0",
		}
	: {};
```

Merge `lifecycleEnv` into the child process env after the existing shared env:

```ts
env: {
	...process.env,
	...sharedEnv,
	...lifecycleEnv,
	PI_SUBAGENT_DEPTH: String(getSubagentDepthEnv().current + 1),
	PI_SUBAGENT_MAX_DEPTH: String(options.maxSubagentDepth ?? getSubagentDepthEnv().max),
}
```

Use the actual spawn call shape in `child-runner.ts`; the invariant is that lifecycle env vars are present only when a child session file exists.

- [x] **Step 6: Add integration assertion for lifecycle env**

Add to `test/integration/single-execution.test.ts`:

```ts
void it("passes lifecycle environment to session-backed children", async () => {
	mockPi.onCall({ echoEnv: ["PI_SUBAGENT_SESSION", "PI_SUBAGENT_NAME", "PI_SUBAGENT_AGENT", "PI_SUBAGENT_AUTO_EXIT"] });
	const agents = makeAgentConfigs(["echo"]);
	const sessionFile = path.join(tempDir, "child.jsonl");

	const result = await runSync(tempDir, agents, "echo", "Task", { runId: "run-env", sessionFile, sessionMode: "lineage-only" });

	assert.equal(result.exitCode, 0);
	const env = JSON.parse(getFinalOutput(result.messages)) as Record<string, string>;
	assert.equal(env.PI_SUBAGENT_SESSION, sessionFile);
	assert.equal(env.PI_SUBAGENT_NAME, "echo");
	assert.equal(env.PI_SUBAGENT_AGENT, "echo");
	assert.equal(env.PI_SUBAGENT_AUTO_EXIT, "0");
});
```

If `mock-pi-script.mjs` returns echoEnv as an array instead of object, adapt the assertion to its actual output shape after inspecting the helper.

- [x] **Step 7: Run tests**

```bash
node --experimental-strip-types --test test/unit/superpowers-policy.test.ts test/unit/lifecycle-signals.test.ts
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/single-execution.test.ts
```

Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add src/shared/tool-registry.ts src/execution/superpowers-policy.ts src/extension/index.ts src/execution/child-runner.ts test/unit/superpowers-policy.test.ts test/integration/single-execution.test.ts
git commit -m "feat: add child lifecycle tools"
```

---

## Task 8: Surface `needs_parent` Completion Without Changing Sync Defaults

**Files:**
- Modify: `src/execution/child-runner.ts`
- Modify: `src/execution/subagent-executor.ts`
- Modify: `src/ui/subagent-result-lines.ts` if existing collapsed status ignores `completion.status`
- Create or Modify: `test/integration/caller-ping-lifecycle.test.ts`

- [x] **Step 1: Add integration test for ping sidecar delivery**

Create `test/integration/caller-ping-lifecycle.test.ts` using the mock Pi queue. If the mock Pi cannot write sidecars itself, configure it to output normally and create the sidecar before process close by extending `test/support/mock-pi-script.mjs` with an optional `writeLifecycleSignal` response field.

Test shape:

```ts
/**
 * Integration tests for caller_ping lifecycle sidecars.
 *
 * Responsibilities:
 * - verify ping sidecars become needs_parent completion envelopes
 * - verify ping results are delivered once through the active sync join path
 */

import assert from "node:assert/strict";
import * as path from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import type { MockPi } from "../support/helpers.ts";
import { createMockPi, createTempDir, getFinalOutput, makeAgentConfigs, removeTempDir, tryImport } from "../support/helpers.ts";

const execution = await tryImport<any>("./src/execution/child-runner.ts");
const available = !!execution;
const runSync = execution?.runSync;

void describe("caller_ping lifecycle", { skip: !available ? "pi packages not available" : undefined }, () => {
	let tempDir: string;
	let mockPi: MockPi;

	before(() => {
		mockPi = createMockPi();
		mockPi.install();
	});

	after(() => mockPi.uninstall());
	beforeEach(() => {
		tempDir = createTempDir();
		mockPi.reset();
	});
	afterEach(() => removeTempDir(tempDir));

	void it("maps ping sidecar to needs_parent completion", async () => {
		const sessionFile = path.join(tempDir, "child.jsonl");
		mockPi.onCall({ output: "Partial analysis", writeLifecycleSignal: { sessionFile, signal: { type: "ping", message: "Need target module" } } } as any);

		const result = await runSync(tempDir, makeAgentConfigs(["sp-research"]), "sp-research", "Inspect", {
			runId: "run-ping",
			sessionFile,
			sessionMode: "lineage-only",
		});

		assert.equal(result.lifecycle?.status, "consumed");
		assert.equal(result.completion?.status, "needs_parent");
		assert.equal(result.completion?.parentRequest, "Need target module");
		assert.equal(result.completion?.body, "Partial analysis");
	});
});
```

If `getFinalOutput` is not exported from helpers, import it via `tryImport("./src/shared/utils.ts")` as existing tests do.

- [x] **Step 2: Extend `test/support/mock-pi.ts` and script only as needed**

Add to `MockPiResponse`:

```ts
writeLifecycleSignal?: { sessionFile: string; signal: unknown };
```

In `test/support/mock-pi-script.mjs`, before exit, implement:

```js
if (response.writeLifecycleSignal) {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const sidecar = `${response.writeLifecycleSignal.sessionFile}.exit`;
  fs.mkdirSync(path.dirname(sidecar), { recursive: true });
  const tmp = `${sidecar}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(response.writeLifecycleSignal.signal), "utf-8");
  fs.renameSync(tmp, sidecar);
}
```

- [x] **Step 3: Attach completion envelopes in child runner**

In `src/execution/child-runner.ts`, import:

```ts
import { deriveCompletionEnvelope } from "./result-delivery.ts";
```

Update `attachLifecycle()` to also attach completion:

```ts
function attachLifecycle(result: ChildRunResult, sessionFile?: string): ChildRunResult {
	const lifecycle = consumeLifecycleSignal(result.sessionFile ?? sessionFile);
	const withLifecycle = lifecycle.status === "missing" ? result : { ...result, lifecycle };
	return { ...withLifecycle, completion: deriveCompletionEnvelope(withLifecycle) };
}
```

- [x] **Step 4: Ensure executor output includes help request text**

When formatting single or parallel results, if `result.completion?.status === "needs_parent"`, include the parent request in the returned text. Use the existing formatting helpers and add only a small prefix/suffix, for example:

```ts
function formatNeedsParent(result: SingleResult): string | undefined {
	if (result.completion?.status !== "needs_parent" || !result.completion.parentRequest) return undefined;
	return `Subagent ${result.agent} needs parent input: ${result.completion.parentRequest}`;
}
```

For single result text, prefer the current output plus this line. For parallel aggregation, ensure the line appears in that child's section. Do not change successful child output formatting.

- [x] **Step 5: Run ping lifecycle integration test**

```bash
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/caller-ping-lifecycle.test.ts
```

Expected: PASS.

- [x] **Step 6: Run single/parallel regression tests**

```bash
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/single-execution.test.ts test/integration/parallel-execution.test.ts
```

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add src/execution/child-runner.ts src/execution/subagent-executor.ts src/ui/subagent-result-lines.ts test/support/mock-pi.ts test/support/mock-pi-script.mjs test/integration/caller-ping-lifecycle.test.ts
git commit -m "feat: surface caller ping lifecycle results"
```

---

## Task 9: Preserve No-Async Public Contract and Add Versioned Docs

**Files:**
- Modify: `README.md`
- Modify: `docs/configuration.md`
- Modify: `docs/parameters.md`
- Modify: `docs/worktrees.md`
- Modify: `docs/skills.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json`

- [x] **Step 1: Bump package version**

In `package.json`, change:

```json
"version": "0.8.2"
```

 to:

```json
"version": "0.8.3"
```

- [x] **Step 2: Add `CHANGELOG.md` entry**

Insert above `## [0.8.2]`:

```md
## [0.8.3] - 2026-05-04

- **Compatibility**
  - Preserved synchronous `subagent` single and parallel execution while adding internal execution planning, child-runner, result-delivery, and lifecycle-signal seams.
  - Kept the public `subagent` parameter contract unchanged; no `async` or `blocking` config, frontmatter, or tool parameters were added.
- **Lifecycle**
  - Added internal child lifecycle sidecars for intentional completion and parent help requests, written atomically and parsed fail-softly.
  - Added thin completion envelopes that preserve the child's flexible answer body while exposing runtime-owned status and parent-request metadata.
```

- [x] **Step 3: Update README feature bullets**

Add a bullet after `Packet Handoffs`:

```md
- **Internal Result Ownership & Lifecycle Signals**: Subagent runs remain synchronous by default, but the runtime now tracks delivered-once results and child lifecycle sidecars for semantic completion or parent-help requests.
```

Add a short note under `Agents`:

```md
Subagent execution remains conservative and synchronous for ordinary Superpowers workflows. There is intentionally no user-facing `async` or `blocking` switch in agent frontmatter, config, or tool parameters. Internal result ownership prevents duplicate delivery and lifecycle sidecars let child agents report intentional completion or a parent-help request without changing the normal delegation flow.
```

- [x] **Step 4: Update `docs/parameters.md`**

After the parameter table, add:

```md
There is intentionally no `async` or `blocking` parameter. Superpowers role delegation remains synchronous in v0.8.3: single calls return after one child result is joined, and parallel calls return after all foreground child results are joined.

The runtime may attach additive completion metadata to results. The child's normal answer remains available as text; the envelope only adds `status`, `summary`, optional `parentRequest`, and optional artifact references for parent orchestration.
```

- [x] **Step 5: Update `docs/configuration.md`**

Under `Configuration Keys`, add:

```md
No async launch policy is configured in v0.8.3. `config.json` does not support `async`, `blocking`, or background execution keys. Result ownership and lifecycle sidecars are internal compatibility-preserving runtime features.
```

- [x] **Step 6: Update `docs/worktrees.md`**

Under `Internals`, add:

```md
Worktree-backed children are still foreground-joined before cleanup. Internal result ownership does not allow a worktree-backed child to outlive the tool call in v0.8.3, so cleanup semantics remain unchanged.
```

- [x] **Step 7: Update `docs/skills.md`**

Under `Role Output`, add:

```md
Bounded child roles may receive internal lifecycle tools such as `subagent_done` and `caller_ping` when available. `subagent_done` records intentional completion; `caller_ping` records a concise parent-help request and exits into a delivered `needs_parent` result. These are not delegation tools and do not let bounded roles spawn further subagents.
```

- [x] **Step 8: Run docs/version checks**

```bash
node --experimental-strip-types --test test/unit/package-manifest.test.ts
```

Expected: PASS.

- [x] **Step 9: Commit**

```bash
git add package.json CHANGELOG.md README.md docs/configuration.md docs/parameters.md docs/worktrees.md docs/skills.md
git commit -m "docs: document v0.8.3 lifecycle compatibility"
```

---

## Task 10: Final Verification and Cleanup

**Files:**
- Verify: full repository
- Modify only if failures identify issues

- [x] **Step 1: Verify legacy execution module is gone**

Run:

```bash
test ! -e src/execution/execution.ts
grep -R "execution/execution\.ts\|from \"\.\/execution\.ts\"\|from './execution\.ts'\|runSync" -n src test || true
```

Expected: `test ! -e` exits 0. Grep may show `runSync` compatibility export in `child-runner.ts` and tests during transition; it must not show production imports from `execution.ts`. If keeping `runSync` alias in `child-runner.ts`, add a follow-up inline cleanup step in this task to rename tests to `runPreparedChild` and delete the alias.

- [x] **Step 2: Remove `runSync` alias from `child-runner.ts` if no longer needed**

Replace test variable names from `runSync` to `runPreparedChild`, then remove:

```ts
export const runSync = runPreparedChild;
```

Run:

```bash
grep -R "runSync" -n src test || true
```

Expected: no output. This satisfies the spec's aggressive deprecation path.

- [x] **Step 3: Run unit tests**

```bash
npm run test:unit
```

Expected: PASS.

- [x] **Step 4: Run integration tests**

```bash
npm run test:integration
```

Expected: PASS.

- [x] **Step 5: Run e2e tests**

```bash
npm run test:e2e
```

Expected: PASS or documented skip only when Pi packages are unavailable in the environment. Do not claim completion if there are real failures.

- [x] **Step 6: Run full QA**

```bash
npm run qa
```

Expected: PASS: Biome check/write, TypeScript typecheck, unit tests, integration tests, and e2e tests.

- [x] **Step 7: Inspect changed files**

```bash
git status --short
git diff --stat
git diff -- src/execution/subagent-executor.ts src/execution/child-runner.ts src/execution/execution-planner.ts src/execution/result-delivery.ts src/execution/lifecycle-signals.ts
```

Expected: changes match this plan; no accidental generated files, temp sidecars, packet files, or worktree artifacts are staged.

- [x] **Step 8: Commit final cleanup if needed**

Only if Task 10 made changes:

```bash
git add -A
git commit -m "chore: verify subagent lifecycle extraction"
```

---

## Plan Self-Review

- **Spec coverage:** Execution planning, child-runner extraction, result delivery, lifecycle signals, atomic sidecar writes, deterministic state-machine tests, docs, v0.8.3 compatibility, no async public controls, and aggressive `execution.ts` removal are each covered by tasks above.
- **Placeholder scan:** No `TBD`, `TODO`, "add appropriate", or unspecified test steps remain. Where existing variable names may differ inside `subagent-executor.ts`, the plan gives concrete target code and invariants to preserve.
- **Type consistency:** Shared types introduced in Task 1 are consumed by lifecycle, result-delivery, planner, child-runner, and executor tasks using the same names.
- **Compatibility check:** Public `SubagentParams` is unchanged; new result fields are optional/additive; worktree/session/artifact/progress behavior remains covered by regression tests.
