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
	findMissingSubagentToolPath,
	getSuperagentSettings,
	isSchemeLikeExtensionSource,
	resolveLocalSubagentExtensionPath,
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
				superagents: { commands: { "sp-implement": { useSubagents: true } } },
			}),
			{ commands: { "sp-implement": { useSubagents: true } } },
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

	/**
	 * Verifies that an untrusted project agent's extensions are dropped.
	 *
	 * Project agent frontmatter must not be allowed to inject child Pi extensions
	 * when the parent Pi context has not trusted the project. Global extensions
	 * remain available so the child can still run the lifecycle sidecar.
	 *
	 * @returns Nothing; asserts untrusted project agent extensions are excluded.
	 */
	void it("excludes project agent extensions when the project is not trusted", () => {
		const config = { superagents: { extensions: ["global-ext"] } };
		const agentExtensions = ["project-agent-ext"];
		const result = resolveSubagentExtensions(config, agentExtensions, {
			agentSource: "project",
			projectTrusted: false,
		});
		assert.deepEqual(result, ["global-ext"]);
	});

	/**
	 * Verifies that a trusted project agent's extensions are included.
	 *
	 * When the parent Pi context trusts the project, project agent frontmatter
	 * may add its own extensions alongside the global extensions.
	 *
	 * @returns Nothing; asserts trusted project agent extensions are included.
	 */
	void it("includes project agent extensions when the project is trusted", () => {
		const config = { superagents: { extensions: ["global-ext"] } };
		const agentExtensions = ["project-agent-ext"];
		const result = resolveSubagentExtensions(config, agentExtensions, {
			agentSource: "project",
			projectTrusted: true,
		});
		assert.deepEqual(result, ["global-ext", "project-agent-ext"]);
	});

	/**
	 * Verifies that user and builtin agent extensions are never filtered.
	 *
	 * The trust policy only gates project-sourced agent extensions; user and
	 * builtin agent frontmatter should always be honored regardless of trust.
	 *
	 * @returns Nothing; asserts user/builtin agent extensions are always included.
	 */
	void it("does not filter user or builtin agent extensions by trust", () => {
		const config = { superagents: { extensions: ["global-ext"] } };
		const userAgentExtensions = ["user-agent-ext"];
		const builtinAgentExtensions = ["builtin-agent-ext"];
		assert.deepEqual(
			resolveSubagentExtensions(config, userAgentExtensions, {
				agentSource: "user",
				projectTrusted: false,
			}),
			["global-ext", "user-agent-ext"],
		);
		assert.deepEqual(
			resolveSubagentExtensions(config, builtinAgentExtensions, {
				agentSource: "builtin",
				projectTrusted: false,
			}),
			["global-ext", "builtin-agent-ext"],
		);
	});

	/**
	 * Verifies that omitting the options argument preserves legacy behavior.
	 *
	 * Callers that have not yet been updated to pass the trust options should
	 * see no behavioral change: the function should still include agent
	 * extensions.
	 *
	 * @returns Nothing; asserts no filtering when options are not provided.
	 */
	void it("preserves legacy behavior when options are not provided", () => {
		const config = { superagents: { extensions: ["global-ext"] } };
		const agentExtensions = ["project-agent-ext"];
		assert.deepEqual(resolveSubagentExtensions(config, agentExtensions), ["global-ext", "project-agent-ext"]);
		assert.deepEqual(resolveSubagentExtensions(config, agentExtensions, {}), ["global-ext", "project-agent-ext"]);
		assert.deepEqual(resolveSubagentExtensions(config, agentExtensions, { agentSource: "project" }), ["global-ext", "project-agent-ext"]);
	});
});

void describe("isSchemeLikeExtensionSource", () => {
	/**
	 * Verifies npm: scheme sources are recognized as scheme-like.
	 *
	 * @returns Nothing; asserts npm: prefix returns true.
	 */
	void it("returns true for npm: scheme sources", () => {
		assert.equal(isSchemeLikeExtensionSource("npm:@scope/pkg"), true);
	});

	/**
	 * Verifies git: scheme sources are recognized as scheme-like.
	 *
	 * @returns Nothing; asserts git: prefix returns true.
	 */
	void it("returns true for git: scheme sources", () => {
		assert.equal(isSchemeLikeExtensionSource("git:github.com/user/repo"), true);
	});

	/**
	 * Verifies https: scheme sources are recognized as scheme-like.
	 *
	 * @returns Nothing; asserts https: prefix returns true.
	 */
	void it("returns true for https: scheme sources", () => {
		assert.equal(isSchemeLikeExtensionSource("https://example.com/ext.ts"), true);
	});

	/**
	 * Verifies ssh: scheme sources are recognized as scheme-like.
	 *
	 * @returns Nothing; asserts ssh: prefix returns true.
	 */
	void it("returns true for ssh: scheme sources", () => {
		assert.equal(isSchemeLikeExtensionSource("ssh://git@example.com/user/repo.git"), true);
	});

	/**
	 * Verifies Windows backslash drive-letter paths are not treated as scheme sources.
	 *
	 * @returns Nothing; asserts Windows path returns false.
	 */
	void it("returns false for Windows backslash drive-letter paths", () => {
		assert.equal(isSchemeLikeExtensionSource("C:\\missing\\extension.ts"), false);
	});

	/**
	 * Verifies Windows forward-slash drive-letter paths are not treated as scheme sources.
	 *
	 * @returns Nothing; asserts Windows path returns false.
	 */
	void it("returns false for Windows forward-slash drive-letter paths", () => {
		assert.equal(isSchemeLikeExtensionSource("C:/missing/extension.ts"), false);
	});

	/**
	 * Verifies relative paths are not treated as scheme sources.
	 *
	 * @returns Nothing; asserts relative path returns false.
	 */
	void it("returns false for relative paths", () => {
		assert.equal(isSchemeLikeExtensionSource("./local.ts"), false);
	});

	/**
	 * Verifies absolute Unix-style paths are not treated as scheme sources.
	 *
	 * @returns Nothing; asserts absolute path returns false.
	 */
	void it("returns false for absolute Unix-style paths", () => {
		assert.equal(isSchemeLikeExtensionSource("/tmp/local.ts"), false);
	});

	/**
	 * Verifies home-relative paths are not treated as scheme sources.
	 *
	 * @returns Nothing; asserts home-relative path returns false.
	 */
	void it("returns false for home-relative paths", () => {
		assert.equal(isSchemeLikeExtensionSource("~/local.ts"), false);
	});
});

void describe("resolveLocalSubagentExtensionPath", () => {
	/**
	 * Verifies bare tilde resolves to the user's home directory.
	 *
	 * @returns Nothing; asserts bare tilde returns os.homedir().
	 */
	void it("resolves bare tilde to os.homedir()", () => {
		assert.equal(resolveLocalSubagentExtensionPath("/some/runtime/cwd", "~"), os.homedir());
	});

	/**
	 * Verifies tilde-forward-slash paths expand to the user's home directory.
	 *
	 * @returns Nothing; asserts ~/path returns os.homedir() + path.
	 */
	void it("resolves tilde-forward-slash paths to os.homedir() with path", () => {
		assert.equal(resolveLocalSubagentExtensionPath("/some/runtime/cwd", "~/local.ts"), path.join(os.homedir(), "local.ts"));
	});

	/**
	 * Verifies tilde-backslash paths expand to the user's home directory.
	 *
	 * @returns Nothing; asserts ~\\path returns os.homedir() + path.
	 */
	void it("resolves tilde-backslash paths to os.homedir() with path", () => {
		assert.equal(resolveLocalSubagentExtensionPath("/some/runtime/cwd", "~\\local.ts"), path.join(os.homedir(), "local.ts"));
	});

	/**
	 * Verifies absolute paths are returned unchanged.
	 *
	 * @returns Nothing; asserts absolute path returned as-is.
	 */
	void it("returns absolute paths unchanged", () => {
		const absPath = "/some/absolute/path/extension.ts";
		assert.equal(resolveLocalSubagentExtensionPath("/some/runtime/cwd", absPath), absPath);
	});

	/**
	 * Verifies relative paths are resolved against the runtime working directory.
	 *
	 * @returns Nothing; asserts relative path resolved against runtimeCwd.
	 */
	void it("resolves relative paths against runtime cwd", () => {
		const runtimeCwd = "/some/runtime/cwd";
		const relativePath = "./local.ts";
		assert.equal(resolveLocalSubagentExtensionPath(runtimeCwd, relativePath), path.resolve(runtimeCwd, relativePath));
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
				findMissingSubagentExtensionPath(tempDir, ["npm:@sting8k/pi-vcc", "git:github.com/user/repo"], ["https://example.com/ext.ts", "ssh://git@example.com/user/repo.git"]),
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

void describe("findMissingSubagentToolPath", () => {
	/**
	 * Verifies builtin-style tool names are not treated as local paths.
	 *
	 * @returns Nothing; asserts builtin tool names pass validation.
	 */
	void it("ignores builtin-style tool names", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-tool-config-test-builtin-"));
		try {
			assert.equal(findMissingSubagentToolPath(tempDir, ["read", "grep"], ["write"]), undefined);
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	/**
	 * Verifies missing global path-like tool entries report their config source.
	 *
	 * @returns Nothing; asserts missing global tool path diagnostics.
	 */
	void it("reports missing global path-like tool entries", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-tool-config-test-global-"));
		try {
			const result = findMissingSubagentToolPath(tempDir, ["./missing-tool.ts"], undefined);

			assert.ok(result !== undefined);
			assert.equal(result!.source, "superagents.tools[0]");
			assert.equal(result!.configuredPath, "./missing-tool.ts");
			assert.equal(result!.resolvedPath, path.resolve(tempDir, "./missing-tool.ts"));
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	/**
	 * Verifies existing path-like tool entries pass validation.
	 *
	 * @returns Nothing; asserts existing tool extension path is accepted.
	 */
	void it("accepts existing path-like tool entries", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-tool-config-test-existing-"));
		try {
			const toolPath = path.join(tempDir, "tool.ts");
			fs.writeFileSync(toolPath, "// tool");

			assert.equal(findMissingSubagentToolPath(tempDir, [toolPath], undefined), undefined);
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	/**
	 * Verifies missing agent frontmatter tool paths report their agent source.
	 *
	 * @returns Nothing; asserts missing agent tool path diagnostics.
	 */
	void it("reports missing agent path-like tool entries", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-tool-config-test-agent-"));
		try {
			const result = findMissingSubagentToolPath(tempDir, undefined, ["tools/missing.js"]);

			assert.ok(result !== undefined);
			assert.equal(result!.source, "agent.tools[0]");
			assert.equal(result!.configuredPath, "tools/missing.js");
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});
});
