/**
 * Extension config validation and merge helpers.
 *
 * Responsibilities:
 * - validate user-authored config overrides before runtime use
 * - merge validated overrides over bundled defaults without losing nested defaults
 * - format diagnostics for Pi startup notifications and tool results
 * - warn when command behavior blocks reference non-existent entrypoint agents
 *
 * Important side effects:
 * - none; this module is pure and safe to use from tests and extension startup
 */

import { isThinkingLevel } from "../shared/thinking-levels.ts";
import type { ConfigDiagnostic, ExtensionConfig, ModelTierSetting, SuperpowersCommandPreset } from "../shared/types.ts";

export interface ConfigValidationOptions {
	/** Interactive entrypoint command names discovered at startup. Commands in config but not in this list produce warnings. */
	entrypointCommands?: readonly string[];
}

export interface ConfigValidationResult {
	blocked: boolean;
	diagnostics: ConfigDiagnostic[];
}

export interface EffectiveConfigResult extends ConfigValidationResult {
	config: ExtensionConfig;
}

export interface FormatConfigDiagnosticsOptions {
	configPath: string;
	examplePath: string;
}

const TOP_LEVEL_KEYS = new Set(["superagents"]);

const SUPERAGENTS_KEYS = new Set(["commands", "modelTiers", "interceptSkillCommands", "extensions", "tools", "superpowersSkills"]);

/** Skills that can be intercepted for direct skill command interception. */
const SUPPORTED_INTERCEPTED_SKILLS = new Set(["brainstorming", "writing-plans"]);

const COMMAND_PRESET_KEYS = new Set(["useBranches", "useSubagents", "useTestDrivenDevelopment", "usePlannotator", "worktrees"]);

const COMMAND_NAME_PATTERN = /^(?:superpowers-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|sp-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)$/;

const WORKTREE_KEYS = new Set(["enabled", "root"]);

const MODEL_TIER_KEYS = new Set(["model", "thinking"]);

/** Removed top-level config keys with migration guidance. */
const REMOVED_GENERIC_KEYS: Record<string, { code: string; message: string }> = {
	asyncByDefault: {
		code: "removed_key",
		message: "has been removed. Use superagents.useSubagents instead.",
	},
	defaultSessionDir: {
		code: "removed_key",
		message: "has been removed.",
	},
	maxSubagentDepth: {
		code: "removed_key",
		message: "has been removed.",
	},
};

/** Removed superagents keys with migration guidance. */
const REMOVED_SUPERAGENTS_KEYS: Record<string, { code: string; message: string }> = {
	defaultImplementerMode: {
		code: "removed_key",
		message: "has been removed. Use superagents.useTestDrivenDevelopment instead.",
	},
	skillOverlays: {
		code: "removed_key",
		message: "was removed. Superpowers now selects relevant skills through using-superpowers; entrypoint overlays are not supported.",
	},
};

/** Removed command preset keys with migration guidance. */
const REMOVED_COMMAND_PRESET_KEYS: Record<string, { code: string; message: string }> = {
	description: {
		code: "removed_key",
		message: "was moved to entrypoint agent frontmatter. Add or edit an agents/*.md entrypoint instead.",
	},
	entrySkill: {
		code: "removed_key",
		message: "was moved to entrypoint agent frontmatter. Add or edit an agents/*.md entrypoint instead.",
	},
};

/**
 * Determine whether a value is a non-array object.
 *
 * @param value Unknown value to inspect.
 * @returns True when the value is a record object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Add one diagnostic to the mutable diagnostics list.
 *
 * @param diagnostics Mutable diagnostic accumulator.
 * @param path Dot-separated config path.
 * @param message User-facing diagnostic message.
 * @param code Stable diagnostic code.
 */
function pushConfigIssue(diagnostics: ConfigDiagnostic[], path: string, message: string, code = "invalid_value"): void {
	diagnostics.push({ level: "error", code, path, message });
}

/**
 * Determine whether two JSON-compatible values are structurally equal.
 *
 * @param left First value.
 * @param right Second value.
 * @returns True when their JSON representation matches.
 */
function jsonEqual(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Validate an optional string-or-null path setting.
 *
 * @param diagnostics Mutable diagnostic accumulator.
 * @param config Config object containing the key.
 * @param key Key to validate.
 * @param path Dot-separated config path.
 */
function validateOptionalStringOrNull(diagnostics: ConfigDiagnostic[], config: Record<string, unknown>, key: string, path: string): void {
	if (!(key in config)) return;
	const value = config[key];
	if (value !== null && typeof value !== "string") {
		pushConfigIssue(diagnostics, path, "must be a string or null.");
		return;
	}
	if (typeof value === "string" && !value.trim()) {
		pushConfigIssue(diagnostics, path, "must be a non-empty string or null.");
	}
}

/**
 * Validate one model tier setting.
 *
 * @param diagnostics Mutable diagnostic accumulator.
 * @param value Unknown model tier value.
 * @param path Dot-separated config path.
 */
function validateModelTier(diagnostics: ConfigDiagnostic[], value: unknown, path: string): void {
	if (typeof value === "string") {
		if (!value.trim()) pushConfigIssue(diagnostics, path, "must not be an empty string.");
		return;
	}
	if (!isRecord(value)) {
		pushConfigIssue(diagnostics, path, "must be a model string or an object with a model field.");
		return;
	}
	for (const key of Object.keys(value)) {
		if (!MODEL_TIER_KEYS.has(key)) pushConfigIssue(diagnostics, `${path}.${key}`, "is not a supported config key.", "unknown_key");
	}
	if (typeof value.model !== "string" || !value.model.trim()) {
		pushConfigIssue(diagnostics, `${path}.model`, "must be a non-empty string.");
	}
	if ("thinking" in value && !isThinkingLevel(value.thinking as string | undefined)) {
		pushConfigIssue(diagnostics, `${path}.thinking`, "must be one of off, minimal, low, medium, high, xhigh.");
	}
}

/**
 * Validate a single superpowers command preset.
 *
 * @param diagnostics Mutable diagnostic accumulator.
 * @param value Unknown preset value.
 * @param path Dot-separated config path for the preset.
 */
function validateCommandPreset(diagnostics: ConfigDiagnostic[], value: unknown, path: string): void {
	if (!isRecord(value)) {
		pushConfigIssue(diagnostics, path, "must be an object.");
		return;
	}
	for (const key of Object.keys(value)) {
		if (key in REMOVED_COMMAND_PRESET_KEYS) {
			const { code, message } = REMOVED_COMMAND_PRESET_KEYS[key];
			pushConfigIssue(diagnostics, `${path}.${key}`, message, code);
		} else if (!COMMAND_PRESET_KEYS.has(key)) {
			pushConfigIssue(diagnostics, `${path}.${key}`, "is not a supported command behavior key.", "unknown_key");
		}
	}
	if ("useBranches" in value && typeof value.useBranches !== "boolean") {
		pushConfigIssue(diagnostics, `${path}.useBranches`, "must be a boolean.");
	}
	if ("useSubagents" in value && typeof value.useSubagents !== "boolean") {
		pushConfigIssue(diagnostics, `${path}.useSubagents`, "must be a boolean.");
	}
	if ("useTestDrivenDevelopment" in value && typeof value.useTestDrivenDevelopment !== "boolean") {
		pushConfigIssue(diagnostics, `${path}.useTestDrivenDevelopment`, "must be a boolean.");
	}
	if ("usePlannotator" in value && typeof value.usePlannotator !== "boolean") {
		pushConfigIssue(diagnostics, `${path}.usePlannotator`, "must be a boolean.");
	}
	if ("worktrees" in value && !isRecord(value.worktrees)) {
		pushConfigIssue(diagnostics, `${path}.worktrees`, "must be an object.");
	} else if ("worktrees" in value && isRecord(value.worktrees)) {
		const worktreeKeys = Object.keys(value.worktrees);
		for (const wtKey of worktreeKeys) {
			if (!WORKTREE_KEYS.has(wtKey)) {
				pushConfigIssue(diagnostics, `${path}.worktrees.${wtKey}`, "is not a supported config key.", "unknown_key");
			}
		}
		if ("enabled" in value.worktrees && typeof value.worktrees.enabled !== "boolean") {
			pushConfigIssue(diagnostics, `${path}.worktrees.enabled`, "must be a boolean.");
		}
		validateOptionalStringOrNull(diagnostics, value.worktrees, "root", `${path}.worktrees.root`);
	}
}

/**
 * Validate an array whose entries must all be non-empty strings.
 *
 * @param diagnostics Mutable diagnostic accumulator.
 * @param value Unknown array value.
 * @param path Dot-separated path for diagnostics.
 * @param label Human-readable value label used in diagnostics.
 */
function validateNonEmptyStringArray(diagnostics: ConfigDiagnostic[], value: unknown, path: string, label: string): void {
	if (!Array.isArray(value)) {
		pushConfigIssue(diagnostics, path, `must be an array of non-empty ${label}.`);
		return;
	}
	value.forEach((entry, index) => {
		if (typeof entry !== "string" || !entry.trim()) {
			pushConfigIssue(diagnostics, `${path}[${index}]`, `must be a non-empty ${label}.`);
		}
	});
}

/**
 * Validate opted-in direct skill command interception.
 *
 * @param diagnostics Mutable diagnostic accumulator.
 * @param value Unknown interception list value.
 */
function validateInterceptSkillCommands(diagnostics: ConfigDiagnostic[], value: unknown): void {
	if (!Array.isArray(value)) {
		pushConfigIssue(diagnostics, "superagents.interceptSkillCommands", "must be an array of supported skill names.");
		return;
	}
	value.forEach((entry, index) => {
		if (typeof entry !== "string" || !entry.trim()) {
			pushConfigIssue(diagnostics, `superagents.interceptSkillCommands[${index}]`, "must be a non-empty skill name.");
			return;
		}
		if (!SUPPORTED_INTERCEPTED_SKILLS.has(entry)) {
			pushConfigIssue(diagnostics, `superagents.interceptSkillCommands[${index}]`, "must be one of: brainstorming, writing-plans.");
		}
	});
}

// ---------------------------------------------------------------------------
// Group-level validators extracted from validateConfigObject
// ---------------------------------------------------------------------------

/**
 * Validate top-level config object keys.
 *
 * @param diagnostics Mutable diagnostic accumulator.
 * @param rawConfig Parsed user config value.
 */
function validateTopLevelObject(diagnostics: ConfigDiagnostic[], rawConfig: Record<string, unknown>): void {
	for (const key of Object.keys(rawConfig)) {
		if (key in REMOVED_GENERIC_KEYS) {
			const { code, message } = REMOVED_GENERIC_KEYS[key];
			pushConfigIssue(diagnostics, key, message, code);
		} else if (!TOP_LEVEL_KEYS.has(key)) {
			pushConfigIssue(diagnostics, key, "is not a supported config key.", "unknown_key");
		}
	}
}

/**
 * Validate the superagents.commands section.
 *
 * @param diagnostics Mutable diagnostic accumulator.
 * @param commands Raw commands value.
 * @param options Validation options including discovered entrypoint command names.
 */
function validateCommandsSection(diagnostics: ConfigDiagnostic[], commands: unknown, options: ConfigValidationOptions): void {
	if (!isRecord(commands)) {
		pushConfigIssue(diagnostics, "superagents.commands", "must be an object.");
		return;
	}
	const entrypointCommandSet = options.entrypointCommands ? new Set(options.entrypointCommands) : undefined;
	for (const [commandName, commandValue] of Object.entries(commands)) {
		if (!COMMAND_NAME_PATTERN.test(commandName)) {
			pushConfigIssue(diagnostics, `superagents.commands.${commandName}`, "must match superpowers-<name> or sp-<name> (lowercase alphanumeric and hyphens).");
		}
		validateCommandPreset(diagnostics, commandValue, `superagents.commands.${commandName}`);
		// Warn for commands that have no matching entrypoint agent
		if (entrypointCommandSet && !entrypointCommandSet.has(commandName)) {
			diagnostics.push({
				level: "warning",
				code: "unknown_entrypoint_command",
				path: `superagents.commands.${commandName}`,
				message: "does not match any discovered interactive entrypoint agent command. Add an entrypoint agent markdown file or remove this behavior block.",
			});
		}
	}
}

/**
 * Validate the superagents.modelTiers section.
 *
 * @param diagnostics Mutable diagnostic accumulator.
 * @param modelTiers Raw model tiers value.
 */
function validateModelTiersSection(diagnostics: ConfigDiagnostic[], modelTiers: unknown): void {
	if (!isRecord(modelTiers)) {
		pushConfigIssue(diagnostics, "superagents.modelTiers", "must be an object.");
		return;
	}
	for (const [tierName, tierValue] of Object.entries(modelTiers)) {
		validateModelTier(diagnostics, tierValue, `superagents.modelTiers.${tierName}`);
	}
}

/**
 * Validate the superagents.extensions section.
 *
 * @param diagnostics Mutable diagnostic accumulator.
 * @param extensions Raw extensions value.
 */
function validateExtensionsSection(diagnostics: ConfigDiagnostic[], extensions: unknown): void {
	validateNonEmptyStringArray(diagnostics, extensions, "superagents.extensions", "extension path");
}

/**
 * Validate the superagents.tools section.
 *
 * @param diagnostics Mutable diagnostic accumulator.
 * @param tools Raw tools value.
 */
function validateToolsSection(diagnostics: ConfigDiagnostic[], tools: unknown): void {
	validateNonEmptyStringArray(diagnostics, tools, "superagents.tools", "tool name or path");
}

/**
 * Validate the superagents section.
 *
 * @param diagnostics Mutable diagnostic accumulator.
 * @param superagents Raw superagents value.
 * @param options Validation options including discovered entrypoint command names.
 */
function validateSuperagentsSection(diagnostics: ConfigDiagnostic[], superagents: unknown, options: ConfigValidationOptions): void {
	if (!isRecord(superagents)) {
		pushConfigIssue(diagnostics, "superagents", "must be an object.");
		return;
	}
	for (const key of Object.keys(superagents)) {
		if (key in REMOVED_SUPERAGENTS_KEYS) {
			const { code, message } = REMOVED_SUPERAGENTS_KEYS[key];
			pushConfigIssue(diagnostics, `superagents.${key}`, message, code);
		} else if (!SUPERAGENTS_KEYS.has(key)) {
			pushConfigIssue(diagnostics, `superagents.${key}`, "is not a supported config key.", "unknown_key");
		}
	}

	if ("commands" in superagents) {
		validateCommandsSection(diagnostics, superagents.commands, options);
	}
	if ("modelTiers" in superagents) {
		validateModelTiersSection(diagnostics, superagents.modelTiers);
	}
	if ("interceptSkillCommands" in superagents) {
		validateInterceptSkillCommands(diagnostics, superagents.interceptSkillCommands);
	}
	if ("extensions" in superagents) {
		validateExtensionsSection(diagnostics, superagents.extensions);
	}
	if ("tools" in superagents) {
		validateToolsSection(diagnostics, superagents.tools);
	}
	if ("superpowersSkills" in superagents) {
		diagnostics.push({
			level: "warning",
			code: "defaults_only_key",
			path: "superagents.superpowersSkills",
			message: "is not user-configurable. It is defined in the bundled defaults and cannot be overridden.",
		});
	}
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate user-authored config shape and values.
 *
 * @param rawConfig Parsed user config value.
 * @param options Validation options including discovered entrypoint command names.
 * @returns Validation diagnostics plus a blocked flag.
 */
export function validateConfigObject(rawConfig: unknown, options: ConfigValidationOptions = {}): ConfigValidationResult {
	const diagnostics: ConfigDiagnostic[] = [];
	if (!isRecord(rawConfig)) {
		pushConfigIssue(diagnostics, "$", "must be a JSON object.");
		return { blocked: true, diagnostics };
	}

	validateTopLevelObject(diagnostics, rawConfig);

	if ("superagents" in rawConfig) {
		validateSuperagentsSection(diagnostics, rawConfig.superagents, options);
	}

	return { blocked: diagnostics.some((diagnostic) => diagnostic.level === "error"), diagnostics };
}

/**
 * Merge one model tier map while preserving existing tiers.
 *
 * @param defaults Bundled default model tiers.
 * @param overrides User-authored model tier overrides.
 * @returns Merged model tier map.
 */
function mergeModelTiers(
	defaults: Record<string, ModelTierSetting> | undefined,
	overrides: Record<string, ModelTierSetting> | undefined,
): Record<string, ModelTierSetting> | undefined {
	if (!defaults && !overrides) return undefined;
	return {
		...(defaults ?? {}),
		...(overrides ?? {}),
	};
}

/**
 * Deep-merge one command preset, preserving nested worktrees defaults.
 *
 * @param defaultPreset Default preset for this command name.
 * @param preset Override preset for this command name.
 * @returns Deep-merged preset with worktrees inner-merged.
 */
function mergeCommandPreset(defaultPreset: SuperpowersCommandPreset, preset: SuperpowersCommandPreset): SuperpowersCommandPreset {
	const defaultWorktrees = defaultPreset.worktrees;
	const overrideWorktrees = preset.worktrees;
	const worktreesMerged = defaultWorktrees || overrideWorktrees ? { ...(defaultWorktrees ?? {}), ...(overrideWorktrees ?? {}) } : undefined;
	const mergedPreset = { ...defaultPreset, ...preset };
	if (worktreesMerged !== undefined) {
		mergedPreset.worktrees = worktreesMerged;
	}
	return mergedPreset;
}

/**
 * Merge user config over bundled defaults.
 *
 * @param defaults Bundled defaults.
 * @param overrides Validated user overrides.
 * @returns Effective runtime config.
 */
function mergeConfig(defaults: ExtensionConfig, overrides: ExtensionConfig): ExtensionConfig {
	const defaultSuperagents = defaults.superagents;
	const overrideSuperagents = overrides.superagents;

	// Replace-not-merge for interceptSkillCommands
	const mergedInterceptSkillCommands = overrideSuperagents?.interceptSkillCommands ?? defaultSuperagents?.interceptSkillCommands ?? [];

	// Replace-not-merge for globally allowlisted child Pi extensions.
	const mergedExtensions = overrideSuperagents?.extensions ?? defaultSuperagents?.extensions ?? [];

	// Replace-not-merge for global child Pi tools.
	const mergedTools = overrideSuperagents?.tools ?? defaultSuperagents?.tools ?? [];

	const mergedSuperagents =
		defaultSuperagents || overrideSuperagents
			? {
					...(defaultSuperagents ?? {}),
					...(overrideSuperagents ?? {}),
					// Deep merge command presets, with worktrees nested-merged
					commands: {
						...(defaultSuperagents?.commands ?? {}),
						...Object.fromEntries(
							Object.entries(overrideSuperagents?.commands ?? {}).map(([name, preset]) => [name, mergeCommandPreset(defaultSuperagents?.commands?.[name] ?? {}, preset)]),
						),
					},
					modelTiers: mergeModelTiers(defaultSuperagents?.modelTiers, overrideSuperagents?.modelTiers),
					interceptSkillCommands: mergedInterceptSkillCommands,
					extensions: mergedExtensions,
					tools: mergedTools,
					superpowersSkills: defaultSuperagents?.superpowersSkills ?? [],
				}
			: undefined;

	return {
		...defaults,
		...overrides,
		...(mergedSuperagents ? { superagents: mergedSuperagents } : {}),
	};
}

/**
 * Validate user overrides and produce an effective config when possible.
 *
 * @param defaults Bundled default config.
 * @param userConfig Parsed user override config, if present.
 * @param options Validation options including discovered entrypoint command names.
 * @returns Effective config plus diagnostics.
 */
export function loadEffectiveConfig(defaults: ExtensionConfig, userConfig: unknown, options: ConfigValidationOptions = {}): EffectiveConfigResult {
	if (userConfig === undefined) {
		return { blocked: false, diagnostics: [], config: defaults };
	}
	const validation = validateConfigObject(userConfig, options);
	if (validation.blocked) {
		return { ...validation, config: defaults };
	}
	const migrationDiagnostics: ConfigDiagnostic[] = jsonEqual(defaults, userConfig)
		? [
				{
					level: "warning",
					code: "legacy_full_copy",
					path: "$",
					message: "appears to duplicate the bundled defaults. Replace it with {} and keep only local overrides.",
					action: "replace_with_empty_override",
				},
			]
		: [];
	return {
		blocked: false,
		diagnostics: [...validation.diagnostics, ...migrationDiagnostics],
		config: mergeConfig(defaults, userConfig as ExtensionConfig),
	};
}

/**
 * Format diagnostics into a concise user-facing message.
 *
 * @param diagnostics Diagnostics to display.
 * @param options Config and example paths for repair guidance.
 * @returns Multi-line notification text.
 */
export function formatConfigDiagnostics(diagnostics: ConfigDiagnostic[], options: FormatConfigDiagnosticsOptions): string {
	const headline = diagnostics.some((diagnostic) => diagnostic.level === "error")
		? "pi-superagents is disabled because config.json needs attention."
		: "pi-superagents config.json has warnings.";
	const body = diagnostics.map((diagnostic) => `- ${diagnostic.path}: ${diagnostic.message}`);
	return [headline, `Path: ${options.configPath}`, "", ...body, "", `See ${options.examplePath} for the current config shape.`].join("\n");
}