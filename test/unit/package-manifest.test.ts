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

void describe("package.json manifest", () => {
	void it("publishes the src-based Pi extension entrypoints and files", () => {
		const packageJson = readPackageJson();
		assert.deepEqual((packageJson.pi as { extensions?: string[] }).extensions, ["./src/extension/index.ts"]);
		assert.deepEqual(packageJson.files, ["src/", "scripts/", "agents/", "docs/", "default-config.json", "config.example.json", "*.mjs", "README.md", "CHANGELOG.md"]);
	});

	void it("only advertises Pi extension entrypoints that exist in the package", () => {
		const packageJson = readPackageJson();
		const extensions = (packageJson.pi as { extensions?: string[] }).extensions ?? [];
		assert.ok(extensions.length > 0, "package should advertise at least one Pi extension entrypoint");

		for (const extensionPath of extensions) {
			const absolutePath = path.resolve(extensionPath);
			assert.ok(fs.existsSync(absolutePath), `${extensionPath} should exist`);
		}
	});

	void it("points package metadata at the release repository", () => {
		const packageJson = readPackageJson();
		assert.deepEqual(packageJson.repository, {
			type: "git",
			url: "git+https://github.com/teelicht/pi-superagents.git",
		});
		assert.equal(packageJson.homepage, "https://github.com/teelicht/pi-superagents#readme");
		assert.deepEqual(packageJson.bugs, {
			url: "https://github.com/teelicht/pi-superagents/issues",
		});
	});
});
