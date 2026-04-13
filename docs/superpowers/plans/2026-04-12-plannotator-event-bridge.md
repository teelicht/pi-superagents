# Plannotator Event Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional, fail-soft Plannotator browser review bridge to the Superpowers plan approval flow without adopting Plannotator’s planner runtime.

**Architecture:** Keep the integration narrow. Add a typed event bridge module that emits `plannotator:request`, waits for the initial Plannotator response plus the final `plannotator:review-result`, and returns an internal outcome enum. Wire that bridge into the exact Superpowers plan approval call site through a root-only custom tool (`superpowers_plan_review`) that the root prompt instructs the planning agent to call only when `superagents.plannotator.enabled` is true; when the bridge is unavailable, the tool returns a soft-fallback result and the normal text approval path remains authoritative.

**Tech Stack:** TypeScript, Node.js built-in test runner, TypeBox, Pi extension API event bus, Superpowers root prompt, markdown docs

---

## Scope Check

This spec is one focused subsystem: optional review transport for Superpowers plan approval. Do not broaden it into generic browser review, generic session message interception, or Plannotator-native planning support.

## File Structure

### Files to Create

- `src/integrations/plannotator.ts` — typed event-only bridge and timeout handling.
- `test/unit/plannotator-bridge.test.ts` — unit coverage for request/response/result matching, stale-event filtering, and timeout fallbacks.
- `test/integration/plannotator-review-tool.test.ts` — extension-level wiring tests using a mocked `pi.events` bus.

### Files to Modify

- `src/shared/types.ts` — add `SuperpowersPlannotatorSettings` and nest it under `SuperpowersSettings`.
- `src/execution/config-validation.ts` — validate `superagents.plannotator.enabled`, reject unknown nested keys, deep-merge defaults and overrides.
- `src/execution/superagents-config.ts` — add one helper to resolve whether Plannotator review is enabled.
- `default-config.json` — add `superagents.plannotator.enabled: false`.
- `config.example.json` — add the same public config key.
- `src/superpowers/root-prompt.ts` — expose `usePlannotatorReview` metadata and conditional root-planning instructions for the exact approval point.
- `src/extension/index.ts` — register `superpowers_plan_review`, call the bridge from tool execution, and notify softly on unavailable outcomes.
- `test/unit/config-validation.test.ts` — add config validation coverage for `superagents.plannotator`.
- `test/unit/default-config.test.ts` — assert config templates expose the new key.
- `test/unit/superagents-config.test.ts` — assert the new helper resolves the flag correctly.
- `test/unit/superpowers-root-prompt.test.ts` — assert the tool instructions are present only when enabled.
- `test/integration/slash-commands.test.ts` — assert enabled config injects Plannotator review instructions into the root prompt.
- `docs/reference/configuration.md` — document the new flag and separate Plannotator installation step.
- `docs/guides/superpowers.md` — document how the optional browser review fits into the Superpowers workflow.

### Reference Patterns

- `src/execution/config-validation.ts` + `test/unit/config-validation.test.ts` — strict config validation with nested key rejection.
- `src/superpowers/root-prompt.ts` + `test/unit/superpowers-root-prompt.test.ts` — config-driven prompt contract text.
- `test/integration/config-gating.test.ts` — extension registration tests with a minimal mocked Pi API and event bus.
- `test/integration/slash-commands.test.ts` — root prompt assertions driven by config.

### Risks To Keep In Mind

- Do not add a broad `message_end` listener that guesses when a plan is ready.
- Do not import `@plannotator/pi-extension` or any Plannotator runtime types.
- Do not let a missing Plannotator extension hang the session.
- Do not expose the review tool to bounded `sp-*` roles through policy changes.

## Task 1: Add Config Surface, Defaults, and Resolution Helpers

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/execution/config-validation.ts`
- Modify: `src/execution/superagents-config.ts`
- Modify: `default-config.json`
- Modify: `config.example.json`
- Modify: `test/unit/config-validation.test.ts`
- Modify: `test/unit/default-config.test.ts`
- Modify: `test/unit/superagents-config.test.ts`

- [x] **Step 1: Write failing tests for the new config surface**

In `test/unit/default-config.test.ts`, add `plannotator` to the supported key list and assert the default boolean:

```ts
const SUPERAGENTS_OPTION_KEYS = [
	"useSubagents",
	"useTestDrivenDevelopment",
	"plannotator",
	"commands",
	"worktrees",
	"modelTiers",
] as const;
```

Inside `assertPublicConfigSurface()` add:

```ts
const plannotator = superagents.plannotator as Record<string, unknown>;
assert.ok("plannotator" in superagents, "Expected superagents option 'plannotator' to be present");
assert.equal(plannotator.enabled, false);
```

In `test/unit/config-validation.test.ts`, add these cases inside `describe("config validation", ...)`:

```ts
void it("accepts plannotator enabled true and false", () => {
	assert.equal(
		validateConfigObject({ superagents: { plannotator: { enabled: true } } }).blocked,
		false,
	);
	assert.equal(
		validateConfigObject({ superagents: { plannotator: { enabled: false } } }).blocked,
		false,
	);
});

void it("rejects non-boolean plannotator enabled and unknown nested keys", () => {
	const result = validateConfigObject({
		superagents: {
			plannotator: {
				enabled: "yes",
				mode: "browser-only",
			},
		},
	});

	assert.equal(result.blocked, true);
	assert.deepEqual(result.diagnostics.map((d) => d.path), [
		"superagents.plannotator.mode",
		"superagents.plannotator.enabled",
	]);
});

void it("deep merges plannotator defaults and user overrides", () => {
	const result = loadEffectiveConfig(defaults, {
		superagents: {
			plannotator: { enabled: true },
		},
	});

	assert.equal(result.blocked, false);
	assert.equal(result.config.superagents?.plannotator?.enabled, true);
	assert.equal(result.config.superagents?.useSubagents, true);
});
```

Update the local `defaults` fixture to include:

```ts
plannotator: {
	enabled: false,
},
```

In `test/unit/superagents-config.test.ts`, add:

```ts
import { isSuperagentPlannotatorEnabled } from "../../src/execution/superagents-config.ts";
```

and a new test:

```ts
void it("resolves plannotator review as disabled by default and true only when enabled", () => {
	assert.equal(isSuperagentPlannotatorEnabled({}), false);
	assert.equal(isSuperagentPlannotatorEnabled({ superagents: { plannotator: { enabled: false } } }), false);
	assert.equal(isSuperagentPlannotatorEnabled({ superagents: { plannotator: { enabled: true } } }), true);
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run:

```bash
node --experimental-strip-types --test test/unit/default-config.test.ts test/unit/config-validation.test.ts test/unit/superagents-config.test.ts
```

Expected:
- FAIL because `plannotator` is missing from `default-config.json` and `config.example.json`
- FAIL because `SuperpowersSettings` and config validation do not recognize `superagents.plannotator`
- FAIL because `isSuperagentPlannotatorEnabled` does not exist

- [x] **Step 3: Add the TypeScript config types and resolver helper**

In `src/shared/types.ts`, insert the new interface directly before `SuperpowersSettings`:

```ts
/** Optional Plannotator browser-review bridge settings for Superpowers plans. */
export interface SuperpowersPlannotatorSettings {
	enabled?: boolean;
}

export interface SuperpowersSettings {
	useSubagents?: boolean;
	useTestDrivenDevelopment?: boolean;
	plannotator?: SuperpowersPlannotatorSettings;
	commands?: Record<string, SuperpowersCommandPreset>;
	worktrees?: SuperpowersWorktreeSettings;
	modelTiers?: Record<string, ModelTierSetting>;
}
```

In `src/execution/superagents-config.ts`, add:

```ts
/**
 * Resolve whether the optional Plannotator review bridge is enabled.
 *
 * @param config Extension config being inspected.
 * @returns `true` only when the user explicitly enables the bridge.
 */
export function isSuperagentPlannotatorEnabled(config: ExtensionConfig): boolean {
	return getSuperagentSettings(config)?.plannotator?.enabled ?? false;
}
```

- [x] **Step 4: Add strict config validation and deep-merge support**

In `src/execution/config-validation.ts`, update the supported key sets:

```ts
const SUPERAGENTS_KEYS = new Set(["useSubagents", "useTestDrivenDevelopment", "plannotator", "commands", "worktrees", "modelTiers"]);
const PLANNOTATOR_KEYS = new Set(["enabled"]);
```

Inside `validateConfigObject()`, immediately after the `useTestDrivenDevelopment` check, add:

```ts
if ("plannotator" in superagents) {
	const plannotator = superagents.plannotator;
	if (!isRecord(plannotator)) {
		addError(diagnostics, "superagents.plannotator", "must be an object.");
	} else {
		for (const key of Object.keys(plannotator)) {
			if (!PLANNOTATOR_KEYS.has(key)) {
				addError(diagnostics, `superagents.plannotator.${key}`, "is not a supported config key.", "unknown_key");
			}
		}
		if ("enabled" in plannotator && typeof plannotator.enabled !== "boolean") {
			addError(diagnostics, "superagents.plannotator.enabled", "must be a boolean.");
		}
	}
}
```

In `mergeConfig()`, deep-merge `plannotator` alongside the existing nested objects:

```ts
const mergedSuperagents = defaultSuperagents || overrideSuperagents
	? {
		...(defaultSuperagents ?? {}),
		...(overrideSuperagents ?? {}),
		plannotator: {
			...(defaultSuperagents?.plannotator ?? {}),
			...(overrideSuperagents?.plannotator ?? {}),
		},
		commands: {
			...(defaultSuperagents?.commands ?? {}),
			...(overrideSuperagents?.commands ?? {}),
		},
```

- [x] **Step 5: Add the default and example config values**

In both `default-config.json` and `config.example.json`, insert this block directly under `useTestDrivenDevelopment`:

```json
"plannotator": {
  "enabled": false
},
```

The `superagents` object should begin like this in both files:

```json
{
  "superagents": {
    "useSubagents": true,
    "useTestDrivenDevelopment": true,
    "plannotator": {
      "enabled": false
    },
```

- [x] **Step 6: Run the tests to verify they pass**

Run:

```bash
node --experimental-strip-types --test test/unit/default-config.test.ts test/unit/config-validation.test.ts test/unit/superagents-config.test.ts
```

Expected:
- PASS

- [x] **Step 7: Commit**

```bash
git add src/shared/types.ts src/execution/config-validation.ts src/execution/superagents-config.ts default-config.json config.example.json test/unit/config-validation.test.ts test/unit/default-config.test.ts test/unit/superagents-config.test.ts
git commit -m "feat: add plannotator config surface"
```

## Task 2: Build the Event-Only Plannotator Bridge Module

**Files:**
- Create: `src/integrations/plannotator.ts`
- Create: `test/unit/plannotator-bridge.test.ts`

- [x] **Step 1: Write the failing bridge tests**

- [x] Follow-up: tighten the first bridge test to assert the complete emitted request key set so unexpected extra properties fail review coverage.

Create `test/unit/plannotator-bridge.test.ts`:

```ts
/**
 * Unit coverage for the Plannotator event-only review bridge.
 *
 * Responsibilities:
 * - verify request payload shape and origin tagging
 * - verify handled approval and rejection flows
 * - verify stale review results are ignored
 * - verify unavailable and timeout fallbacks are bounded
 */

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import { requestPlannotatorPlanReview } from "../../src/integrations/plannotator.ts";

function createBus() {
	const emitter = new EventEmitter();
	return {
		emit(channel: string, data: unknown) {
			emitter.emit(channel, data);
		},
		on(channel: string, handler: (data: unknown) => void) {
			emitter.on(channel, handler);
			return () => emitter.off(channel, handler);
		},
	};
}

void describe("requestPlannotatorPlanReview", () => {
	void it("emits the exact request shape and resolves approval for the matching review id", async () => {
		const events = createBus();
		let seenRequest: any;

		events.on("plannotator:request", (request: any) => {
			seenRequest = request;
			request.respond({ status: "handled", result: { status: "pending", reviewId: "review-123" } });
			setTimeout(() => {
				events.emit("plannotator:review-result", { reviewId: "review-123", approved: true });
			}, 0);
		});

		const outcome = await requestPlannotatorPlanReview({
			events,
			planContent: "# Plan\n- [ ] Step",
			planFilePath: "docs/superpowers/plans/2026-04-12-plannotator-event-bridge.md",
			requestTimeoutMs: 25,
			reviewTimeoutMs: 25,
		});

		assert.equal(seenRequest.action, "plan-review");
		assert.equal(seenRequest.payload.planContent, "# Plan\n- [ ] Step");
		assert.equal(seenRequest.payload.planFilePath, "docs/superpowers/plans/2026-04-12-plannotator-event-bridge.md");
		assert.equal(seenRequest.payload.origin, "pi-superagents");
		assert.match(String(seenRequest.requestId), /^plannotator-review-/);
		assert.deepEqual(outcome, { status: "approved" });
	});

	void it("returns rejected with feedback from the matching review id", async () => {
		const events = createBus();
		events.on("plannotator:request", (request: any) => {
			request.respond({ status: "handled", result: { status: "pending", reviewId: "review-456" } });
			setTimeout(() => {
				events.emit("plannotator:review-result", {
					reviewId: "review-456",
					approved: false,
					feedback: "Clarify the retry timeout rationale.",
				});
			}, 0);
		});

		const outcome = await requestPlannotatorPlanReview({
			events,
			planContent: "# Plan",
			requestTimeoutMs: 25,
			reviewTimeoutMs: 25,
		});

		assert.deepEqual(outcome, {
			status: "rejected",
			feedback: "Clarify the retry timeout rationale.",
		});
	});

	void it("ignores stale review results for other review ids", async () => {
		const events = createBus();
		events.on("plannotator:request", (request: any) => {
			request.respond({ status: "handled", result: { status: "pending", reviewId: "review-live" } });
			setTimeout(() => {
				events.emit("plannotator:review-result", { reviewId: "review-stale", approved: true });
				events.emit("plannotator:review-result", { reviewId: "review-live", approved: false });
			}, 0);
		});

		const outcome = await requestPlannotatorPlanReview({
			events,
			planContent: "# Plan",
			requestTimeoutMs: 25,
			reviewTimeoutMs: 25,
		});

		assert.deepEqual(outcome, {
			status: "rejected",
			feedback: "Plan changes requested in Plannotator.",
		});
	});

	void it("returns unavailable when plannotator reports unavailable or error", async () => {
		const unavailableEvents = createBus();
		unavailableEvents.on("plannotator:request", (request: any) => {
			request.respond({ status: "unavailable", error: "No active Plannotator UI." });
		});
		assert.deepEqual(
			await requestPlannotatorPlanReview({
				events: unavailableEvents,
				planContent: "# Plan",
				requestTimeoutMs: 25,
				reviewTimeoutMs: 25,
			}),
			{ status: "unavailable", reason: "No active Plannotator UI." },
		);

		const errorEvents = createBus();
		errorEvents.on("plannotator:request", (request: any) => {
			request.respond({ status: "error", error: "Browser startup failed." });
		});
		assert.deepEqual(
			await requestPlannotatorPlanReview({
				events: errorEvents,
				planContent: "# Plan",
				requestTimeoutMs: 25,
				reviewTimeoutMs: 25,
			}),
			{ status: "unavailable", reason: "Browser startup failed." },
		);
	});

	void it("returns unavailable when the request or matching result times out", async () => {
		const noRequestResponse = createBus();
		assert.deepEqual(
			await requestPlannotatorPlanReview({
				events: noRequestResponse,
				planContent: "# Plan",
				requestTimeoutMs: 5,
				reviewTimeoutMs: 5,
			}),
			{ status: "unavailable", reason: "Plannotator did not respond to plan-review request before timeout." },
		);

		const noResult = createBus();
		noResult.on("plannotator:request", (request: any) => {
			request.respond({ status: "handled", result: { status: "pending", reviewId: "review-timeout" } });
		});
		assert.deepEqual(
			await requestPlannotatorPlanReview({
				events: noResult,
				planContent: "# Plan",
				requestTimeoutMs: 25,
				reviewTimeoutMs: 5,
			}),
			{ status: "unavailable", reason: "Plannotator review-result did not arrive before timeout." },
		);
	});
});
```

- [x] **Step 2: Run the test to verify it fails**

Run:

```bash
node --experimental-strip-types --test test/unit/plannotator-bridge.test.ts
```

Expected:
- FAIL because `src/integrations/plannotator.ts` does not exist

- [x] **Step 3: Implement the bridge module**

Create `src/integrations/plannotator.ts`:

```ts
/**
 * Plannotator event-only review bridge.
 *
 * Responsibilities:
 * - define the minimal plan-review event contract used by pi-superagents
 * - emit `plannotator:request` with a unique request id
 * - wait for the initial request response and the matching review result
 * - convert Plannotator-specific events into a small internal outcome type
 *
 * Important side effects:
 * - emits `plannotator:request` on the provided event bus
 * - subscribes temporarily to `plannotator:review-result` until the request settles
 */

import { randomUUID } from "node:crypto";

export interface PlannotatorEventBus {
	emit(channel: string, data: unknown): void;
	on(channel: string, handler: (data: unknown) => void): () => void;
}

export type PlannotatorPlanReviewResponse =
	| { status: "handled"; result: { status: "pending"; reviewId: string } }
	| { status: "unavailable"; error?: string }
	| { status: "error"; error: string };

export interface PlannotatorPlanReviewRequest {
	requestId: string;
	action: "plan-review";
	payload: {
		planContent: string;
		planFilePath?: string;
		origin: "pi-superagents";
	};
	respond: (response: PlannotatorPlanReviewResponse) => void;
}

export interface PlannotatorReviewResult {
	reviewId: string;
	approved: boolean;
	feedback?: string;
	savedPath?: string;
	agentSwitch?: string;
	permissionMode?: string;
}

export type PlanReviewOutcome =
	| { status: "approved" }
	| { status: "rejected"; feedback: string }
	| { status: "unavailable"; reason: string };

export interface RequestPlannotatorPlanReviewInput {
	events: PlannotatorEventBus;
	planContent: string;
	planFilePath?: string;
	requestTimeoutMs?: number;
	reviewTimeoutMs?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 5000;
const DEFAULT_REVIEW_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Request a browser-based Plannotator review for one Superpowers plan.
 *
 * @param input Event bus plus plan payload and optional timeout overrides.
 * @returns Approved, rejected-with-feedback, or unavailable fallback outcome.
 */
export async function requestPlannotatorPlanReview(
	input: RequestPlannotatorPlanReviewInput,
): Promise<PlanReviewOutcome> {
	const requestTimeoutMs = input.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
	const reviewTimeoutMs = input.reviewTimeoutMs ?? DEFAULT_REVIEW_TIMEOUT_MS;
	const requestId = `plannotator-review-${randomUUID()}`;

	return await new Promise<PlanReviewOutcome>((resolve) => {
		let settled = false;
		let unsubscribeReview: (() => void) | undefined;
		let requestTimer: NodeJS.Timeout | undefined;
		let reviewTimer: NodeJS.Timeout | undefined;

		const finish = (outcome: PlanReviewOutcome) => {
			if (settled) return;
			settled = true;
			if (requestTimer) clearTimeout(requestTimer);
			if (reviewTimer) clearTimeout(reviewTimer);
			unsubscribeReview?.();
			resolve(outcome);
		};

		const startReviewWait = (reviewId: string) => {
			unsubscribeReview = input.events.on("plannotator:review-result", (rawEvent) => {
				const event = rawEvent as Partial<PlannotatorReviewResult>;
				if (event.reviewId !== reviewId) return;
				if (event.approved) {
					finish({ status: "approved" });
					return;
				}
				finish({
					status: "rejected",
					feedback: typeof event.feedback === "string" && event.feedback.trim()
						? event.feedback
						: "Plan changes requested in Plannotator.",
				});
			});

			reviewTimer = setTimeout(() => {
				finish({ status: "unavailable", reason: "Plannotator review-result did not arrive before timeout." });
			}, reviewTimeoutMs);
		};

		requestTimer = setTimeout(() => {
			finish({ status: "unavailable", reason: "Plannotator did not respond to plan-review request before timeout." });
		}, requestTimeoutMs);

		const request: PlannotatorPlanReviewRequest = {
			requestId,
			action: "plan-review",
			payload: {
				planContent: input.planContent,
				...(input.planFilePath ? { planFilePath: input.planFilePath } : {}),
				origin: "pi-superagents",
			},
			respond(response) {
				if (settled) return;
				if (requestTimer) clearTimeout(requestTimer);
				if (response.status === "unavailable") {
					finish({
						status: "unavailable",
						reason: response.error || "Plannotator is unavailable for plan review.",
					});
					return;
				}
				if (response.status === "error") {
					finish({ status: "unavailable", reason: response.error });
					return;
				}
				const reviewId = response.result?.reviewId;
				if (!reviewId) {
					finish({
						status: "unavailable",
						reason: "Plannotator handled the request but did not provide a reviewId.",
					});
					return;
				}
				startReviewWait(reviewId);
			},
		};

		input.events.emit("plannotator:request", request);
	});
}
```

- [x] **Step 4: Run the test to verify it passes**

Run:

```bash
node --experimental-strip-types --test test/unit/plannotator-bridge.test.ts
```

Expected:
- PASS

- [x] **Step 5: Commit**

```bash
git add src/integrations/plannotator.ts test/unit/plannotator-bridge.test.ts
git commit -m "feat: add plannotator event bridge"
```

## Task 3: Wire the Exact Superpowers Plan Approval Call Site

**Files:**
- Modify: `src/superpowers/root-prompt.ts`
- Modify: `src/extension/index.ts`
- Modify: `test/unit/superpowers-root-prompt.test.ts`
- Modify: `test/integration/slash-commands.test.ts`
- Create: `test/integration/plannotator-review-tool.test.ts`

- [x] **Step 1: Write the failing prompt and extension wiring tests**

In `test/unit/superpowers-root-prompt.test.ts`, add `usePlannotatorReview` to both call sites and add a new enabled-path assertion:

```ts
void it("adds plannotator review instructions only when enabled", () => {
	const prompt = buildSuperpowersRootPrompt({
		task: "write a plan",
		useSubagents: true,
		useTestDrivenDevelopment: true,
		usePlannotatorReview: true,
		fork: false,
		usingSuperpowersSkill: {
			name: "using-superpowers",
			path: "/skills/using-superpowers/SKILL.md",
			content: "USING SUPERPOWERS BODY",
		},
	});

	assert.match(prompt, /usePlannotatorReview: true/);
	assert.match(prompt, /superpowers_plan_review/);
	assert.match(prompt, /only at the normal plan approval point/);
	assert.match(prompt, /If the tool returns unavailable, show one concise warning and continue with normal text-based approval/);
});
```

Also update the existing disabled-path test to assert:

```ts
assert.match(prompt, /usePlannotatorReview: false/);
assert.doesNotMatch(prompt, /superpowers_plan_review/);
```

In `test/integration/slash-commands.test.ts`, extend the config type used by `registerSlashCommands`:

```ts
config: {
	superagents?: {
		useSubagents?: boolean;
		useTestDrivenDevelopment?: boolean;
		plannotator?: { enabled?: boolean };
		commands?: Record<string, { description?: string; useSubagents?: boolean; useTestDrivenDevelopment?: boolean }>;
	};
},
```

Add a new test:

```ts
void it("injects plannotator review instructions into the root prompt only when enabled", async () => {
	const userMessages: Array<{ content: string | unknown[]; options?: { deliverAs?: "steer" | "followUp" } }> = [];
	const commands = new Map<string, { description?: string; handler(args: string, ctx: unknown): Promise<void> }>();
	const pi = {
		events: createEventBus(),
		registerCommand(name: string, spec: { description?: string; handler(args: string, ctx: unknown): Promise<void> }) {
			commands.set(name, spec);
		},
		sendMessage() {},
		sendUserMessage(content: string | unknown[], options?: { deliverAs?: "steer" | "followUp" }) {
			userMessages.push({ content, options });
		},
	};

	registerSlashCommands!(pi, createState(process.cwd()), {
		superagents: {
			plannotator: { enabled: true },
		},
	});

	await commands.get("superpowers")!.handler("write the implementation plan", createCommandContext());
	const prompt = String(userMessages[0].content);
	assert.match(prompt, /usePlannotatorReview:\s*true/);
	assert.match(prompt, /superpowers_plan_review/);
});
```

Create `test/integration/plannotator-review-tool.test.ts`:

```ts
/**
 * Integration coverage for the root-only Plannotator plan review tool.
 *
 * Responsibilities:
 * - verify extension wiring calls the event bridge through `pi.events`
 * - verify approved, rejected, and unavailable outcomes are surfaced to the agent
 * - verify unavailable startup does not hard-fail the session
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";

let registerSubagentExtension: typeof import("../../src/extension/index.ts").default | undefined;
let available = false;
try {
	registerSubagentExtension = (await import("../../src/extension/index.ts")).default;
	available = true;
} catch {
	// Extension may not be importable in minimal test environments.
}

function createEventBus() {
	const handlers = new Map<string, Array<(data: unknown) => void>>();
	return {
		on(event: string, handler: (data: unknown) => void) {
			const existing = handlers.get(event) ?? [];
			existing.push(handler);
			handlers.set(event, existing);
			return () => {
				handlers.set(event, (handlers.get(event) ?? []).filter((entry) => entry !== handler));
			};
		},
		emit(event: string, data: unknown) {
			for (const handler of handlers.get(event) ?? []) handler(data);
		},
	};
}

function createPiMock() {
	const events = createEventBus();
	const tools = new Map<string, any>();
	const lifecycle = new Map<string, Array<(event: unknown, ctx: unknown) => void>>();
	return {
		events,
		tools,
		pi: {
			events,
			registerTool(tool: any) {
				tools.set(tool.name, tool);
			},
			registerCommand() {},
			registerShortcut() {},
			registerMessageRenderer() {},
			sendMessage() {},
			sendUserMessage() {},
			on(event: string, handler: (event: unknown, ctx: unknown) => void) {
				const existing = lifecycle.get(event) ?? [];
				existing.push(handler);
				lifecycle.set(event, existing);
			},
		},
	};
}

function createCtx(notifications: Array<{ message: string; type?: string }>) {
	return {
		cwd: process.cwd(),
		hasUI: true,
		ui: {
			notify(message: string, type?: string) {
				notifications.push({ message, type });
			},
			setWidget() {},
		},
		sessionManager: {
			getSessionFile: () => null,
			getEntries: () => [],
		},
		modelRegistry: {
			getAvailable: () => [],
		},
		isIdle: () => true,
		signal: undefined,
		abort() {},
		hasPendingMessages: () => false,
		shutdown() {},
		getContextUsage: () => undefined,
		compact() {},
		getSystemPrompt: () => "",
		model: undefined,
	};
}

void describe("plannotator review tool", { skip: !available ? "extension not importable" : undefined }, () => {
	const originalHome = process.env.HOME;
	const tempDirs: string[] = [];

	afterEach(() => {
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;
		for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
	});

	void it("emits plan-review and returns approval", async () => {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-plannotator-home-"));
		tempDirs.push(home);
		process.env.HOME = home;
		const extensionDir = path.join(home, ".pi", "agent", "extensions", "subagent");
		fs.mkdirSync(extensionDir, { recursive: true });
		fs.writeFileSync(path.join(extensionDir, "config.json"), JSON.stringify({ superagents: { plannotator: { enabled: true } } }), "utf-8");

		const mock = createPiMock();
		registerSubagentExtension!(mock.pi as never);

		mock.events.on("plannotator:request", (request: any) => {
			assert.equal(request.action, "plan-review");
			assert.equal(request.payload.origin, "pi-superagents");
			request.respond({ status: "handled", result: { status: "pending", reviewId: "review-tool-1" } });
			setTimeout(() => {
				mock.events.emit("plannotator:review-result", { reviewId: "review-tool-1", approved: true });
			}, 0);
		});

		const result = await mock.tools.get("superpowers_plan_review").execute(
			"review",
			{ planContent: "# Plan\n- [ ] Ship it", planFilePath: "docs/superpowers/plans/2026-04-12-plannotator-event-bridge.md" },
			undefined,
			undefined,
			createCtx([]),
		);

		assert.equal(result.isError, false);
		assert.match(JSON.stringify(result), /approved/i);
	});

	void it("returns rejection feedback for revision", async () => {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-plannotator-reject-home-"));
		tempDirs.push(home);
		process.env.HOME = home;
		const extensionDir = path.join(home, ".pi", "agent", "extensions", "subagent");
		fs.mkdirSync(extensionDir, { recursive: true });
		fs.writeFileSync(path.join(extensionDir, "config.json"), JSON.stringify({ superagents: { plannotator: { enabled: true } } }), "utf-8");

		const mock = createPiMock();
		registerSubagentExtension!(mock.pi as never);

		mock.events.on("plannotator:request", (request: any) => {
			request.respond({ status: "handled", result: { status: "pending", reviewId: "review-tool-2" } });
			setTimeout(() => {
				mock.events.emit("plannotator:review-result", {
					reviewId: "review-tool-2",
					approved: false,
					feedback: "Explain why the bridge uses two bounded timeouts.",
				});
			}, 0);
		});

		const result = await mock.tools.get("superpowers_plan_review").execute(
			"review",
			{ planContent: "# Plan" },
			undefined,
			undefined,
			createCtx([]),
		);

		assert.equal(result.isError, false);
		assert.match(JSON.stringify(result), /Explain why the bridge uses two bounded timeouts/);
	});

	void it("fails softly when plannotator reports unavailable", async () => {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-plannotator-unavailable-home-"));
		tempDirs.push(home);
		process.env.HOME = home;
		const extensionDir = path.join(home, ".pi", "agent", "extensions", "subagent");
		fs.mkdirSync(extensionDir, { recursive: true });
		fs.writeFileSync(path.join(extensionDir, "config.json"), JSON.stringify({ superagents: { plannotator: { enabled: true } } }), "utf-8");

		const mock = createPiMock();
		registerSubagentExtension!(mock.pi as never);
		mock.events.on("plannotator:request", (request: any) => {
			request.respond({ status: "unavailable", error: "No active Plannotator UI." });
		});

		const notifications: Array<{ message: string; type?: string }> = [];
		const result = await mock.tools.get("superpowers_plan_review").execute(
			"review",
			{ planContent: "# Plan" },
			undefined,
			undefined,
			createCtx(notifications),
		);

		assert.equal(result.isError, false);
		assert.match(JSON.stringify(result), /text-based approval flow/);
		assert.equal(notifications[0]?.type, "warning");
		assert.match(notifications[0]?.message ?? "", /Plannotator/);
	});
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run:

```bash
node --experimental-strip-types --test test/unit/superpowers-root-prompt.test.ts
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/slash-commands.test.ts test/integration/plannotator-review-tool.test.ts
```

Expected:
- FAIL because `buildSuperpowersRootPrompt()` does not accept `usePlannotatorReview`
- FAIL because `/superpowers` does not inject Plannotator approval instructions
- FAIL because `superpowers_plan_review` is not registered by the extension

- [x] **Step 3: Add conditional prompt instructions at the exact approval point**

In `src/superpowers/root-prompt.ts`, extend the input type:

```ts
export interface SuperpowersRootPromptInput {
	task: string;
	useSubagents: boolean;
	useTestDrivenDevelopment: boolean;
	usePlannotatorReview: boolean;
	fork: boolean;
	usingSuperpowersSkill?: SuperpowersRootPromptSkill;
}
```

Add the metadata line inside `buildMetadata()`:

```ts
`usePlannotatorReview: ${input.usePlannotatorReview}`,
```

Add a new helper below `buildDelegationContract()`:

```ts
/**
 * Build the optional Plannotator plan-review contract block.
 *
 * @param usePlannotatorReview Whether the browser review bridge is enabled.
 * @returns Prompt block for the exact plan approval call site.
 */
function buildPlannotatorReviewContract(usePlannotatorReview: boolean): string {
	if (!usePlannotatorReview) {
		return "Plannotator browser review is DISABLED by config. Use the normal Superpowers text-based plan approval flow.";
	}
	return [
		"Plannotator browser review is ENABLED by config.",
		"At the normal Superpowers implementation-plan approval point, after you have the final plan content and before you ask for approval in plain text, call the `superpowers_plan_review` tool exactly once with the full final plan content and the saved plan file path when available.",
		"Use this tool only at the normal plan approval point. Do not call it during brainstorming, clarifying questions, implementation, code review, or subagent delegation.",
		"If the tool returns approved, continue the workflow.",
		"If the tool returns rejected, treat the feedback as plan-review feedback, revise the plan, and resubmit through the same tool.",
		"If the tool returns unavailable, show one concise warning and continue with normal text-based approval.",
	].join("\n");
}
```

Insert the contract into `buildSuperpowersRootPrompt()` immediately after the delegation contract:

```ts
buildPlannotatorReviewContract(input.usePlannotatorReview),
"",
```

- [x] **Step 4: Register the root-only plan review tool and call the bridge**

In `src/extension/index.ts`, add imports near the top:

```ts
import { Type } from "@sinclair/typebox";
import { requestPlannotatorPlanReview } from "../integrations/plannotator.ts";
import { isSuperagentPlannotatorEnabled } from "../execution/superagents-config.ts";
```

Add the tool schema before `registerSubagentExtension()`:

```ts
const SuperpowersPlanReviewParams = Type.Object({
	planContent: Type.String({ description: "Final Superpowers implementation plan markdown content." }),
	planFilePath: Type.Optional(Type.String({ description: "Repository-relative plan file path when the plan was saved to disk." })),
});
```

Inside `registerSubagentExtension(pi)`, before `pi.registerTool(tool);`, add:

```ts
const planReviewTool: ToolDefinition<typeof SuperpowersPlanReviewParams, Details> = {
	name: "superpowers_plan_review",
	label: "Superpowers Plan Review",
	description: "Send the final Superpowers implementation plan through the optional Plannotator browser review bridge. Use only at the normal plan approval point.",
	parameters: SuperpowersPlanReviewParams,
	async execute(_id, params, _signal, _onUpdate, ctx) {
		if (!isSuperagentPlannotatorEnabled(config)) {
			return {
				content: [{
					type: "text",
					text: "Plannotator review is disabled in config. Continue with the normal text-based Superpowers approval flow.",
				}],
				details: { mode: "single", results: [] },
			};
		}

		const outcome = await requestPlannotatorPlanReview({
			events: pi.events,
			planContent: params.planContent,
			planFilePath: params.planFilePath,
		});

		if (outcome.status === "approved") {
			return {
				content: [{ type: "text", text: "Plannotator approved the plan review. Continue the Superpowers workflow." }],
				details: { mode: "single", results: [] },
			};
		}

		if (outcome.status === "rejected") {
			return {
				content: [{
					type: "text",
					text: `Plannotator requested plan changes:\n${outcome.feedback}`,
				}],
				details: { mode: "single", results: [] },
			};
		}

		if (ctx.hasUI) {
			ctx.ui.notify(`Plannotator unavailable: ${outcome.reason}. Falling back to text-based approval.`, "warning");
		}
		return {
			content: [{
				type: "text",
				text: `Plannotator unavailable: ${outcome.reason}\nContinue with the normal text-based Superpowers approval flow.`,
			}],
			details: { mode: "single", results: [] },
		};
	},
};
```

Register it:

```ts
pi.registerTool(planReviewTool);
pi.registerTool(tool);
```

In `src/slash/slash-commands.ts`, update `buildSuperpowersRootPrompt()` input:

```ts
usePlannotatorReview: profile.usePlannotatorReview,
```

In `src/superpowers/workflow-profile.ts`, extend the resolved profile:

```ts
export interface ResolvedSuperpowersRunProfile {
	commandName: string;
	task: string;
	useSubagents: boolean;
	useTestDrivenDevelopment: boolean;
	usePlannotatorReview: boolean;
	fork: boolean;
}
```

and inside `resolveSuperpowersRunProfile()` return:

```ts
usePlannotatorReview: settings.plannotator?.enabled ?? false,
```

- [x] **Step 5: Run the tests to verify they pass**

Run:

```bash
node --experimental-strip-types --test test/unit/superpowers-root-prompt.test.ts
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/slash-commands.test.ts test/integration/plannotator-review-tool.test.ts
```

Expected:
- PASS

- [x] **Step 6: Commit**

```bash
git add src/superpowers/root-prompt.ts src/superpowers/workflow-profile.ts src/slash/slash-commands.ts src/extension/index.ts test/unit/superpowers-root-prompt.test.ts test/integration/slash-commands.test.ts test/integration/plannotator-review-tool.test.ts
git commit -m "feat: wire plannotator review into superpowers approval"
```

Task 3 code-review follow-up:
- [x] Clarify the Plannotator approval-point wording so rejected plans can be revised and resubmitted without contradicting the approval gate rule.
- [x] Final follow-up: align the bridge and review-tool tests with Plannotator's shared `respond()` + `plannotator:review-result` contract, and fail softly on synchronous event-bus errors.
- [x] Guard non-UI slash-command paths for usage errors and `/superpowers-status`, with regression coverage.
- [x] Add concise documentation headers for the remaining non-trivial helpers in `src/extension/index.ts`.

## Task 4: Document the Optional Browser Review Flow

**Files:**
- Modify: `docs/reference/configuration.md`
- Modify: `docs/guides/superpowers.md`

- [x] **Step 1: Write the failing documentation expectations by inspection**

Before editing, confirm the docs do **not** mention Plannotator yet:

```bash
rg -n "plannotator|browser review|plan-review" docs/reference/configuration.md docs/guides/superpowers.md
```

Expected:
- no matches

- [x] **Step 2: Update the configuration reference**

In `docs/reference/configuration.md`, add this new override example under `## Common Override Examples`:

```md
Enable optional Plannotator browser review for Superpowers implementation plans:

```json
{
  "superagents": {
    "plannotator": {
      "enabled": true
    }
  }
}
```
```

In the `### superagents` table, add:

```md
| `plannotator.enabled` | Open the optional Plannotator browser review UI at the Superpowers plan approval point and wait for approval/rejection (default: `false`). |
```

Add a short note directly below the table:

```md
When `plannotator.enabled` is `true`, install Plannotator separately:

```bash
pi install npm:@plannotator/pi-extension
```

`pi-superagents` uses only Plannotator's shared event API. Do not enable Plannotator's native `/plannotator` planning mode for the same Superpowers workflow.
```

- [x] **Step 3: Update the Superpowers guide**

In `docs/guides/superpowers.md`, add a new section after `## Worktree Isolation`:

```md
## Optional Plannotator Browser Review

Superpowers can optionally hand off implementation-plan approval to Plannotator's browser review UI without giving up ownership of the planning workflow itself.

Enable it in `~/.pi/agent/extensions/subagent/config.json`:

```json
{
  "superagents": {
    "plannotator": {
      "enabled": true
    }
  }
}
```

Then install Plannotator separately:

```bash
pi install npm:@plannotator/pi-extension
```

Behavior:

1. Superpowers finishes the implementation plan.
2. `pi-superagents` emits Plannotator's shared `plan-review` event.
3. If Plannotator is available, the browser review UI opens and approval/rejection feeds back into the Superpowers plan loop.
4. If Plannotator is unavailable, Superpowers shows a warning and falls back to the normal text-based approval flow.

Do not use Plannotator's native `/plannotator` planning mode for the same workflow. This integration uses only the shared event bridge.
```

- [x] **Step 4: Verify the documentation text**

Run:

```bash
rg -n "plannotator|browser review|shared event API|/plannotator" docs/reference/configuration.md docs/guides/superpowers.md
```

Expected:
- matches in both files
- references to separate installation and the warning not to use native `/plannotator` mode

- [x] **Step 5: Commit**

```bash
git add docs/reference/configuration.md docs/guides/superpowers.md
git commit -m "docs: explain optional plannotator review bridge"
```

Task 4 code-review follow-up:
- [x] Align the Superpowers guide worktree wording with the documented default `worktrees.enabled: false`.
- [x] Reformat the configuration reference Plannotator install note so the separate install command and `/plannotator` warning stand out.
- [x] Clarify in the Superpowers guide that enabling `plannotator.enabled` without installing Plannotator falls back to normal in-chat approval.

## Task 5: Final Verification

**Files:**
- Verify only; no planned source edits

- [x] **Step 1: Run all focused unit tests**

Run:

```bash
node --experimental-strip-types --test test/unit/default-config.test.ts test/unit/config-validation.test.ts test/unit/superagents-config.test.ts test/unit/superpowers-root-prompt.test.ts test/unit/plannotator-bridge.test.ts
```

Expected:
- PASS

- [x] **Step 2: Run all focused integration tests**

Run:

```bash
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/slash-commands.test.ts test/integration/plannotator-review-tool.test.ts
```

Expected:
- PASS

- [x] **Step 3: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected:
- PASS with no TypeScript errors

- [x] **Step 4: Inspect the final diff**

Run:

```bash
git diff --stat --check
```

Expected:
- no whitespace errors
- diff limited to the config surface, bridge module, prompt/tool wiring, tests, and docs listed above

- [x] **Step 5: Commit verification fixes if needed**

If any verification command required follow-up edits, commit them before handing off:

```bash
git add src docs test default-config.json config.example.json
git commit -m "chore: finish plannotator bridge verification"
```

If no fixes were needed, do not create an extra commit.

## Self-Review

- **Spec coverage:**
  - optional boolean config flag: covered in Task 1
  - strict validation and unknown-key rejection: covered in Task 1
  - event-only bridge module: covered in Task 2
  - exact approval-path call site: covered in Task 3 via `superpowers_plan_review` and prompt contract
  - fail-soft unavailable behavior: covered in Tasks 2 and 3
  - docs for separate install and no native `/plannotator` mode: covered in Task 4
  - unit and integration tests: covered in Tasks 1–3 and final verification
- **Placeholder scan:** no `TODO`, `TBD`, or “similar to Task N” shortcuts remain.
- **Type consistency:** `superagents.plannotator.enabled`, `isSuperagentPlannotatorEnabled`, `requestPlannotatorPlanReview`, and `superpowers_plan_review` are named consistently throughout the plan.
