/**
 * Package-manager postinstall migration for Pi-managed npm and git installs.
 *
 * Responsibilities:
 * - create the documented user config on a fresh managed install
 * - apply config/worktree/reviewer migrations after Pi updates the package
 * - stay inert during ordinary repository dependency installs
 *
 * Important side effects:
 * - writes under ~/.pi/agent/extensions/subagent only for Pi-managed installs
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { applyInstallMigrations } from "../src/execution/config-migration.ts";

/**
 * Check whether this package is executing from Pi's managed package storage.
 *
 * @param packageRoot Absolute package root.
 * @returns True for global Pi npm/git package installations.
 */
function isPiManagedInstall(packageRoot: string): boolean {
	const agentDir = path.join(os.homedir(), ".pi", "agent");
	return [path.join(agentDir, "npm"), path.join(agentDir, "git")].some((root) => packageRoot === root || packageRoot.startsWith(`${root}${path.sep}`));
}

/**
 * Apply migrations for a Pi-managed package installation.
 *
 * @returns Nothing; non-Pi repository installs are intentionally ignored.
 */
function main(): void {
	const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
	if (!isPiManagedInstall(packageRoot)) return;

	const userConfigDir = path.join(os.homedir(), ".pi", "agent", "extensions", "subagent");
	const userConfigPath = path.join(userConfigDir, "config.json");
	const defaultConfigPath = path.join(packageRoot, "default-config.json");
	fs.mkdirSync(userConfigDir, { recursive: true });
	if (!fs.existsSync(userConfigPath)) fs.copyFileSync(defaultConfigPath, userConfigPath);

	const result = applyInstallMigrations({
		userConfigPath,
		defaultConfigPath,
		requiredReviewAgentPath: path.join(packageRoot, "agents", "sp-review.md"),
		userAgentDirs: [path.join(os.homedir(), ".pi", "agent", "agents"), path.join(os.homedir(), ".agents")],
	});
	if (result.changes.length > 0) process.stdout.write(`pi-superagents migrations: ${result.changes.join("; ")}\n`);
}

try {
	main();
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`pi-superagents postinstall migration failed: ${message}\n`);
	process.exitCode = 1;
}
