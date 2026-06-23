/**
 * Superpowers packet conventions for command-scoped role execution.
 *
 * Responsibilities:
 * - provide a single source of truth for packet read/progress defaults
 * - keep built-in role packet defaults inert (the runtime packet file is the brief; findings return inline)
 * - avoid fallback to legacy handoff-file conventions in the command path
 */

import type { ExecutionRole, SessionMode } from "../shared/types.ts";
import type { ResolvedStepBehavior } from "./settings.ts";

export interface SuperpowersPacketPlan {
	reads: string[];
	output: string | false;
	progress: false;
}

/**
 * Injects Superpowers packet read instructions into a task string.
 *
 * @param task Original task text for a delegated Superpowers role.
 * @param behavior Resolved role behavior containing optional read packet names.
 * @returns Task text with read instructions appended when packet reads exist.
 */
export function injectSuperpowersPacketInstructions(task: string, behavior: ResolvedStepBehavior): string {
	let instructedTask = task;
	if (behavior.reads && behavior.reads.length > 0) {
		instructedTask += `\n\n[Read from: ${behavior.reads.join(", ")}]`;
	}
	return instructedTask;
}

/**
 * Resolves the canonical packet plan for a Superpowers execution role.
 *
 * Inputs/outputs:
 * - accepts any execution role, including non-packet-producing roles
 * - returns immutable packet defaults for reads and progress behavior
 *
 * Invariants:
 * - Superpowers packet defaults never enable progress tracking
 * - all built-in roles return inert defaults (no reads, no output)
 * - the runtime packet file is the input brief; findings return inline through Pi tool results
 * - legacy handoff filenames (task-brief.md, debug-brief.md, implementer-report.md,
 *   spec-review.md) are never written by the runtime, so no `[Read from:]` references are
 *   injected by built-in defaults. The `reads` channel stays available for explicit step
 *   overrides supplied by callers, but built-in roles no longer populate it.
 *
 * Failure modes:
 * - none; all roles intentionally return an inert default
 */
export function buildSuperpowersPacketPlan(role: ExecutionRole): SuperpowersPacketPlan {
	// All built-in Superpowers roles receive their input brief as the runtime-authored
	// packet file (see execution-planner.ts) and return findings inline through Pi tool
	// results. Legacy handoff filenames were a pre-inline convention and are no longer
	// authored, so referencing them would point subagents at files that never exist.
	void role;
	return {
		reads: [],
		output: false,
		progress: false,
	};
}

export function buildSuperpowersPacketContent(input: { agent: string; sessionMode: SessionMode; task: string; useTestDrivenDevelopment: boolean }): string {
	const modeLine = input.agent === "sp-implementer" ? `Implementer Mode: ${input.useTestDrivenDevelopment ? "tdd" : "direct"}` : null;

	return [
		"# Superpowers Work Packet",
		"",
		`Agent: ${input.agent}`,
		`Session Mode: ${input.sessionMode}`,
		"Use only the information in this packet. Do not rely on parent-session history that is not included here.",
		modeLine,
		"",
		input.task.trim(),
	]
		.filter((line): line is string => Boolean(line))
		.join("\n");
}
