/**
 * Command-scoped policy helpers for the Superpowers workflow.
 *
 * Responsibilities:
 * - resolve Markdown-declared Superpowers model tiers into concrete models
 * - merge agent-declared and step-injected skills safely
 * - add TDD behavior for the implementer role when requested
 */

import type {
	ExecutionRole,
	ExtensionConfig,
	ModelTierConfig,
	SuperpowersImplementerMode,
	WorkflowMode,
} from "../shared/types.ts";
import { getSuperagentSettings } from "./superagents-config.ts";

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

const NON_DELEGATING_ROLE_TOOLS: Partial<Record<ExecutionRole, string[]>> = {
	"sp-recon": ["read", "grep", "find", "ls"],
	"sp-research": ["read", "grep", "find", "ls"],
	"sp-implementer": ["read", "grep", "find", "ls", "bash", "write"],
	"sp-spec-review": ["read", "grep", "find", "ls"],
	"sp-code-review": ["read", "grep", "find", "ls"],
	"sp-debug": ["read", "grep", "find", "ls", "bash"],
};

const DELEGATION_TOOLS = new Set(["subagent", "subagent_status"]);

export interface ResolvedRoleModel {
	model: string;
	thinking?: ModelTierConfig["thinking"];
}

/**
 * Normalize configured tier names.
 *
 * Accepts any non-empty string as a valid tier name, enabling users to
 * define custom tiers (e.g., "creative", "free") in their config.
 *
 * @param tier Raw tier name read from config or agent frontmatter.
 * @returns Valid tier name or `undefined` when the value is invalid.
 */
function normalizeConfiguredTier(tier: unknown): string | undefined {
	if (typeof tier === "string" && tier.length > 0) {
		return tier;
	}
	return undefined;
}

/**
 * Normalize a tier mapping entry into the runtime model-plus-thinking shape.
 *
 * @param entry Tier config entry from `superagents.modelTiers`.
 * @returns Normalized tier settings or `undefined` when the entry is unusable.
 */
function normalizeTierSetting(entry: unknown): ResolvedRoleModel | undefined {
	if (typeof entry === "string" && entry.length > 0) {
		return { model: entry };
	}
	if (!entry || typeof entry !== "object") return undefined;
	const candidate = entry as Partial<ModelTierConfig>;
	if (typeof candidate.model !== "string" || candidate.model.length === 0) return undefined;
	return typeof candidate.thinking === "string"
		? { model: candidate.model, thinking: candidate.thinking }
		: { model: candidate.model };
}

/**
 * Resolve the configured model entry for a normalized tier name.
 *
 * @param settings Full Superpowers config object.
 * @param tier Normalized tier name.
 * @returns Resolved model settings for the tier, if configured.
 */
function resolveTierModelSetting(
	settings: ExtensionConfig["superagents"],
	tier: string,
): ResolvedRoleModel | undefined {
	return normalizeTierSetting(settings?.modelTiers?.[tier]);
}

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
 * Resolve the effective model for an agent using tier configuration.
 *
 * Inputs/outputs:
 * - accepts the current workflow, extension config, and the agent frontmatter `model` value
 * - returns the configured concrete model when that value names a configured tier
 *
 * Invariants:
 * - tier resolution works in all workflows, not just Superpowers
 * - non-tier model values (concrete model IDs) stay owned by agent frontmatter and return `undefined`
 * - unknown tier names resolve to `undefined`, falling back to agent default
 *
 * Failure modes:
 * - unconfigured tier names resolve to `undefined`
 */
export function resolveModelForAgent(input: {
	workflow: WorkflowMode;
	agentModel?: string;
	config: ExtensionConfig;
}): ResolvedRoleModel | undefined {
	const settings = getSuperagentSettings(input.config);
	const tier = normalizeConfiguredTier(input.agentModel);
	if (!tier) return undefined;
	return resolveTierModelSetting(settings, tier);
}

/**
 * Merge agent skills and step overrides for a given execution role.
 *
 * Throws when a merged skill is unavailable or when a non-root role
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

	const merged = [...new Set([...input.agentSkills, ...input.stepSkills])];
	for (const skill of merged) {
		if (!input.availableSkills.has(skill)) {
			throw new Error(`Unknown skill: ${skill}`);
		}
		if (input.role !== "root-planning" && ROOT_ONLY_WORKFLOW_SKILLS.has(skill)) {
			throw new Error(`Role ${input.role} cannot receive root-only workflow skill '${skill}'`);
		}
	}
	return merged;
}

/**
 * Resolve the effective tool allowlist for a Superpowers execution role.
 *
 * Inputs/outputs:
 * - accepts the active workflow, inferred role, and any agent-declared tools
 * - returns the unchanged tool list for default/root runs, or a bounded list for `sp-*` roles
 *
 * Invariants:
 * - bounded Superpowers roles never receive delegation tools
 * - root-planning keeps orchestration access
 *
 * Failure modes:
 * - none; missing tool declarations fall back to a safe built-in allowlist
 */
export function resolveRoleTools(input: {
	workflow: WorkflowMode;
	role: ExecutionRole;
	agentTools?: string[];
}): string[] | undefined {
	if (input.workflow !== "superpowers" || input.role === "root-planning") {
		return input.agentTools;
	}

	const explicitTools = input.agentTools?.filter((tool) => !DELEGATION_TOOLS.has(tool));
	if (explicitTools && explicitTools.length > 0) return explicitTools;
	return NON_DELEGATING_ROLE_TOOLS[input.role];
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
