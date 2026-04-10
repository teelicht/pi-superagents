/**
 * Superagents configuration helpers.
 *
 * Responsibilities:
 * - resolve the canonical Superagents settings object from extension config
 * - apply Superpowers-only worktree defaults in one shared place
 * - build scoped git-worktree options for sync and async execution paths
 */

import { isParallelStep, type ChainStep } from "./settings.ts";
import type { ExtensionConfig, WorkflowMode } from "./types.ts";
import type { CreateWorktreesOptions } from "./worktree.ts";

interface LegacyWorktreeConfig {
	worktreeSetupHook?: string;
	worktreeSetupHookTimeoutMs?: number;
}

/**
 * Resolve the canonical Superagents settings object from config.
 *
 * @param config Extension config being normalized.
 * @returns Canonical Superagents settings, if present.
 */
export function getSuperagentSettings(config: ExtensionConfig): ExtensionConfig["superagents"] | undefined {
	return config.superagents ?? config.superpowers;
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
	return getSuperagentSettings(config)?.worktreeEnabled ?? true;
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
	const options: Omit<CreateWorktreesOptions, "agents"> = {};
	if (workflow !== "superpowers") return options;

	const settings = getSuperagentSettings(config);
	const legacy = config as ExtensionConfig & LegacyWorktreeConfig;
	const hookPath = settings?.worktreeSetupHook ?? legacy.worktreeSetupHook;
	const timeoutMs = settings?.worktreeSetupHookTimeoutMs ?? legacy.worktreeSetupHookTimeoutMs;

	if (settings?.worktreeRoot) {
		options.rootDir = settings.worktreeRoot;
		options.requireIgnoredRoot = true;
	}

	if (hookPath) {
		options.setupHook = {
			hookPath,
			timeoutMs,
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
