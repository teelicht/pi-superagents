/**
 * E2E test: npm pack + install sandbox verification.
 *
 * Uses pi-test-harness verifySandboxInstall() to ensure the published package
 * can be installed cleanly with the package directory layout and loads
 * expected extensions/tools.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, type TestContext } from "node:test";
import { tryImport } from "../support/helpers.ts";

const harness = await tryImport<any>("@marcfargas/pi-test-harness");
const available = !!harness;
const PACKAGE_DIR = path.resolve(".");
const EXPECTED_TOOLS = ["subagent", "superpowers_plan_review", "superpowers_spec_review"];

interface PackageManifest {
	pi?: {
		extensions?: unknown;
	};
}

/**
 * Identify npm failures caused by registry/network availability.
 *
 * @param error Error thrown by the harness npm install command.
 * @returns True when the sandbox cannot populate a clean npm cache.
 */
function isNpmRegistryUnavailable(error: unknown): boolean {
	const text =
		error instanceof Error
			? `${error.message}\n${String((error as { stderr?: unknown }).stderr ?? "")}`
			: String(error);
	return /\b(ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|ENETUNREACH)\b/.test(text);
}

/**
 * Read the number of Pi extension entrypoints advertised by the package manifest.
 *
 * @param packageDir Repository/package directory containing `package.json`.
 * @returns Count of manifest-declared Pi extension entrypoints.
 * @throws SyntaxError when `package.json` is not valid JSON.
 */
function readManifestExtensionCount(packageDir: string): number {
	const packageJsonPath = path.join(packageDir, "package.json");
	const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as PackageManifest;
	const extensions = packageJson.pi?.extensions;
	return Array.isArray(extensions) ? extensions.length : 0;
}

void describe("sandbox install", { skip: !available ? "pi-test-harness not available" : undefined }, () => {
	const { verifySandboxInstall } = harness;
	const expectedExtensions = readManifestExtensionCount(PACKAGE_DIR);

	void it(
		"loads extension after npm pack+install with expected tools",
		{ timeout: 120_000 },
		async (t: TestContext) => {
			const originalEnv = {
				cache: process.env.npm_config_cache,
				fetchRetries: process.env.npm_config_fetch_retries,
				fetchRetryMinTimeout: process.env.npm_config_fetch_retry_mintimeout,
				fetchRetryMaxTimeout: process.env.npm_config_fetch_retry_maxtimeout,
				fetchTimeout: process.env.npm_config_fetch_timeout,
			};
			const fallbackCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-superagents-npm-cache-"));
			process.env.npm_config_cache = fallbackCacheDir;
			process.env.npm_config_fetch_retries = "0";
			process.env.npm_config_fetch_retry_mintimeout = "1000";
			process.env.npm_config_fetch_retry_maxtimeout = "1000";
			process.env.npm_config_fetch_timeout = "10000";

			let result: Awaited<ReturnType<typeof verifySandboxInstall>> | undefined;
			try {
				result = await verifySandboxInstall({
					packageDir: PACKAGE_DIR,
					expect: {
						extensions: expectedExtensions,
						tools: EXPECTED_TOOLS,
					},
				});
			} catch (error) {
				if (isNpmRegistryUnavailable(error)) {
					t.skip("npm registry is unavailable, so the clean sandbox install cannot populate dependencies");
					return;
				}
				throw error;
			} finally {
				if (originalEnv.cache === undefined) {
					delete process.env.npm_config_cache;
				} else {
					process.env.npm_config_cache = originalEnv.cache;
				}
				if (originalEnv.fetchRetries === undefined) delete process.env.npm_config_fetch_retries;
				else process.env.npm_config_fetch_retries = originalEnv.fetchRetries;
				if (originalEnv.fetchRetryMinTimeout === undefined) delete process.env.npm_config_fetch_retry_mintimeout;
				else process.env.npm_config_fetch_retry_mintimeout = originalEnv.fetchRetryMinTimeout;
				if (originalEnv.fetchRetryMaxTimeout === undefined) delete process.env.npm_config_fetch_retry_maxtimeout;
				else process.env.npm_config_fetch_retry_maxtimeout = originalEnv.fetchRetryMaxTimeout;
				if (originalEnv.fetchTimeout === undefined) delete process.env.npm_config_fetch_timeout;
				else process.env.npm_config_fetch_timeout = originalEnv.fetchTimeout;
				if (fallbackCacheDir) {
					fs.rmSync(fallbackCacheDir, { recursive: true, force: true });
				}
			}

			assert.ok(result);
			assert.deepEqual(result.loaded.extensionErrors, []);
			assert.equal(result.loaded.extensions, expectedExtensions);
			for (const toolName of EXPECTED_TOOLS) {
				assert.ok(result.loaded.tools.includes(toolName), `expected ${toolName} to be installed`);
			}

			const installDir =
				(result as { installDir?: string; packageDir?: string }).installDir ??
				(result as { packageDir?: string }).packageDir;
			if (installDir) {
				assert.ok(
					fs.existsSync(path.join(installDir, "config.example.json")),
					"config.example.json should be installed",
				);
				assert.equal(
					fs.existsSync(path.join(installDir, "config.json")),
					false,
					"config.json should not be a packaged file",
				);
			}
		},
	);
});
