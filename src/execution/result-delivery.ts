/**
 * Result ownership store for subagent child runs.
 *
 * Responsibilities:
 * - register running child completion promises
 * - implement wait, join, and detach ownership semantics
 * - enforce delivered-once result retrieval
 * - derive thin completion envelopes without constraining child answer bodies
 *
 * Important dependencies and side effects:
 * - no child processes are spawned here; tests should use controlled promises
 * - state is in-memory and scoped to the current executor call/runtime instance
 */

import type {
	ChildRunResult,
	CompletedDelivery,
	DeliveryState,
	ResultDeliveryError,
	SubagentCompletionEnvelope,
} from "../shared/types.ts";
import { getSingleResultOutput } from "../shared/utils.ts";

export interface RegisterChildInput {
	id: string;
	agent: string;
	task: string;
	completion: Promise<ChildRunResult>;
}

export interface WaitOptions {
	/**
	 * Maximum time to wait for a child result in milliseconds.
	 * If the timeout fires before the completion resolves, ownership is
	 * released and a `timeout` error is returned to the waiter/joiner.
	 * If omitted, the waiter waits indefinitely unless detached.
	 */
	timeoutMs?: number;
}

type WaitResult = { result: ChildRunResult } | { error: ResultDeliveryError };
type JoinResult = { results: ChildRunResult[] } | { error: ResultDeliveryError };
type DetachResult = { ok: true } | { error: ResultDeliveryError };

/**
 * Internal record tracking one registered child run's delivery state.
 */
interface DeliveryRecord extends RegisterChildInput {
	state: DeliveryState;
	completed?: ChildRunResult;
	deliveredTo?: CompletedDelivery;
	ownerToken?: symbol;
	/**
	 * Generation counter for per-record abort signaling. Incremented whenever
	 * detach is called on this record. The in-flight collectResult stores
	 * a snapshot of the generation when it starts; it only acts on detach
	 * if the generation still matches, preventing cross-record abort
	 * interference (e.g. b's detach aborting a's already-completed resolution).
	 */
	ownerGeneration: number;
	/**
	 * Deferred resolve/reject for the in-flight collectResult operation on this
	 * record. Stored so that detach() can cancel the pending wait/join promptly
	 * without waiting for child completion to settle.
	 */
	pendingResult?: {
		resolve: (value: ChildRunResult) => void;
		reject: (error: unknown) => void;
	};
}

/**
 * Build a stable delivery error object.
 *
 * @param code Machine-readable error code.
 * @param message Human-readable diagnostic.
 * @param ids Related child ids.
 * @returns Delivery error payload.
 */
function deliveryError(code: ResultDeliveryError["code"], message: string, ids?: string[]): ResultDeliveryError {
	return { code, message, ...(ids ? { ids } : {}) };
}

/**
 * Derive a thin completion envelope from raw child output and lifecycle metadata.
 *
 * @param result Child run result.
 * @returns Completion envelope preserving flexible output in `body`.
 */
export function deriveCompletionEnvelope(result: ChildRunResult): SubagentCompletionEnvelope {
	const body = getSingleResultOutput(result);
	const lifecycleSignal = result.lifecycle?.status === "consumed" ? result.lifecycle.signal : undefined;
	if (lifecycleSignal?.type === "ping") {
		return {
			status: "needs_parent",
			summary: lifecycleSignal.message,
			body,
			parentRequest: lifecycleSignal.message,
			artifacts: result.artifactPaths ? Object.values(result.artifactPaths) : undefined,
		};
	}
	const status = result.exitCode === 0 ? "completed" : result.exitCode < 0 ? "cancelled" : "failed";
	const summary =
		body.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ??
		(status === "completed" ? "Subagent completed." : result.error ?? "Subagent failed.");
	return {
		status,
		summary: summary.slice(0, 240),
		body,
		artifacts: result.artifactPaths ? Object.values(result.artifactPaths) : undefined,
		...(result.error ? { notes: { error: result.error } } : {}),
	};
}

/**
 * Attach a completion envelope to a result when one is not already present.
 *
 * @param result Raw child result.
 * @returns Child result with completion envelope.
 */
function withEnvelope(result: ChildRunResult): ChildRunResult {
	return result.completion ? result : { ...result, completion: deriveCompletionEnvelope(result) };
}

/**
 * Release ownership for every record in the map that is currently owned by
 * the given `ownerToken`. Used to clean up all records associated with a
 * failed join or detached waiter so they can be re-waited.
 *
 * @param records The store's internal map.
 * @param ownerToken The token whose ownership should be released.
 */
function releaseOwnedRecords(records: Map<string, DeliveryRecord>, ownerToken: symbol): void {
	for (const record of records.values()) {
		if (record.ownerToken === ownerToken && !record.deliveredTo) {
			record.state = "detached";
			delete record.ownerToken;
		}
	}
}

/**
 * Deliver a result to a record atomically: set completed + deliveredTo, and
 * clear the owner token.
 *
 * @param record The record to deliver.
 * @param raw The raw (pre-envelope) child result.
 * @param deliveredTo The delivery type (wait/join).
 */
function deliverRecord(record: DeliveryRecord, raw: ChildRunResult, deliveredTo: CompletedDelivery): ChildRunResult {
	const completed = withEnvelope(raw);
	record.completed = completed;
	record.deliveredTo = deliveredTo;
	delete record.ownerToken;
	return completed;
}

/**
 * Convert a rejected child-completion promise reason into a synthetic failure
 * ChildRunResult. Handles plain Error rejections and any thrown non-Error values.
 *
 * @param record The delivery record whose child failed.
 * @param reason The rejection value (typically an Error).
 * @returns A failure ChildRunResult wrapping the error information.
 */
function rejectionAsFailure(record: DeliveryRecord, reason: unknown): ChildRunResult {
	return {
		agent: record.agent,
		task: record.task,
		exitCode: 1,
		messages: [],
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
		error: reason instanceof Error ? reason.message : String(reason),
	};
}

/**
 * Create an in-memory result delivery store.
 *
 * @returns Store operations for register, wait, join, detach, and inspect.
 */
export function createResultDeliveryStore(): {
	register(input: RegisterChildInput): void;
	wait(id: string, options?: WaitOptions): Promise<WaitResult>;
	join(ids: string[], options?: WaitOptions): Promise<JoinResult>;
	detach(id: string): DetachResult;
	inspect(id: string): Readonly<Omit<DeliveryRecord, "pendingResult">> | undefined;
} {
	const records = new Map<string, DeliveryRecord>();

	function getRecord(id: string): DeliveryRecord | undefined {
		return records.get(id);
	}

	function recordNotFound(id: string): ResultDeliveryError {
		return deliveryError("not_found", `No child result found for ${id}.`, [id]);
	}

	/**
	 * Collect a raw (pre-envelope) result from a record's completion, handling
	 * timeouts and rejected completions. Does NOT mark the record as delivered.
	 *
	 * @param record The delivery record whose completion to await.
	 * @param ownerToken The token the caller holds (used to detect detach).
	 * @param ownerGeneration Generation snapshot at call time; when detach
	 *   increments the generation, this snapshot will mismatch and detach will
	 *   reject the pendingResult promptly.
	 * @param options Wait options including optional timeout.
	 * @returns The raw child run result.
	 */
	async function collectResult(
		record: DeliveryRecord,
		ownerToken: symbol,
		ownerGeneration: number,
		options: WaitOptions = {},
	): Promise<ChildRunResult> {
		// Check ownership before starting to await.
		if (record.ownerToken !== ownerToken) {
			throw Object.assign(new Error("not_owned"), { code: "not_owned", id: record.id });
		}

		if (record.completed) {
			return record.completed;
		}

		if (options.timeoutMs !== undefined) {
			// Race child completion against both timeout and explicit detach.
			// The pendingResult handle lets detach() reject promptly without
			// waiting for the timeout to fire, while the settled guard clears the
			// timer and prevents late child completion from resolving twice.
			return await new Promise<ChildRunResult>((resolve, reject) => {
				let settled = false;
				const settle = (outcome: "completion" | "timeout" | "abort", value?: ChildRunResult | unknown): void => {
					if (settled) return;
					settled = true;
					clearTimeout(timer);
					delete record.pendingResult;
					if (outcome === "completion") {
						resolve(value as ChildRunResult);
						return;
					}
					if (outcome === "timeout" && record.ownerToken === ownerToken && !record.deliveredTo) {
						record.state = "detached";
						delete record.ownerToken;
					}
					reject(value);
				};
				const timer = setTimeout(
					() => settle("timeout", Object.assign(new Error("timeout"), { code: "timeout" })),
					options.timeoutMs,
				);
				record.pendingResult = {
					resolve: (value) => settle("completion", value),
					reject: (error) => settle("abort", error),
				};
				record.completion.then(
					(value) => settle("completion", value),
					(reason) => settle("completion", rejectionAsFailure(record, reason)),
				);
			});
		}

		// No timeout: race completion against detach.
		// Set up pendingResult synchronously so detach() can reject promptly
		// even if the completion is already resolved.
		let pendingResolve: (value: ChildRunResult) => void;
		let pendingReject: (error: unknown) => void;
		const resultPromise = new Promise<ChildRunResult>((resolve, reject) => {
			pendingResolve = resolve;
			pendingReject = reject;
			record.pendingResult = { resolve, reject };
		});

		// Use a settled flag so that completion.resolve and abort.reject
		// don't both try to settle the promise.
		let settled = false;
		const settle = (outcome: "abort" | "completion", value: ChildRunResult | unknown) => {
			if (settled) return;
			settled = true;
			// Always clear pendingResult when settling (success or abort).
			delete record.pendingResult;
			if (outcome === "abort") {
				pendingReject(Object.assign(new Error("not_owned"), { code: "not_owned", id: record.id }));
			} else {
				pendingResolve(value as ChildRunResult);
			}
		};

		// Check generation mismatch now (immediate detach before any microtask).
		// If detach() was called before this collectResult, ownerGeneration will
		// have been incremented and will mismatch our snapshot.
		if (record.ownerGeneration !== ownerGeneration) {
			settle("abort", undefined);
			return resultPromise;
		}

		// Use .then(onFulfilled, onRejected) so rejected completions are
		// converted to failure results rather than letting the Error propagate.
		record.completion.then(
			(value) => settle("completion", value),
			(reason) => settle("completion", rejectionAsFailure(record, reason)),
		);

		return resultPromise;
	}

	return {
		/**
		 * Register a child run for later result delivery.
		 *
		 * @param input Child identifier, metadata, and completion promise.
		 * @throws Error when the child id has already been registered.
		 */
		register(input: RegisterChildInput): void {
			if (records.has(input.id)) throw new Error(`Duplicate child id: ${input.id}`);
			records.set(input.id, { ...input, state: "detached", ownerGeneration: 0 });
		},

		/**
		 * Claim and await a single child result.
		 *
		 * @param id Child identifier to wait for.
		 * @param options Optional timeout configuration.
		 * @returns Delivered result, or `not_found`, `already_delivered`,
		 * `already_owned`, `timeout`, or `not_owned` delivery error.
		 */
		async wait(id: string, options: WaitOptions = {}): Promise<WaitResult> {
			const record = getRecord(id);
			if (!record) return { error: recordNotFound(id) };
			if (record.deliveredTo) return { error: deliveryError("already_delivered", `Result for ${id} has already been delivered.`, [id]) };
			if (record.state !== "detached") return { error: deliveryError("already_owned", `Result for ${id} is already owned by ${record.state}.`, [id]) };
			const ownerToken = Symbol(`wait:${id}`);
			record.state = "awaited";
			record.ownerToken = ownerToken;
			const ownerGeneration = record.ownerGeneration;
			try {
				const raw = await collectResult(record, ownerToken, ownerGeneration, options);
				if (record.ownerToken !== ownerToken) {
					return { error: deliveryError("not_owned", `Result for ${id} is no longer owned by this waiter.`, [id]) };
				}
				const result = deliverRecord(record, raw, "wait");
				return { result };
			} catch (error) {
				const err = error as { code?: string };
				if (err.code === "timeout") return { error: deliveryError("timeout", `Timed out waiting for ${id}.`, [id]) };
				if (err.code === "not_owned") return { error: deliveryError("not_owned", `Result for ${id} is no longer owned by this waiter.`, [id]) };
				throw error;
			}
		},

		/**
		 * Atomically claim and await multiple child results in requested order.
		 *
		 * @param ids Child identifiers to join; must be non-empty and unique.
		 * @param options Optional per-child timeout configuration.
		 * @returns Ordered results if every child resolves, or a delivery error
		 * without consuming partially collected results.
		 */
		async join(ids: string[], options: WaitOptions = {}): Promise<JoinResult> {
			if (ids.length === 0) return { error: deliveryError("empty_id_list", "Join requires at least one child id.") };
			if (new Set(ids).size !== ids.length) return { error: deliveryError("duplicate_id", "Join child id list contains duplicates.", ids) };
			const recordsToJoin: DeliveryRecord[] = [];
			for (const id of ids) {
				const record = getRecord(id);
				if (!record) return { error: recordNotFound(id) };
				if (record.deliveredTo) return { error: deliveryError("already_delivered", `Result for ${id} has already been delivered.`, [id]) };
				if (record.state !== "detached") return { error: deliveryError("already_owned", `Result for ${id} is already owned by ${record.state}.`, [id]) };
				recordsToJoin.push(record);
			}
			const ownerToken = Symbol(`join:${ids.join(",")}`);
			for (const record of recordsToJoin) {
				record.state = "joined";
				record.ownerToken = ownerToken;
			}

			// Phase 1: collect all raw results without marking any record as delivered.
			// This preserves atomicity: if any record fails (timeout/detach/error),
			// none of the records are marked as delivered yet, so later waits can
			// claim and deliver them individually.
			const rawResults: ChildRunResult[] = [];
			for (const record of recordsToJoin) {
				try {
					const raw = await collectResult(record, ownerToken, record.ownerGeneration, options);
					rawResults.push(raw);
				} catch (error) {
					const err = error as { code?: string };
					// On any error, release all still-owned records (none are delivered yet)
					// so subsequent waits can claim and deliver them.
					releaseOwnedRecords(records, ownerToken);
					if (err.code === "timeout") return { error: deliveryError("timeout", `Timed out waiting for ${record.id}.`, [record.id]) };
					if (err.code === "not_owned") return { error: deliveryError("not_owned", `Result for ${record.id} is no longer owned.`, [record.id]) };
					throw error;
				}
			}

			// Phase 2: all records succeeded and are still owned by this join.
			// Verify ownership one final time before any delivery so a mid-join
			// detach cannot cause partially collected results to be consumed.
			const detachedRecord = recordsToJoin.find((record) => record.ownerToken !== ownerToken);
			if (detachedRecord) {
				releaseOwnedRecords(records, ownerToken);
				return { error: deliveryError("not_owned", `Result for ${detachedRecord.id} is no longer owned.`, [detachedRecord.id]) };
			}

			const results: ChildRunResult[] = [];
			for (let i = 0; i < recordsToJoin.length; i++) {
				results.push(deliverRecord(recordsToJoin[i], rawResults[i], "join"));
			}
			return { results };
		},

		/**
		 * Release ownership of a pending wait or join for a child result.
		 *
		 * @param id Child identifier whose owner should be detached.
		 * @returns `{ ok: true }` when ownership was released, or `not_found`
		 * / `not_owned` when no detachable owner exists.
		 */
		detach(id: string): DetachResult {
			const record = getRecord(id);
			if (!record) return { error: recordNotFound(id) };
			if (record.deliveredTo || record.state === "detached") return { error: deliveryError("not_owned", `Result for ${id} is not owned.`, [id]) };
			record.state = "detached";
			delete record.ownerToken;
			// Increment generation so in-flight collectResult calls for this record
			// will see the mismatch and reject their pendingResult promptly.
			record.ownerGeneration++;
			// Reject pendingResult synchronously so the join/wait gets not_owned promptly.
			if (record.pendingResult) {
				record.pendingResult.reject(Object.assign(new Error("not_owned"), { code: "not_owned", id: record.id }));
				delete record.pendingResult;
			}
			return { ok: true };
		},

		/**
		 * Return a read-only snapshot of the delivery record for the given id.
		 *
		 * Internal pending delivery controllers are omitted so callers cannot
		 * mutate or settle in-flight wait/join operations through inspection.
		 *
		 * @param id Child identifier.
		 * @returns A frozen copy of public record state, or undefined if not found.
		 */
		inspect(id: string): Readonly<Omit<DeliveryRecord, "pendingResult">> | undefined {
			const record = records.get(id);
			if (!record) return undefined;
			const { pendingResult: _pendingResult, ...snapshot } = record;
			return Object.freeze(snapshot);
		},
	};
}
