/**
 * E2E test: extension loading and tool registration.
 *
 * Uses pi-test-harness createTestSession to verify that the extension
 * loads correctly and the foreground subagent tool responds to calls.
 */

import assert from "node:assert/strict";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import { tryImport } from "../support/helpers.ts";

const harness = await tryImport<any>("@marcfargas/pi-test-harness");
const available = !!harness;

const EXTENSION = path.resolve("src/extension/index.ts");

void describe("extension loading", { skip: !available ? "pi-test-harness not available" : undefined }, () => {
	const { createTestSession, when, calls, says } = harness;
	let t: any;

	afterEach(() => t?.dispose());

	void it("loads extension and subagent tool responds", async () => {
		t = await createTestSession({
			extensions: [EXTENSION],
			mockTools: { bash: "ok", read: "ok", write: "ok", edit: "ok" },
		});

		await t.run(when("Run recon", [calls("subagent", { agent: "sp-recon", task: "hello" }), says("Done.")]));

		const results = t.events.toolResultsFor("subagent");
		assert.equal(results.length, 1, "subagent tool should respond");
		// sp-recon is a builtin agent, so this should not be an agent-not-found error
		assert.ok(!results[0].isError, `should not be an error: ${results[0].text}`);
	});
});
