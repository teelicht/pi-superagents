/**
 * Unit tests for the shipped default extension config template.
 *
 * Responsibilities:
 * - ensure installers have a concrete starter config to copy
 * - verify every supported starter option is exposed and documented inline
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
	"worktreeEnabled",
	"worktreeRoot",
	"worktreeSetupHook",
	"worktreeSetupHookTimeoutMs",
	"modelTiers",
	"roleSkillOverlays",
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

/**
 * Assert that each option key is present and has a non-empty sibling description.
 *
 * @param config Object containing supported option keys.
 * @param optionKeys Supported keys that must be documented inline.
 */
function assertDescriptionsPresent(
	config: Record<string, unknown>,
	optionKeys: readonly string[],
): void {
	for (const key of optionKeys) {
		assert.ok(key in config, `Expected option '${key}' to be present in default-config.json`);
		const descriptionKey = `_${key}_description`;
		assert.equal(
			typeof config[descriptionKey],
			"string",
			`Expected '${descriptionKey}' to document '${key}'`,
		);
		assert.ok(
			String(config[descriptionKey]).trim().length > 0,
			`Expected '${descriptionKey}' to be non-empty`,
		);
	}
}

describe("default-config.json", () => {
	it("ships all supported user config options with inline descriptions", () => {
		const config = readDefaultConfig();
		const superagents = config.superagents as {
			[key: string]: unknown;
			modelTiers?: Record<string, unknown>;
			roleSkillOverlays?: Record<string, unknown>;
			roleModelTiers?: unknown;
			commandName?: unknown;
			worktreeBaselineCommand?: unknown;
		};
		const roleSkillOverlays = superagents.roleSkillOverlays as Record<string, unknown>;
		const modelTiers = superagents.modelTiers as Record<string, unknown>;
		const cheapTier = modelTiers.cheap as Record<string, unknown>;
		const balancedTier = modelTiers.balanced as Record<string, unknown>;
		const maxTier = modelTiers.max as Record<string, unknown>;

		assertDescriptionsPresent(config, TOP_LEVEL_OPTION_KEYS);
		assertDescriptionsPresent(superagents, SUPERAGENTS_OPTION_KEYS);
		assertDescriptionsPresent(roleSkillOverlays, ROLE_KEYS);

		assert.equal(superagents.commandName, undefined);
		assert.equal(superagents.worktreeBaselineCommand, undefined);
		assert.equal(config.superpowers, undefined);
		assert.equal(superagents.defaultImplementerMode, "tdd");
		assert.equal(superagents.worktreeEnabled, true);
		assert.equal(superagents.worktreeRoot, null);
		assert.equal(superagents.worktreeSetupHook, null);
		assert.equal(superagents.worktreeSetupHookTimeoutMs, 30000);

		assert.equal(typeof modelTiers._cheap_description, "string");
		assert.equal(typeof modelTiers._balanced_description, "string");
		assert.equal(typeof modelTiers._max_description, "string");
		assert.equal(typeof cheapTier._description, "string");
		assert.equal(typeof balancedTier._description, "string");
		assert.equal(typeof maxTier._description, "string");
		assert.equal(typeof cheapTier.model, "string");
		assert.equal(typeof balancedTier.model, "string");
		assert.equal(typeof maxTier.model, "string");
		assert.ok(String(cheapTier.model).length > 0);
		assert.ok(String(balancedTier.model).length > 0);
		assert.ok(String(maxTier.model).length > 0);
		assert.equal(superagents.roleModelTiers, undefined);
	});
});
