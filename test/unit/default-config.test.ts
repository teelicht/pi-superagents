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
	"useBranches",
	"useSubagents",
	"useTestDrivenDevelopment",
	"commands",
	"worktrees",
	"modelTiers",
	"usePlannotator",
	"skillOverlays",
	"interceptSkillCommands",
	"superpowersSkills",
] as const;

const WORKTREE_OPTION_KEYS = [
	"enabled",
	"root",
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
 * @param bundledDefaultsOnly When true, includes bundled-defaults-only keys like superpowersSkills.
 */
function assertPublicConfigSurface(config: Record<string, unknown>, bundledDefaultsOnly = false): void {
	const superagents = config.superagents as {
		[key: string]: unknown;
		modelTiers?: Record<string, unknown>;
		worktrees?: Record<string, unknown>;
		commands?: Record<string, unknown>;
		useBranches?: unknown;
		useSubagents?: unknown;
		useTestDrivenDevelopment?: unknown;
		skillOverlays?: unknown;
		interceptSkillCommands?: unknown;
		superpowersSkills?: unknown;
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
		// superpowersSkills is bundled-defaults-only, not user-configurable
		if (key === "superpowersSkills" && !bundledDefaultsOnly) continue;
		assert.ok(key in superagents, `Expected superagents option '${key}' to be present`);
	}
	for (const key of WORKTREE_OPTION_KEYS) {
		assert.ok(key in worktrees, `Expected superagents.worktrees option '${key}' to be present`);
	}

	assert.equal(superagents.useBranches, false);
	assert.equal(superagents.useSubagents, true);
	assert.equal(superagents.useTestDrivenDevelopment, true);
	assert.equal(superagents.usePlannotator, false);
	assert.equal(worktrees.enabled, false);
	assert.equal(worktrees.root, null);
	assert.equal(typeof cheapTier.model, "string");
	assert.equal(typeof balancedTier.model, "string");
	assert.equal(typeof maxTier.model, "string");
	assert.ok(String(cheapTier.model).length > 0);
	assert.ok(String(balancedTier.model).length > 0);
	assert.ok(String(maxTier.model).length > 0);
	assert.deepEqual(metadataKeys, []);
}

void describe("config templates", () => {
	void it("ships all supported runtime defaults", () => {
		assertPublicConfigSurface(readConfigFile("default-config.json"), true);
	});

	void it("ships a parseable user-facing example config with the same public surface", () => {
		assertPublicConfigSurface(readConfigFile("config.example.json"));
	});

	void it("includes empty skill entry defaults", () => {
		const config = readConfigFile("default-config.json");
		assert.deepEqual((config.superagents as Record<string, unknown>).skillOverlays, {});
		assert.deepEqual((config.superagents as Record<string, unknown>).interceptSkillCommands, []);
	});

	void it("keeps direct skill interception opt-in by default", () => {
		const config = readConfigFile("default-config.json");
		const superagents = config.superagents as Record<string, unknown>;
		assert.deepEqual(superagents.skillOverlays, {});
		assert.deepEqual(superagents.interceptSkillCommands, []);
	});

	void it("includes illustrative slash command presets in config.example.json", () => {
		const config = readConfigFile("config.example.json");
		const commands = (config.superagents as Record<string, unknown>).commands as Record<string, Record<string, unknown>>;
		assert.deepEqual(commands["sp-lean"], {
			description: "Run Superpowers lean: no subagents, no TDD",
			useSubagents: false,
			useTestDrivenDevelopment: false,
		});
		assert.deepEqual(commands["sp-plannotator"], {
			description: "Run Superpowers with Plannotator review enabled",
			usePlannotator: true,
		});
	});

	void it("includes illustrative skill overlay examples in config.example.json", () => {
		const config = readConfigFile("config.example.json");
		const overlays = (config.superagents as Record<string, unknown>).skillOverlays as Record<string, string[]>;
		assert.deepEqual(overlays["brainstorming"], ["react-native-best-practices"]);
		assert.deepEqual(overlays["writing-plans"], ["supabase-postgres-best-practices"]);
	});

	void it("includes superpowers skills in bundled defaults", () => {
		const config = readConfigFile("default-config.json");
		const skills = (config.superagents as Record<string, unknown>).superpowersSkills as string[];
		assert.ok(Array.isArray(skills));
		assert.ok(skills.includes("using-superpowers"));
		assert.ok(skills.includes("brainstorming"));
		assert.ok(skills.includes("writing-plans"));
		assert.ok(skills.includes("executing-plans"));
		assert.ok(skills.includes("test-driven-development"));
		assert.ok(skills.includes("requesting-code-review"));
		assert.ok(skills.includes("receiving-code-review"));
		assert.ok(skills.includes("verification-before-completion"));
		assert.ok(skills.includes("subagent-driven-development"));
		assert.ok(skills.includes("dispatching-parallel-agents"));
		assert.ok(skills.includes("using-git-worktrees"));
		assert.ok(skills.includes("finishing-a-development-branch"));
	});

	void it("does not include superpowersSkills in the example config", () => {
		const config = readConfigFile("config.example.json");
		assert.equal("superpowersSkills" in (config.superagents as Record<string, unknown>), false);
	});
});
