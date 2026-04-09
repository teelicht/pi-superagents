/**
 * Integration coverage for Superpowers packet defaults.
 *
 * Responsibilities:
 * - verify the command-scoped packet names used by Superpowers roles
 * - guard against fallback to legacy context/plan/progress conventions
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveStepBehavior } from "../../settings.ts";
import { buildSuperpowersPacketPlan } from "../../superpowers-packets.ts";

describe("superpowers packets", () => {
	/**
	 * Verifies the implementer role uses Superpowers packet names instead of legacy defaults.
	 *
	 * Inputs/outputs:
	 * - no runtime inputs beyond the built-in role name
	 * - expects the packet plan for `sp-implementer`
	 *
	 * Invariants:
	 * - the plan must read `task-brief.md`
	 * - the plan must write `implementer-report.md`
	 * - progress tracking must stay disabled
	 */
	it("uses task and review packet names instead of context.md/plan.md/progress.md", () => {
		const packets = buildSuperpowersPacketPlan("sp-implementer");
		assert.deepEqual(packets.reads, ["task-brief.md"]);
		assert.equal(packets.output, "implementer-report.md");
		assert.equal(packets.progress, false);
	});

	/**
	 * Verifies the built-in review and debug roles receive their canonical packet defaults.
	 *
	 * Inputs/outputs:
	 * - resolves packet plans for the remaining Task 3 roles plus a default case
	 * - expects exact packet filenames from the implementation plan
	 *
	 * Invariants:
	 * - all packet defaults keep progress disabled
	 * - unknown roles must not read or write any packet files
	 */
	it("maps review, debug, and default roles to the expected packet defaults", () => {
		assert.deepEqual(buildSuperpowersPacketPlan("sp-spec-review"), {
			reads: ["task-brief.md", "implementer-report.md"],
			output: "spec-review.md",
			progress: false,
		});
		assert.deepEqual(buildSuperpowersPacketPlan("sp-code-review"), {
			reads: ["task-brief.md", "spec-review.md"],
			output: "code-review.md",
			progress: false,
		});
		assert.deepEqual(buildSuperpowersPacketPlan("sp-debug"), {
			reads: ["debug-brief.md"],
			output: "debug-brief.md",
			progress: false,
		});
		assert.deepEqual(buildSuperpowersPacketPlan("sp-recon"), {
			reads: [],
			output: false,
			progress: false,
		});
	});

	/**
	 * Verifies packet defaults sit between explicit step overrides and agent frontmatter defaults.
	 *
	 * Inputs/outputs:
	 * - resolves behavior with step overrides, packet defaults, and agent defaults present
	 * - expects explicit overrides to win, packet defaults to backfill missing values, and agent defaults to remain the fallback
	 *
	 * Invariants:
	 * - explicit step settings must always win
	 * - packet defaults must not erase unspecified agent defaults outside their fields
	 */
	it("prefers explicit step overrides, then packet defaults, then agent defaults", () => {
		const behavior = resolveStepBehavior(
			{
				name: "sp-implementer",
				description: "Implementer",
				systemPrompt: "Implement one task.",
				source: "builtin",
				filePath: "/tmp/sp-implementer.md",
				output: "legacy-report.md",
				defaultReads: ["context.md"],
				defaultProgress: true,
			},
			{
				output: "step-output.md",
			},
			undefined,
			{
				reads: ["task-brief.md"],
				output: "implementer-report.md",
				progress: false,
			},
		);

		assert.equal(behavior.output, "step-output.md");
		assert.deepEqual(behavior.reads, ["task-brief.md"]);
		assert.equal(behavior.progress, false);
	});
});
