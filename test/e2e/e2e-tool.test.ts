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

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
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
const USER_CONFIG_PATH = path.join(os.homedir(), ".pi", "agent", "extensions", "subagent", "config.json");

interface UserConfigSnapshot {
	exists: boolean;
	content?: string;
}

/**
 * Replace the user-owned extension config with a valid override for E2E sessions.
 *
 * @returns Snapshot that can restore the previous user config after the test.
 */
function installValidUserConfigForTest(): UserConfigSnapshot {
	const snapshot: UserConfigSnapshot = fs.existsSync(USER_CONFIG_PATH) ? { exists: true, content: fs.readFileSync(USER_CONFIG_PATH, "utf-8") } : { exists: false };
	fs.mkdirSync(path.dirname(USER_CONFIG_PATH), { recursive: true });
	fs.writeFileSync(USER_CONFIG_PATH, "{}\n", "utf-8");
	return snapshot;
}

/**
 * Restore the user-owned extension config after an E2E session.
 *
 * @param snapshot - Previous config state captured before the test.
 */
function restoreUserConfigAfterTest(snapshot: UserConfigSnapshot | undefined): void {
	if (!snapshot) return;
	if (snapshot.exists) {
		fs.writeFileSync(USER_CONFIG_PATH, snapshot.content ?? "", "utf-8");
		return;
	}
	fs.rmSync(USER_CONFIG_PATH, { force: true });
}

interface SubagentToolDetails {
	mode?: string;
	results?: Array<{
		exitCode?: number;
		error?: string;
	}>;
}

/**
 * Write test agent definitions as .md files with YAML frontmatter.
 * Agent discovery only reads .md files, not .yaml.
 */
function writeTestAgents(cwd: string, agents: Array<{ name: string; description?: string; model?: string }>) {
	const agentsDir = path.join(cwd, ".pi", "agents");
	fs.mkdirSync(agentsDir, { recursive: true });
	for (const agent of agents) {
		const frontmatter = ["---", `name: ${agent.name}`, `description: ${agent.description ?? `Test agent ${agent.name}`}`, agent.model ? `model: ${agent.model}` : null, "---"]
			.filter(Boolean)
			.join("\n");
		const content = `${frontmatter}\n\nYou are a test agent named ${agent.name}.\n`;
		fs.writeFileSync(path.join(agentsDir, `${agent.name}.md`), content);
	}
}

void describe("subagent tool — validation", { skip: !available ? "pi-test-harness not available" : undefined }, () => {
	const { createTestSession, when, calls, says } = harness;
	let t: any;
	let userConfigSnapshot: UserConfigSnapshot | undefined;

	beforeEach(() => {
		userConfigSnapshot = installValidUserConfigForTest();
	});

	afterEach(() => {
		t?.dispose();
		mockPi?.reset();
		restoreUserConfigAfterTest(userConfigSnapshot);
		userConfigSnapshot = undefined;
	});

	void it("rejects unknown agent in single mode", async () => {
		t = await createTestSession({
			extensions: [EXTENSION],
			mockTools: { bash: "ok", read: "ok", write: "ok", edit: "ok" },
		});

		await t.run(when("Call nonexistent agent", [calls("subagent", { agent: "nonexistent_agent_xyz", task: "hello" }), says("Agent not found.")]));

		const results = t.events.toolResultsFor("subagent");
		assert.equal(results.length, 1);
		assert.match(results[0].text, /Unknown agent: nonexistent_agent_xyz/);
		const details = results[0].details as SubagentToolDetails;
		assert.equal(details.mode, "single");
		assert.deepEqual(details.results, []);
	});
});

void describe("subagent tool — single execution", { skip: !available ? "pi-test-harness not available" : undefined }, () => {
	const { createTestSession, when, calls, says } = harness;
	let t: any;
	let userConfigSnapshot: UserConfigSnapshot | undefined;

	beforeEach(() => {
		userConfigSnapshot = installValidUserConfigForTest();
	});

	afterEach(() => {
		t?.dispose();
		mockPi?.reset();
		restoreUserConfigAfterTest(userConfigSnapshot);
		userConfigSnapshot = undefined;
	});

	void it("executes single agent and returns output", async () => {
		mockPi?.onCall({ output: "Hello from the subagent!" });

		t = await createTestSession({
			extensions: [EXTENSION],
			mockTools: { bash: "ok", read: "ok", write: "ok", edit: "ok" },
		});

		writeTestAgents(t.cwd, [{ name: "echo" }]);

		await t.run(when("Run the echo agent", [calls("subagent", { agent: "echo", task: "Say hello" }), says("The agent responded.")]));

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

		await t.run(when("Run the crasher", [calls("subagent", { agent: "crasher", task: "Crash please" }), says("It failed.")]));

		const results = t.events.toolResultsFor("subagent");
		assert.equal(results.length, 1);
		assert.match(results[0].text, /Agent crashed hard/);
		const details = results[0].details as SubagentToolDetails;
		assert.equal(details.mode, "single");
		assert.equal(details.results?.length, 1);
		assert.equal(details.results?.[0]?.exitCode, 1);
		assert.match(details.results?.[0]?.error ?? "", /Agent crashed hard/);
	});
});
