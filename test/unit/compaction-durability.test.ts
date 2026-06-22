/**
 * Unit tests for compaction-durability helpers.
 *
 * Responsibilities:
 * - verify reason → sizing mapping
 * - verify bootstrap-marker idempotency detection
 * - verify compaction-summary insertion-point calculation
 * - verify registered session_compact / context / agent_end handlers behave
 *   correctly against a mock pi with a fake SubagentState and fake deps
 *   (no real sockets or live skill filesystem resolution exercised)
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	firstNonCompactionSummaryIndex,
	messageContainsBootstrap,
	registerCompactionDurabilityHandlers,
	resolveCompactionSizing,
} from "../../src/extension/compaction-durability.ts";
import type { SubagentState } from "../../src/shared/types.ts";

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
		assert.equal(messageContainsBootstrap({ role: "custom", customType: "superpowers-root-contract", content: "superpowers:compaction-reminder\nrest", display: false }), true);
	});
	void it("detects the contract marker in a custom message", () => {
		assert.equal(messageContainsBootstrap({ role: "custom", customType: "superpowers-root-contract", content: "# Superpowers Root Session Contract\nrest", display: false }), true);
	});
	void it("returns false for unrelated messages", () => {
		assert.equal(messageContainsBootstrap({ role: "user", content: [{ type: "text", text: "hello" }] }), false);
	});
	void it("returns false for null-ish messages", () => {
		assert.equal(messageContainsBootstrap(null), false);
		assert.equal(messageContainsBootstrap(undefined), false);
	});
});

void describe("firstNonCompactionSummaryIndex", () => {
	void it("returns 0 when there are no compaction summaries", () => {
		assert.equal(firstNonCompactionSummaryIndex([{ role: "user" }, { role: "assistant" }]), 0);
	});
	void it("returns 0 for an empty array", () => {
		assert.equal(firstNonCompactionSummaryIndex([]), 0);
	});
	void it("skips leading compactionSummary messages", () => {
		assert.equal(firstNonCompactionSummaryIndex([{ role: "compactionSummary" }, { role: "compactionSummary" }, { role: "user" }]), 2);
	});
	void it("stops at the first non-summary message", () => {
		assert.equal(firstNonCompactionSummaryIndex([{ role: "compactionSummary" }, { role: "user" }, { role: "compactionSummary" }]), 1);
	});
});

void describe("registerCompactionDurabilityHandlers", () => {
	type AnyHandler = (event: unknown) => unknown;

	/** Build a mock pi that captures handlers registered via `on`. */
	function createMockPi(): { pi: ExtensionAPI; handlers: Map<string, AnyHandler> } {
		const handlers = new Map<string, AnyHandler>();
		const pi = {
			on(event: string, handler: AnyHandler) {
				handlers.set(event, handler);
			},
		};
		return { pi: pi as unknown as ExtensionAPI, handlers };
	}

	/** Build a fake SubagentState with opt-in defaults plus optional overrides. */
	function createFakeState(overrides: Partial<SubagentState> = {}): SubagentState {
		return {
			baseCwd: "/tmp/pi-superagents-compaction-durability-test",
			currentSessionId: null,
			lastUiContext: null,
			configGate: { blocked: false, diagnostics: [], message: "", configPath: undefined, examplePath: undefined },
			superpowersActive: false,
			compactionSizing: null,
			rootLifecycleSkillNames: [],
			rootPromptProfile: null,
			...overrides,
		};
	}

	void it("registers one handler each for session_compact, context, and agent_end", () => {
		const { pi, handlers } = createMockPi();
		const state = createFakeState();
		registerCompactionDurabilityHandlers(pi, state, { cwd: () => state.baseCwd });
		assert.ok(handlers.has("session_compact"));
		assert.ok(handlers.has("context"));
		assert.ok(handlers.has("agent_end"));
	});

	void it("session_compact sets compactionSizing from reason when active", () => {
		const { pi, handlers } = createMockPi();
		const state = createFakeState({ superpowersActive: true });
		registerCompactionDurabilityHandlers(pi, state, { cwd: () => state.baseCwd });
		handlers.get("session_compact")?.({ reason: "threshold", willRetry: false });
		assert.equal(state.compactionSizing, "full");
		assert.equal(state.superpowersActive, true);
	});

	void it("session_compact is a no-op when not active", () => {
		const { pi, handlers } = createMockPi();
		const state = createFakeState({ superpowersActive: false });
		registerCompactionDurabilityHandlers(pi, state, { cwd: () => state.baseCwd });
		handlers.get("session_compact")?.({ reason: "threshold", willRetry: false });
		assert.equal(state.compactionSizing, null);
		assert.equal(state.superpowersActive, false);
	});

	void it("session_compact is fail-soft when reading reason throws", () => {
		const { pi, handlers } = createMockPi();
		const state = createFakeState({ superpowersActive: true, compactionSizing: "pointer" });
		registerCompactionDurabilityHandlers(pi, state, { cwd: () => state.baseCwd });
		// Proxy throws on property access to exercise the try/catch guard.
		const throwingEvent = new Proxy(
			{},
			{
				get() {
					throw new Error("boom");
				},
			},
		);
		handlers.get("session_compact")?.(throwingEvent);
		// State is left as-is because the handler swallowed the error.
		assert.equal(state.compactionSizing, "pointer");
		assert.equal(state.superpowersActive, true);
	});

	void it("context is a no-op when not active", () => {
		const { pi, handlers } = createMockPi();
		const state = createFakeState({ superpowersActive: false });
		registerCompactionDurabilityHandlers(pi, state, { cwd: () => state.baseCwd });
		const result = handlers.get("context")?.({ messages: [{ role: "user" }] });
		assert.equal(result, undefined);
	});

	void it("context skips injection when a bootstrap marker is already present", () => {
		const { pi, handlers } = createMockPi();
		const state = createFakeState({
			superpowersActive: true,
			compactionSizing: "trimmed",
			rootLifecycleSkillNames: ["verification-before-completion"],
		});
		registerCompactionDurabilityHandlers(pi, state, { cwd: () => state.baseCwd });
		const result = handlers.get("context")?.({
			messages: [{ role: "custom", customType: "superpowers-root-contract", content: "superpowers:compaction-reminder\nrest", display: false }],
		});
		assert.equal(result, undefined);
	});

	void it("context injects a trimmed reminder after leading compactionSummary messages", () => {
		const { pi, handlers } = createMockPi();
		const state = createFakeState({
			superpowersActive: true,
			compactionSizing: "trimmed",
			rootLifecycleSkillNames: ["verification-before-completion"],
		});
		registerCompactionDurabilityHandlers(pi, state, { cwd: () => state.baseCwd });
		const summary = { role: "compactionSummary" };
		const user = { role: "user" };
		const result = handlers.get("context")?.({ messages: [summary, user] }) as { messages: unknown[] } | undefined;
		assert.ok(result, "expected context handler to return a messages array");
		assert.equal(result.messages.length, 3);
		assert.equal((result.messages[0] as { role: string }).role, "compactionSummary");
		assert.equal((result.messages[1] as { customType: string }).customType, "superpowers-root-contract");
		assert.equal((result.messages[1] as { display: boolean }).display, false);
		assert.match((result.messages[1] as { content: string }).content, /superpowers:compaction-reminder/);
		assert.equal((result.messages[2] as { role: string }).role, "user");
	});

	void it("context injects a pointer reminder at the head when there are no summaries", () => {
		const { pi, handlers } = createMockPi();
		const state = createFakeState({
			superpowersActive: true,
			compactionSizing: "pointer",
			rootLifecycleSkillNames: ["receiving-code-review"],
		});
		registerCompactionDurabilityHandlers(pi, state, { cwd: () => state.baseCwd });
		const result = handlers.get("context")?.({ messages: [{ role: "user" }] }) as { messages: unknown[] } | undefined;
		assert.ok(result);
		assert.equal(result.messages.length, 2);
		assert.match((result.messages[0] as { content: string }).content, /superpowers:compaction-reminder/);
		assert.equal((result.messages[1] as { role: string }).role, "user");
	});

	void it("context returns undefined for full sizing when no rootPromptProfile is set", () => {
		const { pi, handlers } = createMockPi();
		const state = createFakeState({ superpowersActive: true, compactionSizing: "full", rootPromptProfile: null });
		registerCompactionDurabilityHandlers(pi, state, { cwd: () => state.baseCwd });
		const result = handlers.get("context")?.({ messages: [{ role: "user" }] });
		assert.equal(result, undefined);
	});

	void it("context is fail-soft when messages is not array-like", () => {
		const { pi, handlers } = createMockPi();
		const state = createFakeState({
			superpowersActive: true,
			compactionSizing: "trimmed",
			rootLifecycleSkillNames: [],
		});
		registerCompactionDurabilityHandlers(pi, state, { cwd: () => state.baseCwd });
		const result = handlers.get("context")?.({ messages: null as unknown as unknown[] });
		assert.equal(result, undefined);
	});

	void it("agent_end clears the opt-in flag", () => {
		const { pi, handlers } = createMockPi();
		const state = createFakeState({ superpowersActive: true });
		registerCompactionDurabilityHandlers(pi, state, { cwd: () => state.baseCwd });
		handlers.get("agent_end")?.({ messages: [] });
		assert.equal(state.superpowersActive, false);
	});
});
