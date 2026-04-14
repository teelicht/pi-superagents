/**
 * Unit tests for run history tracking.
 *
 * Tests the active run lifecycle: startRun, updateRun, finishRun.
 */

import { test } from "node:test";
import * as assert from "node:assert";
import { globalRunHistory, recordRun } from "../../src/execution/run-history.ts";

void test("globalRunHistory tracks active and finished runs", () => {
	globalRunHistory.activeRuns.clear();
	const runId = "test-run-123";

	// Start
	globalRunHistory.startRun(runId, { agent: "TestAgent", task: "Test Task" });
	assert.strictEqual(globalRunHistory.activeRuns.size, 1);

	const active = globalRunHistory.activeRuns.get(runId);
	assert.strictEqual(active?.status, "ok");
	assert.strictEqual(active?.duration, 0);

	// Update
	globalRunHistory.updateRun(runId, { duration: 500, model: "gpt-4" });
	const updated = globalRunHistory.activeRuns.get(runId);
	assert.strictEqual(updated?.duration, 500);
	assert.strictEqual(updated?.model, "gpt-4");

	// Finish
	globalRunHistory.finishRun(runId, "ok");
	assert.strictEqual(globalRunHistory.activeRuns.size, 0);
});
