#!/usr/bin/env node

/**
 * pi-superagents installer
 * 
 * Usage:
 *   npx @teelicht/pi-superagents          # Install to ~/.pi/agent/extensions/subagent
 *   npx @teelicht/pi-superagents --remove # Remove the extension
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const EXTENSION_DIR = path.join(os.homedir(), ".pi", "agent", "extensions", "subagent");
const USER_CONFIG_PATH = path.join(EXTENSION_DIR, "config.json");
const DEFAULT_CONFIG_PATH = path.join(EXTENSION_DIR, "default-config.json");
const EXAMPLE_CONFIG_PATH = path.join(EXTENSION_DIR, "config.example.json");
const REPO_URL = "https://github.com/teelicht/pi-superagents.git";

const args = process.argv.slice(2);
const isRemove = args.includes("--remove") || args.includes("-r");
const isHelp = args.includes("--help") || args.includes("-h");
const isCheckConfig = args.includes("--check-config");
const isMigrateConfig = args.includes("--migrate-config");

if (isHelp) {
	console.log(`
pi-superagents - Pi extension for delegating tasks to subagents

Usage:
  npx @teelicht/pi-superagents          Install the extension
  npx @teelicht/pi-superagents --remove Remove the extension
  npx @teelicht/pi-superagents --check-config Check user config parseability
  npx @teelicht/pi-superagents --migrate-config Apply safe config migrations
  npx @teelicht/pi-superagents --help   Show this help

Installation directory: ${EXTENSION_DIR}
`);
	process.exit(0);
}

if (isRemove) {
	if (fs.existsSync(EXTENSION_DIR)) {
		console.log(`Removing ${EXTENSION_DIR}...`);
		fs.rmSync(EXTENSION_DIR, { recursive: true });
		console.log("\u2713 pi-superagents removed");
	} else {
		console.log("pi-superagents is not installed");
	}
	process.exit(0);
}

if (isCheckConfig) {
	const diagnostics = validateUserConfigForInstall();
	if (diagnostics.errors.length === 0 && diagnostics.warnings.length === 0) {
		console.log(`Config is parseable: ${USER_CONFIG_PATH}`);
		process.exit(0);
	}
	for (const diagnostic of diagnostics.errors) console.error(`ERROR: ${diagnostic}`);
	for (const diagnostic of diagnostics.warnings) console.error(`WARNING: ${diagnostic}`);
	process.exit(diagnostics.errors.length ? 1 : 0);
}

if (isMigrateConfig) {
	try {
		const result = migrateUserConfigForInstall();
		console.log(result.message);
		process.exit(result.changed ? 0 : 1);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`Failed to migrate config.json: ${message}`);
		process.exit(1);
	}
}

/**
 * Ensure the user-owned override config exists, copying from bundled defaults on fresh install.
 *
 * @returns `true` when a new config file was created.
 */
function ensureUserConfig() {
	if (fs.existsSync(USER_CONFIG_PATH)) return false;
	if (fs.existsSync(DEFAULT_CONFIG_PATH)) {
		fs.copyFileSync(DEFAULT_CONFIG_PATH, USER_CONFIG_PATH);
	} else {
		fs.writeFileSync(USER_CONFIG_PATH, "{}\n", "utf-8");
	}
	return true;
}

/**
 * Validate that the user config is parseable enough for install-time guidance.
 *
 * Runtime validation remains authoritative and checks the complete schema.
 *
 * @returns Install-time diagnostics split by severity.
 */
function validateUserConfigForInstall() {
	const result = { errors: [], warnings: [] };
	if (!fs.existsSync(USER_CONFIG_PATH)) return result;
	try {
		const parsed = JSON.parse(fs.readFileSync(USER_CONFIG_PATH, "utf-8"));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			result.errors.push("config.json must contain a JSON object. pi-superagents will stay disabled until this is fixed.");
			return result;
		}
		if (fs.existsSync(DEFAULT_CONFIG_PATH)) {
			const defaults = JSON.parse(fs.readFileSync(DEFAULT_CONFIG_PATH, "utf-8"));
			if (JSON.stringify(parsed) === JSON.stringify(defaults)) {
				result.warnings.push("config.json matches bundled defaults. This is valid for fresh installs; edit only the behavior flags you want to change.");
			}
		}
		return result;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		result.errors.push(`config.json is not valid JSON: ${message}. pi-superagents will stay disabled until this is fixed.`);
		return result;
	}
}

/**
 * Replace an unchanged copied default config with an empty override.
 *
 * @returns Migration result for installer output.
 */
function migrateUserConfigForInstall() {
	if (!fs.existsSync(USER_CONFIG_PATH)) return { changed: false, message: "config.json does not exist." };
	if (!fs.existsSync(DEFAULT_CONFIG_PATH)) return { changed: false, message: "default-config.json is missing; cannot compare safely." };
	const parsed = JSON.parse(fs.readFileSync(USER_CONFIG_PATH, "utf-8"));
	const defaults = JSON.parse(fs.readFileSync(DEFAULT_CONFIG_PATH, "utf-8"));
	if (JSON.stringify(parsed) !== JSON.stringify(defaults)) {
		return { changed: false, message: "No safe migration is available. Edit config.json manually using config.example.json." };
	}
	const backupPath = `${USER_CONFIG_PATH}.bak-${Date.now()}`;
	fs.copyFileSync(USER_CONFIG_PATH, backupPath);
	fs.writeFileSync(USER_CONFIG_PATH, "{}\n", "utf-8");
	return { changed: true, message: `Migrated config.json to {}; backup written to ${backupPath}` };
}

// Install
console.log("Installing pi-superagents...\n");

// Ensure parent directory exists
const parentDir = path.dirname(EXTENSION_DIR);
if (!fs.existsSync(parentDir)) {
	fs.mkdirSync(parentDir, { recursive: true });
}

// Check if already installed
if (fs.existsSync(EXTENSION_DIR)) {
	const isGitRepo = fs.existsSync(path.join(EXTENSION_DIR, ".git"));
	if (isGitRepo) {
		console.log("Updating existing installation...");
		try {
			execSync("git pull", { cwd: EXTENSION_DIR, stdio: "inherit" });
			console.log("\n✓ pi-superagents updated");
		} catch {
			console.error("Failed to update. Try removing and reinstalling:");
			console.error("  npx pi-superagents --remove && npx pi-superagents");
			process.exit(1);
		}
	} else {
		console.log(`Directory exists but is not a git repo: ${EXTENSION_DIR}`);
		console.log("Remove it first with: npx pi-superagents --remove");
		process.exit(1);
	}
} else {
	// Fresh install
	console.log(`Cloning to ${EXTENSION_DIR}...`);
	try {
		execSync(`git clone ${REPO_URL} "${EXTENSION_DIR}"`, { stdio: "inherit" });
		console.log("\n✓ pi-superagents installed");
	} catch {
		console.error("Failed to clone repository");
		process.exit(1);
	}
}

const createdUserConfig = ensureUserConfig();
const installDiagnostics = validateUserConfigForInstall();

console.log(`
The extension is now available in pi. Tools added:
  • subagent       - Delegate tasks to agents (single, chain, parallel)
  • subagent_status - Check async run status and config diagnostics

Documentation: ${EXTENSION_DIR}/README.md
Config override file: ${USER_CONFIG_PATH}${createdUserConfig ? " (created from defaults)" : ""}
Config examples:       ${EXAMPLE_CONFIG_PATH}
`);

if (installDiagnostics.errors.length || installDiagnostics.warnings.length) {
	console.log("Config diagnostics:");
	for (const diagnostic of installDiagnostics.errors) console.log(`  • ERROR: ${diagnostic}`);
	for (const diagnostic of installDiagnostics.warnings) console.log(`  • WARNING: ${diagnostic}`);
}