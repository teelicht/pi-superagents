/**
 * Command-scoped policy helpers for the Superpowers workflow.
 *
 * Responsibilities:
 * - resolve model tiers for Superpowers execution roles
 * - merge role-specific skill overlays safely
 * - add TDD behavior for the implementer role when requested
 */

import type {
	ExecutionRole,
	ExtensionConfig,
	ModelTier,
	SuperpowersImplementerMode,
	WorkflowMode,
} from "./types.ts";

const ROOT_ONLY_WORKFLOW_SKILLS = new Set([
	"using-superpowers",
	"brainstorming",
	"writing-plans",
	"requesting-code-review",
	"receiving-code-review",
	"subagent-driven-development",
	"executing-plans",
	"verification-before-completion",
	"using-git-worktrees",
	"dispatching-parallel-agents",
	"finishing-a-development-branch",
]);

const DEFAULT_ROLE_TIERS: Record<ExecutionRole, ModelTier> = {
	"root-planning": "max",
	"sp-recon": "cheap",
	"sp-research": "cheap",
	"sp-implementer": "cheap",
	"sp-spec-review": "strong",
	"sp-code-review": "strong",
	"sp-debug": "max",
};

/**
 * Infer the execution role used for Superpowers model and skill policy.
 *
 * Falls back to `root-planning` for non-Superpowers or unknown agent names so
 * the default workflow remains unchanged.
 */
export function inferExecutionRole(agentName: string): ExecutionRole {
	switch (agentName) {
		case "sp-recon":
		case "sp-research":
		case "sp-implementer":
		case "sp-spec-review":
		case "sp-code-review":
		case "sp-debug":
			return agentName;
		default:
			return "root-planning";
	}
}

/**
 * Resolve the effective model for a role when the Superpowers workflow is active.
 *
 * Returns `undefined` for the default workflow so existing model resolution stays unchanged.
 */
export function resolveModelForRole(input: {
	workflow: WorkflowMode;
	role: ExecutionRole;
	config: ExtensionConfig;
}): string | undefined {
	if (input.workflow !== "superpowers") return undefined;
	const settings = input.config.superpowers;
	const tier = settings?.roleModelTiers?.[input.role] ?? DEFAULT_ROLE_TIERS[input.role];
	return settings?.modelTiers?.[tier];
}

/**
 * Merge agent skills, step overrides, and role overlays for a given execution role.
 *
 * Throws when a configured overlay skill is unavailable or when a non-root role
 * receives a workflow-orchestration skill that should stay root-owned.
 */
export function resolveRoleSkillSet(input: {
	workflow: WorkflowMode;
	role: ExecutionRole;
	config: ExtensionConfig;
	agentSkills: string[];
	stepSkills: string[];
	availableSkills: ReadonlySet<string>;
}): string[] {
	if (input.workflow !== "superpowers") {
		return [...new Set([...input.agentSkills, ...input.stepSkills])];
	}

	const overlays = input.config.superpowers?.roleSkillOverlays?.[input.role] ?? [];
	const merged = [...new Set([...input.agentSkills, ...input.stepSkills, ...overlays])];
	for (const skill of merged) {
		if (!input.availableSkills.has(skill)) {
			throw new Error(`Unknown overlay skill: ${skill}`);
		}
		if (input.role !== "root-planning" && ROOT_ONLY_WORKFLOW_SKILLS.has(skill)) {
			throw new Error(`Role ${input.role} cannot receive root-only workflow skill '${skill}'`);
		}
	}
	return merged;
}

/**
 * Resolve the effective skill set for the Superpowers implementer role.
 *
 * In `tdd` mode this appends `test-driven-development` when that skill exists.
 */
export function resolveImplementerSkillSet(input: {
	workflow: WorkflowMode;
	implementerMode: SuperpowersImplementerMode;
	config: ExtensionConfig;
	agentSkills: string[];
	stepSkills: string[];
	availableSkills: ReadonlySet<string>;
}): string[] {
	const base = resolveRoleSkillSet({
		workflow: input.workflow,
		role: "sp-implementer",
		config: input.config,
		agentSkills: input.agentSkills,
		stepSkills: input.stepSkills,
		availableSkills: input.availableSkills,
	});
	if (input.workflow !== "superpowers" || input.implementerMode !== "tdd") return base;
	if (!input.availableSkills.has("test-driven-development")) return base;
	return [...new Set([...base, "test-driven-development"])];
}
