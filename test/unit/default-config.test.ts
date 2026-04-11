/**
 * Unit tests for shipped config templates.
 *
 * Responsibilities:
 * - ensure both default and example config templates expose the supported runtime surface
 * - verify every supported starter option is present in both templates
 * - keep starter model tier defaults documented in machine-readable form
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";

const TOP_LEVEL_OPTION_KEYS = ["superagents"] as const;

const SUPERAGENTS_OPTION_KEYS = [
	"useSubagents",
	"useTestDrivenDevelopment",
	"commands",
	"worktrees",
	"modelTiers",
] as const;

const WORKTREE_OPTION_KEYS = [
	"enabled",
	"root",
	"setupHook",
	"setupHookTimeoutMs",
] as const;

/**
 * Read and parse a config JSON file from the repository root.
 *
 * @param fileName Root-relative config file name.
 * @returns Parsed JSON object.
 */
function readConfigFile(fileName: string): Record<string, unknown> {
	const filePath = path.join(process.cwd(), fileName);
	return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
}

/**
 * Assert that a config object exposes the current public config surface.
 *
 * @param config Parsed config object to inspect.
 */
function assertPublicConfigSurface(config: Record<string, unknown>): void {
	const superagents = config.superagents as {
		[key: string]: unknown;
		modelTiers?: Record<string, unknown>;
		worktrees?: Record<string, unknown>;
		commands?: Record<string, unknown>;
		useSubagents?: unknown;
		useTestDrivenDevelopment?: unknown;
	};
	const worktrees = superagents.worktrees as Record<string, unknown>;
	const modelTiers = superagents.modelTiers as Record<string, unknown>;
	const cheapTier = modelTiers.cheap as Record<string, unknown>;
	const balancedTier = modelTiers.balanced as Record<string, unknown>;
	const maxTier = modelTiers.max as Record<string, unknown>;
	const metadataKeys = Object.keys(config).filter((key) => key.startsWith("_"));

	for (const key of TOP_LEVEL_OPTION_KEYS) {
		assert.ok(key in config, `Expected option '${key}' to be present`);
	}
	for (const key of SUPERAGENTS_OPTION_KEYS) {
		assert.ok(key in superagents, `Expected superagents option '${key}' to be present`);
	}
	for (const key of WORKTREE_OPTION_KEYS) {
		assert.ok(key in worktrees, `Expected superagents.worktrees option '${key}' to be present`);
	}

	assert.equal(superagents.useSubagents, true);
	assert.equal(superagents.useTestDrivenDevelopment, true);
	assert.equal(worktrees.enabled, false);
	assert.equal(worktrees.root, null);
	assert.equal(worktrees.setupHook, null);
	assert.equal(worktrees.setupHookTimeoutMs, 30000);
	assert.equal(typeof cheapTier.model, "string");
	assert.equal(typeof balancedTier.model, "string");
	assert.equal(typeof maxTier.model, "string");
	assert.ok(String(cheapTier.model).length > 0);
	assert.ok(String(balancedTier.model).length > 0);
	assert.ok(String(maxTier.model).length > 0);
	assert.deepEqual(metadataKeys, []);
}

describe("config templates", () => {
	it("ships all supported runtime defaults", () => {
		assertPublicConfigSurface(readConfigFile("default-config.json"));
	});

	it("ships a parseable user-facing example config with the same public surface", () => {
		assertPublicConfigSurface(readConfigFile("config.example.json"));
	});
});