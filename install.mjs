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
const REPO_URL = "https://github.com/nicobailon/pi-superagents.git";

const args = process.argv.slice(2);
const isRemove = args.includes("--remove") || args.includes("-r");
const isHelp = args.includes("--help") || args.includes("-h");

if (isHelp) {
	console.log(`
pi-superagents - Pi extension for delegating tasks to subagents

Usage:
  npx @teelicht/pi-superagents          Install the extension
  npx @teelicht/pi-superagents --remove Remove the extension
  npx @teelicht/pi-superagents --help   Show this help

Installation directory: ${EXTENSION_DIR}
`);
	process.exit(0);
}

if (isRemove) {
	if (fs.existsSync(EXTENSION_DIR)) {
		console.log(`Removing ${EXTENSION_DIR}...`);
		fs.rmSync(EXTENSION_DIR, { recursive: true });
		console.log("✓ pi-superagents removed");
	} else {
		console.log("pi-superagents is not installed");
	}
	process.exit(0);
}

/**
 * Seed an editable user config file from the bundled template when missing.
 *
 * @returns `true` when a new config file was created.
 */
function ensureUserConfig() {
	if (fs.existsSync(USER_CONFIG_PATH)) return false;
	if (!fs.existsSync(DEFAULT_CONFIG_PATH)) {
		console.warn(`Warning: bundled default config not found at ${DEFAULT_CONFIG_PATH}`);
		return false;
	}
	fs.copyFileSync(DEFAULT_CONFIG_PATH, USER_CONFIG_PATH);
	return true;
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
		} catch (err) {
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
	} catch (err) {
		console.error("Failed to clone repository");
		process.exit(1);
	}
}

const createdUserConfig = ensureUserConfig();

console.log(`
The extension is now available in pi. Tools added:
  • subagent       - Delegate tasks to agents (single, chain, parallel)
  • subagent_status - Check async run status

Documentation: ${EXTENSION_DIR}/README.md
Config: ${USER_CONFIG_PATH}${createdUserConfig ? " (created with starter tier mappings)" : ""}
`);
