/**
 * Unit coverage for install-time user config and review-agent migrations.
 *
 * Responsibilities:
 * - verify explicit-only Superpowers activation is added without replacing overrides
 * - verify missing parallel presets are added from bundled defaults
 * - verify legacy parallel sp-implement settings split into sp-implement-parallel
 * - verify obsolete review command blocks and stale user agent files are cleaned up
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import { applyInstallMigrations, migrateStaleReviewAgentFiles, migrateUserConfigDocument } from "../../src/execution/config-migration.ts";
import type { ExtensionConfig } from "../../src/shared/types.ts";

const defaults: ExtensionConfig = {
	superagents: {
		makeSuperpowersSkillsOptInOnly: true,
		commands: {
			"sp-implement": {
				taskScheduling: "sequential",
				useSubagents: true,
				useTestDrivenDevelopment: true,
				useBranches: false,
				worktrees: { enabled: false, root: null },
			},
			"sp-implement-parallel": {
				taskScheduling: "parallel",
				useSubagents: true,
				useTestDrivenDevelopment: true,
				useBranches: false,
				worktrees: { enabled: true, root: null },
			},
			"sp-brainstorm": { usePlannotator: true },
			"sp-plan": { usePlannotator: true },
		},
	},
};

const tempDirs: string[] = [];

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) fs.rmSync(dir, { recursive: true, force: true });
	}
});

/**
 * Create an isolated temporary directory for migration filesystem tests.
 *
 * @returns Absolute temporary directory path.
 */
function tempDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-config-migration-"));
	tempDirs.push(dir);
	return dir;
}

void describe("migrateUserConfigDocument", () => {
	void it("adds the bundled opt-in-only flag when missing", () => {
		const result = migrateUserConfigDocument({}, { superagents: { makeSuperpowersSkillsOptInOnly: true } });

		assert.equal(result.config.superagents?.makeSuperpowersSkillsOptInOnly, true);
		assert.deepEqual(result.changes, ["Added superagents.makeSuperpowersSkillsOptInOnly from bundled defaults."]);
	});

	void it("preserves an explicit opt-in-only override", () => {
		const result = migrateUserConfigDocument({ superagents: { makeSuperpowersSkillsOptInOnly: false } }, { superagents: { makeSuperpowersSkillsOptInOnly: true } });

		assert.equal(result.config.superagents?.makeSuperpowersSkillsOptInOnly, false);
		assert.deepEqual(result.changes, []);
	});

	void it("adds the bundled sp-implement-parallel preset when missing", () => {
		const result = migrateUserConfigDocument(
			{
				superagents: {
					makeSuperpowersSkillsOptInOnly: true,
					commands: {
						"sp-implement": {
							useSubagents: false,
							useTestDrivenDevelopment: true,
						},
					},
					extensions: ["npm:@example/ext"],
				},
			},
			defaults,
		);

		assert.ok(result.changes.some((change) => /sp-implement-parallel/.test(change)));
		assert.deepEqual(result.config.superagents?.commands?.["sp-implement-parallel"], defaults.superagents?.commands?.["sp-implement-parallel"]);
		assert.equal(result.config.superagents?.commands?.["sp-implement"]?.useSubagents, false);
		assert.deepEqual(result.config.superagents?.extensions, ["npm:@example/ext"]);
	});

	void it("splits a legacy parallel sp-implement preset into sp-implement-parallel", () => {
		const result = migrateUserConfigDocument(
			{
				superagents: {
					commands: {
						"sp-implement": {
							taskScheduling: "parallel",
							useSubagents: true,
							useTestDrivenDevelopment: false,
							worktrees: { enabled: true, root: ".worktrees" },
						},
					},
				},
			},
			defaults,
		);

		assert.equal(result.config.superagents?.commands?.["sp-implement"]?.taskScheduling, "sequential");
		assert.equal(result.config.superagents?.commands?.["sp-implement"]?.worktrees?.enabled, false);
		assert.equal(result.config.superagents?.commands?.["sp-implement-parallel"]?.taskScheduling, "parallel");
		assert.equal(result.config.superagents?.commands?.["sp-implement-parallel"]?.useTestDrivenDevelopment, false);
		assert.equal(result.config.superagents?.commands?.["sp-implement-parallel"]?.worktrees?.enabled, true);
		assert.equal(result.config.superagents?.commands?.["sp-implement-parallel"]?.worktrees?.root, ".worktrees");
	});

	void it("copies a custom worktrees.root onto a newly added parallel preset", () => {
		const result = migrateUserConfigDocument(
			{
				superagents: {
					commands: {
						"sp-implement": {
							taskScheduling: "sequential",
							worktrees: { enabled: false, root: "../worktrees" },
						},
					},
				},
			},
			defaults,
		);

		assert.equal(result.config.superagents?.commands?.["sp-implement-parallel"]?.worktrees?.root, "../worktrees");
		assert.equal(result.config.superagents?.commands?.["sp-implement-parallel"]?.worktrees?.enabled, true);
	});

	void it("removes obsolete review command presets", () => {
		const result = migrateUserConfigDocument(
			{
				superagents: {
					commands: {
						"sp-implement": { useSubagents: true },
						"sp-spec-review": { useSubagents: false },
						"sp-code-review": { useSubagents: false },
					},
				},
			},
			defaults,
		);

		assert.equal(result.config.superagents?.commands?.["sp-spec-review"], undefined);
		assert.equal(result.config.superagents?.commands?.["sp-code-review"], undefined);
		assert.ok(result.config.superagents?.commands?.["sp-implement-parallel"]);
	});

	void it("returns no changes when the config is already migrated", () => {
		const result = migrateUserConfigDocument(
			{
				superagents: {
					makeSuperpowersSkillsOptInOnly: true,
					commands: {
						"sp-implement": defaults.superagents!.commands!["sp-implement"],
						"sp-implement-parallel": defaults.superagents!.commands!["sp-implement-parallel"],
					},
				},
			},
			defaults,
		);

		assert.deepEqual(result.changes, []);
	});
});

void describe("migrateStaleReviewAgentFiles", () => {
	void it("renames stale user review agents out of the way", () => {
		const agentsDir = tempDir();
		fs.writeFileSync(path.join(agentsDir, "sp-spec-review.md"), "# old spec\n", "utf-8");
		fs.writeFileSync(path.join(agentsDir, "sp-code-review.md"), "# old code\n", "utf-8");
		fs.writeFileSync(path.join(agentsDir, "sp-fast.md"), "# keep\n", "utf-8");

		const result = migrateStaleReviewAgentFiles([agentsDir]);

		assert.equal(fs.existsSync(path.join(agentsDir, "sp-spec-review.md")), false);
		assert.equal(fs.existsSync(path.join(agentsDir, "sp-code-review.md")), false);
		assert.equal(fs.readFileSync(path.join(agentsDir, "sp-fast.md"), "utf-8"), "# keep\n");
		assert.equal(result.changes.length, 2);
		assert.ok(result.backups.every((backupPath) => fs.existsSync(backupPath)));
	});
});

void describe("applyInstallMigrations", () => {
	void it("writes migrated config with a backup and cleans stale review agents", () => {
		const root = tempDir();
		const userConfigPath = path.join(root, "config.json");
		const defaultConfigPath = path.join(root, "default-config.json");
		const agentsDir = path.join(root, "agents");
		fs.mkdirSync(agentsDir, { recursive: true });
		fs.writeFileSync(defaultConfigPath, `${JSON.stringify(defaults, null, 2)}\n`, "utf-8");
		fs.writeFileSync(
			userConfigPath,
			`${JSON.stringify(
				{
					superagents: {
						commands: {
							"sp-implement": {
								taskScheduling: "parallel",
								useSubagents: true,
								worktrees: { enabled: true, root: ".worktrees" },
							},
							"sp-spec-review": { useSubagents: false },
						},
					},
				},
				null,
				2,
			)}\n`,
			"utf-8",
		);
		fs.writeFileSync(path.join(agentsDir, "sp-code-review.md"), "# old\n", "utf-8");

		const result = applyInstallMigrations({
			userConfigPath,
			defaultConfigPath,
			userAgentDirs: [agentsDir],
		});

		assert.equal(result.changed, true);
		assert.ok(result.backupPath && fs.existsSync(result.backupPath));
		const migrated = JSON.parse(fs.readFileSync(userConfigPath, "utf-8")) as ExtensionConfig;
		assert.equal(migrated.superagents?.makeSuperpowersSkillsOptInOnly, true);
		assert.equal(migrated.superagents?.commands?.["sp-implement"]?.taskScheduling, "sequential");
		assert.ok(migrated.superagents?.commands?.["sp-implement-parallel"]);
		assert.equal(migrated.superagents?.commands?.["sp-spec-review"], undefined);
		assert.equal(fs.existsSync(path.join(agentsDir, "sp-code-review.md")), false);
	});

	void it("leaves invalid user JSON untouched", () => {
		const root = tempDir();
		const userConfigPath = path.join(root, "config.json");
		const defaultConfigPath = path.join(root, "default-config.json");
		fs.writeFileSync(userConfigPath, "{ invalid\n", "utf-8");
		fs.writeFileSync(defaultConfigPath, `${JSON.stringify(defaults, null, 2)}\n`, "utf-8");

		assert.throws(() => applyInstallMigrations({ userConfigPath, defaultConfigPath }), /JSON|Unexpected|property/i);
		assert.equal(fs.readFileSync(userConfigPath, "utf-8"), "{ invalid\n");
		assert.deepEqual(fs.readdirSync(root).sort(), ["config.json", "default-config.json"]);
	});
});
