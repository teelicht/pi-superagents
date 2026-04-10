/**
 * Superagents configuration helpers.
 *
 * Responsibilities:
 * - resolve the Superagents settings object from extension config
 * - apply Superpowers-only worktree defaults in one shared place
 * - build scoped git-worktree options for sync and async execution paths
 */

import { isParallelStep, type ChainStep } from "./settings.ts";
import type { ExtensionConfig, WorkflowMode } from "../shared/types.ts";
import type { CreateWorktreesOptions } from "./worktree.ts";

/**
 * Resolve the Superagents settings object from config.
 *
 * @param config Extension config being normalized.
 * @returns Superagents settings, if present.
 */
export function getSuperagentSettings(config: ExtensionConfig): ExtensionConfig["superagents"] | undefined {
	return config.superagents;
}

/**
 * Resolve the effective default worktree flag for a run.
 *
 * Inputs/outputs:
 * - accepts an optional explicit per-run worktree flag plus workflow/config
 * - returns the explicit value when present, otherwise the Superpowers default
 *
 * Invariants:
 * - only the explicit Superpowers workflow gets a config-driven default
 * - default workflow runs preserve caller behavior when no explicit flag is set
 *
 * @param requested Explicit worktree preference from the current run, if any.
 * @param workflow Active workflow for the current run.
 * @param config Extension config containing optional Superagents settings.
 * @returns The effective worktree preference for the run.
 */
export function resolveSuperagentWorktreeEnabled(
	requested: boolean | undefined,
	workflow: WorkflowMode,
	config: ExtensionConfig,
): boolean | undefined {
	if (requested !== undefined) return requested;
	if (workflow !== "superpowers") return undefined;
	return getSuperagentSettings(config)?.worktrees?.enabled ?? true;
}

/**
 * Apply the Superpowers default worktree flag to chain parallel steps.
 *
 * @param chain Chain steps to normalize.
 * @param workflow Active workflow for the current run.
 * @param config Extension config containing optional Superagents settings.
 * @returns Chain steps with implicit Superpowers worktree defaults filled in.
 */
export function applySuperagentWorktreeDefaultsToChain(
	chain: ChainStep[],
	workflow: WorkflowMode,
	config: ExtensionConfig,
): ChainStep[] {
	const defaultEnabled = resolveSuperagentWorktreeEnabled(undefined, workflow, config);
	if (defaultEnabled !== true) return chain;

	return chain.map((step) => {
		if (!isParallelStep(step) || step.worktree !== undefined) return step;
		return { ...step, worktree: true };
	});
}

/**
 * Resolve the workflow-scoped worktree runtime settings without agent labels.
 *
 * @param workflow Active workflow for the current run.
 * @param config Extension config containing optional Superagents settings.
 * @returns Resolved worktree root and hook settings for the active workflow.
 */
export function resolveSuperagentWorktreeRuntimeOptions(
	workflow: WorkflowMode,
	config: ExtensionConfig,
): Omit<CreateWorktreesOptions, "agents"> {
	if (workflow !== "superpowers") return {};

	const worktrees = getSuperagentSettings(config)?.worktrees;
	const options: Omit<CreateWorktreesOptions, "agents"> = {};

	if (worktrees?.root) {
		options.rootDir = worktrees.root;
		options.requireIgnoredRoot = true;
	}

	if (worktrees?.setupHook) {
		options.setupHook = {
			hookPath: worktrees.setupHook,
			timeoutMs: worktrees.setupHookTimeoutMs,
		};
	}

	return options;
}

/**
 * Build createWorktrees options scoped to the active workflow.
 *
 * @param input Workflow/config metadata plus the agent labels for the worktree batch.
 * @returns Concrete options for createWorktrees().
 */
export function resolveSuperagentWorktreeCreateOptions(input: {
	workflow: WorkflowMode;
	config: ExtensionConfig;
	agents: string[];
}): CreateWorktreesOptions {
	return {
		agents: input.agents,
		...resolveSuperagentWorktreeRuntimeOptions(input.workflow, input.config),
	};
}
