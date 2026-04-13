/**
 * Unit coverage for the Plannotator event-only review bridge.
 *
 * Key responsibilities:
 * - verify the shared `plannotator:request` payload contract
 * - verify approval and rejection flows for matching review ids
 * - verify stale review results are ignored
 * - verify unavailable, missing-review-id, and timeout fallbacks remain fail-soft
 */

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import { requestPlannotatorPlanReview } from "../../src/integrations/plannotator.ts";

/**
 * Creates an EventEmitter-backed bus compatible with the Plannotator bridge.
 *
 * Inputs/outputs:
 * - no inputs
 * - returns emit/on methods matching the bridge contract
 *
 * Invariants:
 * - each on() call returns an unsubscribe function for that specific listener
 */
function createBus() {
	const emitter = new EventEmitter();

	return {
		emit(channel: string, data: unknown) {
			emitter.emit(channel, data);
		},
		on(channel: string, handler: (data: unknown) => void) {
			emitter.on(channel, handler);
			return () => emitter.off(channel, handler);
		},
	};
}

void describe("requestPlannotatorPlanReview", () => {
	void it("emits the shared request contract and resolves approval for the matching review id", async () => {
		const events = createBus();
		let seenRequest: Record<string, unknown> | undefined;

		events.on("plannotator:request", (request) => {
			assert.equal(typeof request, "object");
			assert.ok(request);
			seenRequest = request as Record<string, unknown>;

			assert.equal(seenRequest.action, "plan-review");
			assert.equal(typeof seenRequest.respond, "function");
			assert.match(String(seenRequest.requestId), /^plannotator-review-/);

			const payload = seenRequest.payload as Record<string, unknown>;
			assert.deepEqual(payload, {
				planContent: "# Plan\n- [ ] Step",
				planFilePath: "docs/plan.md",
				origin: "pi-superagents",
			});

			(seenRequest.respond as (response: unknown) => void)({
				status: "handled",
				result: { status: "pending", reviewId: "review-123" },
			});
			setTimeout(() => {
				events.emit("plannotator:review-result", { reviewId: "review-123", approved: true });
			}, 0);
		});

		const outcome = await requestPlannotatorPlanReview({
			events,
			planContent: "# Plan\n- [ ] Step",
			planFilePath: "docs/plan.md",
			requestTimeoutMs: 25,
			reviewTimeoutMs: 25,
		});

		assert.ok(seenRequest);
		assert.deepEqual(outcome, { status: "approved" });
	});

	void it("returns rejected with feedback from the matching review id", async () => {
		const events = createBus();

		events.on("plannotator:request", (request) => {
			const typedRequest = request as { respond(response: unknown): void };
			typedRequest.respond({
				status: "handled",
				result: { status: "pending", reviewId: "review-456" },
			});
			setTimeout(() => {
				events.emit("plannotator:review-result", {
					reviewId: "review-456",
					approved: false,
					feedback: "Clarify the retry timeout rationale.",
				});
			}, 0);
		});

		const outcome = await requestPlannotatorPlanReview({
			events,
			planContent: "# Plan",
			requestTimeoutMs: 25,
			reviewTimeoutMs: 25,
		});

		assert.deepEqual(outcome, {
			status: "rejected",
			feedback: "Clarify the retry timeout rationale.",
		});
	});

	void it("ignores stale review results for other review ids", async () => {
		const events = createBus();

		events.on("plannotator:request", (request) => {
			const typedRequest = request as { respond(response: unknown): void };
			typedRequest.respond({
				status: "handled",
				result: { status: "pending", reviewId: "review-live" },
			});
			setTimeout(() => {
				events.emit("plannotator:review-result", { reviewId: "review-stale", approved: true });
				events.emit("plannotator:review-result", { reviewId: "review-live", approved: false });
			}, 0);
		});

		const outcome = await requestPlannotatorPlanReview({
			events,
			planContent: "# Plan",
			requestTimeoutMs: 25,
			reviewTimeoutMs: 25,
		});

		assert.deepEqual(outcome, {
			status: "rejected",
			feedback: "Plan changes requested in Plannotator.",
		});
	});

	void it("returns unavailable when handled pending omits the review id", async () => {
		const events = createBus();

		events.on("plannotator:request", (request) => {
			const typedRequest = request as { respond(response: unknown): void };
			typedRequest.respond({
				status: "handled",
				result: { status: "pending" },
			});
		});

		const outcome = await requestPlannotatorPlanReview({
			events,
			planContent: "# Plan",
			requestTimeoutMs: 25,
			reviewTimeoutMs: 25,
		});

		assert.deepEqual(outcome, {
			status: "unavailable",
			reason: "Plannotator handled the request but did not provide a reviewId.",
		});
	});

	void it("returns unavailable when Plannotator reports unavailable or error", async () => {
		const unavailableEvents = createBus();
		unavailableEvents.on("plannotator:request", (request) => {
			const typedRequest = request as { respond(response: unknown): void };
			typedRequest.respond({ status: "unavailable", error: "No active Plannotator UI." });
		});

		assert.deepEqual(
			await requestPlannotatorPlanReview({
				events: unavailableEvents,
				planContent: "# Plan",
				requestTimeoutMs: 25,
				reviewTimeoutMs: 25,
			}),
			{ status: "unavailable", reason: "No active Plannotator UI." },
		);

		const errorEvents = createBus();
		errorEvents.on("plannotator:request", (request) => {
			const typedRequest = request as { respond(response: unknown): void };
			typedRequest.respond({ status: "error", error: "Browser startup failed." });
		});

		assert.deepEqual(
			await requestPlannotatorPlanReview({
				events: errorEvents,
				planContent: "# Plan",
				requestTimeoutMs: 25,
				reviewTimeoutMs: 25,
			}),
			{ status: "unavailable", reason: "Browser startup failed." },
		);
	});

	void it("returns unavailable when the response callback or matching review result times out", async () => {
		const noResponseEvents = createBus();
		assert.deepEqual(
			await requestPlannotatorPlanReview({
				events: noResponseEvents,
				planContent: "# Plan",
				requestTimeoutMs: 5,
				reviewTimeoutMs: 5,
			}),
			{ status: "unavailable", reason: "Plannotator did not respond to plan-review request before timeout." },
		);

		const noResultEvents = createBus();
		noResultEvents.on("plannotator:request", (request) => {
			const typedRequest = request as { respond(response: unknown): void };
			typedRequest.respond({
				status: "handled",
				result: { status: "pending", reviewId: "review-timeout" },
			});
		});

		assert.deepEqual(
			await requestPlannotatorPlanReview({
				events: noResultEvents,
				planContent: "# Plan",
				requestTimeoutMs: 25,
				reviewTimeoutMs: 5,
			}),
			{ status: "unavailable", reason: "Plannotator review-result did not arrive before timeout." },
		);
	});

	void it("cleans up immediately when emitting the request throws", async () => {
		let activeReviewListeners = 0;
		const events = {
			emit() {
				throw new Error("event bus unavailable");
			},
			on() {
				activeReviewListeners++;
				return () => {
					activeReviewListeners--;
				};
			},
		};

		const outcome = await requestPlannotatorPlanReview({
			events,
			planContent: "# Plan",
			requestTimeoutMs: 50,
			reviewTimeoutMs: 50,
		});

		assert.deepEqual(outcome, {
			status: "unavailable",
			reason: "Plannotator request event failed: event bus unavailable",
		});
		assert.equal(activeReviewListeners, 0);
	});
});
