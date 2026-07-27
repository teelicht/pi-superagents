/**
 * Internal CLI bridge for install-time config and review-agent migrations.
 *
 * Responsibilities:
 * - invoke the typed migration module from the plain-JavaScript npm installer
 * - emit one machine-readable JSON result for installer status output
 *
 * Important side effects:
 * - may back up and rewrite the user config
 * - may rename obsolete user review-agent files
 */

import { applyInstallMigrations } from "../src/execution/config-migration.ts";

/**
 * Run the migration CLI using positional paths supplied by the installer.
 *
 * @param argv User config, defaults, review agent, then zero or more user-agent directories.
 * @returns Process exit code.
 */
function main(argv: string[]): number {
	const [userConfigPath, defaultConfigPath, requiredReviewAgentPath, ...userAgentDirs] = argv;
	if (!userConfigPath || !defaultConfigPath || !requiredReviewAgentPath) {
		throw new Error("Usage: migrate-user-config.ts <config.json> <default-config.json> <sp-review.md> [user-agent-dir ...]");
	}

	const result = applyInstallMigrations({
		userConfigPath,
		defaultConfigPath,
		requiredReviewAgentPath,
		userAgentDirs,
	});
	process.stdout.write(`${JSON.stringify(result)}\n`);
	return 0;
}

try {
	process.exitCode = main(process.argv.slice(2));
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`Failed to migrate pi-superagents install: ${message}\n`);
	process.exitCode = 1;
}
