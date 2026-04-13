/**
 * Event-only bridge for requesting plan reviews from the Plannotator extension.
 *
 * Key responsibilities:
 * - emit the shared `plannotator:request` event contract
 * - await the immediate `respond()` callback acknowledgement
 * - await the matching `plannotator:review-result` event for the returned review id
 * - translate Plannotator responses into fail-soft plan-review outcomes for callers
 *
 * Important dependencies and side effects:
 * - uses node:crypto to generate unique request ids
 * - subscribes to and unsubscribes from an external event bus
 * - uses timers for request and review-result timeouts
 */

import { randomUUID } from "node:crypto";

export const DEFAULT_PLANNOTATOR_REQUEST_TIMEOUT_MS = 5_000;
export const DEFAULT_PLANNOTATOR_REVIEW_TIMEOUT_MS = 10 * 60 * 1_000;
const DEFAULT_REJECTION_FEEDBACK = "Plan changes requested in Plannotator.";
const REQUEST_TIMEOUT_REASON = "Plannotator did not respond to plan-review request before timeout.";
const REVIEW_TIMEOUT_REASON = "Plannotator review-result did not arrive before timeout.";
const MISSING_REVIEW_ID_REASON = "Plannotator handled the request but did not provide a reviewId.";
const UNKNOWN_UNAVAILABLE_REASON = "Plannotator is unavailable for plan review.";
const REQUEST_EMIT_FAILED_PREFIX = "Plannotator request event failed";

export interface PlannotatorEventBus {
	emit(channel: string, data: unknown): void;
	on(channel: string, handler: (data: unknown) => void): () => void;
}

export type PlannotatorPlanReviewResponse =
	| { status: "handled"; result: { status: "pending"; reviewId: string } }
	| { status: "unavailable"; error?: string }
	| { status: "error"; error: string };

export interface PlannotatorPlanReviewRequest {
	requestId: string;
	action: "plan-review";
	payload: {
		planContent: string;
		planFilePath?: string;
		origin: "pi-superagents";
	};
	respond(response: PlannotatorPlanReviewResponse): void;
}

export interface PlannotatorReviewResult {
	reviewId: string;
	approved: boolean;
	feedback?: string;
	savedPath?: string;
	agentSwitch?: string;
	permissionMode?: string;
}

export type PlanReviewOutcome =
	| { status: "approved" }
	| { status: "rejected"; feedback: string }
	| { status: "unavailable"; reason: string };

export interface RequestPlannotatorPlanReviewInput {
	events: PlannotatorEventBus;
	planContent: string;
	planFilePath?: string;
	requestTimeoutMs?: number;
	reviewTimeoutMs?: number;
}

/**
 * Determines whether an unknown payload is a review result for the active review id.
 *
 * @param payload Raw event payload from the event bus.
 * @param reviewId Review identifier returned from the handled response.
 * @returns True only for matching review-result payloads with a boolean approval state.
 */
function isMatchingReviewResult(
	payload: unknown,
	reviewId: string,
): payload is PlannotatorReviewResult {
	if (!payload || typeof payload !== "object") {
		return false;
	}

	const candidate = payload as Partial<PlannotatorReviewResult>;
	return candidate.reviewId === reviewId && typeof candidate.approved === "boolean";
}

/**
 * Derive a fail-soft unavailable reason from an immediate Plannotator response.
 *
 * @param response Immediate response payload received through `respond()`.
 * @returns Human-readable unavailable reason.
 */
function getUnavailableReason(response: PlannotatorPlanReviewResponse): string {
	if (response.status === "unavailable") {
		return response.error?.trim() || UNKNOWN_UNAVAILABLE_REASON;
	}
	if (response.status === "error") {
		return response.error;
	}
	return UNKNOWN_UNAVAILABLE_REASON;
}

/**
 * Formats synchronous event-bus emission failures as fail-soft bridge output.
 *
 * @param error Error thrown while emitting the plan-review request event.
 * @returns Human-readable unavailable reason for the caller.
 */
function getRequestEmitFailureReason(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return `${REQUEST_EMIT_FAILED_PREFIX}: ${message}`;
}

/**
 * Requests a plan review from Plannotator and resolves a fail-soft review outcome.
 *
 * @param input Event bus plus plan payload and optional timeout overrides.
 * @returns Approved, rejected-with-feedback, or unavailable fallback outcome.
 *
 * Failure modes:
 * - returns `unavailable` when Plannotator reports unavailable, reports error,
 *   omits a review id, or times out during request/review waiting
 */
export async function requestPlannotatorPlanReview(
	input: RequestPlannotatorPlanReviewInput,
): Promise<PlanReviewOutcome> {
	const requestId = `plannotator-review-${randomUUID()}`;
	const requestTimeoutMs = input.requestTimeoutMs ?? DEFAULT_PLANNOTATOR_REQUEST_TIMEOUT_MS;
	const reviewTimeoutMs = input.reviewTimeoutMs ?? DEFAULT_PLANNOTATOR_REVIEW_TIMEOUT_MS;

	return await new Promise<PlanReviewOutcome>((resolve) => {
		let settled = false;
		let activeReviewId: string | null = null;
		let requestTimer: NodeJS.Timeout | undefined;
		let reviewTimer: NodeJS.Timeout | undefined;
		const unsubscribeReview = input.events.on("plannotator:review-result", (payload) => {
			if (!activeReviewId || !isMatchingReviewResult(payload, activeReviewId)) {
				return;
			}

			if (payload.approved) {
				finish({ status: "approved" });
				return;
			}

			finish({
				status: "rejected",
				feedback: payload.feedback?.trim() || DEFAULT_REJECTION_FEEDBACK,
			});
		});

		/**
		 * Resolve the request exactly once and dispose timers/listeners.
		 *
		 * @param outcome Final bridge outcome for the caller.
		 */
		function finish(outcome: PlanReviewOutcome): void {
			if (settled) {
				return;
			}
			settled = true;
			if (requestTimer) {
				clearTimeout(requestTimer);
			}
			if (reviewTimer) {
				clearTimeout(reviewTimer);
			}
			unsubscribeReview();
			resolve(outcome);
		}

		requestTimer = setTimeout(() => {
			finish({ status: "unavailable", reason: REQUEST_TIMEOUT_REASON });
		}, requestTimeoutMs);

		const request: PlannotatorPlanReviewRequest = {
			requestId,
			action: "plan-review",
			payload: {
				planContent: input.planContent,
				...(input.planFilePath ? { planFilePath: input.planFilePath } : {}),
				origin: "pi-superagents",
			},
			respond(response) {
				if (settled) {
					return;
				}
				if (requestTimer) {
					clearTimeout(requestTimer);
					requestTimer = undefined;
				}
				if (response.status !== "handled") {
					finish({ status: "unavailable", reason: getUnavailableReason(response) });
					return;
				}

				const reviewId = (response.result as Partial<{ reviewId: string }> | undefined)?.reviewId;
				if (!reviewId) {
					finish({ status: "unavailable", reason: MISSING_REVIEW_ID_REASON });
					return;
				}

				activeReviewId = reviewId;
				reviewTimer = setTimeout(() => {
					finish({ status: "unavailable", reason: REVIEW_TIMEOUT_REASON });
				}, reviewTimeoutMs);
			},
		};

		try {
			input.events.emit("plannotator:request", request);
		} catch (error) {
			finish({ status: "unavailable", reason: getRequestEmitFailureReason(error) });
		}
	});
}
