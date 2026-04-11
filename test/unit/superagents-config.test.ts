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

describe("superagents config helpers", () => {
	/**
	 * Verifies the canonical settings accessor returns the configured Superagents settings.
	 *
	 * @returns Nothing; asserts canonical lookup behavior.
	 */
	it("returns only the configured superagents settings", () => {
		assert.deepEqual(
			getSuperagentSettings({
				superagents: { defaultImplementerMode: "direct" },
			}),
			{ defaultImplementerMode: "direct" },
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
	 * Verifies Superpowers runs default worktree isolation on unless disabled.
	 *
	 * @returns Nothing; asserts the resolved effective worktree flag.
	 */
	it("defaults worktree isolation on for superpowers and respects explicit overrides", () => {
		assert.equal(resolveSuperagentWorktreeEnabled(undefined, "superpowers", {}), true);
		assert.equal(
			resolveSuperagentWorktreeEnabled(undefined, "superpowers", {
				superagents: { worktrees: { enabled: false } },
			}),
			false,
		);
		assert.equal(resolveSuperagentWorktreeEnabled(false, "superpowers", {}), false);
		assert.equal(resolveSuperagentWorktreeEnabled(true, "default", {}), true);
		assert.equal(resolveSuperagentWorktreeEnabled(undefined, "default", {}), undefined);
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
							worktrees: {
								root: ".worktrees",
								setupHook: "./scripts/setup-worktree.mjs",
								setupHookTimeoutMs: 45000,
							},
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
							worktrees: {
								root: ".worktrees",
								setupHook: "./scripts/setup-worktree.mjs",
								setupHookTimeoutMs: 45000,
							},
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
