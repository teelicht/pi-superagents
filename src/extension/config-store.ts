/**
 * Runtime configuration store for the pi-superagents extension.
 *
 * Responsibilities:
 * - own extension-level config paths and effective config loading
 * - provide gate diagnostics and in-place gate mutation
 * - export `createRuntimeConfigStore`, `loadRuntimeConfigState`, and `RuntimeConfigStore`
 * - enable live config reload without extension restart
 *
 * Important dependencies:
 * - fs, os, path (node:fs, node:os, node:path)
 * - config-validation.ts (loadEffectiveConfig, formatConfigDiagnostics)
 * - types.ts (ConfigGateState, ExtensionConfig, ConfigDiagnostic)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { formatConfigDiagnostics, loadEffectiveConfig } from "../execution/config-validation.ts";
import type { ConfigDiagnostic, ConfigGateState, ExtensionConfig } from "../shared/types.ts";

/**
 * Runtime config store interface.
 *
 * Provides live access to the effective merged config and gate diagnostics.
 * Supports hot-reload without extension restart.
 */
export interface RuntimeConfigStore {
	/** Returns the current effective merged config. */
	getConfig(): ExtensionConfig;
	/** Returns the current gate state with diagnostics. */
	getGateState(): ConfigGateState;
	/** Reloads config from disk and updates internal state. */
	reloadConfig(): void;
}

/**
 * Interface for loaded config state with diagnostics.
 *
 * Produced by `loadRuntimeConfigState` and convertible to ConfigGateState.
 */
export interface LoadedConfigState {
	/** The effective merged configuration. */
	config: ExtensionConfig;
	/** True when config has validation errors blocking execution. */
	blocked: boolean;
	/** Validation diagnostics for display. */
	diagnostics: ConfigDiagnostic[];
	/** Combined user-facing message for notifications. */
	message: string;
	/** Path to the user config file. */
	configPath: string;
	/** Path to the example config file. */
	examplePath: string;
	/**
	 * Convert to a ConfigGateState object.
	 *
	 * Creates a fresh object with the state data copied in,
	 * ensuring stable object identity independent of the source state.
	 */
	asGateState(): ConfigGateState;
}

/**
 * Build default config paths for the installed extension.
 *
 * Resolves bundled defaults relative to the package directory and user-owned
 * config relative to the config directory:
 * - default-config.json: bundled package defaults
 * - config.json: user-overridden config
 * - config.example.json: user config reference
 *
 * @param packageConfigDir Absolute path to the package directory containing bundled defaults.
 * @param userConfigDir Absolute path to the user config directory. Defaults to `packageConfigDir`.
 * @returns Object with bundled default and user config paths.
 */
export function resolveRuntimeConfigPaths(
	packageConfigDir: string,
	userConfigDir = packageConfigDir,
): {
	bundledDefaultConfigPath: string;
	userConfigPath: string;
	exampleConfigPath: string;
} {
	const bundledDefaultConfigPath = path.join(packageConfigDir, "default-config.json");
	const userConfigPath = path.join(userConfigDir, "config.json");
	const exampleConfigPath = path.join(userConfigDir, "config.example.json");
	return { bundledDefaultConfigPath, userConfigPath, exampleConfigPath };
}

/**
 * Read one JSON config file from disk.
 *
 * @param filePath Absolute path to the JSON file.
 * @returns Parsed JSON value or `undefined` when the file is absent.
 */
export function readJsonConfig(filePath: string): unknown {
	if (!fs.existsSync(filePath)) return undefined;
	return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

/**
 * Load and validate extension config, preserving diagnostics for user display.
 *
 * @param packageConfigDir Absolute path to the package directory containing bundled defaults.
 * @param userConfigDir Absolute path to the user config directory. Defaults to `packageConfigDir`.
 * @param entrypointCommands Discovered interactive entrypoint command names for stale command warnings.
 * @returns Validated config state for runtime registration.
 */
export function loadRuntimeConfigState(
	packageConfigDir: string,
	userConfigDir = packageConfigDir,
	entrypointCommands: readonly string[] = [],
): LoadedConfigState {
	const { bundledDefaultConfigPath, userConfigPath, exampleConfigPath } = resolveRuntimeConfigPaths(packageConfigDir, userConfigDir);

	try {
		const bundledDefaults = (readJsonConfig(bundledDefaultConfigPath) ?? {}) as ExtensionConfig;
		const userConfig = readJsonConfig(userConfigPath);
		const result = loadEffectiveConfig(bundledDefaults, userConfig, { entrypointCommands });
		const message = result.diagnostics.length ? formatConfigDiagnostics(result.diagnostics, { configPath: userConfigPath, examplePath: exampleConfigPath }) : "";

		return {
			config: result.config,
			blocked: result.blocked,
			diagnostics: result.diagnostics,
			message,
			configPath: userConfigPath,
			examplePath: exampleConfigPath,
			asGateState(): ConfigGateState {
				return {
					blocked: this.blocked,
					diagnostics: this.diagnostics,
					message: this.message,
					configPath: this.configPath,
					examplePath: this.examplePath,
				};
			},
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const diagnostics: ConfigDiagnostic[] = [
			{
				level: "error",
				code: "config_load_failed",
				path: "config.json",
				message,
			},
		];
		return {
			config: {},
			blocked: true,
			diagnostics,
			message: formatConfigDiagnostics(diagnostics, { configPath: userConfigPath, examplePath: exampleConfigPath }),
			configPath: userConfigPath,
			examplePath: exampleConfigPath,
			asGateState(): ConfigGateState {
				return {
					blocked: this.blocked,
					diagnostics: this.diagnostics,
					message: this.message,
					configPath: this.configPath,
					examplePath: this.examplePath,
				};
			},
		};
	}
}

/**
 * Copy loaded config state into a ConfigGateState object.
 *
 * Creates a fresh object with the state data copied in.
 *
 * @param state The loaded config state to convert.
 * @param target Optional target object to copy data into (mutated in place).
 * @returns ConfigGateState with copied data.
 */
export function assignGate(state: LoadedConfigState, target?: ConfigGateState): ConfigGateState {
	const gate = target ?? {
		blocked: false,
		diagnostics: [],
		message: "",
		configPath: undefined,
		examplePath: undefined,
	};
	gate.blocked = state.blocked;
	gate.diagnostics = state.diagnostics;
	gate.message = state.message;
	gate.configPath = state.configPath;
	gate.examplePath = state.examplePath;
	return gate;
}

/**
 * Create the live runtime config store.
 *
 * Provides hot-reloadable access to the effective merged config
 * and gate diagnostics. The store initially loads config from the
 * specified extension directory. The gate state object is created
 * once and mutated in place on reload, ensuring consumers holding
 * a reference always see current state.
 *
 * @param packageConfigDir Absolute path to the package directory containing bundled defaults.
 * @param userConfigDir Absolute path to the user config directory. Defaults to `packageConfigDir`.
 * @param getEntrypointCommands Callback that returns discovered interactive entrypoint command names.
 * @returns Runtime config store with getConfig, getGateState, and reloadConfig.
 */
export function createRuntimeConfigStore(
	packageConfigDir: string,
	userConfigDir = packageConfigDir,
	getEntrypointCommands: () => readonly string[] = () => [],
): RuntimeConfigStore {
	let currentState = loadRuntimeConfigState(packageConfigDir, userConfigDir, getEntrypointCommands());
	// Store a single gate object that gets mutated on reload
	const gate = assignGate(currentState);

	return {
		getConfig(): ExtensionConfig {
			return currentState.config;
		},
		getGateState(): ConfigGateState {
			return gate;
		},
		reloadConfig(): void {
			currentState = loadRuntimeConfigState(packageConfigDir, userConfigDir, getEntrypointCommands());
			assignGate(currentState, gate);
		},
	};
}