/**
 * Superpowers workflow profile resolution.
 *
 * Responsibilities:
 * - parse leading workflow tokens from slash command arguments
 * - preserve supported execution flags
 * - merge command preset settings and inline overrides
 * - carry entry skill name and overlay skill names for skill-entry flows
 *
 * Important side effects:
 * - none; this module is pure and safe to unit test
 */

import type { ExtensionConfig } from "../shared/types.ts";

export interface SuperpowersWorkflowOverrides {
	useSubagents?: boolean;
	useTestDrivenDevelopment?: boolean;
}

export interface ParsedSuperpowersWorkflowArgs {
	task: string;
	overrides: SuperpowersWorkflowOverrides;
	fork: boolean;
}

export interface ResolvedSuperpowersRunProfile {
	commandName: string;
	task: string;
	entrySkill: string;
	useBranches?: boolean;
	useSubagents?: boolean;
	useTestDrivenDevelopment?: boolean;
	usePlannotatorReview?: boolean;
	worktrees?: { enabled: boolean; root?: string | null };
	fork: boolean;
	overlaySkillNames: string[];
}

/**
 * Remove supported execution flags from the end of an argument string.
 *
 * @param rawArgs Raw slash command arguments.
 * @returns Cleaned arguments plus extracted flag values.
 */
function extractExecutionFlags(rawArgs: string): { args: string; fork: boolean } {
	let args = rawArgs.trim();
	let fork = false;

	while (true) {
		if (args.endsWith(" --fork") || args === "--fork") {
			fork = true;
			args = args === "--fork" ? "" : args.slice(0, -7).trim();
			continue;
		}
		break;
	}

	return { args, fork };
}

/**
 * Apply one leading workflow token to an override accumulator.
 *
 * @param token Candidate workflow token.
 * @param overrides Mutable override accumulator.
 * @returns True when the token was consumed.
 */
function applyWorkflowToken(token: string, overrides: SuperpowersWorkflowOverrides): boolean {
	switch (token) {
		case "tdd":
			overrides.useTestDrivenDevelopment = true;
			return true;
		case "direct":
			overrides.useTestDrivenDevelopment = false;
			return true;
		case "subagents":
			overrides.useSubagents = true;
			return true;
		case "no-subagents":
		case "inline":
			overrides.useSubagents = false;
			return true;
		case "full":
			overrides.useSubagents = true;
			overrides.useTestDrivenDevelopment = true;
			return true;
		case "lean":
			overrides.useSubagents = false;
			overrides.useTestDrivenDevelopment = false;
			return true;
		default:
			return false;
	}
}

/**
 * Parse `/sp-implement` or custom Superpowers command arguments.
 *
 * @param rawArgs Raw command arguments.
 * @returns Parsed workflow args or null when no task remains.
 */
export function parseSuperpowersWorkflowArgs(rawArgs: string): ParsedSuperpowersWorkflowArgs | null {
	const { args, fork } = extractExecutionFlags(rawArgs);
	const words = args.split(/\s+/).filter(Boolean);
	const overrides: SuperpowersWorkflowOverrides = {};
	let index = 0;
	while (index < words.length && applyWorkflowToken(words[index], overrides)) {
		index++;
	}
	const task = words.slice(index).join(" ").trim();
	if (!task) return null;
	return { task, overrides, fork };
}

/**
 * Resolve a custom command preset by registered command name.
 *
 * @param config Effective extension config.
 * @param commandName Slash command name without leading slash.
 * @returns Matching preset or an empty preset.
 */
function resolveCommandPreset(config: ExtensionConfig, commandName: string) {
	return config.superagents?.commands?.[commandName] ?? {};
}

/**
 * Merge command preset, inline overrides, and entry skill into one run profile.
 *
 * @param input Effective config, command name, parsed arguments, and optional entry skill name.
 * @returns Fully resolved Superpowers run profile.
 */
export function resolveSuperpowersRunProfile(input: {
	config: ExtensionConfig;
	commandName: string;
	parsed: ParsedSuperpowersWorkflowArgs;
	entrySkill?: string;
}): ResolvedSuperpowersRunProfile {
	const settings = input.config.superagents ?? {};
	const preset = resolveCommandPreset(input.config, input.commandName);
	const entrySkill = input.entrySkill ?? preset.entrySkill ?? "using-superpowers";
	const superpowersSkills: readonly string[] = settings.superpowersSkills ?? [];
	const invocationOverlayNames = superpowersSkills
		.flatMap((skillName) => settings.skillOverlays?.[skillName] ?? []);
	const entryOverlayNames = settings.skillOverlays?.[entrySkill] ?? [];
	const overlaySkillNames = [...new Set([...entryOverlayNames, ...invocationOverlayNames])];

	const profile: ResolvedSuperpowersRunProfile = {
		commandName: input.commandName,
		task: input.parsed.task,
		entrySkill,
		fork: input.parsed.fork,
		overlaySkillNames,
	};

	// Only include policy fields when the preset or overrides declare them
	const useSubagents = input.parsed.overrides.useSubagents ?? preset.useSubagents;
	if (useSubagents !== undefined) profile.useSubagents = useSubagents;

	const useTestDrivenDevelopment = input.parsed.overrides.useTestDrivenDevelopment ?? preset.useTestDrivenDevelopment;
	if (useTestDrivenDevelopment !== undefined) profile.useTestDrivenDevelopment = useTestDrivenDevelopment;

	if (preset.useBranches !== undefined) profile.useBranches = preset.useBranches;
	if (preset.usePlannotator !== undefined) profile.usePlannotatorReview = preset.usePlannotator;

	if (preset.worktrees) {
		profile.worktrees = { enabled: preset.worktrees.enabled ?? false };
		if (preset.worktrees.root !== undefined) {
			profile.worktrees.root = preset.worktrees.root;
		}
	}

	return profile;
}
