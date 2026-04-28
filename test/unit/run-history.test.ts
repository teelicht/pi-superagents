/**
 * Unit tests for run history tracking.
 *
 * Tests the active run lifecycle: startRun, updateRun, finishRun.
 */

import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

const tempHistoryDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-superagents-run-history-test-"));
process.env.PI_SUPERAGENTS_RUN_HISTORY_PATH = path.join(tempHistoryDir, "run-history.jsonl");

const { globalRunHistory } = await import("../../src/execution/run-history.ts");

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
