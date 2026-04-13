/**
 * Extension config validation and merge helpers.
 *
 * Responsibilities:
 * - validate user-authored config overrides before runtime use
 * - merge validated overrides over bundled defaults without losing nested defaults
 * - format diagnostics for Pi startup notifications and tool results
 *
 * Important side effects:
 * - none; this module is pure and safe to use from tests and extension startup
 */

import type {
	ConfigDiagnostic,
	ExtensionConfig,
	ModelTierSetting,
	ThinkingLevel,
} from "../shared/types.ts";

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

const SUPERAGENTS_KEYS = new Set([
	"useBranches",
	"useSubagents",
	"useTestDrivenDevelopment",
	"usePlannotator",
	"commands",
	"worktrees",
	"modelTiers",
	"skillOverlays",
	"interceptSkillCommands",
]);

/** Skills that can be intercepted for direct command interception. */
const SUPPORTED_INTERCEPTED_SKILLS = new Set(["brainstorming"]);

const COMMAND_PRESET_KEYS = new Set(["description", "useBranches", "useSubagents", "useTestDrivenDevelopment", "usePlannotator", "worktrees"]);

const COMMAND_NAME_PATTERN = /^(?:superpowers-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|sp-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)$/;

const WORKTREE_KEYS = new Set(["enabled", "root"]);

const MODEL_TIER_KEYS = new Set(["model", "thinking"]);

const THINKING_LEVELS: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

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
function addError(diagnostics: ConfigDiagnostic[], path: string, message: string, code = "invalid_value"): void {
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
function validateOptionalStringOrNull(
	diagnostics: ConfigDiagnostic[],
	config: Record<string, unknown>,
	key: string,
	path: string,
): void {
	if (!(key in config)) return;
	const value = config[key];
	if (value !== null && typeof value !== "string") {
		addError(diagnostics, path, "must be a string or null.");
		return;
	}
	if (typeof value === "string" && !value.trim()) {
		addError(diagnostics, path, "must be a non-empty string or null.");
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
		if (!value.trim()) addError(diagnostics, path, "must not be an empty string.");
		return;
	}
	if (!isRecord(value)) {
		addError(diagnostics, path, "must be a model string or an object with a model field.");
		return;
	}
	for (const key of Object.keys(value)) {
		if (!MODEL_TIER_KEYS.has(key)) addError(diagnostics, `${path}.${key}`, "is not a supported config key.", "unknown_key");
	}
	if (typeof value.model !== "string" || !value.model.trim()) {
		addError(diagnostics, `${path}.model`, "must be a non-empty string.");
	}
	if ("thinking" in value && !THINKING_LEVELS.includes(value.thinking as ThinkingLevel)) {
		addError(diagnostics, `${path}.thinking`, "must be one of off, minimal, low, medium, high, xhigh.");
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
		addError(diagnostics, path, "must be an object.");
		return;
	}
	for (const key of Object.keys(value)) {
		if (!COMMAND_PRESET_KEYS.has(key)) {
			addError(diagnostics, `${path}.${key}`, "is not a supported config key.", "unknown_key");
		}
	}
	if ("description" in value && typeof value.description !== "string") {
		addError(diagnostics, `${path}.description`, "must be a string.");
	}
	if ("useBranches" in value && typeof value.useBranches !== "boolean") {
		addError(diagnostics, `${path}.useBranches`, "must be a boolean.");
	}
	if ("useSubagents" in value && typeof value.useSubagents !== "boolean") {
		addError(diagnostics, `${path}.useSubagents`, "must be a boolean.");
	}
	if ("useTestDrivenDevelopment" in value && typeof value.useTestDrivenDevelopment !== "boolean") {
		addError(diagnostics, `${path}.useTestDrivenDevelopment`, "must be a boolean.");
	}
	if ("usePlannotator" in value && typeof value.usePlannotator !== "boolean") {
		addError(diagnostics, `${path}.usePlannotator`, "must be a boolean.");
	}
	if ("worktrees" in value && isRecord(value.worktrees)) {
		const worktreeKeys = Object.keys(value.worktrees);
		for (const wtKey of worktreeKeys) {
			if (!WORKTREE_KEYS.has(wtKey)) {
				addError(diagnostics, `${path}.worktrees.${wtKey}`, "is not a supported config key.", "unknown_key");
			}
		}
		if ("enabled" in value.worktrees && typeof value.worktrees.enabled !== "boolean") {
			addError(diagnostics, `${path}.worktrees.enabled`, "must be a boolean.");
		}
		validateOptionalStringOrNull(diagnostics, value.worktrees, "root", `${path}.worktrees.root`);
	}
}

/**
 * Validate a list of skill names.
 *
 * @param diagnostics Mutable diagnostic accumulator.
 * @param value Unknown skill-list value.
 * @param path Dot-separated path for diagnostics.
 */
function validateSkillNameArray(diagnostics: ConfigDiagnostic[], value: unknown, path: string): void {
	if (!Array.isArray(value)) {
		addError(diagnostics, path, "must be an array of non-empty skill names.");
		return;
	}
	value.forEach((entry, index) => {
		if (typeof entry !== "string" || !entry.trim()) {
			addError(diagnostics, `${path}[${index}]`, "must be a non-empty skill name.");
		}
	});
}

/**
 * Validate the root-skill overlay map.
 *
 * @param diagnostics Mutable diagnostic accumulator.
 * @param value Unknown overlay map value.
 */
function validateSkillOverlays(diagnostics: ConfigDiagnostic[], value: unknown): void {
	if (!isRecord(value)) {
		addError(diagnostics, "superagents.skillOverlays", "must be an object mapping skill names to skill-name arrays.");
		return;
	}
	for (const [skillName, overlayNames] of Object.entries(value)) {
		if (!skillName.trim()) {
			addError(diagnostics, "superagents.skillOverlays.", "must use non-empty skill names as keys.");
			continue;
		}
		validateSkillNameArray(diagnostics, overlayNames, `superagents.skillOverlays.${skillName}`);
	}
}

/**
 * Validate opted-in direct skill command interception.
 *
 * @param diagnostics Mutable diagnostic accumulator.
 * @param value Unknown interception list value.
 */
function validateInterceptSkillCommands(diagnostics: ConfigDiagnostic[], value: unknown): void {
	if (!Array.isArray(value)) {
		addError(diagnostics, "superagents.interceptSkillCommands", "must be an array of supported skill names.");
		return;
	}
	value.forEach((entry, index) => {
		if (typeof entry !== "string" || !entry.trim()) {
			addError(diagnostics, `superagents.interceptSkillCommands[${index}]`, "must be a non-empty skill name.");
			return;
		}
		if (!SUPPORTED_INTERCEPTED_SKILLS.has(entry)) {
			addError(
				diagnostics,
				`superagents.interceptSkillCommands[${index}]`,
				"must be one of: brainstorming.",
			);
		}
	});
}

/**
 * Validate user-authored config shape and values.
 *
 * @param rawConfig Parsed user config value.
 * @returns Validation diagnostics plus a blocked flag.
 */
export function validateConfigObject(rawConfig: unknown): ConfigValidationResult {
	const diagnostics: ConfigDiagnostic[] = [];
	if (!isRecord(rawConfig)) {
		addError(diagnostics, "$", "must be a JSON object.");
		return { blocked: true, diagnostics };
	}

	for (const key of Object.keys(rawConfig)) {
		if (key in REMOVED_GENERIC_KEYS) {
			const { code, message } = REMOVED_GENERIC_KEYS[key];
			addError(diagnostics, key, message, code);
		} else if (!TOP_LEVEL_KEYS.has(key)) {
			addError(diagnostics, key, "is not a supported config key.", "unknown_key");
		}
	}

	if ("superagents" in rawConfig) {
		const superagents = rawConfig.superagents;
		if (!isRecord(superagents)) {
			addError(diagnostics, "superagents", "must be an object.");
		} else {
			for (const key of Object.keys(superagents)) {
				if (key in REMOVED_SUPERAGENTS_KEYS) {
					const { code, message } = REMOVED_SUPERAGENTS_KEYS[key];
					addError(diagnostics, `superagents.${key}`, message, code);
				} else if (!SUPERAGENTS_KEYS.has(key)) {
					addError(diagnostics, `superagents.${key}`, "is not a supported config key.", "unknown_key");
				}
			}
			if ("useBranches" in superagents && typeof superagents.useBranches !== "boolean") {
				addError(diagnostics, "superagents.useBranches", "must be a boolean.");
			}
			if ("useSubagents" in superagents && typeof superagents.useSubagents !== "boolean") {
				addError(diagnostics, "superagents.useSubagents", "must be a boolean.");
			}
			if ("useTestDrivenDevelopment" in superagents && typeof superagents.useTestDrivenDevelopment !== "boolean") {
				addError(diagnostics, "superagents.useTestDrivenDevelopment", "must be a boolean.");
			}
			if ("usePlannotator" in superagents && typeof superagents.usePlannotator !== "boolean") {
				addError(diagnostics, "superagents.usePlannotator", "must be a boolean.");
			}
			if ("commands" in superagents) {
				const commands = superagents.commands;
				if (!isRecord(commands)) {
					addError(diagnostics, "superagents.commands", "must be an object.");
				} else {
					for (const [commandName, commandValue] of Object.entries(commands)) {
						if (!COMMAND_NAME_PATTERN.test(commandName)) {
							addError(
								diagnostics,
								`superagents.commands.${commandName}`,
								"must match superpowers-<name> or sp-<name> (lowercase alphanumeric and hyphens).",
							);
						}
						validateCommandPreset(diagnostics, commandValue, `superagents.commands.${commandName}`);
					}
				}
			}
			if ("worktrees" in superagents) {
				const worktrees = superagents.worktrees;
				if (!isRecord(worktrees)) {
					addError(diagnostics, "superagents.worktrees", "must be an object.");
				} else {
					for (const key of Object.keys(worktrees)) {
						if (!WORKTREE_KEYS.has(key)) addError(diagnostics, `superagents.worktrees.${key}`, "is not a supported config key.", "unknown_key");
					}
					if ("enabled" in worktrees && typeof worktrees.enabled !== "boolean") {
						addError(diagnostics, "superagents.worktrees.enabled", "must be a boolean.");
					}
					validateOptionalStringOrNull(diagnostics, worktrees, "root", "superagents.worktrees.root");
				}
			}
			if ("modelTiers" in superagents) {
				const modelTiers = superagents.modelTiers;
				if (!isRecord(modelTiers)) {
					addError(diagnostics, "superagents.modelTiers", "must be an object.");
				} else {
					for (const [tierName, tierValue] of Object.entries(modelTiers)) {
						validateModelTier(diagnostics, tierValue, `superagents.modelTiers.${tierName}`);
					}
				}
			}
			if ("skillOverlays" in superagents) {
				validateSkillOverlays(diagnostics, superagents.skillOverlays);
			}
			if ("interceptSkillCommands" in superagents) {
				validateInterceptSkillCommands(diagnostics, superagents.interceptSkillCommands);
			}
		}
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
 * Merge user config over bundled defaults.
 *
 * @param defaults Bundled defaults.
 * @param overrides Validated user overrides.
 * @returns Effective runtime config.
 */
export function mergeConfig(defaults: ExtensionConfig, overrides: ExtensionConfig): ExtensionConfig {
	const defaultSuperagents = defaults.superagents;
	const overrideSuperagents = overrides.superagents;

	// Shallow merge for skill overlays (maps over defaults)
	const mergedSkillOverlays: Record<string, string[]> = {
		...(defaultSuperagents?.skillOverlays ?? {}),
		...(overrideSuperagents?.skillOverlays ?? {}),
	};

	// Replace-not-merge for interceptSkillCommands
	const mergedInterceptSkillCommands = (
		overrideSuperagents?.interceptSkillCommands
		?? defaultSuperagents?.interceptSkillCommands
		?? []
	);

	const mergedSuperagents = defaultSuperagents || overrideSuperagents
		? {
			...(defaultSuperagents ?? {}),
			...(overrideSuperagents ?? {}),
			commands: {
				...(defaultSuperagents?.commands ?? {}),
				...(overrideSuperagents?.commands ?? {}),
			},
			worktrees: {
				...(defaultSuperagents?.worktrees ?? {}),
				...(overrideSuperagents?.worktrees ?? {}),
			},
			modelTiers: mergeModelTiers(defaultSuperagents?.modelTiers, overrideSuperagents?.modelTiers),
			skillOverlays: mergedSkillOverlays,
			interceptSkillCommands: mergedInterceptSkillCommands,
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
 * @returns Effective config plus diagnostics.
 */
export function loadEffectiveConfig(defaults: ExtensionConfig, userConfig: unknown): EffectiveConfigResult {
	if (userConfig === undefined) {
		return { blocked: false, diagnostics: [], config: defaults };
	}
	const validation = validateConfigObject(userConfig);
	if (validation.blocked) {
		return { ...validation, config: defaults };
	}
	const migrationDiagnostics: ConfigDiagnostic[] = jsonEqual(defaults, userConfig)
		? [{
			level: "warning",
			code: "legacy_full_copy",
			path: "$",
			message: "appears to duplicate the bundled defaults. Replace it with {} and keep only local overrides.",
			action: "replace_with_empty_override",
		}]
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
export function formatConfigDiagnostics(
	diagnostics: ConfigDiagnostic[],
	options: FormatConfigDiagnosticsOptions,
): string {
	const headline = diagnostics.some((diagnostic) => diagnostic.level === "error")
		? "pi-superagents is disabled because config.json needs attention."
		: "pi-superagents config.json has warnings.";
	const body = diagnostics.map((diagnostic) => `- ${diagnostic.path}: ${diagnostic.message}`);
	return [
		headline,
		`Path: ${options.configPath}`,
		"",
		...body,
		"",
		`See ${options.examplePath} for the current config shape.`,
	].join("\n");
}
