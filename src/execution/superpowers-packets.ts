/**
 * Superpowers packet conventions for command-scoped role execution.
 *
 * Responsibilities:
 * - map built-in Superpowers roles to their canonical packet filenames
 * - provide a single source of truth for packet read/write/progress defaults
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
 * Injects Superpowers packet instructions into a task string.
 */
export function injectSuperpowersPacketInstructions(task: string, behavior: ResolvedStepBehavior): string {
	let instructedTask = task;
	if (behavior.reads && behavior.reads.length > 0) {
		instructedTask += `\n\n[Read from: ${behavior.reads.join(", ")}]`;
	}
	if (behavior.output) {
		instructedTask += `\n\n[Write to: ${behavior.output}]`;
	}
	return instructedTask;
}

/**
 * Resolves the canonical packet plan for a Superpowers execution role.
 *
 * Inputs/outputs:
 * - accepts any execution role, including non-packet-producing roles
 * - returns immutable packet defaults for reads, output, and progress behavior
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
				output: "implementer-report.md",
				progress: false,
			};
		case "sp-spec-review":
			return {
				reads: ["task-brief.md", "implementer-report.md"],
				output: "spec-review.md",
				progress: false,
			};
		case "sp-code-review":
			return {
				reads: ["task-brief.md", "spec-review.md"],
				output: "code-review.md",
				progress: false,
			};
		case "sp-debug":
			return {
				reads: ["debug-brief.md"],
				output: "debug-brief.md",
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
