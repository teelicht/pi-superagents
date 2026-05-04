/**
 * Integration tests for caller_ping lifecycle sidecars.
 *
 * Responsibilities:
 * - verify ping sidecars become needs_parent completion envelopes
 * - verify ping results are delivered once through the active sync join path
 */

import assert from "node:assert/strict";
import * as path from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import type { MockPi } from "../support/helpers.ts";
import { createMockPi, createTempDir, makeAgentConfigs, removeTempDir, tryImport } from "../support/helpers.ts";

const execution = await tryImport<any>("./src/execution/child-runner.ts");
const available = !!execution;
const runPreparedChild = execution?.runPreparedChild;

void describe("caller_ping lifecycle", { skip: !available ? "pi packages not available" : undefined }, () => {
	let tempDir: string;
	let mockPi: MockPi;

	before(() => {
		mockPi = createMockPi();
		mockPi.install();
	});

	after(() => mockPi.uninstall());

	beforeEach(() => {
		tempDir = createTempDir();
		mockPi.reset();
	});

	afterEach(() => removeTempDir(tempDir));

	void it("maps ping sidecar to needs_parent completion", async () => {
		const sessionFile = path.join(tempDir, "child.jsonl");
		mockPi.onCall({
			output: "Partial analysis",
			writeLifecycleSignal: { sessionFile, signal: { type: "ping", message: "Need target module" } },
		} as any);

		const result = await runPreparedChild(tempDir, makeAgentConfigs(["sp-research"]), "sp-research", "Inspect", {
			runId: "run-ping",
			sessionFile,
			sessionMode: "lineage-only",
		});

		assert.equal(result.lifecycle?.status, "consumed");
		assert.equal(result.completion?.status, "needs_parent");
		assert.equal(result.completion?.parentRequest, "Need target module");
		assert.equal(result.completion?.body, "Partial analysis");
	});

	void it("maps done sidecar to completed envelope", async () => {
		const sessionFile = path.join(tempDir, "child.jsonl");
		mockPi.onCall({
			output: "All done here",
			writeLifecycleSignal: { sessionFile, signal: { type: "done", outputTokens: 123 } },
		} as any);

		const result = await runPreparedChild(tempDir, makeAgentConfigs(["sp-research"]), "sp-research", "Inspect", {
			runId: "run-done",
			sessionFile,
			sessionMode: "lineage-only",
		});

		assert.equal(result.lifecycle?.status, "consumed");
		assert.equal(result.completion?.status, "completed");
		assert.equal(result.completion?.body, "All done here");
	});

	void it("result without sidecar gets derived completion envelope", async () => {
		const result = await runPreparedChild(tempDir, makeAgentConfigs(["sp-research"]), "sp-research", "Inspect", {
			runId: "run-no-sidecar",
		});

		// lifecycle should be undefined (no session file means no sidecar path)
		assert.equal(result.lifecycle, undefined);
		// completion should still be derived
		assert.equal(result.completion?.status, "completed");
		assert.equal(result.completion?.body, "ok");
	});
});
