/**
 * Superpowers configuration helpers.
 *
 * Responsibilities:
 * - resolve the Superpowers settings object from extension config
 * - apply Superpowers-only worktree defaults in one shared place
 * - build scoped git-worktree options for sync and async execution paths
 * - resolve global extension ordering for subagent execution
 * - validate that configured subagent extension paths exist at runtime
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

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
export function resolveSuperagentWorktreeEnabled(requested: boolean | undefined, workflow: WorkflowMode, config: ExtensionConfig): boolean | undefined {
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
export function resolveSuperagentWorktreeRuntimeOptions(workflow: WorkflowMode, config: ExtensionConfig): Omit<CreateWorktreesOptions, "agents"> {
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
export function resolveSuperagentWorktreeCreateOptions(input: { workflow: WorkflowMode; config: ExtensionConfig; agents: string[] }): CreateWorktreesOptions {
	return {
		agents: input.agents,
		...resolveSuperagentWorktreeRuntimeOptions(input.workflow, input.config),
	};
}

/**
 * Resolve the effective extensions for a subagent run.
 *
 * Combines global extensions from config with agent-specific extensions from frontmatter.
 * Global extensions are prepended before agent extensions to ensure global policy runs first.
 *
 * @param config Extension config containing optional Superpowers settings with global extensions.
 * @param agentExtensions Agent-specific extensions from frontmatter, or undefined if not specified.
 * @returns Combined extension array with global extensions first, then agent extensions.
 */
export function resolveSubagentExtensions(config: ExtensionConfig, agentExtensions: string[] | undefined): string[] {
	return [...(config.superagents?.extensions ?? []), ...(agentExtensions ?? [])];
}

/**
 * Determine whether an extension source starts with a URI-style scheme.
 *
 * Inputs/outputs:
 * - returns true for Pi source specs such as `npm:pkg`, `git:repo`, `https://...`, and `ssh://...`
 * - returns false for Windows drive-letter paths such as `C:\\ext.ts`
 *
 * @param value Configured extension source string.
 * @returns True when Pi should resolve the source as a scheme-like extension source.
 */
export function isSchemeLikeExtensionSource(value: string): boolean {
	return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value) && !/^[a-zA-Z]:[\\/]/.test(value);
}

/**
 * Resolve a local subagent extension path against runtime context.
 *
 * Inputs/outputs:
 * - expands `~`, `~/...`, and `~\\...` against the current user's home directory
 * - returns absolute paths unchanged
 * - resolves relative paths from the subagent runtime working directory
 *
 * @param runtimeCwd Runtime working directory used to resolve relative paths.
 * @param configuredPath Local path as written in config or agent frontmatter.
 * @returns Absolute local filesystem path used for existence checks.
 */
export function resolveLocalSubagentExtensionPath(runtimeCwd: string, configuredPath: string): string {
	if (configuredPath === "~") return os.homedir();
	if (configuredPath.startsWith("~/")) return path.join(os.homedir(), configuredPath.slice(2));
	if (configuredPath.startsWith("~\\")) return path.join(os.homedir(), configuredPath.slice(2));
	return path.isAbsolute(configuredPath) ? configuredPath : path.resolve(runtimeCwd, configuredPath);
}

/**
 * Describes a configured subagent extension path that could not be found.
 *
 * @property source  - The config key referencing the missing path (e.g. `superagents.extensions[0]`).
 * @property configuredPath - The path as written in config (may be relative).
 * @property resolvedPath   - The path after resolution against the runtime working directory.
 */
export interface MissingSubagentExtensionPath {
	/** The config source key referencing this path, e.g. `superagents.extensions[0]`. */
	source: string;
	/** The path as written in the configuration (may be relative). */
	configuredPath: string;
	/** The resolved absolute path that was found to be missing. */
	resolvedPath: string;
}

/**
 * Find the first configured subagent extension path that does not exist.
 *
 * @param runtimeCwd      - Runtime working directory used to resolve relative paths.
 * @param globalExtensions - Extensions from `superagents.extensions`.
 * @param agentExtensions  - Extensions from agent frontmatter.
 * @returns The first missing extension path, or undefined when all configured paths exist.
 */
export function findMissingSubagentExtensionPath(
	runtimeCwd: string,
	globalExtensions: string[] | undefined,
	agentExtensions: string[] | undefined,
): MissingSubagentExtensionPath | undefined {
	const entries = [
		...(globalExtensions ?? []).map((configuredPath, index) => ({ source: `superagents.extensions[${index}]`, configuredPath })),
		...(agentExtensions ?? []).map((configuredPath, index) => ({ source: `agent.extensions[${index}]`, configuredPath })),
	];
	for (const entry of entries) {
		if (isSchemeLikeExtensionSource(entry.configuredPath)) continue;
		const resolvedPath = resolveLocalSubagentExtensionPath(runtimeCwd, entry.configuredPath);
		if (!fs.existsSync(resolvedPath)) {
			return { ...entry, resolvedPath };
		}
	}
	return undefined;
}
