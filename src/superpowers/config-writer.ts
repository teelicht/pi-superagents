/**
 * Safe text updates for Superpowers JSON config files.
 *
 * Responsibilities:
 * - parse user config text as JSON
 * - update only the Superpowers settings object
 * - serialize stable two-space JSON for TUI-initiated edits
 *
 * Important side effects:
 * - none; callers perform filesystem writes
 */

import type { ExtensionConfig, ModelTierSetting } from "../shared/types.ts";

type MutableConfig = ExtensionConfig & {
	superagents?: NonNullable<ExtensionConfig["superagents"]>;
};

/**
 * Keys that represent command behavior flags (not metadata).
 */
const BEHAVIOR_FLAG_KEYS = ["usePlannotator", "useSubagents", "useTestDrivenDevelopment", "useBranches"] as const;
type BehaviorFlagKey = (typeof BEHAVIOR_FLAG_KEYS)[number];

/**
 * Ensure a mutable Superpowers settings object exists.
 *
 * @param config - Mutable config object to ensure superagents on.
 * @returns The superagents settings object (new or existing).
 */
function ensureSuperagents(config: MutableConfig): NonNullable<ExtensionConfig["superagents"]> {
	config.superagents ??= {};
	return config.superagents;
}

/**
 * Extract only the behavior flags from a command preset, excluding metadata fields.
 *
 * @param command - Existing command preset (may include metadata).
 * @returns Behavior-only command object with only the valid behavior flags.
 */
function extractBehaviorFlags(command: unknown): Record<string, unknown> {
	const source = command && typeof command === "object" && !Array.isArray(command) ? (command as Record<string, unknown>) : {};
	const result: Record<string, unknown> = {};
	for (const key of BEHAVIOR_FLAG_KEYS) {
		if (key in source) {
			result[key] = source[key];
		}
	}
	if ("worktrees" in source && source.worktrees && typeof source.worktrees === "object" && !Array.isArray(source.worktrees)) {
		result.worktrees = { ...(source.worktrees as Record<string, unknown>) };
	}
	return result;
}

/**
 * Parse, update, and serialize Superpowers config text.
 *
 * @param rawText - Current file contents (may be empty or malformed).
 * @param update - Mutator that receives the parsed config and returns it modified.
 * @returns JSON string with trailing newline suitable for writing back to disk.
 * @throws Error if rawText is not valid JSON or is not a JSON object.
 */
export function updateSuperpowersConfigText(rawText: string, update: (config: MutableConfig) => MutableConfig): string {
	let parsed: unknown;
	try {
		parsed = rawText.trim() ? JSON.parse(rawText) : {};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Superpowers config is not valid JSON: ${message}`);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("Superpowers config must be a JSON object.");
	}
	const updated = update(parsed as MutableConfig);
	return `${JSON.stringify(updated, null, 2)}\n`;
}

/**
 * Toggle one boolean Superpowers setting in a command preset.
 *
 * Legacy two-argument calls still target `sp-implement` for compatibility. New
 * callers should pass an explicit command name so settings edits are scoped to
 * the selected command preset.
 *
 * Writes only behavior flags to the command block. Never writes description,
 * entrySkill, or skillOverlays.
 *
 * @param config - Mutable config object to modify in place.
 * @param commandNameOrKey - Command preset name, or legacy boolean setting key.
 * @param maybeKey - Boolean setting key to toggle when commandNameOrKey is a command name.
 * @returns The same config reference, modified.
 */
export function toggleSuperpowersBoolean(config: MutableConfig, key: "useSubagents" | "useTestDrivenDevelopment" | "usePlannotator"): MutableConfig;
export function toggleSuperpowersBoolean(config: MutableConfig, commandName: string, key: "useSubagents" | "useTestDrivenDevelopment" | "usePlannotator"): MutableConfig;
export function toggleSuperpowersBoolean(
	config: MutableConfig,
	commandNameOrKey: string,
	maybeKey?: "useSubagents" | "useTestDrivenDevelopment" | "usePlannotator",
): MutableConfig {
	const commandName = maybeKey ? commandNameOrKey : "sp-implement";
	const key = maybeKey ?? (commandNameOrKey as "useSubagents" | "useTestDrivenDevelopment" | "usePlannotator");
	const settings = ensureSuperagents(config);
	settings.commands ??= {};
	const existingCommand = settings.commands[commandName] ?? {};
	const behaviorOnly = extractBehaviorFlags(existingCommand);
	behaviorOnly[key] = !(behaviorOnly[key] ?? true);
	settings.commands[commandName] = behaviorOnly;
	return config;
}

/**
 * Toggle Superpowers worktree isolation in a command preset.
 *
 * Legacy one-argument calls still target `sp-implement` for compatibility. New
 * callers should pass an explicit command name so settings edits are scoped to
 * the selected command preset.
 *
 * Writes only behavior flags to the command block. Never writes description,
 * entrySkill, or skillOverlays.
 *
 * @param config - Mutable config object to modify in place.
 * @param commandName - Command preset name to update. Defaults to `sp-implement`.
 * @returns The same config reference, modified.
 */
export function toggleSuperpowersWorktrees(config: MutableConfig, commandName = "sp-implement"): MutableConfig {
	const settings = ensureSuperagents(config);
	settings.commands ??= {};
	const existingCommand = settings.commands[commandName] ?? {};
	const behaviorOnly = extractBehaviorFlags(existingCommand);
	behaviorOnly.worktrees ??= {};
	behaviorOnly.worktrees = { ...(behaviorOnly.worktrees as Record<string, unknown>) };
	(behaviorOnly.worktrees as Record<string, unknown>).enabled = !((behaviorOnly.worktrees as Record<string, unknown>).enabled ?? false);
	settings.commands[commandName] = behaviorOnly;
	return config;
}

/**
 * Ensure a mutable modelTiers object exists.
 *
 * @param config - Mutable config object to ensure modelTiers on.
 * @returns The modelTiers object (new or existing).
 */
function ensureModelTiers(config: MutableConfig): Record<string, ModelTierSetting> {
	const settings = ensureSuperagents(config);
	settings.modelTiers ??= {};
	return settings.modelTiers;
}

/**
 * Set the model for a model tier in a config object.
 *
 * This function updates the model for a named tier while preserving any existing
 * thinking level setting. If the tier does not exist, it is created. If the tier
 * exists as a string (legacy shorthand), it is converted to object form.
 *
 * @param config - Mutable config object to modify in place.
 * @param tierName - Name of the model tier (e.g., "fast", "balanced").
 * @param model - Model identifier to set for this tier.
 * @returns The same config reference, modified.
 * @throws Error if tierName or model is empty.
 */
export function setSuperpowersModelTierModel(config: MutableConfig, tierName: string, model: string): MutableConfig {
	const normalizedTierName = tierName.trim();
	const normalizedModel = model.trim();
	if (!normalizedTierName) throw new Error("Model tier name must be non-empty.");
	if (!normalizedModel) throw new Error("Model tier model must be non-empty.");

	const modelTiers = ensureModelTiers(config);
	const existing = modelTiers[normalizedTierName];
	if (existing && typeof existing === "object" && !Array.isArray(existing)) {
		modelTiers[normalizedTierName] = { ...existing, model: normalizedModel };
		return config;
	}

	modelTiers[normalizedTierName] = { model: normalizedModel };
	return config;
}
