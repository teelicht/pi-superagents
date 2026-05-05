/**
 * Unit tests for shared thinking level resolution utilities.
 *
 * Responsibilities:
 * - verify ThinkingLevel type narrowing via VALID_THINKING_LEVELS
 * - verify isThinkingLevel type guard behavior
 * - verify toThinkingLevel fallback priority (agent > tier > undefined)
 * - verify extractThinkingSuffix parses model strings correctly
 *
 * Important dependencies:
 * - src/shared/thinking-levels.ts (module under test)
 */

import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractThinkingSuffix, isThinkingLevel, toThinkingLevel, VALID_THINKING_LEVELS } from "../../src/shared/thinking-levels.ts";

void describe("VALID_THINKING_LEVELS", () => {
	void it("contains all expected thinking level strings", () => {
		assert.deepStrictEqual(VALID_THINKING_LEVELS, ["off", "minimal", "low", "medium", "high", "xhigh"]);
	});
});

void describe("isThinkingLevel", () => {
	void it("returns true for valid thinking levels", () => {
		assert.strictEqual(isThinkingLevel("off"), true);
		assert.strictEqual(isThinkingLevel("minimal"), true);
		assert.strictEqual(isThinkingLevel("low"), true);
		assert.strictEqual(isThinkingLevel("medium"), true);
		assert.strictEqual(isThinkingLevel("high"), true);
		assert.strictEqual(isThinkingLevel("xhigh"), true);
	});

	void it("returns false for invalid strings", () => {
		assert.strictEqual(isThinkingLevel("invalid"), false);
		assert.strictEqual(isThinkingLevel("notalevel"), false);
		assert.strictEqual(isThinkingLevel("HIGH"), false);
	});

	void it("returns false for undefined", () => {
		assert.strictEqual(isThinkingLevel(undefined), false);
	});
});

void describe("toThinkingLevel", () => {
	void it("returns agent thinking when valid", () => {
		assert.strictEqual(toThinkingLevel("high", "medium", false), "high");
		assert.strictEqual(toThinkingLevel("low", "high", true), "low");
		assert.strictEqual(toThinkingLevel("minimal", "high", false), "minimal");
	});

	void it("returns tier thinking when agent is invalid and no override", () => {
		assert.strictEqual(toThinkingLevel("invalid", "medium", false), "medium");
		assert.strictEqual(toThinkingLevel("", "low", false), "low");
		assert.strictEqual(toThinkingLevel(undefined, "high", false), "high");
	});

	void it("returns undefined when agent invalid and has model override", () => {
		assert.strictEqual(toThinkingLevel("invalid", "medium", true), undefined);
		assert.strictEqual(toThinkingLevel(undefined, "high", true), undefined);
		assert.strictEqual(toThinkingLevel("", "low", true), undefined);
	});

	void it("returns undefined when agent invalid, tier invalid, no override", () => {
		assert.strictEqual(toThinkingLevel("invalid", "notalevel", false), undefined);
		assert.strictEqual(toThinkingLevel("", undefined, false), undefined);
	});

	void it("returns undefined when all inputs are undefined", () => {
		assert.strictEqual(toThinkingLevel(undefined, undefined, false), undefined);
		assert.strictEqual(toThinkingLevel(undefined, undefined, true), undefined);
	});

	void it("prioritizes valid agent thinking over tier even with override", () => {
		assert.strictEqual(toThinkingLevel("high", "medium", true), "high");
		assert.strictEqual(toThinkingLevel("low", "high", true), "low");
	});
});

void describe("extractThinkingSuffix", () => {
	void it("extracts valid thinking suffix from model string", () => {
		assert.strictEqual(extractThinkingSuffix("openai/gpt-4o:medium"), "medium");
		assert.strictEqual(extractThinkingSuffix("anthropic/claude-sonnet-4:high"), "high");
		assert.strictEqual(extractThinkingSuffix("openai/gpt-4o:low"), "low");
		assert.strictEqual(extractThinkingSuffix("model:off"), "off");
		assert.strictEqual(extractThinkingSuffix("model:minimal"), "minimal");
		assert.strictEqual(extractThinkingSuffix("model:xhigh"), "xhigh");
	});

	void it("returns undefined when no colon suffix", () => {
		assert.strictEqual(extractThinkingSuffix("openai/gpt-4o"), undefined);
		assert.strictEqual(extractThinkingSuffix("anthropic/claude-sonnet-4"), undefined);
	});

	void it("returns undefined for invalid suffix", () => {
		assert.strictEqual(extractThinkingSuffix("openai/gpt-4o:notalevel"), undefined);
		assert.strictEqual(extractThinkingSuffix("openai/gpt-4o:HIGH"), undefined);
		assert.strictEqual(extractThinkingSuffix("model:invalid"), undefined);
	});

	void it("returns undefined for empty or malformed strings", () => {
		assert.strictEqual(extractThinkingSuffix(""), undefined);
		assert.strictEqual(extractThinkingSuffix(undefined), undefined);
		assert.strictEqual(extractThinkingSuffix("model:"), undefined);
	});
});
