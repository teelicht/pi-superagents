/**
 * Chain behavior, template resolution, and directory management
 */

import type { AgentConfig } from "../agents/agents.ts";
// import { normalizeSkillInput } from "../shared/skills.ts";

// =============================================================================
// Behavior Resolution Types
// =============================================================================

export interface ResolvedStepBehavior {
	reads: string[] | false;
	progress: boolean;
	skills: string[] | false;
	model?: string;
}

export interface StepOverrides {
	reads?: string[] | false;
	progress?: boolean;
	skills?: string[] | false;
	model?: string;
}

export interface PacketDefaults {
	reads?: string[];
	progress?: boolean;
}

// =============================================================================
// Behavior Resolution
// =============================================================================

/**
 * Resolve effective chain behavior per step.
 *
 * @param agentConfig Agent frontmatter-derived configuration.
 * @param stepOverrides Runtime overrides for a specific delegated step.
 * @param packetDefaults Superpowers role packet defaults.
 * @returns Effective read/progress/skill/model behavior for the step.
 */
export function resolveStepBehavior(
	agentConfig: AgentConfig,
	stepOverrides: StepOverrides,
	packetDefaults?: PacketDefaults,
): ResolvedStepBehavior {
	const reads =
		stepOverrides.reads !== undefined
			? stepOverrides.reads
			: packetDefaults?.reads !== undefined
				? packetDefaults.reads
				: false;

	const progress =
		stepOverrides.progress !== undefined
			? stepOverrides.progress
			: packetDefaults?.progress !== undefined
				? packetDefaults.progress
				: false;

	let skills: string[] | false;
	if (stepOverrides.skills === false) {
		skills = false;
	} else if (stepOverrides.skills !== undefined) {
		skills = [...stepOverrides.skills];
	} else {
		skills = agentConfig.skills ? [...agentConfig.skills] : [];
	}

	const model = stepOverrides.model ?? agentConfig.model;
	return { reads, progress, skills, model };
}
