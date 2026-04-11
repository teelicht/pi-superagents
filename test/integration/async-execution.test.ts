/**
 * Integration tests for async (background) agent execution.
 *
 * Tests the async support utilities: jiti availability check,
 * status file reading/caching, and runtime skill resolution parity.
 *
 * Requires pi packages to be importable. Skips gracefully if unavailable.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	createTempDir,
	makeAgent,
	removeTempDir,
	tryImport,
} from "../support/helpers.ts";

// Top-level await
const asyncMod = await tryImport<any>("./src/execution/async-execution.ts");
const utils = await tryImport<any>("./src/shared/utils.ts");
const available = !!(asyncMod && utils);

const isAsyncAvailable = asyncMod?.isAsyncAvailable;
const executeAsyncSingle = asyncMod?.executeAsyncSingle;
const readStatus = utils?.readStatus;

/**
 * Write a test skill file into the temporary workspace skill directory.
 *
 * @param cwd Workspace root used for skill discovery during the test.
 * @param name Skill name to expose to the runtime.
 */
function writeSkill(cwd: string, name: string): void {
	const skillsDir = path.join(cwd, ".agents", "skills");
	fs.mkdirSync(skillsDir, { recursive: true });
	fs.writeFileSync(
		path.join(skillsDir, `${name}.md`),
		`---\nname: ${name}\ndescription: test skill\n---\nUse ${name}.`,
		"utf-8",
	);
}

/**
 * Read the temp async runner config written by `executeAsyncSingle()`.
 *
 * @param id Async run identifier used in the config filename.
 * @returns Parsed JSON config written for the detached runner.
 */
function readAsyncConfig(id: string): any {
	return JSON.parse(fs.readFileSync(path.join(os.tmpdir(), `pi-async-cfg-${id}.json`), "utf-8"));
}

describe("async execution utilities", { skip: !available ? "pi packages not available" : undefined }, () => {
	it("reports jiti availability as boolean", () => {
		const result = isAsyncAvailable();
		assert.equal(typeof result, "boolean");
	});

	it("readStatus returns null for missing directory", () => {
		const status = readStatus("/nonexistent/path/abc123");
		assert.equal(status, null);
	});

	it("readStatus parses valid status file", () => {
		const dir = createTempDir();
		try {
			const statusData = {
				runId: "test-123",
				state: "running",
				mode: "single",
				startedAt: Date.now(),
				lastUpdate: Date.now(),
				steps: [{ agent: "test", status: "running" }],
			};
			fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify(statusData));

			const status = readStatus(dir);
			assert.ok(status, "should parse status");
			assert.equal(status.runId, "test-123");
			assert.equal(status.state, "running");
			assert.equal(status.mode, "single");
		} finally {
			removeTempDir(dir);
		}
	});

	it("readStatus caches by mtime (second call uses cache)", () => {
		const dir = createTempDir();
		try {
			const statusData = {
				runId: "cache-test",
				state: "running",
				mode: "single",
				startedAt: Date.now(),
			};
			fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify(statusData));

			const s1 = readStatus(dir);
			const s2 = readStatus(dir);
			assert.ok(s1);
			assert.ok(s2);
			assert.equal(s1.runId, s2.runId);
		} finally {
			removeTempDir(dir);
		}
	});

	it("readStatus throws for malformed status files", () => {
		const dir = createTempDir();
		try {
			fs.writeFileSync(path.join(dir, "status.json"), "{bad-json", "utf-8");
			assert.throws(() => readStatus(dir), /Failed to parse async status file/);
		} finally {
			removeTempDir(dir);
		}
	});

	it("single async execution replaces agent default skills with an explicit override", () => {
		const cwd = createTempDir("pi-async-skills-");
		const id = `async-skill-override-${Date.now().toString(36)}`;
		try {
			writeSkill(cwd, "default-skill");
			writeSkill(cwd, "override-skill");

			executeAsyncSingle(id, {
				agent: "worker",
				task: "Do the work.",
				agentConfig: makeAgent("worker", {
					systemPrompt: "Work carefully.",
					skills: ["default-skill"],
				}),
				ctx: {
					pi: { events: new EventEmitter() },
					cwd,
					currentSessionId: "session-test",
				},
				artifactConfig: { enabled: false },
				skills: ["override-skill"],
				maxSubagentDepth: 0,
			});

			const cfg = readAsyncConfig(id);
			assert.deepEqual(cfg.step.skills, ["override-skill"]);
			assert.match(cfg.step.systemPrompt, /override-skill/);
			assert.doesNotMatch(cfg.step.systemPrompt, /default-skill/);
		} finally {
			removeTempDir(cwd);
			fs.rmSync(path.join(os.tmpdir(), `pi-async-cfg-${id}.json`), { force: true });
		}
	});

	it("single async execution adds test-driven-development for superpowers implementer tdd mode", () => {
		const cwd = createTempDir("pi-async-skills-");
		const id = `async-implementer-skills-${Date.now().toString(36)}`;
		try {
			writeSkill(cwd, "domain-skill");
			writeSkill(cwd, "test-driven-development");

			executeAsyncSingle(id, {
				agent: "sp-implementer",
				task: "Implement the task.",
				agentConfig: makeAgent("sp-implementer", {
					systemPrompt: "Implement the task.",
				}),
				ctx: {
					pi: { events: new EventEmitter() },
					cwd,
					currentSessionId: "session-test",
				},
				artifactConfig: { enabled: false },
				shareEnabled: false,
				skills: ["domain-skill"],
				maxSubagentDepth: 0,
				workflow: "superpowers",
				useTestDrivenDevelopment: true,
				config: {},
			});

			const cfg = readAsyncConfig(id);
			assert.deepEqual(cfg.step.skills, ["domain-skill", "test-driven-development"]);
		} finally {
			removeTempDir(cwd);
			fs.rmSync(path.join(os.tmpdir(), `pi-async-cfg-${id}.json`), { force: true });
		}
	});
});
