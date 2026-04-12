/**
 * E2E tests: subagent tool behavior through the real pi runtime.
 *
 * Uses pi-test-harness createTestSession to test the tool handler with
 * playbook-scripted model actions. The extension loads for real, tools
 * register for real, hooks fire for real — only the model is replaced.
 *
 * For execution tests (single, chain, parallel), createMockPi() from
 * @marcfargas/pi-test-harness handles the spawned subagent processes.
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import type { MockPi } from "../support/helpers.ts";
import { createMockPi, tryImport } from "../support/helpers.ts";

const harness = await tryImport<any>("@marcfargas/pi-test-harness");
const available = !!harness;

// Install mock pi for execution tests
let mockPi: MockPi | undefined;
if (available) {
	mockPi = createMockPi();
	mockPi.install();
	process.on("exit", () => mockPi?.uninstall());
}

const EXTENSION = path.resolve("src/extension/index.ts");

/**
 * Write test agent definitions as .md files with YAML frontmatter.
 * Agent discovery only reads .md files, not .yaml.
 */
function writeTestAgents(cwd: string, agents: Array<{ name: string; description?: string; model?: string }>) {
	const agentsDir = path.join(cwd, ".pi", "agents");
	fs.mkdirSync(agentsDir, { recursive: true });
	for (const agent of agents) {
		const frontmatter = [
			"---",
			`name: ${agent.name}`,
			`description: ${agent.description ?? `Test agent ${agent.name}`}`,
			agent.model ? `model: ${agent.model}` : null,
			"---",
		]
			.filter(Boolean)
			.join("\n");
		const content = `${frontmatter}\n\nYou are a test agent named ${agent.name}.\n`;
		fs.writeFileSync(path.join(agentsDir, `${agent.name}.md`), content);
	}
}

void describe("subagent tool — validation", { skip: !available ? "pi-test-harness not available" : undefined }, () => {
	const { createTestSession, when, calls, says } = harness;
	let t: any;

	afterEach(() => {
		t?.dispose();
		mockPi?.reset();
	});

	void it("rejects unknown agent in single mode", async () => {
		t = await createTestSession({
			extensions: [EXTENSION],
			mockTools: { bash: "ok", read: "ok", write: "ok", edit: "ok" },
		});

		await t.run(
			when("Call nonexistent agent", [
				calls("subagent", { agent: "nonexistent_agent_xyz", task: "hello" }),
				says("Agent not found."),
			]),
		);

		const results = t.events.toolResultsFor("subagent");
		assert.equal(results.length, 1);
		assert.ok(results[0].isError, "should be an error");
		assert.ok(results[0].text.includes("Unknown") || results[0].text.includes("nonexistent"));
	});
});

void describe("subagent tool — single execution", { skip: !available ? "pi-test-harness not available" : undefined }, () => {
	const { createTestSession, when, calls, says } = harness;
	let t: any;

	afterEach(() => {
		t?.dispose();
		mockPi?.reset();
	});

	void it("executes single agent and returns output", async () => {
		mockPi?.onCall({ output: "Hello from the subagent!" });

		t = await createTestSession({
			extensions: [EXTENSION],
			mockTools: { bash: "ok", read: "ok", write: "ok", edit: "ok" },
		});

		writeTestAgents(t.cwd, [{ name: "echo" }]);

		await t.run(
			when("Run the echo agent", [
				calls("subagent", { agent: "echo", task: "Say hello" }),
				says("The agent responded."),
			]),
		);

		const results = t.events.toolResultsFor("subagent");
		assert.equal(results.length, 1);
		assert.ok(!results[0].isError, `should succeed: ${results[0].text.slice(0, 200)}`);
		assert.ok(results[0].text.includes("Hello from the subagent"), `should contain output: ${results[0].text.slice(0, 200)}`);
	});

	void it("returns error for failed agent", async () => {
		mockPi?.onCall({ exitCode: 1, stderr: "Agent crashed hard" });

		t = await createTestSession({
			extensions: [EXTENSION],
			mockTools: { bash: "ok", read: "ok", write: "ok", edit: "ok" },
		});

		writeTestAgents(t.cwd, [{ name: "crasher" }]);

		await t.run(
			when("Run the crasher", [
				calls("subagent", { agent: "crasher", task: "Crash please" }),
				says("It failed."),
			]),
		);

		const results = t.events.toolResultsFor("subagent");
		assert.equal(results.length, 1);
		assert.ok(results[0].isError, "should be an error");
	});
});
