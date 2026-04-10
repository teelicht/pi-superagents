import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { formatAsyncRunList, listAsyncRuns, listAsyncRunsForOverlay } from "../../src/ui/async-status.ts";

function createAsyncDir(root: string, id: string, status: Record<string, unknown>): string {
	const dir = path.join(root, id);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify(status), "utf-8");
	return dir;
}

describe("async status helpers", () => {
	it("lists only requested states and includes flattened step summaries", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-async-status-"));
		try {
			createAsyncDir(root, "run-a", {
				runId: "run-a",
				mode: "chain",
				state: "running",
				startedAt: 100,
				lastUpdate: 200,
				cwd: "/repo-a",
				currentStep: 1,
				steps: [
					{ agent: "scout", status: "complete", durationMs: 10 },
					{ agent: "worker", status: "running", durationMs: 20 },
				],
			});
			createAsyncDir(root, "run-b", {
				runId: "run-b",
				mode: "single",
				state: "complete",
				startedAt: 50,
				lastUpdate: 75,
				steps: [{ agent: "reviewer", status: "complete" }],
			});

			const runs = listAsyncRuns(root, { states: ["queued", "running"] });
			assert.equal(runs.length, 1);
			assert.equal(runs[0]?.id, "run-a");
			assert.equal(runs[0]?.cwd, "/repo-a");
			assert.equal(runs[0]?.steps.length, 2);
			assert.equal(runs[0]?.steps[1]?.agent, "worker");
			assert.equal(runs[0]?.steps[1]?.status, "running");
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("orders recent overlay runs by recency instead of failure-first state ranking", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-async-recent-order-"));
		try {
			createAsyncDir(root, "older-failed", {
				runId: "older-failed",
				mode: "single",
				state: "failed",
				startedAt: 10,
				lastUpdate: 100,
				endedAt: 100,
				steps: [{ agent: "worker", status: "failed" }],
			});
			createAsyncDir(root, "newer-complete", {
				runId: "newer-complete",
				mode: "single",
				state: "complete",
				startedAt: 20,
				lastUpdate: 200,
				endedAt: 200,
				steps: [{ agent: "reviewer", status: "complete" }],
			});

			const overlay = listAsyncRunsForOverlay(root, 5);
			assert.deepEqual(overlay.recent.map((run) => run.id), ["newer-complete", "older-failed"]);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("surfaces malformed status files instead of silently skipping them", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-async-bad-status-"));
		const dir = path.join(root, "broken-run");
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, "status.json"), "{not-json", "utf-8");
		try {
			assert.throws(
				() => listAsyncRuns(root),
				/Failed to parse async status file/,
			);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("separates active and recent runs for the overlay and formats readable list output", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-async-overlay-"));
		try {
			createAsyncDir(root, "run-running", {
				runId: "run-running",
				mode: "chain",
				state: "running",
				startedAt: 100,
				lastUpdate: 300,
				steps: [{ agent: "scout", status: "running", durationMs: 12_000 }],
			});
			createAsyncDir(root, "run-failed", {
				runId: "run-failed",
				mode: "single",
				state: "failed",
				startedAt: 50,
				lastUpdate: 250,
				endedAt: 250,
				steps: [{ agent: "worker", status: "failed", durationMs: 5_000 }],
			});
			createAsyncDir(root, "run-complete", {
				runId: "run-complete",
				mode: "single",
				state: "complete",
				startedAt: 10,
				lastUpdate: 200,
				endedAt: 200,
				steps: [{ agent: "reviewer", status: "complete", durationMs: 3_000 }],
			});

			const overlay = listAsyncRunsForOverlay(root, 1);
			assert.equal(overlay.active.length, 1);
			assert.equal(overlay.active[0]?.id, "run-running");
			assert.equal(overlay.recent.length, 1);
			assert.equal(overlay.recent[0]?.id, "run-failed");

			const text = formatAsyncRunList(overlay.active);
			assert.match(text, /Active async runs: 1/);
			assert.match(text, /run-running/);
			assert.match(text, /scout/);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
