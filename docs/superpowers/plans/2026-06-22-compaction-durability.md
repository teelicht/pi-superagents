# Compaction Durability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in, reason-aware re-injection layer that re-arms the Superpowers root contract after pi session compaction, sized by the new `session_compact` `reason`/`willRetry` fields.

**Architecture:** A new `context`-event handler re-injects the bootstrap after compaction, gated by an opt-in flag on `SubagentState` set at `/sp-*`/`/skill:` dispatch sites. The `session_compact` handler reads `reason` to size the injection (full/trimmed/pointer). Content production is shared with the existing `before_agent_start` initial-bootstrap path via the existing `buildSuperpowersRootPrompt` and a new `buildCompactionReminder` helper.

**Tech Stack:** TypeScript, pi extension API (`context`/`session_compact`/`agent_end`/`session_start` events), `node:test` + `node:assert/strict`, biome lint.

## Global Constraints

- TypeScript for all source code (AGENTS.md): `.ts` only, no new plain JS.
- Test framework: `node:test` with `node:assert/strict` — run unit tests via `pnpm run test:unit` (resolves to `node --experimental-strip-types --test test/unit/*.test.ts`).
- Lint: `pnpm run lint` (resolves to `biome check --write`).
- Every source file needs a file header (module purpose, responsibilities, dependencies). Every non-trivial function needs a doc comment (what it does, inputs/outputs, invariants).
- Never inject into sessions where the user hasn't opted in. The opt-in flag is `false` by default and only set `true` at Superpowers command dispatch.
- Skill content must be re-resolved at runtime from disk, never snapshotted in state.

## Spec reference

`docs/superpowers/specs/2026-06-22-compaction-durability-design.md`

**Spec refinement in this plan (resolves open question 2):** The spec's `rootPromptInput: SuperpowersRootPromptInput | null` field is replaced with `rootPromptProfile: ResolvedSuperpowersRunProfile | null`. Rationale: `SuperpowersRootPromptInput` carries resolved skill `.content` strings (snapshots), which contradicts the "re-resolve at runtime" principle. `ResolvedSuperpowersRunProfile` carries only skill *names* + task + flags; the `context` handler re-resolves content at compaction time via the existing `buildResolvedSkillEntryPrompt`. This is cleaner and already supported by the codebase (`buildResolvedSkillEntryPrompt` takes a profile + resolve functions).

---

## Task 1: Add `buildCompactionReminder` to root-prompt.ts

**Files:**
- Modify: `src/superpowers/root-prompt.ts` (extract `triggerBySkillName` to module level; add `buildCompactionReminder`)
- Test: `test/unit/superpowers-root-prompt.test.ts`

**Interfaces:**
- Produces: `buildCompactionReminder(skillNames: string[], sizing: "trimmed" | "pointer"): string` — exported from `src/superpowers/root-prompt.ts`. Task 4's `context` handler uses this for trimmed/pointer sizing.

- [ ] **Step 1: Write the failing tests**

Add these tests to the end of the `describe("Superpowers root prompt", ...)` block in `test/unit/superpowers-root-prompt.test.ts`:

```typescript
	void it("builds a trimmed compaction reminder with lifecycle trigger names", () => {
		const reminder = buildCompactionReminder(
			["verification-before-completion", "receiving-code-review", "finishing-a-development-branch"],
			"trimmed",
		);
		assert.match(reminder, /superpowers:compaction-reminder/);
		assert.match(reminder, /You are mid-Superpowers-run/);
		assert.match(reminder, /verification-before-completion/);
		assert.match(reminder, /receiving-code-review/);
		assert.match(reminder, /finishing-a-development-branch/);
		assert.match(reminder, /Resume your current task/);
	});

	void it("builds a pointer compaction reminder in minimal one-line form", () => {
		const reminder = buildCompactionReminder(
			["verification-before-completion", "finishing-a-development-branch"],
			"pointer",
		);
		assert.match(reminder, /superpowers:compaction-reminder/);
		assert.match(reminder, /Superpowers workflow still active/);
		assert.match(reminder, /verification-before-completion/);
		assert.match(reminder, /finishing-a-development-branch/);
		assert.doesNotMatch(reminder, /You are mid-Superpowers-run/);
	});

	void it("uses fallback trigger text for unknown skill names in compaction reminder", () => {
		const reminder = buildCompactionReminder(["custom-skill"], "trimmed");
		assert.match(reminder, /Invoke `custom-skill` at its trigger point/);
	});
```

Also add `buildCompactionReminder` to the existing import on line 14:

```typescript
import { buildCompactionReminder, buildSuperpowersRootPrompt, buildSuperpowersVisiblePromptSummary } from "../../src/superpowers/root-prompt.ts";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test:unit -- --test-name-pattern="compaction reminder"`
Expected: FAIL — `buildCompactionReminder` is not exported (import error).

- [ ] **Step 3: Extract `triggerBySkillName` to module level and add `buildCompactionReminder`**

In `src/superpowers/root-prompt.ts`, move the `triggerBySkillName` const from inside `buildRootLifecycleSkillsBlock` (currently around line 99) to module level, just above `buildRootLifecycleSkillsBlock`. Then update `buildRootLifecycleSkillsBlock` to reference the module-level constant instead of re-declaring it.

Add the module-level constant (place it before `buildRootLifecycleSkillsBlock`, around line 95):

```typescript
/**
 * Trigger-point descriptions for known root lifecycle skills.
 *
 * Used by both the initial root-prompt lifecycle block and the compaction
 * reminder so trigger wording stays consistent across both paths.
 */
const LIFECYCLE_TRIGGER_BY_SKILL: Record<string, string> = {
	"verification-before-completion": "Before claiming complete, fixed, passing, or ready: invoke `verification-before-completion`.",
	"receiving-code-review": "When receiving or acting on review feedback: invoke `receiving-code-review`.",
	"finishing-a-development-branch": "After implementation is complete and verification passes: invoke `finishing-a-development-branch`.",
};
```

In `buildRootLifecycleSkillsBlock`, replace the local `triggerBySkillName` const (lines 99-103) and its usage on line 104:

```typescript
	const triggerLines = rootLifecycleSkills.map((skill) => `- ${LIFECYCLE_TRIGGER_BY_SKILL[skill.name] ?? `Invoke \`${skill.name}\` at the trigger point described in its skill content.`}`);
```

(Delete the local `const triggerBySkillName: Record<string, string> = { ... };` block that was lines 99-103.)

Add `buildCompactionReminder` after `buildRootLifecycleSkillsBlock` (after the closing `}` of that function, around line 114):

```typescript
/**
 * Build a compaction-durability reminder for trimmed or pointer sizing.
 *
 * Produces a hidden reminder containing lifecycle-skill trigger names so the
 * model can re-arm its workflow after compaction without the full root
 * contract. Used by the `context`-event re-injection handler for `overflow`
 * (trimmed) and `manual` (pointer) compaction reasons.
 *
 * @param skillNames Root lifecycle skill names from the active entrypoint.
 * @param sizing "trimmed" (overflow — full reminder) or "pointer" (manual — minimal one-liner).
 * @returns Reminder text wrapped in an EXTREMELY_IMPORTANT marker block.
 */
export function buildCompactionReminder(skillNames: string[], sizing: "trimmed" | "pointer"): string {
	const triggerLines = skillNames.map((name) => `- ${LIFECYCLE_TRIGGER_BY_SKILL[name] ?? `Invoke \`${name}\` at its trigger point.`}`);
	if (sizing === "pointer") {
		return [
			"<EXTREMELY_IMPORTANT>",
			"superpowers:compaction-reminder",
			"",
			"Superpowers workflow still active. Invoke lifecycle skills at their trigger points:",
			...triggerLines,
			"</EXTREMELY_IMPORTANT>",
		].join("\n");
	}
	return [
		"<EXTREMELY_IMPORTANT>",
		"superpowers:compaction-reminder",
		"",
		"You are mid-Superpowers-run. Context was compacted. Re-arm your workflow:",
		...triggerLines,
		"- Resume your current task using the kept context above.",
		"</EXTREMELY_IMPORTANT>",
	].join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test:unit -- --test-name-pattern="compaction reminder"`
Expected: PASS — all three new tests pass.

- [ ] **Step 5: Run full unit suite to verify no regressions**

Run: `pnpm run test:unit`
Expected: PASS — all existing root-prompt tests still pass (the `triggerBySkillName` extraction doesn't change behavior).

- [ ] **Step 6: Lint**

Run: `pnpm run lint`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/superpowers/root-prompt.ts test/unit/superpowers-root-prompt.test.ts
git commit -m "feat(superpowers): add buildCompactionReminder for compaction-durability re-injection

Extract LIFECYCLE_TRIGGER_BY_SKILL to module level so both the initial
root-prompt lifecycle block and the new compaction reminder share
trigger wording. Add buildCompactionReminder(skillNames, sizing) for
trimmed (overflow) and pointer (manual) re-injection sizing."
```

---

## Task 2: Extract shared `buildSuperpowersContractMessage` factory

**Files:**
- Modify: `src/superpowers/prompt-dispatch.ts` (extract factory; refactor `before_agent_start` handler)
- Test: `test/unit/superpowers-prompt-dispatch.test.ts`

**Interfaces:**
- Produces: `buildSuperpowersContractMessage(content: string): { customType: string; content: string; display: boolean }` — exported from `src/superpowers/prompt-dispatch.ts`. Task 4's `context` handler uses this for the shared message shape.

- [ ] **Step 1: Write the failing test**

Add this test to the end of the `describe("Superpowers prompt dispatcher", ...)` block in `test/unit/superpowers-prompt-dispatch.test.ts`:

```typescript
	void it("buildSuperpowersContractMessage produces the hidden contract message shape", () => {
		const message = buildSuperpowersContractMessage("contract text");
		assert.equal(message.customType, SUPERPOWERS_CONTRACT_CUSTOM_TYPE);
		assert.equal(message.content, "contract text");
		assert.equal(message.display, false);
	});
```

Add `buildSuperpowersContractMessage` to the import on line 12:

```typescript
import { buildSuperpowersContractMessage, createSuperpowersPromptDispatcher, SUPERPOWERS_CONTRACT_CUSTOM_TYPE } from "../../src/superpowers/prompt-dispatch.ts";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test:unit -- --test-name-pattern="buildSuperpowersContractMessage"`
Expected: FAIL — `buildSuperpowersContractMessage` is not exported.

- [ ] **Step 3: Extract the factory and refactor the handler**

In `src/superpowers/prompt-dispatch.ts`, add the factory function after the `SUPERPOWERS_CONTRACT_CUSTOM_TYPE` constant (around line 17):

```typescript
/**
 * Build the hidden Superpowers contract message shape.
 *
 * Shared by the `before_agent_start` initial-bootstrap path and the
 * `context`-event compaction re-injection path so both produce the same
 * custom-type hidden message. Callers wrap the returned object in their
 * respective event-return shapes.
 *
 * @param content Contract or reminder text to inject as hidden model context.
 * @returns Custom message object with the Superpowers contract type and display disabled.
 */
export function buildSuperpowersContractMessage(content: string): {
	customType: string;
	content: string;
	display: boolean;
} {
	return {
		customType: SUPERPOWERS_CONTRACT_CUSTOM_TYPE,
		content,
		display: false,
	};
}
```

Refactor the `before_agent_start` handler (around line 49-60) to use the factory. Replace the inline `message` object:

```typescript
	maybePi.on?.("before_agent_start", (event) => {
		if (!isSuperpowersVisibleSummary(event.prompt)) return undefined;
		const hiddenContract = pendingHiddenContracts.shift();
		if (!hiddenContract) return undefined;
		return {
			message: buildSuperpowersContractMessage(hiddenContract),
		};
	});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test:unit -- --test-name-pattern="buildSuperpowersContractMessage"`
Expected: PASS.

- [ ] **Step 5: Run full unit suite to verify no regressions**

Run: `pnpm run test:unit`
Expected: PASS — the existing dispatcher tests still pass (the refactor preserves behavior).

- [ ] **Step 6: Lint**

Run: `pnpm run lint`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/superpowers/prompt-dispatch.ts test/unit/superpowers-prompt-dispatch.test.ts
git commit -m "refactor(superpowers): extract buildSuperpowersContractMessage factory

Share the hidden contract message shape between the existing
before_agent_start initial-bootstrap path and the upcoming context-event
compaction re-injection path. No behavior change."
```

---

## Task 3: Extend `SubagentState` with compaction-durability fields

**Files:**
- Modify: `src/shared/types.ts` (add type import + four fields to `SubagentState`)
- Modify: `src/extension/index.ts` (update state initialization)
- Test: `test/unit/types-fork-preamble.test.ts` (add type-level test) — or a new `test/unit/subagent-state.test.ts` if the existing file doesn't cover `SubagentState`.

**Interfaces:**
- Produces: `SubagentState` gains `superpowersActive`, `compactionSizing`, `rootLifecycleSkillNames`, `rootPromptProfile`. Tasks 4–5 rely on these fields.

- [ ] **Step 1: Write the failing test**

Create `test/unit/subagent-state.test.ts`:

```typescript
/**
 * Unit tests for SubagentState compaction-durability fields.
 *
 * Responsibilities:
 * - verify new compaction-durability fields exist on SubagentState
 * - verify default values match the opt-in (false/null/empty) contract
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SubagentState } from "../../src/shared/types.ts";

void describe("SubagentState compaction-durability fields", () => {
	void it("accepts the four new compaction-durability fields", () => {
		const state: SubagentState = {
			baseCwd: "/tmp",
			currentSessionId: null,
			lastUiContext: null,
			configGate: { blocked: false, diagnostics: [], message: "", configPath: undefined, examplePath: undefined },
			superpowersActive: true,
			compactionSizing: "full",
			rootLifecycleSkillNames: ["verification-before-completion"],
			rootPromptProfile: {
				commandName: "sp-implement",
				task: "fix auth",
				entrySkill: "using-superpowers",
				fork: false,
				rootLifecycleSkillNames: ["verification-before-completion"],
			},
		};
		assert.equal(state.superpowersActive, true);
		assert.equal(state.compactionSizing, "full");
		assert.deepEqual(state.rootLifecycleSkillNames, ["verification-before-completion"]);
		assert.equal(state.rootPromptProfile?.task, "fix auth");
	});

	void it("allows opt-in defaults (false, null, empty)", () => {
		const state: SubagentState = {
			baseCwd: "/tmp",
			currentSessionId: null,
			lastUiContext: null,
			configGate: { blocked: false, diagnostics: [], message: "", configPath: undefined, examplePath: undefined },
			superpowersActive: false,
			compactionSizing: null,
			rootLifecycleSkillNames: [],
			rootPromptProfile: null,
		};
		assert.equal(state.superpowersActive, false);
		assert.equal(state.compactionSizing, null);
		assert.deepEqual(state.rootLifecycleSkillNames, []);
		assert.equal(state.rootPromptProfile, null);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test:unit -- --test-name-pattern="compaction-durability fields"`
Expected: FAIL — TypeScript compile error: `superpowersActive` etc. do not exist on `SubagentState`.

- [ ] **Step 3: Add the type import and fields to `SubagentState`**

In `src/shared/types.ts`, add a type-only import near the top (after line 17, the existing `ExtensionContext` import):

```typescript
import type { ResolvedSuperpowersRunProfile } from "../superpowers/workflow-profile.ts";
```

Extend `SubagentState` (currently lines 327-332). Replace the interface:

```typescript
export interface SubagentState {
	baseCwd: string;
	currentSessionId: string | null;
	lastUiContext: ExtensionContext | null;
	configGate: ConfigGateState;
	/** Opt-in gate: true only after a Superpowers command has fired this session. */
	superpowersActive: boolean;
	/** Last compaction's sizing class, set by session_compact, read by context. Null when no compaction has occurred. */
	compactionSizing: "full" | "trimmed" | "pointer" | null;
	/** Root lifecycle skill names, captured at command fire for the trimmed/pointer reminder. */
	rootLifecycleSkillNames: string[];
	/** Resolved run profile, captured at command fire for full-sizing re-injection. Skill content is re-resolved at compaction time, not snapshotted. */
	rootPromptProfile: ResolvedSuperpowersRunProfile | null;
}
```

- [ ] **Step 4: Update state initialization in `src/extension/index.ts`**

In `registerSubagentExtension` (around line 240), extend the `state` object:

```typescript
	const state: SubagentState = {
		baseCwd: process.cwd(),
		currentSessionId: null,
		lastUiContext: null,
		configGate: { blocked: false, diagnostics: [], message: "", configPath: undefined, examplePath: undefined },
		superpowersActive: false,
		compactionSizing: null,
		rootLifecycleSkillNames: [],
		rootPromptProfile: null,
	};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm run test:unit -- --test-name-pattern="compaction-durability fields"`
Expected: PASS.

- [ ] **Step 6: Run full unit suite + type check**

Run: `pnpm run test:unit`
Expected: PASS — no regressions. The type-only import is erased at runtime so no circular-dependency issues.

- [ ] **Step 7: Lint**

Run: `pnpm run lint`
Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add src/shared/types.ts src/extension/index.ts test/unit/subagent-state.test.ts
git commit -m "feat(superpowers): add compaction-durability fields to SubagentState

Add superpowersActive (opt-in gate), compactionSizing (reason-sized
injection class), rootLifecycleSkillNames, and rootPromptProfile. All
default to opt-out values (false/null/empty). The profile stores skill
names only; content is re-resolved at compaction time."
```

---

## Task 4: Add compaction-durability helpers module

**Files:**
- Create: `src/extension/compaction-durability.ts` (helpers + handler-registration function)
- Test: `test/unit/compaction-durability.test.ts`

**Interfaces:**
- Produces: `resolveCompactionSizing(reason: string): "full" | "trimmed" | "pointer"` — pure sizing function.
- Produces: `messageContainsBootstrap(message: unknown): boolean` — idempotency marker scan.
- Produces: `firstNonCompactionSummaryIndex(messages: unknown[]): number` — insertion-point helper.
- Produces: `registerCompactionDurabilityHandlers(pi, state, deps): void` — registers `session_compact`, `context`, and `agent_end` handlers. Task 5 calls this from `index.ts`.

- [ ] **Step 1: Write the failing tests**

Create `test/unit/compaction-durability.test.ts`:

```typescript
/**
 * Unit tests for compaction-durability helpers.
 *
 * Responsibilities:
 * - verify reason → sizing mapping
 * - verify bootstrap-marker idempotency detection
 * - verify compaction-summary insertion-point calculation
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	firstNonCompactionSummaryIndex,
	messageContainsBootstrap,
	resolveCompactionSizing,
} from "../../src/extension/compaction-durability.ts";

void describe("resolveCompactionSizing", () => {
	void it("maps threshold to full", () => {
		assert.equal(resolveCompactionSizing("threshold"), "full");
	});
	void it("maps overflow to trimmed", () => {
		assert.equal(resolveCompactionSizing("overflow"), "trimmed");
	});
	void it("maps manual to pointer", () => {
		assert.equal(resolveCompactionSizing("manual"), "pointer");
	});
	void it("defaults unknown reasons to pointer", () => {
		assert.equal(resolveCompactionSizing("unknown"), "pointer");
	});
});

void describe("messageContainsBootstrap", () => {
	void it("detects the compaction-reminder marker in a custom message", () => {
		assert.equal(
			messageContainsBootstrap({ role: "custom", customType: "superpowers-root-contract", content: "superpowers:compaction-reminder\nrest", display: false }),
			true,
		);
	});
	void it("detects the contract marker in a custom message", () => {
		assert.equal(
			messageContainsBootstrap({ role: "custom", customType: "superpowers-root-contract", content: "# Superpowers Root Session Contract\nrest", display: false }),
			true,
		);
	});
	void it("returns false for unrelated messages", () => {
		assert.equal(
			messageContainsBootstrap({ role: "user", content: [{ type: "text", text: "hello" }] }),
			false,
		);
	});
	void it("returns false for null-ish messages", () => {
		assert.equal(messageContainsBootstrap(null), false);
		assert.equal(messageContainsBootstrap(undefined), false);
	});
});

void describe("firstNonCompactionSummaryIndex", () => {
	void it("returns 0 when there are no compaction summaries", () => {
		assert.equal(
			firstNonCompactionSummaryIndex([{ role: "user" }, { role: "assistant" }]),
			0,
		);
	});
	void it("returns 0 for an empty array", () => {
		assert.equal(firstNonCompactionSummaryIndex([]), 0);
	});
	void it("skips leading compactionSummary messages", () => {
		assert.equal(
			firstNonCompactionSummaryIndex([
				{ role: "compactionSummary" },
				{ role: "compactionSummary" },
				{ role: "user" },
			]),
			2,
		);
	});
	void it("stops at the first non-summary message", () => {
		assert.equal(
			firstNonCompactionSummaryIndex([
				{ role: "compactionSummary" },
				{ role: "user" },
				{ role: "compactionSummary" },
			]),
			1,
		);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test:unit -- --test-name-pattern="resolveCompactionSizing|messageContainsBootstrap|firstNonCompactionSummaryIndex"`
Expected: FAIL — module `src/extension/compaction-durability.ts` does not exist.

- [ ] **Step 3: Create the helpers module**

Create `src/extension/compaction-durability.ts`:

```typescript
/**
 * Compaction-durability helpers and handler registration.
 *
 * Responsibilities:
 * - map session_compact reason to a sizing class (full/trimmed/pointer)
 * - detect existing bootstrap markers for idempotent re-injection
 * - find the insertion point after leading compactionSummary messages
 * - register session_compact, context, and agent_end handlers that re-arm
 *   the Superpowers root contract after compaction, gated by SubagentState
 *
 * Important dependencies:
 * - pi ExtensionAPI (event handlers)
 * - SubagentState (opt-in gate + sizing + profile)
 * - buildSuperpowersRootPrompt / buildCompactionReminder (content production)
 * - buildResolvedSkillEntryPrompt (runtime skill re-resolution for full sizing)
 *
 * Side effects:
 * - mutates state.superpowersActive / state.compactionSizing on compaction events
 * - injects messages into the context event's messages array
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildCompactionReminder } from "../superpowers/root-prompt.ts";
import { buildResolvedSkillEntryPrompt } from "../superpowers/skill-entry.ts";
import type { SubagentState } from "../shared/types.ts";
import { resolveAvailableSkill, resolveSkills } from "../shared/skills.ts";
import { buildSuperpowersContractMessage } from "../superpowers/prompt-dispatch.ts";

/** Marker string identifying a compaction-reminder injection. */
const COMPACTION_REMINDER_MARKER = "superpowers:compaction-reminder";

/** Marker string identifying the full root contract injection. */
const ROOT_CONTRACT_MARKER = "# Superpowers Root Session Contract";

/**
 * Map a session_compact reason to a re-injection sizing class.
 *
 * @param reason "threshold" | "overflow" | "manual" (or unknown).
 * @returns "full" for threshold, "trimmed" for overflow, "pointer" for manual/unknown.
 */
export function resolveCompactionSizing(reason: string): "full" | "trimmed" | "pointer" {
	if (reason === "threshold") return "full";
	if (reason === "overflow") return "trimmed";
	return "pointer";
}

/**
 * Check whether a message already contains a Superpowers bootstrap marker.
 *
 * Scans custom-type messages for the compaction-reminder or root-contract
 * marker so the context handler never double-injects.
 *
 * @param message A session message (any shape).
 * @returns True when the message carries a known bootstrap marker.
 */
export function messageContainsBootstrap(message: unknown): boolean {
	if (!message || typeof message !== "object") return false;
	const msg = message as { content?: unknown; customType?: string };
	if (msg.customType !== "superpowers-root-contract") return false;
	const content = typeof msg.content === "string" ? msg.content : "";
	return content.includes(COMPACTION_REMINDER_MARKER) || content.includes(ROOT_CONTRACT_MARKER);
}

/**
 * Find the index after leading compactionSummary messages.
 *
 * @param messages Session messages array (deep copy from the context event).
 * @returns Index where non-summary messages begin (0 when no leading summaries).
 */
export function firstNonCompactionSummaryIndex(messages: unknown[]): number {
	let index = 0;
	while ((messages[index] as { role?: unknown } | undefined)?.role === "compactionSummary") {
		index += 1;
	}
	return index;
}

/**
 * Dependency-injection interface for the handler registration.
 */
export interface CompactionDurabilityDeps {
	/** Current working directory for skill re-resolution. */
	cwd: () => string;
}

/**
 * Register compaction-durability event handlers with Pi.
 *
 * Registers three handlers:
 * - session_compact: re-arms the opt-in flag (only if already active) and
 *   sets compactionSizing from event.reason.
 * - context: re-injects the bootstrap sized by compactionSizing, with
 *   idempotency marker scan and insertion after compactionSummary messages.
 * - agent_end: consumes the opt-in flag after each turn.
 *
 * All handlers are fail-soft: errors are caught and never break compaction
 * or the LLM call.
 *
 * @param pi Extension API for event registration.
 * @param state SubagentState holding the opt-in gate and sizing.
 * @param deps Dependencies (cwd accessor for skill re-resolution).
 */
export function registerCompactionDurabilityHandlers(
	pi: ExtensionAPI,
	state: SubagentState,
	_deps: CompactionDurabilityDeps,
): void {
	pi.on("session_compact", (event: { reason?: string; willRetry?: boolean }) => {
		try {
			if (!state.superpowersActive) return;
			state.superpowersActive = true;
			state.compactionSizing = resolveCompactionSizing(event.reason ?? "manual");
		} catch {
			// Never break compaction — leave state as-is.
		}
	});

	pi.on("context", (event: { messages: unknown[] }) => {
		try {
			if (!state.superpowersActive) return;
			if (event.messages.some(messageContainsBootstrap)) return;

			const sizing = state.compactionSizing ?? "full";
			let content: string | null = null;

			if (sizing === "full" && state.rootPromptProfile) {
				const promptResult = buildResolvedSkillEntryPrompt({
					cwd: state.baseCwd,
					profile: state.rootPromptProfile,
					resolveSkill: resolveAvailableSkill,
					resolveSkillNames: resolveSkills,
				});
				if ("error" in promptResult) return;
				content = promptResult.prompt;
			} else if (sizing !== "full") {
				content = buildCompactionReminder(state.rootLifecycleSkillNames, sizing);
			}

			if (!content) return;

			const message = {
				role: "custom" as const,
				...buildSuperpowersContractMessage(content),
			};
			const insertAt = firstNonCompactionSummaryIndex(event.messages);
			return {
				messages: [
					...event.messages.slice(0, insertAt),
					message,
					...event.messages.slice(insertAt),
				],
			};
		} catch {
			// Never break the LLM call — no-op on error.
		}
	});

	pi.on("agent_end", () => {
		try {
			state.superpowersActive = false;
		} catch {
			// Best effort — never break agent_end.
		}
	});
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test:unit -- --test-name-pattern="resolveCompactionSizing|messageContainsBootstrap|firstNonCompactionSummaryIndex"`
Expected: PASS — all helper tests pass.

- [ ] **Step 5: Run full unit suite**

Run: `pnpm run test:unit`
Expected: PASS — no regressions.

- [ ] **Step 6: Lint**

Run: `pnpm run lint`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/extension/compaction-durability.ts test/unit/compaction-durability.test.ts
git commit -m "feat(superpowers): add compaction-durability helpers and handler module

Add resolveCompactionSizing (reason→sizing), messageContainsBootstrap
(idempotency marker scan), firstNonCompactionSummaryIndex (insertion
point), and registerCompactionDurabilityHandlers (session_compact +
context + agent_end handlers). The context handler re-resolves skill
content at runtime via buildResolvedSkillEntryPrompt for full sizing."
```

---

## Task 5: Wire handlers into index.ts and set opt-in flag at dispatch sites

**Files:**
- Modify: `src/extension/index.ts` (register handlers; set opt-in at intercepted `/skill:` site; update `session_start`)
- Modify: `src/slash/slash-commands.ts` (set opt-in at `/sp-*` dispatch site)
- Test: `test/integration/compaction-durability.test.ts`

**Interfaces:**
- Consumes: `registerCompactionDurabilityHandlers` from Task 4; `SubagentState` fields from Task 3; `buildCompactionReminder` from Task 1.
- Produces: a fully wired compaction-durability layer that activates on `/sp-*`/`/skill:` dispatch and re-injects after compaction.

- [ ] **Step 1: Write the failing integration tests**

Create `test/integration/compaction-durability.test.ts`:

```typescript
/**
 * Integration tests for compaction-durability lifecycle.
 *
 * Responsibilities:
 * - verify opt-in gate: no injection without a Superpowers command
 * - verify session_compact reason → sizing → context injection
 * - verify idempotency (no double-injection)
 * - verify agent_end consumes the opt-in flag
 * - verify session_start resets the opt-in flag
 * - verify non-opted-in compaction stays unarmed
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SubagentState } from "../../src/shared/types.ts";
import { registerCompactionDurabilityHandlers } from "../../src/extension/compaction-durability.ts";

type EventHandler = (event: unknown) => unknown;
type CtxHandler = (event: { messages: unknown[] }) => { messages: unknown[] } | undefined;

function createPiMock() {
	const handlers = new Map<string, EventHandler[]>();
	return {
		handlers,
		pi: {
			on(event: string, handler: EventHandler) {
				const existing = handlers.get(event) ?? [];
				existing.push(handler);
				handlers.set(event, existing);
			},
		} as unknown as ExtensionAPI,
	};
}

function createState(overrides: Partial<SubagentState> = {}): SubagentState {
	return {
		baseCwd: "/tmp",
		currentSessionId: null,
		lastUiContext: null,
		configGate: { blocked: false, diagnostics: [], message: "", configPath: undefined, examplePath: undefined },
		superpowersActive: false,
		compactionSizing: null,
		rootLifecycleSkillNames: ["verification-before-completion"],
		rootPromptProfile: null,
		...overrides,
	};
}

function fireHandler(handlers: Map<string, EventHandler[]>, event: string, payload: unknown): unknown[] {
	const list = handlers.get(event) ?? [];
	return list.map((h) => h(payload));
}

void describe("compaction-durability lifecycle", () => {
	void it("does not inject on context when superpowersActive is false", () => {
		const { handlers, pi } = createPiMock();
		const state = createState({ superpowersActive: false });
		registerCompactionDurabilityHandlers(pi, state, { cwd: () => "/tmp" });

		const results = fireHandler(handlers, "context", { messages: [{ role: "user" }] });
		assert.equal(results[0], undefined);
	});

	void it("re-arms and sets full sizing on threshold compaction", () => {
		const { handlers, pi } = createPiMock();
		const state = createState({ superpowersActive: true });
		registerCompactionDurabilityHandlers(pi, state, { cwd: () => "/tmp" });

		fireHandler(handlers, "session_compact", { reason: "threshold", willRetry: false });
		assert.equal(state.superpowersActive, true);
		assert.equal(state.compactionSizing, "full");
	});

	void it("sets trimmed sizing on overflow compaction", () => {
		const { handlers, pi } = createPiMock();
		const state = createState({ superpowersActive: true });
		registerCompactionDurabilityHandlers(pi, state, { cwd: () => "/tmp" });

		fireHandler(handlers, "session_compact", { reason: "overflow", willRetry: true });
		assert.equal(state.compactionSizing, "trimmed");
	});

	void it("sets pointer sizing on manual compaction", () => {
		const { handlers, pi } = createPiMock();
		const state = createState({ superpowersActive: true });
		registerCompactionDurabilityHandlers(pi, state, { cwd: () => "/tmp" });

		fireHandler(handlers, "session_compact", { reason: "manual", willRetry: false });
		assert.equal(state.compactionSizing, "pointer");
	});

	void it("injects a trimmed reminder on context after overflow compaction", () => {
		const { handlers, pi } = createPiMock();
		const state = createState({ superpowersActive: true, rootLifecycleSkillNames: ["verification-before-completion"] });
		registerCompactionDurabilityHandlers(pi, state, { cwd: () => "/tmp" });

		fireHandler(handlers, "session_compact", { reason: "overflow", willRetry: true });
		const results = fireHandler(handlers, "context", { messages: [{ role: "user" }] });
		const result = results[0] as { messages: unknown[] } | undefined;
		assert.ok(result, "expected context handler to return messages");
		assert.equal(result.messages.length, 2);
		const injected = result.messages[0] as { role: string; customType: string; content: string; display: boolean };
		assert.equal(injected.role, "custom");
		assert.equal(injected.customType, "superpowers-root-contract");
		assert.match(injected.content, /superpowers:compaction-reminder/);
		assert.match(injected.content, /verification-before-completion/);
	});

	void it("does not double-inject when marker is already present", () => {
		const { handlers, pi } = createPiMock();
		const state = createState({ superpowersActive: true, compactionSizing: "trimmed", rootLifecycleSkillNames: ["verification-before-completion"] });
		registerCompactionDurabilityHandlers(pi, state, { cwd: () => "/tmp" });

		const existingMessage = {
			role: "custom",
			customType: "superpowers-root-contract",
			content: "superpowers:compaction-reminder\nalready here",
			display: false,
		};
		const results = fireHandler(handlers, "context", { messages: [existingMessage, { role: "user" }] });
		assert.equal(results[0], undefined);
	});

	void it("inserts after leading compactionSummary messages", () => {
		const { handlers, pi } = createPiMock();
		const state = createState({ superpowersActive: true, compactionSizing: "trimmed", rootLifecycleSkillNames: [] });
		registerCompactionDurabilityHandlers(pi, state, { cwd: () => "/tmp" });

		const results = fireHandler(handlers, "context", {
			messages: [{ role: "compactionSummary" }, { role: "compactionSummary" }, { role: "user" }],
		});
		const result = results[0] as { messages: unknown[] };
		assert.equal(result.messages.length, 4);
		assert.equal((result.messages[0] as { role: string }).role, "compactionSummary");
		assert.equal((result.messages[1] as { role: string }).role, "compactionSummary");
		assert.equal((result.messages[2] as { role: string }).role, "custom");
	});

	void it("agent_end consumes the opt-in flag", () => {
		const { handlers, pi } = createPiMock();
		const state = createState({ superpowersActive: true });
		registerCompactionDurabilityHandlers(pi, state, { cwd: () => "/tmp" });

		fireHandler(handlers, "agent_end", {});
		assert.equal(state.superpowersActive, false);
	});

	void it("does not re-arm on session_compact when not opted in", () => {
		const { handlers, pi } = createPiMock();
		const state = createState({ superpowersActive: false });
		registerCompactionDurabilityHandlers(pi, state, { cwd: () => "/tmp" });

		fireHandler(handlers, "session_compact", { reason: "threshold", willRetry: false });
		assert.equal(state.superpowersActive, false);
		assert.equal(state.compactionSizing, null);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test:integration -- --test-name-pattern="compaction-durability lifecycle"`
Expected: FAIL — `registerCompactionDurabilityHandlers` is not yet called from `index.ts`, and the opt-in flag is never set at dispatch sites. (The handler tests themselves should pass from Task 4, but the wiring isn't in place — this test validates the handler registration directly, so it should actually pass. If it passes, the wiring tests are validated at the handler level; the index.ts wiring is verified by the full suite passing in Step 6.)

Note: If these tests pass already (because they test the handler registration directly, not the index.ts wiring), proceed — the index.ts wiring is validated by the full integration suite in Step 6.

- [ ] **Step 3: Register handlers in `src/extension/index.ts`**

Add the import near the top of `src/extension/index.ts` (after the existing `createRuntimeConfigStore` import, around line 32):

```typescript
import { registerCompactionDurabilityHandlers } from "./compaction-durability.ts";
```

In `registerSubagentExtension`, after the existing `pi.on("session_shutdown", ...)` handler (around line 613-615), add:

```typescript
	registerCompactionDurabilityHandlers(pi, state, { cwd: () => state.baseCwd });
```

- [ ] **Step 4: Update `session_start` to reset the opt-in flag**

In `src/extension/index.ts`, the existing `session_start` handler (around line 606) currently calls `resetSessionState(ctx)`. Add the opt-in reset after it:

```typescript
	pi.on("session_start", (_event, ctx) => {
		resetSessionState(ctx);
		state.superpowersActive = false;
		state.compactionSizing = null;
		if (state.configGate.message && ctx.hasUI && configDiagnosticNotifiedForSession !== state.currentSessionId) {
			configDiagnosticNotifiedForSession = state.currentSessionId;
			ctx.ui.notify(state.configGate.message, state.configGate.blocked ? "error" : "warning");
		}
	});
```

- [ ] **Step 5: Set the opt-in flag at the intercepted `/skill:` dispatch site**

In `src/extension/index.ts`, the `input` handler's intercepted-skill path (around line 563, after `buildResolvedSkillEntryPrompt` succeeds and before `skillCommandPromptDispatcher.send`), add the opt-in flag:

```typescript
		// Arm the compaction-durability opt-in flag at dispatch time
		state.superpowersActive = true;
		state.compactionSizing = null;
		state.rootLifecycleSkillNames = profile.rootLifecycleSkillNames ?? [];
		state.rootPromptProfile = profile;

		// Send the prompt to the agent with only flags visible in chat.
		skillCommandPromptDispatcher.send(
```

(Insert the four `state.*` lines between the `if ("error" in promptResult) { ... }` block and the `skillCommandPromptDispatcher.send` call.)

- [ ] **Step 6: Set the opt-in flag at the `/sp-*` dispatch site in `src/slash/slash-commands.ts`**

In `src/slash/slash-commands.ts`, the `sendSkillEntryPrompt` function (around line 80) needs `state` passed in. Update its signature and add the opt-in flag before `dispatcher.send`:

```typescript
function sendSkillEntryPrompt(
	dispatcher: ReturnType<typeof createSuperpowersPromptDispatcher>,
	ctx: ExtensionContext,
	profile: ResolvedSuperpowersRunProfile,
	state: SubagentState,
): void {
	const promptResult = buildResolvedSkillEntryPrompt({
		cwd: ctx.cwd,
		profile,
		resolveSkill: resolveAvailableSkill,
		resolveSkillNames: resolveSkills,
	});
	if ("error" in promptResult) {
		if (ctx.hasUI) ctx.ui.notify(promptResult.error, "error");
		return;
	}

	// Arm the compaction-durability opt-in flag at dispatch time
	state.superpowersActive = true;
	state.compactionSizing = null;
	state.rootLifecycleSkillNames = profile.rootLifecycleSkillNames ?? [];
	state.rootPromptProfile = profile;

	const wasIdle = ctx.isIdle();
	dispatcher.send(
```

Update all call sites of `sendSkillEntryPrompt` to pass `state`. Find each call (there should be one or more in the command handlers registered by `registerSlashCommands`) and add `state` as the fourth argument. For example:

```typescript
	sendSkillEntryPrompt(dispatcher, ctx, profile, state);
```

(Search for `sendSkillEntryPrompt(` in `src/slash/slash-commands.ts` and add `, state` before the closing `)` at each call site.)

- [ ] **Step 7: Run the integration tests**

Run: `pnpm run test:integration -- --test-name-pattern="compaction-durability"`
Expected: PASS.

- [ ] **Step 8: Run the full test suite**

Run: `pnpm run test:unit && pnpm run test:integration`
Expected: PASS — no regressions in existing tests. The `sendSkillEntryPrompt` signature change is covered by the existing `slash-commands.test.ts`.

- [ ] **Step 9: Lint**

Run: `pnpm run lint`
Expected: No errors.

- [ ] **Step 10: Commit**

```bash
git add src/extension/index.ts src/slash/slash-commands.ts test/integration/compaction-durability.test.ts
git commit -m "feat(superpowers): wire compaction-durability handlers and opt-in gate

Register session_compact/context/agent_end handlers from index.ts. Set
the opt-in flag at both dispatch sites (intercepted /skill: in index.ts
and /sp-* in slash-commands.ts). session_start resets the flag to false
(opt-in is not sticky across sessions). sendSkillEntryPrompt now
receives state to set the flag at dispatch time."
```

---

## Task 6: User documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/skills.md`

**Interfaces:**
- Consumes: the completed feature from Tasks 1–5.

- [ ] **Step 1: Read the current README and docs/skills.md**

Run: `read README.md` and `read docs/skills.md` to find the right insertion points.

- [ ] **Step 2: Add compaction-durability note to README.md**

Add a section in the features or behavior area of `README.md`:

```markdown
## Compaction Durability

During long autonomous Superpowers runs, pi may compact the session context
(auto-compaction at the context threshold, or overflow recovery). The
Superpowers extension automatically re-arms the root contract after
compaction so the model retains lifecycle-trigger awareness
(`verification-before-completion`, `receiving-code-review`,
`finishing-a-development-branch`).

This behavior is **opt-in**: it only activates after a Superpowers command
(`/sp-*` or an intercepted `/skill:brainstorming` / `/skill:writing-plans`)
has been dispatched. Normal sessions without a Superpowers command are
unaffected.

The re-injection is sized by the compaction flow:
- **Threshold** (auto-compaction): full root contract re-injected.
- **Overflow** (context window exceeded): trimmed reminder only, to avoid
  re-overflow on the automatic retry.
- **Manual** (`/compact`): minimal one-line pointer, respecting the user's
  intent to reclaim context.
```

- [ ] **Step 3: Add lifecycle-skill re-arm note to docs/skills.md**

Add to `docs/skills.md` in the lifecycle-skills section:

```markdown
### Re-arming after compaction

When pi compacts the session context mid-Superpowers-run, the extension
re-injects the lifecycle-skill trigger points so the model can continue
invoking `verification-before-completion`, `receiving-code-review`, and
`finishing-a-development-branch` at their trigger points without re-running
the original command. The re-injection is sized by the compaction reason
(threshold = full, overflow = trimmed, manual = pointer) and only occurs
in sessions where a Superpowers command has been explicitly activated.
```

- [ ] **Step 4: Lint**

Run: `pnpm run lint`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/skills.md
git commit -m "docs(superpowers): document compaction-durability behavior

Add README section on the opt-in compaction-durability feature and the
docs/skills.md note on lifecycle-skill re-arming after compaction."
```

---

## Self-Review

**1. Spec coverage:**

| Spec section | Task |
|---|---|
| `SubagentState` additions (§1) | Task 3 |
| Opt-in trigger at dispatch sites (§2) | Task 5 (Steps 5–6) |
| `session_compact` handler (§3) | Task 4 (registration) + Task 5 (wiring) |
| `context` handler (§4) | Task 4 (registration) + Task 5 (wiring) |
| `agent_end` / `session_start` handlers (§5) | Task 4 (agent_end) + Task 5 (session_start) |
| `buildCompactionReminder` (§6) | Task 1 |
| `buildSuperpowersContractMessage` shared factory (§6) | Task 2 |
| Helpers: `messageContainsBootstrap`, `firstNonCompactionSummaryIndex` (§7) | Task 4 |
| Sizing by reason table (§Architecture) | Task 4 (`resolveCompactionSizing`) |
| Error handling (try/catch, no-op) | Task 4 (handlers) |
| Testing (unit + integration) | Tasks 1–5 (tests in each) |
| User documentation | Task 6 |
| Open question 1 (custom-type in context) | Task 4 (uses custom-type; integration tests verify; fallback documented in spec) |
| Open question 2 (re-resolve at runtime) | Task 3 (`rootPromptProfile` not `rootPromptInput`) + Task 4 (`buildResolvedSkillEntryPrompt` re-resolves) |

**2. Placeholder scan:** No TBD/TODO/vague text. All code steps contain complete code. All test steps contain complete test code.

**3. Type consistency:**
- `buildCompactionReminder(skillNames: string[], sizing: "trimmed" | "pointer")` — consistent across Task 1 (definition) and Task 4 (usage in `context` handler).
- `resolveCompactionSizing(reason: string): "full" | "trimmed" | "pointer"` — consistent across Task 4 (definition + tests).
- `buildSuperpowersContractMessage(content: string): { customType; content; display }` — consistent across Task 2 (definition) and Task 4 (usage).
- `SubagentState` fields — consistent across Task 3 (definition), Task 4 (usage), Task 5 (usage).
- `rootPromptProfile: ResolvedSuperpowersRunProfile | null` — used consistently (not `rootPromptInput`).

No issues found.
