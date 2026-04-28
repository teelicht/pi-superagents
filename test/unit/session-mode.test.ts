/**
 * Unit coverage for session-mode resolution and child-session seeding.
 *
 * Responsibilities:
 * - verify precedence across explicit params, deprecated aliases, agent defaults, and system defaults
 * - ensure lineage-only creates linked child sessions without copying conversation turns
 * - preserve fork caching behavior through the new resolver entry point
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
	createSessionLaunchResolver,
	resolveRequestedSessionMode,
	resolveTaskDeliveryMode,
	type SessionLaunchManager,
	seedLineageOnlySessionFile,
} from "../../src/execution/session-mode.ts";
import { createTempDir, removeTempDir } from "../support/helpers.ts";

const tempDirs: string[] = [];

/**
 * Track a temporary directory for cleanup after each test.
 *
 * @param prefix Directory prefix for the fixture root.
 * @returns Newly created temporary directory path.
 */
function makeTempDir(prefix: string): string {
	const dir = createTempDir(prefix);
	tempDirs.push(dir);
	return dir;
}

/**
 * Read and parse all JSONL lines from a session fixture.
 *
 * @param sessionFile Absolute path to the session file under test.
 * @returns Parsed JSON objects for each persisted line.
 */
function readJsonl(sessionFile: string): unknown[] {
	return fs
		.readFileSync(sessionFile, "utf-8")
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

/**
 * Build a minimal launch manager while recording fork requests.
 *
 * @param baseDir Directory used for synthetic forked session files.
 * @param overrides Optional parent-session or leaf overrides for each test.
 * @returns Manager implementation and the seen fork leaf ids.
 */
function makeSessionLaunchManager(
	baseDir: string,
	overrides: {
		parentSessionFile?: string;
		leafId?: string | null;
	} = {},
): {
	manager: SessionLaunchManager;
	calls: string[];
} {
	const calls: string[] = [];
	let forkCount = 0;

	return {
		manager: {
			getSessionFile: () => overrides.parentSessionFile,
			getLeafId: () => (overrides.leafId === undefined ? "leaf-current" : overrides.leafId),
			createBranchedSession: (leafId: string) => {
				calls.push(leafId);
				forkCount += 1;
				return path.join(baseDir, `fork-${forkCount}.jsonl`);
			},
		},
		calls,
	};
}

afterEach(() => {
	while (tempDirs.length > 0) {
		removeTempDir(tempDirs.pop()!);
	}
});

void describe("resolveRequestedSessionMode", () => {
	void it("prefers explicit sessionMode over aliases and defaults", () => {
		assert.equal(
			resolveRequestedSessionMode({
				sessionMode: "lineage-only",
				agentSessionMode: "fork",
				defaultSessionMode: "standalone",
			}),
			"lineage-only",
		);
	});

	void it("falls back to the agent default and then the system default", () => {
		assert.equal(resolveRequestedSessionMode({ agentSessionMode: "lineage-only" }), "lineage-only");
		assert.equal(resolveRequestedSessionMode({ defaultSessionMode: "fork" }), "fork");
		assert.equal(resolveRequestedSessionMode({}), "standalone");
	});
});

void describe("resolveTaskDeliveryMode", () => {
	void it("keeps fork as direct delivery and other modes artifact-ready", () => {
		assert.equal(resolveTaskDeliveryMode("fork"), "direct");
		assert.equal(resolveTaskDeliveryMode("lineage-only"), "artifact");
		assert.equal(resolveTaskDeliveryMode("standalone"), "artifact");
	});
});

void describe("seedLineageOnlySessionFile", () => {
	void it("writes a linked session header and no inherited turns", () => {
		const tempDir = makeTempDir("pi-session-mode-unit-");
		const childSessionFile = path.join(tempDir, "child.jsonl");

		seedLineageOnlySessionFile({
			parentSessionFile: "/tmp/parent-session.jsonl",
			childSessionFile,
			childCwd: tempDir,
		});

		const lines = readJsonl(childSessionFile);
		assert.equal(lines.length, 1);
		assert.deepEqual(lines[0] && typeof lines[0] === "object" ? Object.keys(lines[0] as object).sort() : [], ["cwd", "id", "parentSession", "timestamp", "type", "version"]);
		assert.equal((lines[0] as { type?: string }).type, "session");
		assert.equal((lines[0] as { version?: number }).version, 3);
		assert.equal((lines[0] as { cwd?: string }).cwd, tempDir);
		assert.equal((lines[0] as { parentSession?: string }).parentSession, "/tmp/parent-session.jsonl");
	});
});

void describe("createSessionLaunchResolver", () => {
	void it("returns undefined for standalone launches", () => {
		const tempDir = makeTempDir("pi-session-mode-unit-");
		const { manager, calls } = makeSessionLaunchManager(tempDir, {
			parentSessionFile: "/tmp/parent.jsonl",
		});
		const resolver = createSessionLaunchResolver({
			sessionManager: manager,
			sessionRoot: path.join(tempDir, "sessions"),
		});

		const sessionFile = resolver.sessionFileForIndex({
			sessionMode: "standalone",
			index: 0,
			childCwd: tempDir,
		});

		assert.equal(sessionFile, undefined);
		assert.deepEqual(calls, []);
	});

	void it("creates cached forked sessions per index", () => {
		const tempDir = makeTempDir("pi-session-mode-unit-");
		const { manager, calls } = makeSessionLaunchManager(tempDir, {
			parentSessionFile: "/tmp/parent.jsonl",
			leafId: "leaf-123",
		});
		const resolver = createSessionLaunchResolver({
			sessionManager: manager,
			sessionRoot: path.join(tempDir, "sessions"),
		});

		const first = resolver.sessionFileForIndex({
			sessionMode: "fork",
			index: 0,
			childCwd: tempDir,
		});
		const firstAgain = resolver.sessionFileForIndex({
			sessionMode: "fork",
			index: 0,
			childCwd: tempDir,
		});
		const second = resolver.sessionFileForIndex({
			sessionMode: "fork",
			index: 1,
			childCwd: tempDir,
		});

		assert.equal(first, firstAgain);
		assert.notEqual(first, second);
		assert.deepEqual(calls, ["leaf-123", "leaf-123"]);
	});

	void it("seeds lineage-only sessions per index without branching", () => {
		const tempDir = makeTempDir("pi-session-mode-unit-");
		const { manager, calls } = makeSessionLaunchManager(tempDir, {
			parentSessionFile: "/tmp/parent.jsonl",
			leafId: null,
		});
		const resolver = createSessionLaunchResolver({
			sessionManager: manager,
			sessionRoot: path.join(tempDir, "sessions"),
		});

		const first = resolver.sessionFileForIndex({
			sessionMode: "lineage-only",
			index: 0,
			childCwd: path.join(tempDir, "first"),
		});
		const second = resolver.sessionFileForIndex({
			sessionMode: "lineage-only",
			index: 1,
			childCwd: path.join(tempDir, "second"),
		});

		assert.ok(first);
		assert.ok(second);
		assert.notEqual(first, second);
		assert.deepEqual(calls, []);
		assert.equal(readJsonl(first!).length, 1);
		assert.equal(readJsonl(second!).length, 1);
		assert.equal((readJsonl(first!)[0] as { parentSession?: string }).parentSession, "/tmp/parent.jsonl");
		assert.equal((readJsonl(second!)[0] as { cwd?: string }).cwd, path.join(tempDir, "second"));
	});
});
