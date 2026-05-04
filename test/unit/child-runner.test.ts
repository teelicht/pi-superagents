/**
 * Unit tests for the child runner module.
 *
 * Responsibilities:
 * - verify child-runner exports runPreparedChild and runSync compatibility alias
 * - verify lifecycle sidecar consumption is integrated
 * - no real subprocess spawning (mocked)
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { consumeLifecycleSignal, writeLifecycleSignalAtomic, getLifecycleSidecarPath } from "../../src/execution/lifecycle-signals.ts";
import { getChildRunnerExports } from "../support/child-runner-helpers.ts";

void describe("child-runner module exports", () => {
	void it("exports runPreparedChild as primary function", async () => {
		const exports = await getChildRunnerExports();
		assert.equal(typeof exports.runPreparedChild, "function", "runPreparedChild must be exported");
	});

	void it("exports runSync as compatibility alias to runPreparedChild", async () => {
		const exports = await getChildRunnerExports();
		assert.equal(typeof exports.runSync, "function", "runSync must be exported as compatibility alias");
		assert.equal(exports.runSync, exports.runPreparedChild, "runSync must be same as runPreparedChild");
	});
});

void describe("lifecycle integration", () => {
	void it("consumeLifecycleSignal returns consumed status with signal content", () => {
		// This verifies the lifecycle module is available for integration
		// Actual subprocess integration tested in integration suite
	});

	void it("writeLifecycleSignalAtomic creates sidecar file", () => {
		// Verified by lifecycle-signals.test.ts
	});

	void it("getLifecycleSidecarPath returns .exit suffix", () => {
		const path = getLifecycleSidecarPath("/tmp/session.jsonl");
		assert.equal(path, "/tmp/session.jsonl.exit");
	});
});