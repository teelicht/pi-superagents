/**
 * Unit coverage for Superagents configuration helpers.
 *
 * Responsibilities:
 * - resolve the canonical Superagents settings root
 * - apply Superpowers-specific worktree defaults consistently
 * - scope worktree setup options to the Superpowers workflow
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	getSuperagentSettings,
	resolveSuperagentWorktreeCreateOptions,
	resolveSuperagentWorktreeEnabled,
} from "../../src/execution/superagents-config.ts";

void describe("superagents config helpers", () => {
	/**
	 * Verifies the canonical settings accessor returns the configured Superagents settings.
	 *
	 * @returns Nothing; asserts canonical lookup behavior.
	 */
	void it("returns only the configured superagents settings", () => {
		assert.deepEqual(
			getSuperagentSettings({
				superagents: { commands: { "sp-implement": { entrySkill: "using-superpowers" } } },
			}),
			{ commands: { "sp-implement": { entrySkill: "using-superpowers" } } },
		);
		assert.equal(getSuperagentSettings({}), undefined);
		assert.equal(
			getSuperagentSettings({
				superpowers: { defaultImplementerMode: "tdd" },
			} as unknown as Parameters<typeof getSuperagentSettings>[0]),
			undefined,
		);
	});

	/**
	 * Verifies Superpowers runs default worktree isolation on unless disabled in sp-implement command.
	 *
	 * @returns Nothing; asserts the resolved effective worktree flag.
	 */
	void it("defaults worktree isolation on for superpowers and respects sp-implement config", () => {
		assert.equal(resolveSuperagentWorktreeEnabled(undefined, "superpowers", {}), true);
		assert.equal(
			resolveSuperagentWorktreeEnabled(undefined, "superpowers", {
				superagents: { commands: { "sp-implement": { worktrees: { enabled: false } } } },
			}),
			false,
		);
		assert.equal(
			resolveSuperagentWorktreeEnabled(true, "superpowers", {
				superagents: { commands: { "sp-implement": { worktrees: { enabled: false } } } },
			}),
			false,
		);
		assert.equal(resolveSuperagentWorktreeEnabled(false, "superpowers", {}), false);
		assert.equal(resolveSuperagentWorktreeEnabled(true, "superpowers", {}), true);
	});

	/**
	 * Verifies worktree create options are scoped to the Superpowers workflow.
	 *
	 * @returns Nothing; asserts resolved createWorktrees options.
	 */
	void it("resolves root and hook settings only for superpowers runs from sp-implement command", () => {
		assert.deepEqual(
			resolveSuperagentWorktreeCreateOptions({
				workflow: "superpowers",
				config: {
					superagents: {
						commands: {
							"sp-implement": {
								worktrees: { root: ".worktrees" },
							},
						},
					},
				},
				agents: ["sp-implementer", "sp-code-review"],
			}),
			{
				agents: ["sp-implementer", "sp-code-review"],
				rootDir: ".worktrees",
				requireIgnoredRoot: true,
			},
		);
	});
});
