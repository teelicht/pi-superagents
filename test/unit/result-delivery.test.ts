/**
 * Unit tests for subagent result ownership and delivery.
 *
 * Responsibilities:
 * - exercise wait/join/detach as a deterministic state machine
 * - prove completed results are delivered at most once
 * - avoid real child processes by using controlled completion promises
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChildRunResult } from "../../src/shared/types.ts";
import { createResultDeliveryStore, deriveCompletionEnvelope } from "../../src/execution/result-delivery.ts";

function result(agent = "sp-research", task = "Task", output = "Done", exitCode = 0, errorMsg?: string): ChildRunResult {
	return {
		agent,
		task,
		exitCode,
		messages: [],
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
		finalOutput: output,
		...(errorMsg ? { error: errorMsg } : {}),
	};
}

type Deferred = {
	promise: Promise<unknown>;
	resolve: (value: unknown) => void;
	reject: (error: unknown) => void;
};

function deferred(): Deferred {
	const d = Object.create(null);
	d.promise = new Promise<unknown>((res, rej) => {
		d.resolve = res;
		d.reject = rej;
	});
	return d;
}

describe("result delivery store", () => {
	it("waits for one running child and prevents duplicate delivery", async () => {
		const completion = deferred();
		const store = createResultDeliveryStore();
		store.register({ id: "child-1", agent: "sp-research", task: "Inspect", completion: completion.promise as Promise<ChildRunResult> });

		const waitPromise = store.wait("child-1");
		completion.resolve(result("sp-research", "Inspect", "Report"));
		const waited = await waitPromise;

		assert.equal("error" in waited, false);
		if ("error" in waited) return;
		assert.equal(waited.result.completion?.status, "completed");
		assert.equal(waited.result.completion?.body, "Report");

		const second = await store.wait("child-1");
		assert.deepEqual(second, { error: { code: "already_delivered", message: "Result for child-1 has already been delivered.", ids: ["child-1"] } });
	});

	it("joins multiple children in requested order", async () => {
		const store = createResultDeliveryStore();
		store.register({ id: "a", agent: "sp-recon", task: "A", completion: Promise.resolve(result("sp-recon", "A", "A done")) });
		store.register({ id: "b", agent: "sp-debug", task: "B", completion: Promise.resolve(result("sp-debug", "B", "B done")) });

		const joined = await store.join(["b", "a"]);
		assert.equal("error" in joined, false);
		if ("error" in joined) return;
		assert.deepEqual(joined.results.map((item) => item.agent), ["sp-debug", "sp-recon"]);
		assert.equal((await store.wait("a") as any).error.code, "already_delivered");
	});

	it("rejects duplicate and empty joins", async () => {
		const store = createResultDeliveryStore();
		assert.equal((await store.join([]) as any).error.code, "empty_id_list");
		assert.equal((await store.join(["x", "x"]) as any).error.code, "duplicate_id");
	});

	it("rejects already owned records", async () => {
		const completion = deferred();
		const store = createResultDeliveryStore();
		store.register({ id: "child-1", agent: "sp-research", task: "Inspect", completion: completion.promise as Promise<ChildRunResult> });

		const waitPromise = store.wait("child-1");
		const second = await store.wait("child-1");
		assert.equal((second as any).error.code, "already_owned");

		completion.resolve(result());
		await waitPromise;
	});

	it("timeout releases ownership before completion", async () => {
		const completion = deferred();
		const store = createResultDeliveryStore();
		store.register({ id: "child-1", agent: "sp-research", task: "Inspect", completion: completion.promise as Promise<ChildRunResult> });

		const waitPromise = store.wait("child-1", { timeoutMs: 1 });
		const timedOut = await waitPromise;
		assert.equal((timedOut as any).error.code, "timeout");

		completion.resolve(result());
		const waited = await store.wait("child-1");
		assert.equal("error" in waited, false);
	});

	it("derives needs_parent envelope from ping lifecycle", () => {
		const envelope = deriveCompletionEnvelope({
			...result("sp-research", "Inspect", "Partial notes"),
			lifecycle: { status: "consumed", path: "/tmp/session.exit", signal: { type: "ping", message: "Need target file" } },
		});
		assert.equal(envelope.status, "needs_parent");
		assert.equal(envelope.parentRequest, "Need target file");
		assert.equal(envelope.body, "Partial notes");
	});

	// --- Task 1: detach while waiter is pending ---
	it("detach while waiter is pending releases ownership and allows re-wait after resolve", async () => {
		const completion = deferred();
		const store = createResultDeliveryStore();
		store.register({ id: "child-1", agent: "sp-research", task: "Inspect", completion: completion.promise as Promise<ChildRunResult> });

		// Start a waiter
		const waitPromise = store.wait("child-1");

		// Detach should succeed
		const detachResult = store.detach("child-1");
		assert.deepEqual(detachResult, { ok: true });

		// Resolve the child while waiter is still pending.
		// Note: with node --experimental-strip-types, resolve BEFORE awaiting the
		// waitPromise to avoid a timing edge case in the test runner's await handling.
		completion.resolve(result("sp-research", "Inspect", "Final report"));

		// First waiter gets not_owned
		const notOwned = await waitPromise;
		assert.equal((notOwned as any).error?.code, "not_owned");

		// Subsequent wait should deliver the result
		const waited = await store.wait("child-1");
		assert.equal("error" in waited, false);
		if ("error" in waited) return;
		assert.equal(waited.result.completion?.body, "Final report");
	});

	it("detach while child is join-owned releases ownership and allows re-wait after resolve", async () => {
		const completion = deferred();
		const store = createResultDeliveryStore();
		store.register({ id: "child-1", agent: "sp-research", task: "Inspect", completion: completion.promise as Promise<ChildRunResult> });

		// Start a join
		const joinPromise = store.join(["child-1"]);

		// Detach should succeed
		const detachResult = store.detach("child-1");
		assert.deepEqual(detachResult, { ok: true });

		// Resolve before awaiting to avoid node:test strip-types timing edge case
		completion.resolve(result("sp-research", "Inspect", "Post-detach result"));

		// Join should get not_owned
		const notOwned = await joinPromise;
		assert.equal((notOwned as any).error?.code, "not_owned");

		// Subsequent wait should deliver the result
		const waited = await store.wait("child-1");
		assert.equal("error" in waited, false);
		if ("error" in waited) return;
		assert.equal(waited.result.completion?.body, "Post-detach result");
	});

	it("detach interrupts timeout wait before timeout elapses", async () => {
		const completion = deferred();
		const store = createResultDeliveryStore();
		store.register({ id: "child-1", agent: "sp-research", task: "Inspect", completion: completion.promise as Promise<ChildRunResult> });

		const waitPromise = store.wait("child-1", { timeoutMs: 5_000 });
		assert.deepEqual(store.detach("child-1"), { ok: true });

		const notOwned = await waitPromise;
		assert.equal((notOwned as any).error?.code, "not_owned");

		completion.resolve(result("sp-research", "Inspect", "After detach"));
		const waited = await store.wait("child-1");
		assert.equal("error" in waited, false);
	});

	it("detach interrupts timeout join before timeout elapses", async () => {
		const completion = deferred();
		const store = createResultDeliveryStore();
		store.register({ id: "child-1", agent: "sp-research", task: "Inspect", completion: completion.promise as Promise<ChildRunResult> });

		const joinPromise = store.join(["child-1"], { timeoutMs: 5_000 });
		assert.deepEqual(store.detach("child-1"), { ok: true });

		const notOwned = await joinPromise;
		assert.equal((notOwned as any).error?.code, "not_owned");

		completion.resolve(result("sp-research", "Inspect", "After detach"));
		const waited = await store.wait("child-1");
		assert.equal("error" in waited, false);
	});

	// --- Task 2: join timeout cleanup ---
	it("join timeout detaches all owned records so later waits can deliver", async () => {
		const completionA = deferred();
		const completionB = deferred();
		const store = createResultDeliveryStore();
		store.register({ id: "child-a", agent: "sp-recon", task: "A", completion: completionA.promise as Promise<ChildRunResult> });
		store.register({ id: "child-b", agent: "sp-research", task: "B", completion: completionB.promise as Promise<ChildRunResult> });

		// Join with very short timeout
		const joinResult = await store.join(["child-a", "child-b"], { timeoutMs: 5 });
		assert.equal((joinResult as any).error?.code, "timeout");

		// Both should be detached and available
		const inspectA = store.inspect("child-a");
		const inspectB = store.inspect("child-b");
		assert.equal(inspectA?.state, "detached");
		assert.equal(inspectB?.state, "detached");
		assert.equal(inspectA?.ownerToken, undefined);
		assert.equal(inspectB?.ownerToken, undefined);

		// Resolve both children
		completionA.resolve(result("sp-recon", "A", "A done"));
		completionB.resolve(result("sp-research", "B", "B done"));

		// Later waits should deliver successfully
		const waitedA = await store.wait("child-a");
		const waitedB = await store.wait("child-b");
		assert.equal("error" in waitedA, false);
		assert.equal("error" in waitedB, false);
	});

	it("join first-child timeout leaves second child detached for re-wait", async () => {
		const completionA = deferred();
		const store = createResultDeliveryStore();
		store.register({ id: "child-a", agent: "sp-recon", task: "A", completion: completionA.promise as Promise<ChildRunResult> });
		store.register({ id: "child-b", agent: "sp-research", task: "B", completion: Promise.resolve(result("sp-research", "B", "B done")) });

		// Join with very short timeout
		const joinResult = await store.join(["child-a", "child-b"], { timeoutMs: 5 });
		assert.equal((joinResult as any).error?.code, "timeout");

		// child-b should be detached (timeout cleanup via releaseOwnedRecords)
		const inspectB = store.inspect("child-b");
		assert.equal(inspectB?.state, "detached");

		// Resolve child-a and deliver both
		completionA.resolve(result("sp-recon", "A", "A done"));
		const waitedA = await store.wait("child-a");
		const waitedB = await store.wait("child-b");
		assert.equal("error" in waitedA, false);
		assert.equal("error" in waitedB, false);
	});

	// --- Task 3: not_found on wait/join/detach ---
	it("wait returns not_found for unknown id", async () => {
		const store = createResultDeliveryStore();
		const r = await store.wait("nonexistent");
		assert.deepEqual(r, { error: { code: "not_found", message: "No child result found for nonexistent.", ids: ["nonexistent"] } });
	});

	it("join returns not_found for unknown id", async () => {
		const store = createResultDeliveryStore();
		const r = await store.join(["nonexistent"]);
		assert.deepEqual(r, { error: { code: "not_found", message: "No child result found for nonexistent.", ids: ["nonexistent"] } });
	});

	it("detach returns not_found for unknown id", () => {
		const store = createResultDeliveryStore();
		const r = store.detach("nonexistent");
		assert.deepEqual(r, { error: { code: "not_found", message: "No child result found for nonexistent.", ids: ["nonexistent"] } });
	});

	it("inspect returns undefined for unknown id", () => {
		const store = createResultDeliveryStore();
		assert.equal(store.inspect("nonexistent"), undefined);
	});

	// --- Task 3: duplicate register throws ---
	it("register throws on duplicate id", () => {
		const store = createResultDeliveryStore();
		store.register({ id: "child-1", agent: "sp-research", task: "Inspect", completion: Promise.resolve(result()) });
		assert.throws(
			() => store.register({ id: "child-1", agent: "sp-research", task: "Inspect", completion: Promise.resolve(result()) }),
			/duplicate/i,
		);
	});

	// --- Task 3: completion promise rejection becomes failed ChildRunResult ---
	it("rejected completion promise becomes a failed ChildRunResult", async () => {
		const completion = deferred();
		const store = createResultDeliveryStore();
		store.register({ id: "child-1", agent: "sp-research", task: "Inspect", completion: completion.promise as Promise<ChildRunResult> });

		const waitPromise = store.wait("child-1");
		completion.reject(new Error("Child crashed"));

		const waited = await waitPromise;
		assert.equal("error" in waited, false);
		if ("error" in waited) return;
		assert.equal(waited.result.completion?.status, "failed");
		assert.equal(waited.result.error, "Child crashed");
	});

	// --- Task 3: deriveCompletionEnvelope failed/cancelled states ---
	it("derives failed envelope from non-zero exit code", () => {
		const envelope = deriveCompletionEnvelope(result("sp-research", "Inspect", "Something went wrong", 1));
		assert.equal(envelope.status, "failed");
		assert.equal(envelope.summary, "Something went wrong");
		assert.equal(envelope.body, "Something went wrong");
	});

	it("derives cancelled envelope from negative exit code", () => {
		const envelope = deriveCompletionEnvelope(result("sp-research", "Inspect", "Killed", -1));
		assert.equal(envelope.status, "cancelled");
		assert.equal(envelope.summary, "Killed");
	});

	it("derives failed envelope from error message field", () => {
		const envelope = deriveCompletionEnvelope(result("sp-research", "Inspect", "Output text", 1, "Process error"));
		assert.equal(envelope.status, "failed");
		assert.equal(envelope.notes?.error, "Process error");
	});

	// --- Task 4: inspect returns frozen shallow copy ---
	it("inspect returns frozen copy preventing external mutation", () => {
		const store = createResultDeliveryStore();
		store.register({ id: "child-1", agent: "sp-research", task: "Inspect", completion: Promise.resolve(result()) });
		const inspected = store.inspect("child-1");
		assert.ok(inspected);
		// Frozen object: attempts to mutate should throw
		assert.throws(() => { (inspected as any).state = "awaited"; }, TypeError);
		assert.throws(() => { (inspected as any).ownerToken = Symbol("hacker"); }, TypeError);
		assert.throws(() => { (inspected as any).deliveredTo = "wait"; }, TypeError);
	});

	it("mutating inspect result does not affect store ownership", async () => {
		const completion = deferred();
		const store = createResultDeliveryStore();
		store.register({ id: "child-1", agent: "sp-research", task: "Inspect", completion: completion.promise as Promise<ChildRunResult> });

		const inspected = store.inspect("child-1");
		assert.ok(inspected);
		// The returned object is frozen at the top level; nested refs (completion promise)
		// are still the original objects but cannot be reassigned.
		assert.throws(() => { (inspected as any).state = "awaited"; }, TypeError);

		// Store state is preserved
		const reInspected = store.inspect("child-1");
		assert.equal(reInspected?.state, "detached");
		assert.equal(reInspected?.ownerToken, undefined);
		assert.equal(reInspected?.deliveredTo, undefined);

		// Wait still works normally
		const waitPromise = store.wait("child-1");
		completion.resolve(result("sp-research", "Inspect", "Final"));
		const waited = await waitPromise;
		assert.equal("error" in waited, false);
	});

	it("inspect omits pending delivery controllers", async () => {
		const completion = deferred();
		const store = createResultDeliveryStore();
		store.register({ id: "child-1", agent: "sp-research", task: "Inspect", completion: completion.promise as Promise<ChildRunResult> });

		const waitPromise = store.wait("child-1");
		const inspected = store.inspect("child-1");
		assert.ok(inspected);
		assert.equal("pendingResult" in inspected, false);

		completion.resolve(result("sp-research", "Inspect", "Final"));
		const waited = await waitPromise;
		assert.equal("error" in waited, false);
	});

	// --- Task 5: timeout waits resolve before long timeout when completions finish ---
	it("timeout waits resolve promptly when completions finish before timeout", async () => {
		// When children complete faster than the timeout, waits resolve promptly
		// instead of waiting for the timeout duration.
		const store = createResultDeliveryStore();
		const completions = [deferred(), deferred(), deferred()];

		store.register({ id: "a", agent: "sp-recon", task: "A", completion: completions[0].promise as Promise<ChildRunResult> });
		store.register({ id: "b", agent: "sp-research", task: "B", completion: completions[1].promise as Promise<ChildRunResult> });
		store.register({ id: "c", agent: "sp-debug", task: "C", completion: completions[2].promise as Promise<ChildRunResult> });

		// Start waits with long timeout (executed fast)
		const waitA = store.wait("a", { timeoutMs: 5000 });
		const waitB = store.wait("b", { timeoutMs: 5000 });
		const waitC = store.wait("c", { timeoutMs: 5000 });

		// Resolve all quickly
		completions[0].resolve(result("sp-recon", "A", "A done"));
		completions[1].resolve(result("sp-research", "B", "B done"));
		completions[2].resolve(result("sp-debug", "C", "C done"));

		const [resA, resB, resC] = await Promise.all([waitA, waitB, waitC]);
		assert.equal("error" in resA, false);
		assert.equal("error" in resB, false);
		assert.equal("error" in resC, false);
	});

	// --- Task 3 new tests ---

	// Test 1: detach returns not_owned for already-detached records and already-delivered records
	it("detach returns not_owned for already-detached record", () => {
		const store = createResultDeliveryStore();
		store.register({ id: "child-1", agent: "sp-research", task: "Inspect", completion: Promise.resolve(result()) });

		// Detach on a detached (never-owned) record should return not_owned
		const result1 = store.detach("child-1");
		assert.deepEqual(result1, { error: { code: "not_owned", message: "Result for child-1 is not owned.", ids: ["child-1"] } });
	});

	it("detach returns not_owned for already-delivered record", async () => {
		const completion = deferred();
		const store = createResultDeliveryStore();
		store.register({ id: "child-1", agent: "sp-research", task: "Inspect", completion: completion.promise as Promise<ChildRunResult> });

		// Deliver the result
		const waitPromise = store.wait("child-1");
		completion.resolve(result("sp-research", "Inspect", "Report"));
		await waitPromise;

		// Detach on already-delivered record should return not_owned
		const result1 = store.detach("child-1");
		assert.deepEqual(result1, { error: { code: "not_owned", message: "Result for child-1 is not owned.", ids: ["child-1"] } });
	});

	// Test 2: join returns already_owned when one requested record is already wait-owned
	it("join returns already_owned when one record is already wait-owned", async () => {
		const completion = deferred();
		const store = createResultDeliveryStore();
		store.register({ id: "child-1", agent: "sp-research", task: "Inspect", completion: completion.promise as Promise<ChildRunResult> });
		store.register({ id: "child-2", agent: "sp-recon", task: "Recon", completion: Promise.resolve(result("sp-recon", "Recon", "Recon done")) });

		// Start a wait on child-1
		store.wait("child-1");

		// Join should reject because child-1 is already owned by the wait
		const result1 = await store.join(["child-1", "child-2"]);
		assert.equal((result1 as any).error?.code, "already_owned");

		// Resolve to clean up
		completion.resolve(result("sp-research", "Inspect", "Inspect done"));
	});

	// Test 3: multi-record join atomicity — partial failure must not deliver
	it("join does not deliver any result when a later record times out", async () => {
		const completionA = deferred();
		const completionB = deferred();
		const store = createResultDeliveryStore();
		store.register({ id: "a", agent: "sp-recon", task: "A", completion: completionA.promise as Promise<ChildRunResult> });
		store.register({ id: "b", agent: "sp-research", task: "B", completion: completionB.promise as Promise<ChildRunResult> });

		// Resolve the first child before joining so the test exercises the
		// partial-success path: a is collected, then b times out.
		completionA.resolve(result("sp-recon", "A", "A done"));
		const joinResult = await store.join(["a", "b"], { timeoutMs: 5 });
		assert.equal((joinResult as any).error?.code, "timeout");

		// Neither record should be delivered
		const inspectA = store.inspect("a");
		const inspectB = store.inspect("b");
		assert.equal(inspectA?.deliveredTo, undefined);
		assert.equal(inspectB?.deliveredTo, undefined);

		// Both should be detached (not joined-owned) so later waits can claim them
		assert.equal(inspectA?.state, "detached");
		assert.equal(inspectB?.state, "detached");

		// Resolve the still-pending child.
		completionB.resolve(result("sp-research", "B", "B done"));

		// Later waits should deliver both results
		const waitedA = await store.wait("a");
		const waitedB = await store.wait("b");
		assert.equal("error" in waitedA, false);
		assert.equal("error" in waitedB, false);
	});

	it("join does not deliver any result when a later record is detached during the join", async () => {
		const completionA = deferred();
		const completionB = deferred();
		const store = createResultDeliveryStore();
		store.register({ id: "a", agent: "sp-recon", task: "A", completion: completionA.promise as Promise<ChildRunResult> });
		store.register({ id: "b", agent: "sp-research", task: "B", completion: completionB.promise as Promise<ChildRunResult> });

		// Start join in background
		const joinPromise = store.join(["a", "b"]);

		// Wait for a to complete then detach b before b resolves
		completionA.resolve(result("sp-recon", "A", "A done"));
		// Give a chance to be processed
		await new Promise((r) => setTimeout(r, 1));
		// Detach b
		store.detach("b");

		const joinResult = await joinPromise;
		assert.equal((joinResult as any).error?.code, "not_owned");

		// a should NOT be delivered
		const inspectA = store.inspect("a");
		assert.equal(inspectA?.deliveredTo, undefined);

		// Resolve both children
		completionB.resolve(result("sp-research", "B", "B done"));

		// Later waits should deliver both results
		const waitedA = await store.wait("a");
		const waitedB = await store.wait("b");
		assert.equal("error" in waitedA, false);
		assert.equal("error" in waitedB, false);
	});

	it("join returns results in requested order on success", async () => {
		const store = createResultDeliveryStore();
		store.register({ id: "a", agent: "sp-recon", task: "A", completion: Promise.resolve(result("sp-recon", "A", "A done")) });
		store.register({ id: "b", agent: "sp-debug", task: "B", completion: Promise.resolve(result("sp-debug", "B", "B done")) });
		store.register({ id: "c", agent: "sp-research", task: "C", completion: Promise.resolve(result("sp-research", "C", "C done")) });

		// Request order: b, c, a (not alphabetical)
		const joined = await store.join(["b", "c", "a"]);
		assert.equal("error" in joined, false);
		if ("error" in joined) return;
		// Results must match requested order
		assert.deepEqual(joined.results.map((item) => item.agent), ["sp-debug", "sp-research", "sp-recon"]);
	});

	it("join releases owned records on error (not_owned from detach)", async () => {
		const completionA = deferred();
		const completionB = deferred();
		const store = createResultDeliveryStore();
		store.register({ id: "a", agent: "sp-recon", task: "A", completion: completionA.promise as Promise<ChildRunResult> });
		store.register({ id: "b", agent: "sp-research", task: "B", completion: completionB.promise as Promise<ChildRunResult> });

		// Start join in background
		const joinPromise = store.join(["a", "b"]);

		// Let a complete
		completionA.resolve(result("sp-recon", "A", "A done"));
		// Yield to event loop
		await new Promise((r) => setTimeout(r, 1));
		// Detach b (b is still pending)
		store.detach("b");

		const joinResult = await joinPromise;
		assert.equal((joinResult as any).error?.code, "not_owned");

		// a must NOT be delivered
		const inspectA = store.inspect("a");
		assert.equal(inspectA?.deliveredTo, undefined);
		assert.equal(inspectA?.state, "detached");

		// Resolve b and verify wait can deliver both
		completionB.resolve(result("sp-research", "B", "B done"));
		const waitedA = await store.wait("a");
		const waitedB = await store.wait("b");
		assert.equal("error" in waitedA, false);
		assert.equal("error" in waitedB, false);
	});
});
