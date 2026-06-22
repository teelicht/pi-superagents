/**
 * Command-scoped policy helpers for the Superpowers workflow.
 *
 * Responsibilities:
 * - resolve Markdown-declared Superpowers model tiers into concrete models
 * - merge agent-declared and step-injected skills safely
 * - add TDD behavior for the implementer role when requested
 * - append global config tools after role-specific tool policy
 */

import { CHILD_LIFECYCLE_TOOLS, DELEGATION_TOOLS, READ_ONLY_TOOLS } from "../shared/tool-registry.ts";
import type { ExecutionRole, ExtensionConfig, ModelTierConfig, ThinkingLevel, WorkflowMode } from "../shared/types.ts";
import { getSuperagentSettings } from "./superagents-config.ts";

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
	return typeof candidate.thinking === "string" ? { model: candidate.model, thinking: candidate.thinking } : { model: candidate.model };
}

/**
 * Resolve the configured model entry for a normalized tier name.
 *
 * @param settings Full Superpowers config object.
 * @param tier Normalized tier name.
 * @returns Resolved model settings for the tier, if configured.
 */
function resolveTierModelSetting(settings: ExtensionConfig["superagents"], tier: string): ResolvedRoleModel | undefined {
	return normalizeTierSetting(settings?.modelTiers?.[tier]);
}

/**
 * Infer the execution role used for Superpowers model and skill policy.
 *
 * Falls back to `root-planning` for non-Superpowers or unknown agent names so
 * the default workflow remains unchanged.
 */
export function inferExecutionRole(agentName: string): ExecutionRole {
	if (agentName.startsWith("sp-")) return agentName as ExecutionRole;
	return "root-planning";
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
export function resolveModelForAgent(input: { workflow: WorkflowMode; agentModel?: string; config: ExtensionConfig }): ResolvedRoleModel | undefined {
	const settings = getSuperagentSettings(input.config);
	const tier = normalizeConfiguredTier(input.agentModel);
	if (!tier) return undefined;
	return resolveTierModelSetting(settings, tier);
}

/**
 * Built-in model tier names that are always treated as tier references.
 *
 * Agents declare one of these names (e.g. `model: cheap`) in frontmatter to
 * reference a configured tier rather than a concrete model id. When such a
 * reference cannot be resolved at launch time the run is halted with a clear
 * error instead of silently passing the literal tier name to Pi.
 *
 * Also reused by the settings overlay as the fallback tier list shown when no
 * tiers are configured, keeping a single source of truth for tier names.
 */
export const RESERVED_MODEL_TIERS: readonly string[] = ["cheap", "balanced", "max", "reasoning"];

const RESERVED_TIER_SET: ReadonlySet<string> = new Set(RESERVED_MODEL_TIERS);

/**
 * Effective model resolution result.
 *
 * - `model` plus optional `thinking` when a concrete model was resolved.
 * - `unresolvedTier` when the agent referenced a tier that has no usable
 *   configuration. Callers must halt the launch rather than fall back to the
 *   literal tier name.
 */
export interface ResolvedEffectiveModel {
	model?: string;
	thinking?: ThinkingLevel;
	unresolvedTier?: string;
}

/**
 * Determine whether an agent model value is an unambiguous tier reference.
 *
 * A value is a tier reference when it names a reserved built-in tier or a key
 * that is present in the configured `modelTiers` map. Configured keys are
 * included so malformed custom tiers (e.g. an empty `model`) are caught too.
 *
 * @param agentModel Agent frontmatter `model` value.
 * @param config Extension config containing optional `superagents.modelTiers`.
 * @returns True when the value must resolve through tier configuration.
 */
function isTierReference(agentModel: string | undefined, config: ExtensionConfig): boolean {
	if (!agentModel) return false;
	if (RESERVED_TIER_SET.has(agentModel)) return true;
	return Object.hasOwn(config.superagents?.modelTiers ?? {}, agentModel);
}

/**
 * Resolve the effective model for a child launch, refusing to emit a literal tier name.
 *
 * Inputs/outputs:
 * - accepts the agent frontmatter `model`, an optional runtime override, and config
 * - returns `{ model, thinking }` for a concrete or resolved-tier model
 * - returns `{ unresolvedTier }` when the agent references a tier with no usable config
 *
 * Invariants:
 * - a runtime `modelOverride` always wins and is returned as-is
 * - non-tier concrete model ids pass through unchanged (no warning, no halt)
 * - the literal tier name is never returned as `model`; an unresolved reference
 *   surfaces as `unresolvedTier` so callers can halt with a clear error
 *
 * Failure modes:
 * - reserved or configured tier names with missing/empty configuration resolve
 *   to `{ unresolvedTier }` instead of silently falling back to the tier name
 */
export function resolveEffectiveModel(input: { agentModel?: string; modelOverride?: string; config: ExtensionConfig }): ResolvedEffectiveModel {
	if (input.modelOverride !== undefined) return { model: input.modelOverride };
	const tierModel = resolveModelForAgent({ workflow: "superpowers", agentModel: input.agentModel, config: input.config });
	if (tierModel) return { model: tierModel.model, thinking: tierModel.thinking };
	if (isTierReference(input.agentModel, input.config)) return { unresolvedTier: input.agentModel };
	return input.agentModel !== undefined ? { model: input.agentModel } : {};
}

/**
 * Merge agent skills and step overrides for a given execution role.
 *
 * Throws when a merged skill is unavailable or when a non-root role
 * receives a root-only workflow skill.
 */
export function resolveRoleSkillSet(input: {
	workflow: WorkflowMode;
	role: ExecutionRole;
	config: ExtensionConfig;
	agentSkills: string[];
	stepSkills: string[];
	availableSkills: ReadonlySet<string>;
	rootOnlySkills?: ReadonlySet<string>;
}): string[] {
	if (input.workflow !== "superpowers") {
		return [...new Set([...input.agentSkills, ...input.stepSkills])];
	}

	const rootOnly = input.rootOnlySkills ?? new Set();
	const merged = [...new Set([...input.agentSkills, ...input.stepSkills])];
	for (const skill of merged) {
		if (!input.availableSkills.has(skill)) {
			throw new Error(`Unknown skill: ${skill}`);
		}
		if (input.role !== "root-planning" && rootOnly.has(skill)) {
			throw new Error(`Role ${input.role} cannot receive root-only workflow skill '${skill}'`);
		}
	}
	return merged;
}

/**
 * Resolve the effective tool allowlist for a Superpowers execution role.
 *
 * Inputs/outputs:
 * - accepts the active workflow, inferred role, agent-declared tools, and optional global config tools
 * - returns the unchanged-plus-global tool list for default/root runs, or a bounded-plus-global list for `sp-*` roles
 *
 * Invariants:
 * - bounded Superpowers roles never receive delegation tools
 * - root-planning keeps orchestration access
 * - configured global tools are appended after role policy and de-duplicated
 * - when a bounded agent declares no tools, falls back to READ_ONLY_TOOLS plus CHILD_LIFECYCLE_TOOLS
 *
 * Failure modes:
 * - none; missing tool declarations fall back to a safe read-only baseline with lifecycle tools
 */
export function resolveRoleTools(input: { workflow: WorkflowMode; role: ExecutionRole; agentTools?: string[]; configTools?: string[] }): string[] | undefined {
	const appendTools = (baseTools: string[] | undefined, extraTools: string[] | undefined): string[] | undefined => {
		const merged = [...(baseTools ?? []), ...(extraTools ?? [])];
		return merged.length > 0 ? [...new Set(merged)] : undefined;
	};

	if (input.workflow !== "superpowers" || input.role === "root-planning") {
		return appendTools(input.agentTools, input.configTools);
	}

	const explicitTools = input.agentTools?.filter((tool) => !DELEGATION_TOOLS.has(tool));
	const boundedConfigTools = input.configTools?.filter((tool) => !DELEGATION_TOOLS.has(tool));
	if (explicitTools && explicitTools.length > 0) return appendTools(explicitTools, boundedConfigTools);
	// Safe read-only fallback for agents without tool declarations,
	// including child lifecycle tools for bounded roles
	return appendTools([...READ_ONLY_TOOLS, ...CHILD_LIFECYCLE_TOOLS], boundedConfigTools);
}

/**
 * Resolve the effective skill set for the Superpowers implementer role.
 *
 * When `useTestDrivenDevelopment` is true, appends the `test-driven-development` skill
 * if it exists in the available set. Otherwise returns only the merged skill list.
 */
export function resolveImplementerSkillSet(input: {
	workflow: WorkflowMode;
	useTestDrivenDevelopment: boolean;
	config: ExtensionConfig;
	agentSkills: string[];
	stepSkills: string[];
	availableSkills: ReadonlySet<string>;
	rootOnlySkills?: ReadonlySet<string>;
}): string[] {
	const base = resolveRoleSkillSet({
		workflow: input.workflow,
		role: "sp-implementer",
		config: input.config,
		agentSkills: input.agentSkills,
		stepSkills: input.stepSkills,
		availableSkills: input.availableSkills,
		rootOnlySkills: input.rootOnlySkills,
	});
	if (input.workflow !== "superpowers" || !input.useTestDrivenDevelopment) return base;
	if (!input.availableSkills.has("test-driven-development")) return base;
	return [...new Set([...base, "test-driven-development"])];
}
