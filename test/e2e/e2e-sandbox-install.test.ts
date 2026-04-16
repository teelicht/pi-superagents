/**
 * E2E test: npm pack + install sandbox verification.
 *
 * Uses pi-test-harness verifySandboxInstall() to ensure the published package
 * can be installed cleanly with the package directory layout and loads
 * expected extensions/tools.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { tryImport } from "../support/helpers.ts";

const harness = await tryImport<any>("@marcfargas/pi-test-harness");
const available = !!harness;
const PACKAGE_DIR = path.resolve(".");

void describe("sandbox install", { skip: !available ? "pi-test-harness not available" : undefined }, () => {
	const { verifySandboxInstall } = harness;

	void it("loads extension after npm pack+install with expected tools", { timeout: 120_000 }, async () => {
		const result = await verifySandboxInstall({
			packageDir: PACKAGE_DIR,
			expect: {
				extensions: 2,
				tools: ["subagent", "subagent_status"],
			},
		});

		assert.deepEqual(result.loaded.extensionErrors, []);
		assert.equal(result.loaded.extensions, 2);
		assert.ok(result.loaded.tools.includes("subagent"));
		assert.ok(result.loaded.tools.includes("subagent_status"));

		const installDir =
			(result as { installDir?: string; packageDir?: string }).installDir ??
			(result as { packageDir?: string }).packageDir;
		if (installDir) {
			assert.ok(fs.existsSync(path.join(installDir, "config.example.json")), "config.example.json should be installed");
			assert.equal(
				fs.existsSync(path.join(installDir, "config.json")),
				false,
				"config.json should not be a packaged file",
			);
		}
	});
});
