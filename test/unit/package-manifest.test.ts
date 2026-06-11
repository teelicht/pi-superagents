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

/**
 * Read a repository text file.
 *
 * @param filePath Repository-relative file path.
 * @returns UTF-8 file contents.
 */
function readTextFile(filePath: string): string {
	return fs.readFileSync(path.resolve(filePath), "utf-8");
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

	void it("uses lockfile-backed npm ci in GitHub Actions release and CI workflows", () => {
		assert.ok(fs.existsSync(path.resolve("package-lock.json")), "package-lock.json should be committed for npm ci");
		const releaseWorkflow = readTextFile(".github/workflows/release.yml");
		const testWorkflow = readTextFile(".github/workflows/test.yml");

		assert.match(releaseWorkflow, /cache:\s*"?npm"?/);
		assert.match(testWorkflow, /cache:\s*"?npm"?/);
		assert.match(releaseWorkflow, /run:\s*npm ci/);
		assert.match(testWorkflow, /run:\s*npm ci/);
		assert.doesNotMatch(releaseWorkflow, /run:\s*npm install/);
		assert.doesNotMatch(testWorkflow, /run:\s*npm install/);
	});

	void it("denies nonessential transitive dependency build scripts for pnpm install", () => {
		const workspaceConfig = readTextFile("pnpm-workspace.yaml");
		assert.match(workspaceConfig, /^allowBuilds:\n/m);
		assert.match(workspaceConfig, /^ {2}'@google\/genai': false$/m);
		assert.match(workspaceConfig, /^ {2}protobufjs: false$/m);
	});

	void it("uses Pi 0.79.1 or newer dev dependencies for project trust APIs", () => {
		const packageJson = readPackageJson();
		const deps = (packageJson.devDependencies as Record<string, string> | undefined) ?? {};

		assert.match(deps["@earendil-works/pi-agent-core"] ?? "", /\^0\.79\.1|>=0\.79\.1/);
		assert.match(deps["@earendil-works/pi-ai"] ?? "", /\^0\.79\.1|>=0\.79\.1/);
		assert.match(deps["@earendil-works/pi-coding-agent"] ?? "", /\^0\.79\.1|>=0\.79\.1/);
		assert.match(deps["@earendil-works/pi-tui"] ?? "", /\^0\.79\.1|>=0\.79\.1/);
	});
});
