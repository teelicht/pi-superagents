/**
 * Unit tests for shared tool registry constants.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DELEGATION_TOOLS, READ_ONLY_TOOLS } from "../../src/shared/tool-registry.ts";

void describe("tool-registry", () => {
	void describe("DELEGATION_TOOLS", () => {
		void it("contains subagent and subagent_status", () => {
			assert.ok(DELEGATION_TOOLS.has("subagent"));
			assert.ok(DELEGATION_TOOLS.has("subagent_status"));
		});

		void it("is a frozen set", () => {
			// Object.freeze makes the set immutable as a whole.
			assert.equal(Object.isFrozen(DELEGATION_TOOLS), true);
		});
	});

	void describe("READ_ONLY_TOOLS", () => {
		void it("contains the safe read-only tool baseline", () => {
			assert.deepEqual([...READ_ONLY_TOOLS], ["read", "grep", "find", "ls"]);
		});

		void it("is a frozen array", () => {
			assert.throws(() => {
				(READ_ONLY_TOOLS as string[]).push("should-fail");
			});
		});
	});
});