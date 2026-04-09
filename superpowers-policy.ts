/**
 * Command-scoped policy helpers for the Superpowers workflow.
 *
 * Responsibilities:
 * - resolve model tiers for Superpowers execution roles
 * - merge role-specific skill overlays safely
 * - add TDD behavior for the implementer role when requested
 */

import type {
	ConfiguredModelTier,
	ExecutionRole,
	ExtensionConfig,
	ModelTier,
	ModelTierConfig,
	ModelTierSetting,
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
	"sp-spec-review": "balanced",
	"sp-code-review": "balanced",
	"sp-debug": "max",
};

/**
 * Resolve the canonical Superagents settings object from config.
 *
 * Prefers the renamed `superagents` root while still accepting the legacy
 * `superpowers` root so older config files remain valid.
 *
 * @param config Extension config for the current run.
 * @returns Canonical settings object, if configured.
 */
function getSuperagentSettings(config: ExtensionConfig): ExtensionConfig["superagents"] | undefined {
	return config.superagents ?? config.superpowers;
}

export interface ResolvedRoleModel {
	model: string;
	thinking?: ModelTierConfig["thinking"];
}

/**
 * Normalize configured tier names, preserving support for legacy `strong`.
 *
 * @param tier Raw tier name read from config.
 * @returns Supported tier name or `undefined` when the value is invalid.
 */
function normalizeConfiguredTier(tier: unknown): ModelTier | undefined {
	if (tier === "strong") return "balanced";
	return tier === "cheap" || tier === "balanced" || tier === "max" ? tier : undefined;
}

/**
 * Normalize a tier mapping entry into the runtime model-plus-thinking shape.
 *
 * @param entry Tier config entry from `superpowers.modelTiers`.
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
 * Falls back from `balanced` to the legacy `strong` key so older config files
 * continue to work after the tier rename.
 *
 * @param settings Full Superpowers config object.
 * @param tier Normalized tier name.
 * @returns Resolved model settings for the tier, if configured.
 */
function resolveTierModelSetting(
	settings: ExtensionConfig["superagents"],
	tier: ModelTier,
): ResolvedRoleModel | undefined {
	const configured = settings?.modelTiers as Partial<Record<ConfiguredModelTier, ModelTierSetting>> | undefined;
	const direct = normalizeTierSetting(configured?.[tier]);
	if (direct) return direct;
	if (tier !== "balanced") return undefined;
	return normalizeTierSetting(configured?.strong);
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
 * Resolve the effective model for a role when the Superpowers workflow is active.
 *
 * Returns `undefined` for the default workflow so existing model resolution stays unchanged.
 */
export function resolveModelForRole(input: {
	workflow: WorkflowMode;
	role: ExecutionRole;
	config: ExtensionConfig;
}): ResolvedRoleModel | undefined {
	if (input.workflow !== "superpowers") return undefined;
	const settings = getSuperagentSettings(input.config);
	const configuredTier = settings?.roleModelTiers?.[input.role] ?? DEFAULT_ROLE_TIERS[input.role];
	const tier = normalizeConfiguredTier(configuredTier);
	if (!tier) return undefined;
	return resolveTierModelSetting(settings, tier);
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

	const overlays = getSuperagentSettings(input.config)?.roleSkillOverlays?.[input.role] ?? [];
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
