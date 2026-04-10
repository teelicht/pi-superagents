/**
 * Unit tests for the shipped default extension config template.
 *
 * Responsibilities:
 * - ensure installers have a concrete starter config to copy
 * - verify every supported starter option is exposed in the shipped template
 * - keep starter model tier defaults documented in machine-readable form
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";

const TOP_LEVEL_OPTION_KEYS = [
	"asyncByDefault",
	"defaultSessionDir",
	"maxSubagentDepth",
	"superagents",
] as const;

const SUPERAGENTS_OPTION_KEYS = [
	"defaultImplementerMode",
	"worktrees",
	"modelTiers",
	"roleSkillOverlays",
] as const;

const WORKTREE_OPTION_KEYS = [
	"enabled",
	"root",
	"setupHook",
	"setupHookTimeoutMs",
] as const;

const ROLE_KEYS = [
	"root-planning",
	"sp-recon",
	"sp-research",
	"sp-implementer",
	"sp-spec-review",
	"sp-code-review",
	"sp-debug",
] as const;

/**
 * Read and parse the default config template shipped with the extension.
 *
 * @returns Parsed JSON object for the default installer config.
 */
function readDefaultConfig(): Record<string, unknown> {
	const filePath = path.join(process.cwd(), "default-config.json");
	return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
}

describe("default-config.json", () => {
	it("ships all supported user config options", () => {
		const config = readDefaultConfig();
		const superagents = config.superagents as {
			[key: string]: unknown;
			modelTiers?: Record<string, unknown>;
			roleSkillOverlays?: Record<string, unknown>;
			worktrees?: Record<string, unknown>;
		};
		const worktrees = superagents.worktrees as Record<string, unknown>;
		const roleSkillOverlays = superagents.roleSkillOverlays as Record<string, unknown>;
		const modelTiers = superagents.modelTiers as Record<string, unknown>;
		const cheapTier = modelTiers.cheap as Record<string, unknown>;
		const balancedTier = modelTiers.balanced as Record<string, unknown>;
		const maxTier = modelTiers.max as Record<string, unknown>;
		const metadataKeys = Object.keys(config).filter((key) => key.startsWith("_"));

		for (const key of TOP_LEVEL_OPTION_KEYS) {
			assert.ok(key in config, `Expected option '${key}' to be present in default-config.json`);
		}
		for (const key of SUPERAGENTS_OPTION_KEYS) {
			assert.ok(key in superagents, `Expected superagents option '${key}' to be present`);
		}
		for (const key of WORKTREE_OPTION_KEYS) {
			assert.ok(key in worktrees, `Expected superagents.worktrees option '${key}' to be present`);
		}
		for (const key of ROLE_KEYS) {
			assert.ok(key in roleSkillOverlays, `Expected role overlay '${key}' to be present`);
		}

		assert.equal(superagents.defaultImplementerMode, "tdd");
		assert.equal(worktrees.enabled, true);
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
	});
});
