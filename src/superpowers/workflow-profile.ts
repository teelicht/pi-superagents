/**
 * Superpowers workflow profile resolution.
 *
 * Responsibilities:
 * - parse leading workflow tokens from slash command arguments
 * - preserve supported execution flags
 * - merge global defaults, custom command presets, inline overrides, and worktree policy
 * - carry entry skill source metadata and overlay skill names for skill-entry flows
 *
 * Important side effects:
 * - none; this module is pure and safe to unit test
 */

import type { ExtensionConfig, SuperpowersCommandPreset } from "../shared/types.ts";

export type SuperpowersEntrySkillSource = "command" | "intercepted-skill" | "implicit";

export interface SuperpowersEntrySkillProfile {
	name: string;
	source: SuperpowersEntrySkillSource;
}

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
	useBranches: boolean;
	useSubagents: boolean;
	useTestDrivenDevelopment: boolean;
	usePlannotatorReview: boolean;
	worktreesEnabled: boolean;
	fork: boolean;
	entrySkill?: SuperpowersEntrySkillProfile;
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
function resolveCommandPreset(config: ExtensionConfig, commandName: string): SuperpowersCommandPreset {
	if (commandName === "superpowers") return {};
	return config.superagents?.commands?.[commandName] ?? {};
}

/**
 * Merge defaults, command preset, inline overrides, and skill-entry metadata into one run profile.
 *
 * @param input Effective config, command name, parsed arguments, and optional entry skill profile.
 * @returns Fully resolved Superpowers run profile.
 */
export function resolveSuperpowersRunProfile(input: {
	config: ExtensionConfig;
	commandName: string;
	parsed: ParsedSuperpowersWorkflowArgs;
	entrySkill?: SuperpowersEntrySkillProfile;
}): ResolvedSuperpowersRunProfile {
	const settings = input.config.superagents ?? {};
	const preset = resolveCommandPreset(input.config, input.commandName);
	const overlaySkillNames = input.entrySkill
		? settings.skillOverlays?.[input.entrySkill.name] ?? []
		: [];
	return {
		commandName: input.commandName,
		task: input.parsed.task,
		useBranches: preset.useBranches ?? settings.useBranches ?? false,
		useSubagents: input.parsed.overrides.useSubagents
			?? preset.useSubagents
			?? settings.useSubagents
			?? true,
		useTestDrivenDevelopment: input.parsed.overrides.useTestDrivenDevelopment
			?? preset.useTestDrivenDevelopment
			?? settings.useTestDrivenDevelopment
			?? true,
		usePlannotatorReview: preset.usePlannotator ?? settings.usePlannotator ?? false,
		worktreesEnabled: preset.worktrees?.enabled ?? settings.worktrees?.enabled ?? true,
		fork: input.parsed.fork,
		...(input.entrySkill ? { entrySkill: input.entrySkill } : {}),
		overlaySkillNames,
	};
}
