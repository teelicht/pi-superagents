/**
 * Unit coverage for session-mode resolution and child-session seeding.
 *
 * Responsibilities:
 * - verify precedence across explicit params, deprecated aliases, agent defaults, and system defaults
 * - ensure lineage-only creates linked child sessions without copying conversation turns
 * - preserve fork caching behavior through the new resolver entry point
 * - validate resumed lineage-only session files for the sp-implementer role
 * - prove the resolver returns the same path for a valid resume request and rejects mismatches
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
	validateResumeSessionFile,
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
			agentName: "sp-implementer",
		});

		const lines = readJsonl(childSessionFile);
		assert.equal(lines.length, 1);
		assert.deepEqual(lines[0] && typeof lines[0] === "object" ? Object.keys(lines[0] as object).sort() : [], [
			"cwd",
			"id",
			"parentSession",
			"piSuperagents",
			"timestamp",
			"type",
			"version",
		]);
		assert.equal((lines[0] as { type?: string }).type, "session");
		assert.equal((lines[0] as { version?: number }).version, 3);
		assert.equal((lines[0] as { cwd?: string }).cwd, tempDir);
		assert.equal((lines[0] as { parentSession?: string }).parentSession, "/tmp/parent-session.jsonl");
		const marker = (lines[0] as { piSuperagents?: Record<string, unknown> }).piSuperagents;
		assert.ok(marker, "expected piSuperagents marker on seeded lineage-only header");
		assert.deepEqual(marker, {
			owner: "pi-superagents",
			agent: "sp-implementer",
			sessionMode: "lineage-only",
		});
	});
});

void describe("validateResumeSessionFile", () => {
	void it("returns the resolved path for a matching sp-implementer session", () => {
		const tempDir = makeTempDir("pi-resume-validate-");
		const parentSessionFile = path.join(tempDir, "parent.jsonl");
		const childSessionFile = path.join(tempDir, "child.jsonl");
		fs.writeFileSync(parentSessionFile, '{"type":"session"}\n', "utf-8");
		seedLineageOnlySessionFile({
			parentSessionFile,
			childSessionFile,
			childCwd: tempDir,
			agentName: "sp-implementer",
		});

		const resolved = validateResumeSessionFile({
			resumeSession: childSessionFile,
			parentSessionFile,
			childCwd: tempDir,
		});

		assert.equal(resolved, path.resolve(childSessionFile));
	});

	void it("rejects when the resumed file does not exist", () => {
		const tempDir = makeTempDir("pi-resume-validate-");
		const parentSessionFile = path.join(tempDir, "parent.jsonl");
		assert.throws(
			() =>
				validateResumeSessionFile({
					resumeSession: path.join(tempDir, "missing.jsonl"),
					parentSessionFile,
					childCwd: tempDir,
				}),
			/resume session file does not exist/,
		);
	});

	void it("rejects when the resumed header is malformed JSON", () => {
		const tempDir = makeTempDir("pi-resume-validate-");
		const parentSessionFile = path.join(tempDir, "parent.jsonl");
		const childSessionFile = path.join(tempDir, "child.jsonl");
		fs.writeFileSync(parentSessionFile, '{"type":"session"}\n', "utf-8");
		fs.writeFileSync(childSessionFile, "not-json\n", "utf-8");
		assert.throws(
			() =>
				validateResumeSessionFile({
					resumeSession: childSessionFile,
					parentSessionFile,
					childCwd: tempDir,
				}),
			/malformed session header/,
		);
	});

	void it("rejects when the marker is missing", () => {
		const tempDir = makeTempDir("pi-resume-validate-");
		const parentSessionFile = path.join(tempDir, "parent.jsonl");
		const childSessionFile = path.join(tempDir, "child.jsonl");
		fs.writeFileSync(parentSessionFile, '{"type":"session"}\n', "utf-8");
		fs.writeFileSync(
			childSessionFile,
			`${JSON.stringify({ type: "session", version: 3, id: "abc", timestamp: "now", cwd: tempDir, parentSession: parentSessionFile })}\n`,
			"utf-8",
		);
		assert.throws(
			() =>
				validateResumeSessionFile({
					resumeSession: childSessionFile,
					parentSessionFile,
					childCwd: tempDir,
				}),
			/missing pi-superagents marker/,
		);
	});

	void it("rejects when the parent session path does not match", () => {
		const tempDir = makeTempDir("pi-resume-validate-");
		const parentSessionFile = path.join(tempDir, "parent.jsonl");
		const childSessionFile = path.join(tempDir, "child.jsonl");
		fs.writeFileSync(parentSessionFile, '{"type":"session"}\n', "utf-8");
		seedLineageOnlySessionFile({
			parentSessionFile: "/tmp/other-parent.jsonl",
			childSessionFile,
			childCwd: tempDir,
			agentName: "sp-implementer",
		});
		assert.throws(
			() =>
				validateResumeSessionFile({
					resumeSession: childSessionFile,
					parentSessionFile,
					childCwd: tempDir,
				}),
			/parent session does not match/,
		);
	});

	void it("rejects when the agent role is not sp-implementer", () => {
		const tempDir = makeTempDir("pi-resume-validate-");
		const parentSessionFile = path.join(tempDir, "parent.jsonl");
		const childSessionFile = path.join(tempDir, "child.jsonl");
		fs.writeFileSync(parentSessionFile, '{"type":"session"}\n', "utf-8");
		seedLineageOnlySessionFile({
			parentSessionFile,
			childSessionFile,
			childCwd: tempDir,
			agentName: "sp-research",
		});
		assert.throws(
			() =>
				validateResumeSessionFile({
					resumeSession: childSessionFile,
					parentSessionFile,
					childCwd: tempDir,
				}),
			/not sp-implementer/,
		);
	});

	void it("rejects when the cwd does not match", () => {
		const tempDir = makeTempDir("pi-resume-validate-");
		const otherCwd = makeTempDir("pi-resume-validate-other-");
		const parentSessionFile = path.join(tempDir, "parent.jsonl");
		const childSessionFile = path.join(tempDir, "child.jsonl");
		fs.writeFileSync(parentSessionFile, '{"type":"session"}\n', "utf-8");
		seedLineageOnlySessionFile({
			parentSessionFile,
			childSessionFile,
			childCwd: otherCwd,
			agentName: "sp-implementer",
		});
		assert.throws(
			() =>
				validateResumeSessionFile({
					resumeSession: childSessionFile,
					parentSessionFile,
					childCwd: tempDir,
				}),
			/cwd does not match/,
		);
	});

	void it("rejects when the lineage-only marker has a different mode", () => {
		const tempDir = makeTempDir("pi-resume-validate-");
		const parentSessionFile = path.join(tempDir, "parent.jsonl");
		const childSessionFile = path.join(tempDir, "child.jsonl");
		fs.writeFileSync(parentSessionFile, '{"type":"session"}\n', "utf-8");
		seedLineageOnlySessionFile({
			parentSessionFile,
			childSessionFile,
			childCwd: tempDir,
			agentName: "sp-implementer",
		});
		// Rewrite the header with a non-lineage-only marker
		fs.writeFileSync(
			childSessionFile,
			`${JSON.stringify({
				type: "session",
				version: 3,
				id: "abc",
				timestamp: new Date().toISOString(),
				cwd: tempDir,
				parentSession: parentSessionFile,
				piSuperagents: { owner: "pi-superagents", agent: "sp-implementer", sessionMode: "standalone" },
			})}\n`,
			"utf-8",
		);
		assert.throws(
			() =>
				validateResumeSessionFile({
					resumeSession: childSessionFile,
					parentSessionFile,
					childCwd: tempDir,
				}),
			/session mode is not lineage-only/,
		);
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
			agentName: "sp-implementer",
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
			agentName: "sp-implementer",
		});
		const firstAgain = resolver.sessionFileForIndex({
			sessionMode: "fork",
			index: 0,
			childCwd: tempDir,
			agentName: "sp-implementer",
		});
		const second = resolver.sessionFileForIndex({
			sessionMode: "fork",
			index: 1,
			childCwd: tempDir,
			agentName: "sp-implementer",
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
			agentName: "sp-implementer",
		});
		const second = resolver.sessionFileForIndex({
			sessionMode: "lineage-only",
			index: 1,
			childCwd: path.join(tempDir, "second"),
			agentName: "sp-implementer",
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

	void it("returns the existing session when resumeSession is valid for sp-implementer", () => {
		const tempDir = makeTempDir("pi-session-mode-resume-");
		const parentSessionFile = path.join(tempDir, "parent.jsonl");
		fs.writeFileSync(parentSessionFile, '{"type":"session"}\n', "utf-8");
		const childSessionFile = path.join(tempDir, "child.jsonl");
		seedLineageOnlySessionFile({
			parentSessionFile,
			childSessionFile,
			childCwd: tempDir,
			agentName: "sp-implementer",
		});
		const { manager, calls } = makeSessionLaunchManager(tempDir, { parentSessionFile });
		const resolver = createSessionLaunchResolver({
			sessionManager: manager,
			sessionRoot: path.join(tempDir, "sessions"),
		});

		const resolved = resolver.sessionFileForIndex({
			sessionMode: "lineage-only",
			index: 0,
			childCwd: tempDir,
			agentName: "sp-implementer",
			resumeSession: childSessionFile,
		});

		assert.equal(resolved, path.resolve(childSessionFile));
		assert.deepEqual(calls, []);
		// Header must not be re-seeded.
		assert.equal(readJsonl(childSessionFile).length, 1);
	});

	void it("rejects resumeSession when agent is not sp-implementer", () => {
		const tempDir = makeTempDir("pi-session-mode-resume-");
		const parentSessionFile = path.join(tempDir, "parent.jsonl");
		fs.writeFileSync(parentSessionFile, '{"type":"session"}\n', "utf-8");
		const childSessionFile = path.join(tempDir, "child.jsonl");
		seedLineageOnlySessionFile({
			parentSessionFile,
			childSessionFile,
			childCwd: tempDir,
			agentName: "sp-implementer",
		});
		const { manager } = makeSessionLaunchManager(tempDir, { parentSessionFile });
		const resolver = createSessionLaunchResolver({
			sessionManager: manager,
			sessionRoot: path.join(tempDir, "sessions"),
		});

		assert.throws(
			() =>
				resolver.sessionFileForIndex({
					sessionMode: "lineage-only",
					index: 0,
					childCwd: tempDir,
					agentName: "sp-research",
					resumeSession: childSessionFile,
				}),
			/sp-implementer/,
		);
	});

	void it("rejects resumeSession when session mode is not lineage-only", () => {
		const tempDir = makeTempDir("pi-session-mode-resume-");
		const parentSessionFile = path.join(tempDir, "parent.jsonl");
		fs.writeFileSync(parentSessionFile, '{"type":"session"}\n', "utf-8");
		const childSessionFile = path.join(tempDir, "child.jsonl");
		seedLineageOnlySessionFile({
			parentSessionFile,
			childSessionFile,
			childCwd: tempDir,
			agentName: "sp-implementer",
		});
		const { manager } = makeSessionLaunchManager(tempDir, { parentSessionFile });
		const resolver = createSessionLaunchResolver({
			sessionManager: manager,
			sessionRoot: path.join(tempDir, "sessions"),
		});

		assert.throws(
			() =>
				resolver.sessionFileForIndex({
					sessionMode: "fork",
					index: 0,
					childCwd: tempDir,
					agentName: "sp-implementer",
					resumeSession: childSessionFile,
				}),
			/lineage-only/,
		);
	});

	void it("rejects resumeSession when the file is missing", () => {
		const tempDir = makeTempDir("pi-session-mode-resume-");
		const parentSessionFile = path.join(tempDir, "parent.jsonl");
		fs.writeFileSync(parentSessionFile, '{"type":"session"}\n', "utf-8");
		const { manager } = makeSessionLaunchManager(tempDir, { parentSessionFile });
		const resolver = createSessionLaunchResolver({
			sessionManager: manager,
			sessionRoot: path.join(tempDir, "sessions"),
		});

		assert.throws(
			() =>
				resolver.sessionFileForIndex({
					sessionMode: "lineage-only",
					index: 0,
					childCwd: tempDir,
					agentName: "sp-implementer",
					resumeSession: path.join(tempDir, "missing.jsonl"),
				}),
			/resume session file does not exist/,
		);
	});

	void it("rejects resumeSession when the resumed file has the wrong parent", () => {
		const tempDir = makeTempDir("pi-session-mode-resume-");
		const parentSessionFile = path.join(tempDir, "parent.jsonl");
		fs.writeFileSync(parentSessionFile, '{"type":"session"}\n', "utf-8");
		const childSessionFile = path.join(tempDir, "child.jsonl");
		seedLineageOnlySessionFile({
			parentSessionFile: "/tmp/some-other-parent.jsonl",
			childSessionFile,
			childCwd: tempDir,
			agentName: "sp-implementer",
		});
		const { manager } = makeSessionLaunchManager(tempDir, { parentSessionFile });
		const resolver = createSessionLaunchResolver({
			sessionManager: manager,
			sessionRoot: path.join(tempDir, "sessions"),
		});

		assert.throws(
			() =>
				resolver.sessionFileForIndex({
					sessionMode: "lineage-only",
					index: 0,
					childCwd: tempDir,
					agentName: "sp-implementer",
					resumeSession: childSessionFile,
				}),
			/parent session does not match/,
		);
	});

	void it("rejects resumeSession when the resumed file has the wrong cwd", () => {
		const tempDir = makeTempDir("pi-session-mode-resume-");
		const otherCwd = makeTempDir("pi-session-mode-resume-other-");
		const parentSessionFile = path.join(tempDir, "parent.jsonl");
		fs.writeFileSync(parentSessionFile, '{"type":"session"}\n', "utf-8");
		const childSessionFile = path.join(tempDir, "child.jsonl");
		seedLineageOnlySessionFile({
			parentSessionFile,
			childSessionFile,
			childCwd: otherCwd,
			agentName: "sp-implementer",
		});
		const { manager } = makeSessionLaunchManager(tempDir, { parentSessionFile });
		const resolver = createSessionLaunchResolver({
			sessionManager: manager,
			sessionRoot: path.join(tempDir, "sessions"),
		});

		assert.throws(
			() =>
				resolver.sessionFileForIndex({
					sessionMode: "lineage-only",
					index: 0,
					childCwd: tempDir,
					agentName: "sp-implementer",
					resumeSession: childSessionFile,
				}),
			/cwd does not match/,
		);
	});

	void it("rejects resumeSession when the resumed file has the wrong role", () => {
		const tempDir = makeTempDir("pi-session-mode-resume-");
		const parentSessionFile = path.join(tempDir, "parent.jsonl");
		fs.writeFileSync(parentSessionFile, '{"type":"session"}\n', "utf-8");
		const childSessionFile = path.join(tempDir, "child.jsonl");
		seedLineageOnlySessionFile({
			parentSessionFile,
			childSessionFile,
			childCwd: tempDir,
			agentName: "sp-research",
		});
		const { manager } = makeSessionLaunchManager(tempDir, { parentSessionFile });
		const resolver = createSessionLaunchResolver({
			sessionManager: manager,
			sessionRoot: path.join(tempDir, "sessions"),
		});

		assert.throws(
			() =>
				resolver.sessionFileForIndex({
					sessionMode: "lineage-only",
					index: 0,
					childCwd: tempDir,
					agentName: "sp-implementer",
					resumeSession: childSessionFile,
				}),
			/not sp-implementer/,
		);
	});
});
