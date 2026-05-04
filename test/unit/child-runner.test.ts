/**
 * Unit tests for the child runner module.
 *
 * Responsibilities:
 * - verify child-runner exports the prepared child runner entrypoint
 * - verify lifecycle sidecar path helpers used by the runner remain available
 * - avoid real subprocess spawning; subprocess behavior is covered by integration tests
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getLifecycleSidecarPath } from "../../src/execution/lifecycle-signals.ts";
import { getChildRunnerExports } from "../support/child-runner-helpers.ts";

void describe("child-runner module exports", () => {
	void it("exports runPreparedChild as the primary runner function", async () => {
		const exports = await getChildRunnerExports();
		assert.equal(typeof exports.runPreparedChild, "function", "runPreparedChild must be exported");
	});
});

void describe("lifecycle integration helpers", () => {
	void it("getLifecycleSidecarPath returns .exit suffix", () => {
		const path = getLifecycleSidecarPath("/tmp/session.jsonl");
		assert.equal(path, "/tmp/session.jsonl.exit");
	});
});
