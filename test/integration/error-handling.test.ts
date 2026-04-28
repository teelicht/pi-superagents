/**
 * Integration tests for error handling across execution modes.
 *
 * Tests: agent crashes, stderr capture, detectSubagentError override,
 * signal/abort handling, and error propagation in chains.
 *
 * Requires pi packages for execution tests. Skips gracefully if unavailable.
 */

import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import type { MockPi } from "../support/helpers.ts";
import { createMockPi, createTempDir, events, makeAgentConfigs, removeTempDir, tryImport } from "../support/helpers.ts";

// Top-level await
const utils = await tryImport<any>("./src/shared/utils.ts");
const execution = await tryImport<any>("./src/execution/execution.ts");

const piAvailable = !!(execution && utils);

const runSync = execution?.runSync;
const detectSubagentError = utils?.detectSubagentError;

/**
 * Minimal structural AbortSignal test double that records listener cleanup.
 *
 * Inputs/outputs:
 * - add/remove methods accept abort event listeners
 * - counters expose how many listeners were attached and detached
 *
 * Invariants:
 * - only abort listeners are tracked
 * - abort() invokes a snapshot so listeners can mutate registration safely
 */
class TrackingAbortSignal {
	aborted = false;
	added = 0;
	removed = 0;
	private readonly listeners = new Set<() => void>();

	/**
	 * Registers an abort listener and records the attachment.
	 *
	 * @param event Event name; only `abort` is tracked.
	 * @param listener Callback to invoke on abort.
	 * @param _options Listener options accepted for AbortSignal compatibility.
	 */
	addEventListener(event: "abort", listener: () => void, _options?: { once?: boolean }): void {
		if (event !== "abort") return;
		this.added++;
		this.listeners.add(listener);
	}

	/**
	 * Removes a tracked abort listener and records successful detachment.
	 *
	 * @param event Event name; only `abort` is tracked.
	 * @param listener Previously registered listener.
	 */
	removeEventListener(event: "abort", listener: () => void): void {
		if (event !== "abort") return;
		if (this.listeners.delete(listener)) {
			this.removed++;
		}
	}

	/**
	 * Marks the signal as aborted and invokes currently tracked listeners.
	 */
	abort(): void {
		this.aborted = true;
		for (const listener of Array.from(this.listeners)) {
			listener();
		}
	}
}

// ---------------------------------------------------------------------------
// detectSubagentError
// ---------------------------------------------------------------------------

void describe("detectSubagentError", { skip: !detectSubagentError ? "utils not importable" : undefined }, () => {
	void it("returns no error for successful messages", () => {
		const messages = [
			{ role: "assistant", content: [{ type: "text", text: "Let me check..." }] },
			{ role: "toolResult", toolName: "bash", isError: false, content: [{ type: "text", text: "OK" }] },
			{ role: "assistant", content: [{ type: "text", text: "All good!" }] },
		];
		const result = detectSubagentError(messages);
		assert.equal(result.hasError, false);
	});

	void it("detects fatal bash error in last tool result", () => {
		const messages = [
			{ role: "assistant", content: [{ type: "text", text: "Running..." }] },
			{
				role: "toolResult",
				toolName: "bash",
				isError: false,
				content: [{ type: "text", text: "command not found" }],
			},
		];
		const result = detectSubagentError(messages);
		assert.equal(result.hasError, true);
		assert.equal(result.errorType, "bash");
	});

	void it("detects non-zero exit code in bash output", () => {
		const messages = [
			{ role: "assistant", content: [{ type: "text", text: "Running..." }] },
			{
				role: "toolResult",
				toolName: "bash",
				isError: false,
				content: [{ type: "text", text: "Error: process exited with code 127" }],
			},
		];
		const result = detectSubagentError(messages);
		assert.equal(result.hasError, true);
		assert.equal(result.exitCode, 127);
	});

	void it("ignores errors before last successful tool result", () => {
		const messages = [
			{ role: "assistant", content: [{ type: "text", text: "Trying..." }] },
			{ role: "toolResult", toolName: "bash", isError: true, content: [{ type: "text", text: "EISDIR" }] },
			{ role: "assistant", content: [{ type: "text", text: "Let me fix that..." }] },
			{ role: "toolResult", toolName: "bash", isError: false, content: [{ type: "text", text: "OK" }] },
			{ role: "assistant", content: [{ type: "text", text: "Fixed!" }] },
		];
		const result = detectSubagentError(messages);
		assert.equal(result.hasError, false);
	});

	void it("detects isError on tool result", () => {
		const messages = [
			{ role: "assistant", content: [{ type: "text", text: "Running..." }] },
			{
				role: "toolResult",
				toolName: "write",
				isError: true,
				content: [{ type: "text", text: "Permission denied" }],
			},
		];
		const result = detectSubagentError(messages);
		assert.equal(result.hasError, true);
		assert.equal(result.errorType, "write");
	});
});

// ---------------------------------------------------------------------------
// runSync error handling
// ---------------------------------------------------------------------------

void describe("runSync error handling", { skip: !piAvailable ? "pi packages not available" : undefined }, () => {
	let tempDir: string;
	let mockPi: MockPi;

	before(() => {
		mockPi = createMockPi();
		mockPi.install();
	});

	after(() => {
		mockPi.uninstall();
	});

	beforeEach(() => {
		tempDir = createTempDir();
		mockPi.reset();
	});

	afterEach(() => {
		removeTempDir(tempDir);
	});

	void it("captures stderr on non-zero exit", async () => {
		mockPi.onCall({ exitCode: 2, stderr: "Fatal: out of memory" });
		const agents = makeAgentConfigs(["crash"]);

		const result = await runSync(tempDir, agents, "crash", "Do heavy work", {});

		assert.equal(result.exitCode, 2);
		assert.ok(result.error?.includes("out of memory"));
	});

	void it("detectSubagentError overrides exit 0 on hidden failure", async () => {
		mockPi.onCall({
			jsonl: [events.toolStart("bash", { command: "deploy" }), events.toolEnd("bash"), events.toolResult("bash", "connection refused")],
		});
		const agents = makeAgentConfigs(["deployer"]);

		const result = await runSync(tempDir, agents, "deployer", "Deploy app", {});

		assert.notEqual(result.exitCode, 0, "should detect hidden failure");
		assert.ok(result.error?.includes("connection refused"));
	});

	void it("handles abort signal (completes faster than delay)", async () => {
		mockPi.onCall({ delay: 10000 });
		const agents = makeAgentConfigs(["slow"]);
		const controller = new AbortController();

		const start = Date.now();
		setTimeout(() => controller.abort(), 200);

		const _result = await runSync(tempDir, agents, "slow", "Slow task", {
			signal: controller.signal,
		});
		const elapsed = Date.now() - start;

		// Key: should complete much faster than the 10s delay
		assert.ok(elapsed < 5000, `should abort early, took ${elapsed}ms`);
	});

	void it("removes abort listener after normal process completion", async () => {
		mockPi.onCall({ output: "Done" });
		const agents = makeAgentConfigs(["echo"]);
		const signal = new TrackingAbortSignal();

		const result = await runSync(tempDir, agents, "echo", "Task", {
			signal: signal as unknown as AbortSignal,
		});

		assert.equal(result.exitCode, 0);
		assert.equal(signal.added, 1);
		assert.equal(signal.removed, 1);
	});
});
