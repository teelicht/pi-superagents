/**
 * Chain behavior, template resolution, and directory management
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentConfig } from "../agents/agents.ts";
import { normalizeSkillInput } from "../shared/skills.ts";

const CHAIN_RUNS_DIR = path.join(os.tmpdir(), "pi-chain-runs");
const CHAIN_DIR_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// =============================================================================
// Behavior Resolution Types
// =============================================================================

export interface ResolvedStepBehavior {
	output: string | false;
	reads: string[] | false;
	progress: boolean;
	skills: string[] | false;
	model?: string;
}

export interface StepOverrides {
	output?: string | false;
	reads?: string[] | false;
	progress?: boolean;
	skills?: string[] | false;
	model?: string;
}

export interface PacketDefaults {
	reads?: string[];
	output?: string | false;
	progress?: boolean;
}

// =============================================================================
// Behavior Resolution
// =============================================================================

/**
 * Resolve effective chain behavior per step.
 * Priority: step override > packet defaults > agent frontmatter > false (disabled)
 */
export function resolveStepBehavior(
	agentConfig: AgentConfig,
	stepOverrides: StepOverrides,
	chainSkills?: string[],
	packetDefaults?: PacketDefaults,
): ResolvedStepBehavior {
	// Output: step override > packet defaults > frontmatter > false (no output)
	const output =
		stepOverrides.output !== undefined
			? stepOverrides.output
			: packetDefaults?.output !== undefined
				? packetDefaults.output
				: agentConfig.output ?? false;

	// Reads: step override > packet defaults > frontmatter defaultReads > false (no reads)
	const reads =
		stepOverrides.reads !== undefined
			? stepOverrides.reads
			: packetDefaults?.reads !== undefined
				? packetDefaults.reads
				: agentConfig.defaultReads ?? false;

	// Progress: step override > packet defaults > frontmatter defaultProgress > false
	const progress =
		stepOverrides.progress !== undefined
			? stepOverrides.progress
			: packetDefaults?.progress !== undefined
				? packetDefaults.progress
				: agentConfig.defaultProgress ?? false;

	let skills: string[] | false;
	if (stepOverrides.skills === false) {
		skills = false;
	} else if (stepOverrides.skills !== undefined) {
		skills = [...stepOverrides.skills];
		if (chainSkills && chainSkills.length > 0) {
			skills = [...new Set([...skills, ...chainSkills])];
		}
	} else {
		skills = agentConfig.skills ? [...agentConfig.skills] : [];
		if (chainSkills && chainSkills.length > 0) {
			skills = [...new Set([...skills, ...chainSkills])];
		}
	}

	const model = stepOverrides.model ?? agentConfig.model;
	return { output, reads, progress, skills, model };
}

