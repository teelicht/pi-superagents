/**
 * Executor validation and session-mode result decoration helpers.
 *
 * Responsibilities:
 * - validate mutually exclusive single and parallel execution inputs
 * - convert execution exceptions into structured tool results
 * - annotate aggregate and child results with explicit session-mode metadata
 *
 * Important dependencies:
 * - session-mode resolution for effective session metadata
 * - shared result contracts used by the TUI renderers and executor
 */

import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { AgentConfig } from "../agents/agents.ts";
import type { Details, SessionMode, SingleResult, SubagentParamsLike } from "../shared/types.ts";
import { resolveRequestedSessionMode } from "./session-mode.ts";

/**
 * Resolve the effective session mode for one child agent launch.
 *
 * @param params Tool or slash-command request parameters.
 * @param agentConfig Target agent configuration for the child.
 * @returns Effective session mode after applying caller precedence rules.
 */
export function resolveAgentSessionMode(params: SubagentParamsLike, agentConfig: AgentConfig): SessionMode {
	return resolveRequestedSessionMode({
		sessionMode: params.sessionMode,
		agentSessionMode: agentConfig.sessionMode,
		defaultSessionMode: "standalone",
	});
}

/**
 * Derive the executor-level fork badge mode for the aggregate result.
 *
 * @param sessionModes Effective session modes for the children participating in this run.
 * @returns `fork` only when every child inherited the parent session branch.
 */
export function resolveDetailsSessionMode(sessionModes: SessionMode[]): SessionMode {
	return sessionModes.length > 0 && sessionModes.every((mode) => mode === sessionModes[0]) ? sessionModes[0] : "standalone";
}

/**
 * Attach the effective session mode to one child result.
 *
 * @param result Child execution result from the lower-level runner.
 * @param sessionMode Effective session mode used for that child.
 * @returns Result annotated with explicit session-mode metadata.
 */
export function withSingleResultSessionMode(result: SingleResult, sessionMode: SessionMode): SingleResult {
	return { ...result, sessionMode };
}

/**
 * Attach explicit session-mode metadata to a tool result.
 *
 * @param result Tool result emitted by the executor.
 * @param sessionMode Effective session mode for the overall response.
 * @returns Tool result with explicit session-mode details.
 */
export function withSessionModeDetails(result: AgentToolResult<Details>, sessionMode: SessionMode): AgentToolResult<Details> {
	if (!result.details) return result;
	return {
		...result,
		details: { ...result.details, sessionMode },
	};
}

/**
 * Attach session-mode metadata to child results emitted during progress updates.
 *
 * @param result Progress update from the lower-level runner.
 * @param sessionMode Effective session mode for the child result(s).
 * @returns Progress update with annotated child results.
 */
export function withProgressResultSessionMode(result: AgentToolResult<Details>, sessionMode: SessionMode): AgentToolResult<Details> {
	if (!result.details?.results) return result;
	return {
		...result,
		details: {
			...result.details,
			results: result.details.results.map((childResult) => withSingleResultSessionMode(childResult, sessionMode)),
		},
	};
}

/**
 * Validate whether a request chose exactly one execution mode.
 *
 * @param params Raw execution parameters from the caller.
 * @param agents Discovered agents used to build the user-facing error hint.
 * @param hasTasks Whether the request includes a non-empty parallel task list.
 * @param hasSingle Whether the request includes both single-agent fields.
 * @returns A structured error result when invalid, otherwise `null`.
 */
export function validateExecutionInput(params: SubagentParamsLike, agents: AgentConfig[], hasTasks: boolean, hasSingle: boolean): AgentToolResult<Details> | null {
	if (Number(hasTasks) + Number(hasSingle) !== 1) {
		return withSessionModeDetails(
			{
				content: [
					{
						type: "text",
						text: `Provide exactly one mode. Agents: ${agents.map((a) => a.name).join(", ") || "none"}`,
					},
				],
				details: { mode: "single" as const, results: [] },
			},
			resolveRequestedSessionMode({
				sessionMode: params.sessionMode,
				defaultSessionMode: "standalone",
			}),
		);
	}

	return null;
}

/**
 * Infer the requested execution mode label for error details.
 *
 * @param params Raw execution parameters from the caller.
 * @returns `parallel` when tasks were provided, otherwise `single`.
 */
export function getRequestedModeLabel(params: SubagentParamsLike): Details["mode"] {
	if ((params.tasks?.length ?? 0) > 0) return "parallel";
	if (params.agent && params.task) return "single";
	return "single";
}

/**
 * Convert an execution exception into a structured tool result.
 *
 * @param params Raw execution parameters from the caller.
 * @param error Unknown thrown value from execution setup or child launch.
 * @returns Tool result preserving the requested mode and effective session mode.
 */
export function toExecutionErrorResult(params: SubagentParamsLike, error: unknown): AgentToolResult<Details> {
	const message = error instanceof Error ? error.message : String(error);
	return withSessionModeDetails(
		{
			content: [{ type: "text", text: message }],
			details: { mode: getRequestedModeLabel(params), results: [] },
		},
		resolveRequestedSessionMode({
			sessionMode: params.sessionMode,
			defaultSessionMode: "standalone",
		}),
	);
}

/**
 * Build a structured parallel-mode validation error.
 *
 * @param message User-facing validation failure.
 * @returns Parallel tool result with no child results.
 */
export function buildParallelModeError(message: string): AgentToolResult<Details> {
	return {
		content: [{ type: "text", text: message }],
		details: { mode: "parallel" as const, results: [] },
	};
}
