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
	applySuperagentWorktreeDefaultsToChain,
	getSuperagentSettings,
	resolveSuperagentWorktreeCreateOptions,
	resolveSuperagentWorktreeEnabled,
} from "../../superagents-config.ts";

describe("superagents config helpers", () => {
	/**
	 * Verifies the canonical settings accessor accepts both supported config roots.
	 *
	 * @returns Nothing; asserts canonical lookup behavior.
	 */
	it("prefers superagents and falls back to legacy superpowers", () => {
		assert.deepEqual(
			getSuperagentSettings({
				superagents: { defaultImplementerMode: "direct" },
				superpowers: { defaultImplementerMode: "tdd" },
			}),
			{ defaultImplementerMode: "direct" },
		);
		assert.deepEqual(
			getSuperagentSettings({
				superpowers: { defaultImplementerMode: "tdd" },
			}),
			{ defaultImplementerMode: "tdd" },
		);
	});

	/**
	 * Verifies Superpowers runs default worktree isolation on unless disabled.
	 *
	 * @returns Nothing; asserts the resolved effective worktree flag.
	 */
	it("defaults worktree isolation on for superpowers and respects explicit overrides", () => {
		assert.equal(resolveSuperagentWorktreeEnabled(undefined, "superpowers", {}), true);
		assert.equal(
			resolveSuperagentWorktreeEnabled(undefined, "superpowers", {
				superagents: { worktreeEnabled: false },
			}),
			false,
		);
		assert.equal(resolveSuperagentWorktreeEnabled(false, "superpowers", {}), false);
		assert.equal(resolveSuperagentWorktreeEnabled(true, "default", {}), true);
		assert.equal(resolveSuperagentWorktreeEnabled(undefined, "default", {}), undefined);
	});

	/**
	 * Verifies chain parallel steps inherit the Superpowers worktree default.
	 *
	 * @returns Nothing; asserts normalized chain step metadata.
	 */
	it("applies the superpowers worktree default only to parallel steps without an explicit value", () => {
		const normalized = applySuperagentWorktreeDefaultsToChain(
			[
				{ agent: "sp-recon", task: "Inspect repo" },
				{ parallel: [{ agent: "sp-implementer", task: "Implement A" }] },
				{ parallel: [{ agent: "sp-code-review", task: "Review B" }], worktree: false },
			],
			"superpowers",
			{},
		);

		assert.equal("agent" in normalized[0], true);
		assert.equal("parallel" in normalized[1], true);
		assert.equal((normalized[1] as { worktree?: boolean }).worktree, true);
		assert.equal((normalized[2] as { worktree?: boolean }).worktree, false);
	});

	/**
	 * Verifies worktree create options are scoped to the Superpowers workflow.
	 *
	 * @returns Nothing; asserts resolved createWorktrees options.
	 */
	it("resolves root and hook settings only for superpowers runs", () => {
		assert.deepEqual(
			resolveSuperagentWorktreeCreateOptions({
				workflow: "superpowers",
				config: {
					superagents: {
						worktreeRoot: ".worktrees",
						worktreeSetupHook: "./scripts/setup-worktree.mjs",
						worktreeSetupHookTimeoutMs: 45000,
					},
				},
				agents: ["sp-implementer", "sp-code-review"],
			}),
			{
				agents: ["sp-implementer", "sp-code-review"],
				rootDir: ".worktrees",
				requireIgnoredRoot: true,
				setupHook: {
					hookPath: "./scripts/setup-worktree.mjs",
					timeoutMs: 45000,
				},
			},
		);

		assert.deepEqual(
			resolveSuperagentWorktreeCreateOptions({
				workflow: "default",
				config: {
					superagents: {
						worktreeRoot: ".worktrees",
						worktreeSetupHook: "./scripts/setup-worktree.mjs",
						worktreeSetupHookTimeoutMs: 45000,
					},
				},
				agents: ["worker"],
			}),
			{
				agents: ["worker"],
			},
		);
	});
});
