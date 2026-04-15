/**
 * Superpowers skill-entry adapters.
 *
 * Responsibilities:
 * - parse direct Pi `/skill:<name>` input before native skill expansion
 * - decide whether a configured skill command should be intercepted
 * - shape resolved entry and overlay skills for root prompt construction
 *
 * Important side effects:
 * - none; callers perform prompt dispatch and skill file resolution
 */

import type { ResolvedSkill } from "../shared/skills.ts";
import type { ExtensionConfig } from "../shared/types.ts";
import type { ResolvedSuperpowersRunProfile } from "./workflow-profile.ts";
import { buildSuperpowersRootPrompt, type SuperpowersRootPromptInput } from "./root-prompt.ts";

/**
 * Extended root prompt input including skill-entry metadata.
 *
 * This type extends SuperpowersRootPromptInput with fields required for
 * skill-entry flows (entry skill, overlay skills, and entry source).
 */
export interface SkillEntryPromptInput extends SuperpowersRootPromptInput {
	/** Resolved entry skill content. */
	entrySkill?: ResolvedSkill;
	/** Resolved overlay skill contents. */
	overlaySkills?: ResolvedSkill[];
	/** Source of the entry skill (command vs intercepted-skill). */
	entrySkillSource?: "command" | "intercepted-skill" | "implicit";
}

/**
 * Parsed result from a direct Pi skill command.
 */
export interface ParsedSkillCommandInput {
	skillName: string;
	task: string;
}

/**
 * Parameters for building skill-entry prompt input from a resolved profile.
 */
export interface BuildSkillEntryPromptInputParams {
	profile: ResolvedSuperpowersRunProfile;
	usingSuperpowersSkill?: ResolvedSkill;
	entrySkill?: ResolvedSkill;
	overlaySkills: ResolvedSkill[];
}

/**
 * Parameters for building a resolved skill-entry prompt.
 */
export interface BuildResolvedSkillEntryPromptParams {
	cwd: string;
	profile: ResolvedSuperpowersRunProfile;
	resolveSkill: (cwd: string, name: string) => ResolvedSkill | undefined;
	resolveSkillNames: (skillNames: string[], cwd: string) => { resolved: ResolvedSkill[]; missing: string[] };
}

/** Pattern to match direct Pi `/skill:<name>` commands. */
const SKILL_COMMAND_PATTERN = /^\/skill:([^\s]+)\s+([\s\S]+)$/;

/** Skills that can be intercepted for Superpowers entry. */
const SUPPORTED_INTERCEPTED_SKILLS = new Set(["brainstorming"]);

/**
 * Parse a direct Pi skill command from raw input text.
 *
 * @param text Raw user input before Pi skill expansion.
 * @returns Parsed skill name and task, or undefined when the input is not a usable skill command.
 */
export function parseSkillCommandInput(text: string): ParsedSkillCommandInput | undefined {
	const match = text.match(SKILL_COMMAND_PATTERN);
	if (!match) return undefined;
	const skillName = match[1]?.trim();
	const task = match[2]?.trim();
	if (!skillName || !task) return undefined;
	return { skillName, task };
}

/**
 * Determine whether a direct skill command should enter Superpowers.
 *
 * @param skillName Skill command name from raw input.
 * @param config Effective extension config.
 * @returns True when the skill is supported and explicitly opted in.
 */
export function shouldInterceptSkillCommand(skillName: string, config: ExtensionConfig): boolean {
	if (!SUPPORTED_INTERCEPTED_SKILLS.has(skillName)) return false;
	return config.superagents?.interceptSkillCommands?.includes(skillName) ?? false;
}

/**
 * Convert a resolved skill-entry profile into root prompt input.
 *
 * @param params Resolved profile and skill contents.
 * @returns Input for `buildSuperpowersRootPrompt`.
 */
export function buildSkillEntryPromptInput(params: BuildSkillEntryPromptInputParams): SkillEntryPromptInput {
	return {
		task: params.profile.task,
		useBranches: params.profile.useBranches,
		useSubagents: params.profile.useSubagents,
		useTestDrivenDevelopment: params.profile.useTestDrivenDevelopment,
		usePlannotatorReview: params.profile.usePlannotatorReview,
		worktreesEnabled: params.profile.worktreesEnabled,
		fork: params.profile.fork,
		usingSuperpowersSkill: params.usingSuperpowersSkill,
		entrySkill: params.entrySkill,
		overlaySkills: params.overlaySkills,
		entrySkillSource: params.profile.entrySkill?.source,
	};
}

/**
 * Build a Superpowers root prompt for one resolved skill-entry profile.
 *
 * @param input Skill resolution inputs and dependencies.
 * @returns Prompt text, or an error when a required skill cannot be resolved.
 */
export function buildResolvedSkillEntryPrompt(
	input: BuildResolvedSkillEntryPromptParams,
): { prompt: string } | { error: string } {
	const usingSuperpowersSkill = input.resolveSkill(input.cwd, "using-superpowers");
	const entrySkillName = input.profile.entrySkill?.name;
	const entrySkill = entrySkillName ? input.resolveSkill(input.cwd, entrySkillName) : undefined;
	const overlayResolution = input.resolveSkillNames(input.profile.overlaySkillNames, input.cwd);

	if (!entrySkill) {
		return { error: `Superpowers entry skill could not be resolved: ${entrySkillName ?? "unknown"}` };
	}
	if (overlayResolution.missing.length > 0) {
		return { error: `Superpowers overlay skills could not be resolved: ${overlayResolution.missing.join(", ")}` };
	}

	return {
		prompt: buildSuperpowersRootPrompt(buildSkillEntryPromptInput({
			profile: input.profile,
			usingSuperpowersSkill,
			entrySkill,
			overlaySkills: overlayResolution.resolved,
		})),
	};
}
