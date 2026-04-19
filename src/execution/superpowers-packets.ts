/**
 * Superpowers packet conventions for command-scoped role execution.
 *
 * Responsibilities:
 * - map built-in Superpowers roles to their canonical read packet filenames
 * - provide a single source of truth for packet read/progress defaults
 * - avoid fallback to legacy context/plan/progress conventions in the command path
 */

import type { ExecutionRole } from "../shared/types.ts";
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
 * - unknown or non-packet roles fall back to no reads and no output
 *
 * Failure modes:
 * - none; unsupported roles intentionally return an inert default
 */
export function buildSuperpowersPacketPlan(role: ExecutionRole): SuperpowersPacketPlan {
	switch (role) {
		case "sp-implementer":
			return {
				reads: ["task-brief.md"],
				output: false,
				progress: false,
			};
		case "sp-spec-review":
			return {
				reads: ["task-brief.md", "implementer-report.md"],
				output: false,
				progress: false,
			};
		case "sp-code-review":
			return {
				reads: ["task-brief.md", "spec-review.md"],
				output: false,
				progress: false,
			};
		case "sp-debug":
			return {
				reads: ["debug-brief.md"],
				output: false,
				progress: false,
			};
		default:
			return {
				reads: [],
				output: false,
				progress: false,
			};
	}
}
