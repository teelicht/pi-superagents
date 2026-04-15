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

import type { ExtensionConfig } from "../shared/types.ts";

type MutableConfig = ExtensionConfig & {
	superagents?: NonNullable<ExtensionConfig["superagents"]>;
};

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
 * Parse, update, and serialize Superpowers config text.
 *
 * @param rawText - Current file contents (may be empty or malformed).
 * @param update - Mutator that receives the parsed config and returns it modified.
 * @returns JSON string with trailing newline suitable for writing back to disk.
 * @throws Error if rawText is not valid JSON or is not a JSON object.
 */
export function updateSuperpowersConfigText(
	rawText: string,
	update: (config: MutableConfig) => MutableConfig,
): string {
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
 * Toggle one boolean Superpowers setting in a config object.
 *
 * Settings are toggled inside the `sp-implement` command preset.
 *
 * @param config - Mutable config object to modify in place.
 * @param key - Boolean setting key to toggle.
 * @returns The same config reference, modified.
 */
export function toggleSuperpowersBoolean(
	config: MutableConfig,
	key: "useSubagents" | "useTestDrivenDevelopment" | "usePlannotator",
): MutableConfig {
	const settings = ensureSuperagents(config);
	settings.commands ??= {};
	settings.commands["sp-implement"] ??= {};
	settings.commands["sp-implement"][key] = !(settings.commands["sp-implement"][key] ?? true);
	return config;
}

/**
 * Toggle Superpowers worktree isolation in a config object.
 *
 * Settings are toggled inside the `sp-implement` command preset.
 *
 * @param config - Mutable config object to modify in place.
 * @returns The same config reference, modified.
 */
export function toggleSuperpowersWorktrees(config: MutableConfig): MutableConfig {
	const settings = ensureSuperagents(config);
	settings.commands ??= {};
	settings.commands["sp-implement"] ??= {};
	settings.commands["sp-implement"].worktrees ??= {};
	settings.commands["sp-implement"].worktrees.enabled = !(settings.commands["sp-implement"].worktrees.enabled ?? false);
	return config;
}