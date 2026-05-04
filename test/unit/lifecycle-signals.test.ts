/**
 * Unit tests for subagent lifecycle sidecar signal handling.
 *
 * Responsibilities:
 * - verify child `.exit` sidecars are written atomically
 * - verify parent-side parse/consume behavior for done and ping signals
 * - verify malformed, unreadable, stale, and missing sidecars never crash callers
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import { consumeLifecycleSignal, getLifecycleSidecarPath, writeLifecycleSignalAtomic } from "../../src/execution/lifecycle-signals.ts";

const tempDirs: string[] = [];

/**
 * Create a temporary session file path and track the temp directory for cleanup.
 * Always uses os.tmpdir() to avoid polluting the repo CWD.
 *
 * @returns Path to a child.jsonl file inside a new temp directory.
 */
function tempSessionFile(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-superagents-life-"));
	tempDirs.push(dir);
	return path.join(dir, "child.jsonl");
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

void describe("lifecycle sidecar signals", () => {
	void it("writes done sidecars atomically and consumes them", () => {
		const sessionFile = tempSessionFile();
		writeLifecycleSignalAtomic(sessionFile, { type: "done", outputTokens: 42 });

		const sidecar = getLifecycleSidecarPath(sessionFile);
		assert.equal(fs.existsSync(sidecar), true);
		assert.equal(
			fs.readdirSync(path.dirname(sidecar)).some((name) => name.includes(".tmp-")),
			false,
		);

		const result = consumeLifecycleSignal(sessionFile);
		assert.equal(result.status, "consumed");
		assert.deepEqual(result.signal, { type: "done", outputTokens: 42 });
		assert.equal(fs.existsSync(sidecar), false);
	});

	void it("writes ping sidecars atomically and consumes parent request text", () => {
		const sessionFile = tempSessionFile();
		writeLifecycleSignalAtomic(sessionFile, { type: "ping", name: "sp-research", message: "Need module name", outputTokens: 7 });

		const result = consumeLifecycleSignal(sessionFile);
		assert.equal(result.status, "consumed");
		assert.deepEqual(result.signal, { type: "ping", name: "sp-research", message: "Need module name", outputTokens: 7 });
	});

	void it("returns missing for absent sidecars", () => {
		const sessionFile = tempSessionFile();
		const result = consumeLifecycleSignal(sessionFile);
		assert.equal(result.status, "missing");
		assert.match(result.path, /child\.jsonl\.exit$/);
	});

	void it("returns malformed and removes invalid sidecars", () => {
		const sessionFile = tempSessionFile();
		const sidecar = getLifecycleSidecarPath(sessionFile);
		fs.writeFileSync(sidecar, "{ not json", "utf-8");

		const result = consumeLifecycleSignal(sessionFile);
		assert.equal(result.status, "malformed");
		assert.match(result.diagnostic ?? "", /JSON|Unexpected|malformed/i);
		assert.equal(fs.existsSync(sidecar), false);
	});

	void it("returns stale and removes sidecars older than max age", () => {
		const sessionFile = tempSessionFile();
		const sidecar = getLifecycleSidecarPath(sessionFile);
		fs.writeFileSync(sidecar, JSON.stringify({ type: "done" }), "utf-8");
		const old = new Date(Date.now() - 60_000);
		fs.utimesSync(sidecar, old, old);

		const result = consumeLifecycleSignal(sessionFile, { maxAgeMs: 1 });
		assert.equal(result.status, "stale");
		assert.equal(fs.existsSync(sidecar), false);
	});

	void it("write and consume sidecar when session file has no directory component", () => {
		// Use a unique filename to avoid collisions when tests run in parallel.
		const uniqueId = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		const sessionFile = `no-slash-${uniqueId}.jsonl`; // no directory prefix
		const expectedSidecar = `${sessionFile}.exit`;
		const sidecar = getLifecycleSidecarPath(sessionFile);
		assert.equal(sidecar, expectedSidecar);

		try {
			writeLifecycleSignalAtomic(sessionFile, { type: "done" });

			assert.equal(fs.existsSync(sidecar), true, "sidecar should exist in current directory");

			const result = consumeLifecycleSignal(sessionFile);
			assert.equal(result.status, "consumed");
			assert.deepEqual(result.signal, { type: "done" });
		} finally {
			// Ensure cleanup even if assertions fail
			fs.rmSync(sidecar, { force: true });
		}
	});

	// --- Tests for removeMalformed option ---

	void it("removes invalid JSON sidecar when removeMalformed defaults to true", () => {
		const sessionFile = tempSessionFile();
		const sidecar = getLifecycleSidecarPath(sessionFile);
		fs.writeFileSync(sidecar, "{ not json", "utf-8");

		const result = consumeLifecycleSignal(sessionFile);
		assert.equal(result.status, "malformed");
		assert.equal(fs.existsSync(sidecar), false);
	});

	void it("removes invalid JSON sidecar when removeMalformed is explicitly true", () => {
		const sessionFile = tempSessionFile();
		const sidecar = getLifecycleSidecarPath(sessionFile);
		fs.writeFileSync(sidecar, "{ not json", "utf-8");

		const result = consumeLifecycleSignal(sessionFile, { removeMalformed: true });
		assert.equal(result.status, "malformed");
		assert.equal(fs.existsSync(sidecar), false);
	});

	void it("keeps invalid JSON sidecar when removeMalformed is false", () => {
		const sessionFile = tempSessionFile();
		const sidecar = getLifecycleSidecarPath(sessionFile);
		fs.writeFileSync(sidecar, "{ not json", "utf-8");

		const result = consumeLifecycleSignal(sessionFile, { removeMalformed: false });
		assert.equal(result.status, "malformed");
		assert.equal(fs.existsSync(sidecar), true);
		fs.rmSync(sidecar, { force: true }); // cleanup
	});

	void it("removes invalid shape sidecar when removeMalformed defaults to true", () => {
		const sessionFile = tempSessionFile();
		const sidecar = getLifecycleSidecarPath(sessionFile);
		// Valid JSON but invalid shape (missing type)
		fs.writeFileSync(sidecar, JSON.stringify({ outputTokens: 42 }), "utf-8");

		const result = consumeLifecycleSignal(sessionFile);
		assert.equal(result.status, "malformed");
		assert.match(result.diagnostic ?? "", /unsupported shape/i);
		assert.equal(fs.existsSync(sidecar), false);
	});

	void it("keeps invalid shape sidecar when removeMalformed is false", () => {
		const sessionFile = tempSessionFile();
		const sidecar = getLifecycleSidecarPath(sessionFile);
		// Valid JSON but invalid shape (wrong type value)
		fs.writeFileSync(sidecar, JSON.stringify({ type: "unknown", outputTokens: 42 }), "utf-8");

		const result = consumeLifecycleSignal(sessionFile, { removeMalformed: false });
		assert.equal(result.status, "malformed");
		assert.match(result.diagnostic ?? "", /unsupported shape/i);
		assert.equal(fs.existsSync(sidecar), true);
		fs.rmSync(sidecar, { force: true }); // cleanup
	});

	// --- Test for ENOENT/missing behavior ---

	void it("returns missing when sidecar does not exist (no TOCTOU)", () => {
		const sessionFile = tempSessionFile();
		// Do not create the sidecar
		const result = consumeLifecycleSignal(sessionFile);
		assert.equal(result.status, "missing");
		assert.match(result.path, /child\.jsonl\.exit$/);
	});

	// --- Test for unreadable sidecar (permission denied) ---

	void it("returns unreadable when sidecar cannot be read due to permissions", () => {
		const sessionFile = tempSessionFile();
		const sidecar = getLifecycleSidecarPath(sessionFile);
		writeLifecycleSignalAtomic(sessionFile, { type: "done" });

		// Remove read permission
		fs.chmodSync(sidecar, 0o000);

		try {
			const result = consumeLifecycleSignal(sessionFile);
			assert.equal(result.status, "unreadable");
			assert.ok(result.diagnostic, "should have a diagnostic message");
		} finally {
			// Restore permissions for cleanup
			fs.chmodSync(sidecar, 0o600);
		}
	});

	// --- New focused tests (Task 4) ---

	void it("returns missing when called with undefined session file", () => {
		const result = consumeLifecycleSignal(undefined);
		assert.equal(result.status, "missing");
		assert.ok(result.diagnostic, "should have a diagnostic explaining no session file");
	});

	void it("returns malformed for ping with missing message", () => {
		const sessionFile = tempSessionFile();
		const sidecar = getLifecycleSidecarPath(sessionFile);
		// Valid ping but missing message — should be malformed
		fs.writeFileSync(sidecar, JSON.stringify({ type: "ping" }), "utf-8");

		const result = consumeLifecycleSignal(sessionFile);
		assert.equal(result.status, "malformed");
		assert.equal(fs.existsSync(sidecar), false);
	});

	void it("returns malformed for ping with empty message", () => {
		const sessionFile = tempSessionFile();
		const sidecar = getLifecycleSidecarPath(sessionFile);
		fs.writeFileSync(sidecar, JSON.stringify({ type: "ping", message: "   " }), "utf-8");

		const result = consumeLifecycleSignal(sessionFile);
		assert.equal(result.status, "malformed");
		assert.equal(fs.existsSync(sidecar), false);
	});

	void it("consumes ping when name is omitted but message is valid", () => {
		const sessionFile = tempSessionFile();
		writeLifecycleSignalAtomic(sessionFile, { type: "ping", message: "Need module name" });

		const result = consumeLifecycleSignal(sessionFile);
		assert.equal(result.status, "consumed");
		assert.deepEqual(result.signal, { type: "ping", message: "Need module name" });
	});

	void it("ignores non-finite outputTokens on done signal (normalizes to undefined)", () => {
		const sessionFile = tempSessionFile();
		const sidecar = getLifecycleSidecarPath(sessionFile);
		fs.writeFileSync(sidecar, JSON.stringify({ type: "done", outputTokens: NaN }), "utf-8");

		// Non-finite outputTokens are normalized to undefined, so signal is valid and consumed.
		const result = consumeLifecycleSignal(sessionFile);
		assert.equal(result.status, "consumed");
		assert.deepEqual(result.signal, { type: "done" });
		assert.strictEqual(result.signal?.outputTokens, undefined);
		assert.equal(fs.existsSync(sidecar), false);
	});

	void it("ignores non-finite outputTokens on ping signal (omitted from output)", () => {
		const sessionFile = tempSessionFile();
		writeLifecycleSignalAtomic(sessionFile, { type: "ping", message: "test", outputTokens: Infinity });

		const result = consumeLifecycleSignal(sessionFile);
		assert.equal(result.status, "consumed");
		assert.deepEqual(result.signal, { type: "ping", message: "test" });
		assert.strictEqual(result.signal?.outputTokens, undefined);
	});
});
