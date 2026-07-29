/**
 * Install-time migration helpers for user config and legacy review agents.
 *
 * Responsibilities:
 * - enable explicit-only Superpowers activation for existing configs
 * - add the bundled parallel implementation preset without replacing user settings
 * - split legacy parallel `sp-implement` settings into `sp-implement-parallel`
 * - retire obsolete review command presets and user agent files with backups
 *
 * Important side effects:
 * - `applyInstallMigrations` writes config backups and migrated JSON
 * - `migrateStaleReviewAgentFiles` renames legacy user agent files
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type { ExtensionConfig, SuperpowersCommandPreset } from "../shared/types.ts";

const PARALLEL_COMMAND = "sp-implement-parallel";
const SEQUENTIAL_COMMAND = "sp-implement";
const LEGACY_REVIEW_COMMANDS = ["sp-spec-review", "sp-code-review"] as const;
const LEGACY_REVIEW_AGENT_FILES = ["sp-spec-review.md", "sp-code-review.md"] as const;

export interface UserConfigMigrationResult {
	config: ExtensionConfig;
	changes: string[];
}

export interface StaleReviewAgentMigrationResult {
	changes: string[];
	backups: string[];
}

export interface ApplyInstallMigrationsOptions {
	userConfigPath: string;
	defaultConfigPath: string;
	userAgentDirs?: string[];
	requiredReviewAgentPath?: string;
}

export interface ApplyInstallMigrationsResult {
	changed: boolean;
	changes: string[];
	backupPath?: string;
	agentBackups: string[];
}

/**
 * Clone a JSON-compatible value while preserving its TypeScript type.
 *
 * @param value JSON-compatible config value.
 * @returns Independent structured clone.
 */
function clone<T>(value: T): T {
	return structuredClone(value);
}

/**
 * Add the bundled explicit-only activation flag without replacing a user override.
 *
 * @param config Mutable cloned user config.
 * @param defaults Bundled defaults for the installed version.
 * @param changes Human-readable migration changes.
 */
function addSuperpowersSkillsOptInDefault(config: ExtensionConfig, defaults: ExtensionConfig, changes: string[]): void {
	if (defaults.superagents?.makeSuperpowersSkillsOptInOnly !== true || config.superagents?.makeSuperpowersSkillsOptInOnly !== undefined) return;
	config.superagents ??= {};
	config.superagents.makeSuperpowersSkillsOptInOnly = true;
	changes.push("Added superagents.makeSuperpowersSkillsOptInOnly from bundled defaults.");
}

/**
 * Merge legacy parallel settings over the bundled parallel preset.
 *
 * Parallel invariants are forced on while user-selected TDD, branch, and
 * worktree-root settings remain intact.
 *
 * @param bundled Bundled parallel command preset.
 * @param legacy Legacy parallel `sp-implement` preset.
 * @returns Migrated parallel command preset.
 */
function buildParallelPreset(bundled: SuperpowersCommandPreset, legacy?: SuperpowersCommandPreset): SuperpowersCommandPreset {
	const root = legacy?.worktrees?.root ?? bundled.worktrees?.root;
	return {
		...clone(bundled),
		...(legacy ? clone(legacy) : {}),
		taskScheduling: "parallel",
		useSubagents: true,
		worktrees: {
			...(bundled.worktrees ?? {}),
			...(legacy?.worktrees ?? {}),
			enabled: true,
			...(root !== undefined ? { root } : {}),
		},
	};
}

/**
 * Upgrade a parsed user config without replacing unrelated custom settings.
 *
 * @param userConfig Parsed user-owned config override.
 * @param defaults Parsed bundled defaults for the installed version.
 * @returns Migrated config and a human-readable list of applied changes.
 */
export function migrateUserConfigDocument(userConfig: ExtensionConfig, defaults: ExtensionConfig): UserConfigMigrationResult {
	const config = clone(userConfig);
	const changes: string[] = [];
	addSuperpowersSkillsOptInDefault(config, defaults, changes);
	const bundledParallel = defaults.superagents?.commands?.[PARALLEL_COMMAND];

	if (!bundledParallel) return { config, changes };

	config.superagents ??= {};
	config.superagents.commands ??= {};
	const commands = config.superagents.commands;
	const legacyImplement = commands[SEQUENTIAL_COMMAND];
	const legacyWasParallel = legacyImplement?.taskScheduling === "parallel";

	if (!commands[PARALLEL_COMMAND]) {
		commands[PARALLEL_COMMAND] = buildParallelPreset(bundledParallel, legacyWasParallel ? legacyImplement : undefined);
		if (!legacyWasParallel && legacyImplement?.worktrees?.root != null) {
			commands[PARALLEL_COMMAND].worktrees = {
				...(commands[PARALLEL_COMMAND].worktrees ?? {}),
				enabled: true,
				root: legacyImplement.worktrees.root,
			};
		}
		changes.push(`Added ${PARALLEL_COMMAND} from bundled defaults.`);
	}

	if (legacyWasParallel && legacyImplement) {
		commands[SEQUENTIAL_COMMAND] = {
			...legacyImplement,
			taskScheduling: "sequential",
			worktrees: { ...(legacyImplement.worktrees ?? {}), enabled: false },
		};
		changes.push(`Reset ${SEQUENTIAL_COMMAND} to sequential scheduling; parallel settings moved to ${PARALLEL_COMMAND}.`);
	}

	for (const commandName of LEGACY_REVIEW_COMMANDS) {
		if (commands[commandName]) {
			delete commands[commandName];
			changes.push(`Removed obsolete ${commandName} command preset; use sp-review.`);
		}
	}

	return { config, changes };
}

/**
 * Find a non-existent backup path next to an existing file.
 *
 * @param filePath File being backed up.
 * @param timestamp Timestamp shared by the migration operation.
 * @returns Available backup path.
 */
function backupPathFor(filePath: string, timestamp: number): string {
	const base = `${filePath}.bak-${timestamp}`;
	let candidate = base;
	let suffix = 1;
	while (fs.existsSync(candidate)) candidate = `${base}-${suffix++}`;
	return candidate;
}

/**
 * Rename obsolete user-level review agents so the bundled `sp-review` agent is
 * the only active reviewer implementation.
 *
 * @param userAgentDirs User agent directories to inspect.
 * @returns Applied changes and backup paths.
 */
export function migrateStaleReviewAgentFiles(userAgentDirs: string[]): StaleReviewAgentMigrationResult {
	const changes: string[] = [];
	const backups: string[] = [];
	const timestamp = Date.now();

	for (const dir of userAgentDirs) {
		for (const fileName of LEGACY_REVIEW_AGENT_FILES) {
			const filePath = path.join(dir, fileName);
			if (!fs.statSync(filePath, { throwIfNoEntry: false })?.isFile()) continue;
			const backupPath = backupPathFor(filePath, timestamp);
			fs.renameSync(filePath, backupPath);
			backups.push(backupPath);
			changes.push(`Backed up obsolete user agent ${filePath}; use bundled sp-review.`);
		}
	}

	return { changes, backups };
}

/**
 * Apply config and legacy-agent migrations for an install or refresh.
 *
 * Invalid JSON and a missing required bundled review agent are fatal so an
 * installer never silently claims a partial migration succeeded.
 *
 * @param options Config paths, user agent directories, and optional review-agent check.
 * @returns Applied changes plus backup paths.
 * @throws When config JSON is invalid or the required bundled review agent is missing.
 */
export function applyInstallMigrations(options: ApplyInstallMigrationsOptions): ApplyInstallMigrationsResult {
	if (options.requiredReviewAgentPath && !fs.statSync(options.requiredReviewAgentPath, { throwIfNoEntry: false })?.isFile()) {
		throw new Error(`Bundled consolidated review agent is missing: ${options.requiredReviewAgentPath}`);
	}

	const changes: string[] = [];
	let backupPath: string | undefined;

	if (fs.existsSync(options.userConfigPath) && fs.existsSync(options.defaultConfigPath)) {
		const userConfig = JSON.parse(fs.readFileSync(options.userConfigPath, "utf-8")) as ExtensionConfig;
		const defaults = JSON.parse(fs.readFileSync(options.defaultConfigPath, "utf-8")) as ExtensionConfig;
		const migration = migrateUserConfigDocument(userConfig, defaults);
		if (migration.changes.length > 0) {
			backupPath = backupPathFor(options.userConfigPath, Date.now());
			fs.copyFileSync(options.userConfigPath, backupPath);
			fs.writeFileSync(options.userConfigPath, `${JSON.stringify(migration.config, null, 2)}\n`, "utf-8");
			changes.push(...migration.changes);
		}
	}

	const agentMigration = migrateStaleReviewAgentFiles(options.userAgentDirs ?? []);
	changes.push(...agentMigration.changes);

	return {
		changed: changes.length > 0,
		changes,
		...(backupPath ? { backupPath } : {}),
		agentBackups: agentMigration.backups,
	};
}
