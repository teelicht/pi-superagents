/**
 * Unit coverage for the local Pi extension installer helper.
 *
 * Responsibilities:
 * - verify installable files are copied into a Pi extension directory
 * - ensure stale files are removed when refreshing an existing install
 * - keep the local debug-install workflow aligned with the package layout
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import { installLocalExtensionFiles } from "../../scripts/local-extension-install.ts";

/**
 * Create a temporary directory for an isolated installer test case.
 *
 * @param prefix Directory name prefix for the temporary folder.
 * @returns Absolute path to the created directory.
 */
function createTempDir(prefix: string): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Best-effort recursive cleanup for temporary test directories.
 *
 * @param dir Directory to remove.
 */
function removeTempDir(dir: string): void {
	try {
		fs.rmSync(dir, { recursive: true, force: true });
	} catch {}
}

describe("installLocalExtensionFiles", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		while (tempDirs.length > 0) {
			const dir = tempDirs.pop();
			if (dir) removeTempDir(dir);
		}
	});

	it("copies the requested package files into the target extension directory", () => {
		const sourceRoot = createTempDir("pi-local-install-src-");
		const targetRoot = createTempDir("pi-local-install-dst-");
		tempDirs.push(sourceRoot, targetRoot);

		fs.mkdirSync(path.join(sourceRoot, "src", "extension"), { recursive: true });
		fs.mkdirSync(path.join(sourceRoot, "agents"), { recursive: true });
		fs.writeFileSync(path.join(sourceRoot, "src", "extension", "index.ts"), "export default {};\n", "utf-8");
		fs.writeFileSync(path.join(sourceRoot, "src", "extension", "notify.ts"), "export default {};\n", "utf-8");
		fs.writeFileSync(path.join(sourceRoot, "package.json"), "{\n  \"name\": \"pi-superagents\"\n}\n", "utf-8");
		fs.writeFileSync(path.join(sourceRoot, "README.md"), "# Readme\n", "utf-8");
		fs.writeFileSync(path.join(sourceRoot, "agents", "worker.md"), "# Worker\n", "utf-8");

		const copied = installLocalExtensionFiles({
			sourceRoot,
			targetRoot,
			relativePaths: [
				"src/extension/index.ts",
				"src/extension/notify.ts",
				"package.json",
				"README.md",
				"agents/worker.md",
			],
		});

		assert.deepEqual(copied, [
			"README.md",
			"agents/worker.md",
			"package.json",
			"src/extension/index.ts",
			"src/extension/notify.ts",
		]);
		assert.equal(fs.readFileSync(path.join(targetRoot, "src", "extension", "index.ts"), "utf-8"), "export default {};\n");
		assert.equal(fs.readFileSync(path.join(targetRoot, "src", "extension", "notify.ts"), "utf-8"), "export default {};\n");
		assert.equal(fs.readFileSync(path.join(targetRoot, "agents", "worker.md"), "utf-8"), "# Worker\n");
	});

	it("replaces an existing install so stale files do not survive refreshes", () => {
		const sourceRoot = createTempDir("pi-local-install-src-");
		const targetRoot = createTempDir("pi-local-install-dst-");
		tempDirs.push(sourceRoot, targetRoot);

		fs.mkdirSync(path.join(sourceRoot, "src", "extension"), { recursive: true });
		fs.writeFileSync(path.join(sourceRoot, "src", "extension", "index.ts"), "export default 1;\n", "utf-8");
		fs.writeFileSync(path.join(sourceRoot, "package.json"), "{\n  \"name\": \"pi-superagents\"\n}\n", "utf-8");
		fs.writeFileSync(path.join(targetRoot, "stale.ts"), "old\n", "utf-8");

		installLocalExtensionFiles({
			sourceRoot,
			targetRoot,
			relativePaths: ["src/extension/index.ts", "package.json"],
		});

		assert.equal(fs.existsSync(path.join(targetRoot, "stale.ts")), false);
		assert.equal(fs.readFileSync(path.join(targetRoot, "src", "extension", "index.ts"), "utf-8"), "export default 1;\n");
	});
});
