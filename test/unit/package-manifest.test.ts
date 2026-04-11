/**
 * Unit coverage for the published package manifest.
 *
 * Responsibilities:
 * - verify Pi entrypoints point at the new `src/extension` files
 * - verify npm package publishing includes the directory-based layout
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";

/**
 * Read and parse the repository package manifest.
 *
 * @returns Parsed `package.json` contents.
 */
function readPackageJson(): Record<string, unknown> {
	const packagePath = path.resolve("package.json");
	return JSON.parse(fs.readFileSync(packagePath, "utf-8")) as Record<string, unknown>;
}

describe("package.json manifest", () => {
	it("publishes the src-based Pi extension entrypoints and files", () => {
		const packageJson = readPackageJson();
		assert.equal(packageJson.version, "0.3.0");
		assert.deepEqual((packageJson.pi as { extensions?: string[] }).extensions, [
			"./src/extension/index.ts",
			"./src/extension/notify.ts",
		]);
		assert.deepEqual(packageJson.files, [
			"src/",
			"scripts/",
			"agents/",
			"docs/",
			"default-config.json",
			"config.example.json",
			"*.mjs",
			"README.md",
			"CHANGELOG.md",
		]);
	});
});
