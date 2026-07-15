/**
 * Unit tests for shared thinking level resolution utilities.
 *
 * Responsibilities:
 * - verify toThinkingLevel fallback priority (agent > tier > undefined) with no
 *   extension-side validation, deferring unknown values to Pi
 * - verify extractThinkingSuffix parses any non-empty model suffix through for
 *   Pi to validate
 *
 * Important dependencies:
 * - src/shared/thinking-levels.ts (module under test)
 */

import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractThinkingSuffix, toThinkingLevel } from "../../src/shared/thinking-levels.ts";

void describe("toThinkingLevel", () => {
	void it("returns agent thinking when defined", () => {
		assert.strictEqual(toThinkingLevel("high", "medium", false), "high");
		assert.strictEqual(toThinkingLevel("low", "high", true), "low");
		assert.strictEqual(toThinkingLevel("minimal", "high", false), "minimal");
	});

	void it("returns tier thinking when agent is undefined and no override", () => {
		assert.strictEqual(toThinkingLevel(undefined, "medium", false), "medium");
		assert.strictEqual(toThinkingLevel(undefined, "low", false), "low");
		assert.strictEqual(toThinkingLevel(undefined, "high", false), "high");
	});

	void it("returns undefined when agent is undefined and has model override", () => {
		assert.strictEqual(toThinkingLevel(undefined, "medium", true), undefined);
		assert.strictEqual(toThinkingLevel(undefined, "high", true), undefined);
	});

	void it("returns undefined when all inputs are undefined", () => {
		assert.strictEqual(toThinkingLevel(undefined, undefined, false), undefined);
		assert.strictEqual(toThinkingLevel(undefined, undefined, true), undefined);
	});

	void it("prioritizes agent thinking over tier even with override", () => {
		assert.strictEqual(toThinkingLevel("high", "medium", true), "high");
		assert.strictEqual(toThinkingLevel("low", "high", true), "low");
	});

	void it("passes configured values through for Pi to validate", () => {
		assert.strictEqual(toThinkingLevel("future-level", "medium", false), "future-level");
	});
});

void describe("extractThinkingSuffix", () => {
	void it("extracts thinking suffix from model string", () => {
		assert.strictEqual(extractThinkingSuffix("openai/gpt-4o:medium"), "medium");
		assert.strictEqual(extractThinkingSuffix("anthropic/claude-sonnet-4:high"), "high");
		assert.strictEqual(extractThinkingSuffix("openai/gpt-4o:low"), "low");
		assert.strictEqual(extractThinkingSuffix("model:off"), "off");
		assert.strictEqual(extractThinkingSuffix("model:minimal"), "minimal");
		assert.strictEqual(extractThinkingSuffix("model:xhigh"), "xhigh");
		assert.strictEqual(extractThinkingSuffix("model:max"), "max");
	});

	void it("returns undefined when no colon suffix", () => {
		assert.strictEqual(extractThinkingSuffix("openai/gpt-4o"), undefined);
		assert.strictEqual(extractThinkingSuffix("anthropic/claude-sonnet-4"), undefined);
	});

	void it("returns undefined for empty or malformed strings", () => {
		assert.strictEqual(extractThinkingSuffix(""), undefined);
		assert.strictEqual(extractThinkingSuffix(undefined), undefined);
		assert.strictEqual(extractThinkingSuffix("model:"), undefined);
	});

	void it("passes non-empty model suffixes through for Pi to validate", () => {
		assert.strictEqual(extractThinkingSuffix("provider/model:future-level"), "future-level");
	});
});
