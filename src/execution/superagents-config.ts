/**
 * Superpowers configuration helpers.
 *
 * Responsibilities:
 * - resolve the Superpowers settings object from extension config
 * - apply Superpowers-only worktree defaults in one shared place
 * - build scoped git-worktree options for sync and async execution paths
 */

import type { ExtensionConfig, WorkflowMode } from "../shared/types.ts";
import type { CreateWorktreesOptions } from "./worktree.ts";

/**
 * Resolve the Superpowers settings object from config.
 *
 * @param config Extension config being normalized.
 * @returns Superpowers settings, if present.
 */
export function getSuperagentSettings(config: ExtensionConfig): ExtensionConfig["superagents"] | undefined {
	return config.superagents;
}

/**
 * Resolve the effective default worktree flag for a run.
 *
 * Inputs/outputs:
 * - accepts an optional explicit per-run worktree flag plus workflow/config
 * - returns false when Superpowers config disables worktrees, otherwise the
 *   explicit value when present or the Superpowers default
 *
 * Invariants:
 * - `superagents.commands["sp-implement"].worktrees.enabled: false` is a hard off switch for Superpowers
 * - only the explicit Superpowers workflow gets a config-driven default
 * - default workflow runs preserve caller behavior when no explicit flag is set
 *
 * @param requested Explicit worktree preference from the current run, if any.
 * @param workflow Active workflow for the current run.
 * @param config Extension config containing optional Superpowers settings.
 * @returns The effective worktree preference for the run.
 */
export function resolveSuperagentWorktreeEnabled(
	requested: boolean | undefined,
	workflow: WorkflowMode,
	config: ExtensionConfig,
): boolean | undefined {
	if (workflow === "superpowers") {
		const worktrees = config.superagents?.commands?.["sp-implement"]?.worktrees;
		if (worktrees?.enabled === false) return false;
	}
	if (requested !== undefined) return requested;
	if (workflow !== "superpowers") return undefined;
	return config.superagents?.commands?.["sp-implement"]?.worktrees?.enabled ?? true;
}

/**
 * Resolve the workflow-scoped worktree runtime settings without agent labels.
 *
 * @param workflow Active workflow for the current run.
 * @param config Extension config containing optional Superpowers settings.
 * @returns Resolved worktree root settings for the active workflow.
 */
export function resolveSuperagentWorktreeRuntimeOptions(
	workflow: WorkflowMode,
	config: ExtensionConfig,
): Omit<CreateWorktreesOptions, "agents"> {
	if (workflow !== "superpowers") return {};

	const worktrees = config.superagents?.commands?.["sp-implement"]?.worktrees;
	const options: Omit<CreateWorktreesOptions, "agents"> = {};

	if (worktrees?.root) {
		options.rootDir = worktrees.root;
		options.requireIgnoredRoot = true;
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
