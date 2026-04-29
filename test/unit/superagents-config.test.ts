/**
 * Unit coverage for Superagents configuration helpers.
 *
 * Responsibilities:
 * - resolve the canonical Superagents settings root
 * - apply Superpowers-specific worktree defaults consistently
 * - scope worktree setup options to the Superpowers workflow
 * - resolve global extension ordering for subagent execution
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";

import {
	findMissingSubagentExtensionPath,
	getSuperagentSettings,
	resolveSubagentExtensions,
	resolveSuperagentWorktreeCreateOptions,
	resolveSuperagentWorktreeEnabled,
} from "../../src/execution/superagents-config.ts";

void describe("superagents config helpers", () => {
	/**
	 * Verifies the canonical settings accessor returns the configured Superagents settings.
	 *
	 * @returns Nothing; asserts canonical lookup behavior.
	 */
	void it("returns only the configured superagents settings", () => {
		assert.deepEqual(
			getSuperagentSettings({
				superagents: { commands: { "sp-implement": { entrySkill: "using-superpowers" } } },
			}),
			{ commands: { "sp-implement": { entrySkill: "using-superpowers" } } },
		);
		assert.equal(getSuperagentSettings({}), undefined);
		assert.equal(
			getSuperagentSettings({
				superpowers: { defaultImplementerMode: "tdd" },
			} as unknown as Parameters<typeof getSuperagentSettings>[0]),
			undefined,
		);
	});

	/**
	 * Verifies Superpowers runs default worktree isolation on unless disabled in sp-implement command.
	 *
	 * @returns Nothing; asserts the resolved effective worktree flag.
	 */
	void it("defaults worktree isolation on for superpowers and respects sp-implement config", () => {
		assert.equal(resolveSuperagentWorktreeEnabled(undefined, "superpowers", {}), true);
		assert.equal(
			resolveSuperagentWorktreeEnabled(undefined, "superpowers", {
				superagents: { commands: { "sp-implement": { worktrees: { enabled: false } } } },
			}),
			false,
		);
		assert.equal(
			resolveSuperagentWorktreeEnabled(true, "superpowers", {
				superagents: { commands: { "sp-implement": { worktrees: { enabled: false } } } },
			}),
			false,
		);
		assert.equal(resolveSuperagentWorktreeEnabled(false, "superpowers", {}), false);
		assert.equal(resolveSuperagentWorktreeEnabled(true, "superpowers", {}), true);
	});

	/**
	 * Verifies worktree create options are scoped to the Superpowers workflow.
	 *
	 * @returns Nothing; asserts resolved createWorktrees options.
	 */
	void it("resolves root and hook settings only for superpowers runs from sp-implement command", () => {
		assert.deepEqual(
			resolveSuperagentWorktreeCreateOptions({
				workflow: "superpowers",
				config: {
					superagents: {
						commands: {
							"sp-implement": {
								worktrees: { root: ".worktrees" },
							},
						},
					},
				},
				agents: ["sp-implementer", "sp-code-review"],
			}),
			{
				agents: ["sp-implementer", "sp-code-review"],
				rootDir: ".worktrees",
				requireIgnoredRoot: true,
			},
		);
	});
});

void describe("resolveSubagentExtensions", () => {
	/**
	 * Verifies global extensions from config come before agent extensions.
	 *
	 * @returns Nothing; asserts global extensions prepended to agent extensions.
	 */
	void it("prepends global extensions before agent extensions", () => {
		const config = { superagents: { extensions: ["global-ext-a", "global-ext-b"] } };
		const agentExtensions = ["agent-ext-1", "agent-ext-2"];
		const result = resolveSubagentExtensions(config, agentExtensions);
		assert.deepEqual(result, ["global-ext-a", "global-ext-b", "agent-ext-1", "agent-ext-2"]);
	});

	/**
	 * Verifies missing config returns only agent extensions.
	 *
	 * @returns Nothing; asserts agent extensions returned when no global config.
	 */
	void it("returns agent extensions when config has no superagents", () => {
		const config = {};
		const agentExtensions = ["agent-ext"];
		const result = resolveSubagentExtensions(config, agentExtensions);
		assert.deepEqual(result, ["agent-ext"]);
	});

	/**
	 * Verifies missing frontmatter returns only global extensions.
	 *
	 * @returns Nothing; asserts global extensions returned when no agent extensions.
	 */
	void it("returns global extensions when agent extensions are undefined", () => {
		const config = { superagents: { extensions: ["global-ext"] } };
		const result = resolveSubagentExtensions(config, undefined);
		assert.deepEqual(result, ["global-ext"]);
	});

	/**
	 * Verifies empty arrays when both are missing.
	 *
	 * @returns Nothing; asserts empty array when no extensions anywhere.
	 */
	void it("returns empty array when both config and agent extensions are missing", () => {
		const config = {};
		const result = resolveSubagentExtensions(config, undefined);
		assert.deepEqual(result, []);
	});
});

void describe("findMissingSubagentExtensionPath", () => {
	/**
	 * Verifies undefined is returned when both arrays are undefined/empty.
	 *
	 * @returns Nothing; asserts no missing path found.
	 */
	void it("returns undefined when both arrays are undefined/empty", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-config-test-empty-"));
		try {
			assert.equal(findMissingSubagentExtensionPath(tempDir, undefined, undefined), undefined);
			assert.equal(findMissingSubagentExtensionPath(tempDir, [], []), undefined);
			assert.equal(findMissingSubagentExtensionPath(tempDir, [], undefined), undefined);
			assert.equal(findMissingSubagentExtensionPath(tempDir, undefined, []), undefined);
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	/**
	 * Verifies Pi package and remote extension sources are passed through without local path checks.
	 *
	 * @returns Nothing; asserts scheme-like sources do not produce missing path diagnostics.
	 */
	void it("does not path-check Pi package and remote extension sources", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-config-test-scheme-"));
		try {
			assert.equal(
				findMissingSubagentExtensionPath(
					tempDir,
					["npm:@sting8k/pi-vcc", "git:github.com/user/repo"],
					["https://example.com/ext.ts", "ssh://git@example.com/user/repo.git"],
				),
				undefined,
			);
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	/**
	 * Verifies Windows drive-letter paths are not mistaken for URI-scheme sources.
	 *
	 * @returns Nothing; asserts a drive-letter path is still validated as a local path.
	 */
	void it("treats Windows drive-letter entries as local paths, not scheme sources", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-config-test-drive-"));
		try {
			const result = findMissingSubagentExtensionPath(tempDir, ["C:\\missing\\extension.ts"], undefined);

			assert.ok(result !== undefined);
			assert.equal(result!.source, "superagents.extensions[0]");
			assert.equal(result!.configuredPath, "C:\\missing\\extension.ts");
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	/**
	 * Verifies home-relative local paths are expanded before validation.
	 *
	 * @returns Nothing; asserts an existing home-relative path passes validation.
	 */
	void it("expands home-relative local extension paths before validation", () => {
		const homeExtensionPath = path.join(os.homedir(), `.pi-superagents-test-${process.pid}.ts`);
		try {
			fs.writeFileSync(homeExtensionPath, "// extension");

			assert.equal(findMissingSubagentExtensionPath(process.cwd(), [`~/${path.basename(homeExtensionPath)}`], undefined), undefined);
		} finally {
			fs.rmSync(homeExtensionPath, { force: true });
		}
	});

	/**
	 * Verifies undefined is returned for existing relative path resolved against runtime cwd.
	 *
	 * @returns Nothing; asserts relative path exists after resolution.
	 */
	void it("returns undefined for existing relative path resolved against runtime cwd", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-config-test-rel-"));
		try {
			const relativePath = "existing-subdir/extension.ts";
			const fullPath = path.join(tempDir, relativePath);
			fs.mkdirSync(path.dirname(fullPath), { recursive: true });
			fs.writeFileSync(fullPath, "// extension");

			const result = findMissingSubagentExtensionPath(tempDir, [relativePath], undefined);
			assert.equal(result, undefined);
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	/**
	 * Verifies undefined is returned for existing absolute path.
	 *
	 * @returns Nothing; asserts absolute path exists.
	 */
	void it("returns undefined for existing absolute path", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-config-test-abs-"));
		try {
			const absPath = path.join(tempDir, "global-ext.txt");
			fs.writeFileSync(absPath, "extension content");

			const result = findMissingSubagentExtensionPath(tempDir, [absPath], undefined);
			assert.equal(result, undefined);
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	/**
	 * Verifies missing result for missing absolute path with source superagents.extensions[0].
	 *
	 * @returns Nothing; asserts missing path with correct source key.
	 */
	void it("returns missing result for missing absolute path with source superagents.extensions[0]", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-config-test-miss-abs-"));
		try {
			const missingPath = path.join(tempDir, "non-existent-global-ext.txt");
			const result = findMissingSubagentExtensionPath(tempDir, [missingPath], undefined);

			assert.ok(result !== undefined);
			assert.equal(result!.source, "superagents.extensions[0]");
			assert.equal(result!.configuredPath, missingPath);
			assert.equal(result!.resolvedPath, missingPath);
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	/**
	 * Verifies missing result for second agent entry when first exists (source agent.extensions[1]).
	 *
	 * @returns Nothing; asserts second agent extension reported as missing.
	 */
	void it("returns missing result for second agent entry when first exists", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-config-test-miss-agent-"));
		try {
			const existingAgentPath = path.join(tempDir, "first-agent-ext.txt");
			fs.writeFileSync(existingAgentPath, "first");
			const missingAgentPath = path.join(tempDir, "second-agent-ext.txt");

			const result = findMissingSubagentExtensionPath(tempDir, undefined, [existingAgentPath, missingAgentPath]);

			assert.ok(result !== undefined);
			assert.equal(result!.source, "agent.extensions[1]");
			assert.equal(result!.configuredPath, missingAgentPath);
			assert.equal(result!.resolvedPath, missingAgentPath);
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});
});