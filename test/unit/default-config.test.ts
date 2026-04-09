/**
 * Unit tests for the shipped default extension config template.
 *
 * Responsibilities:
 * - ensure installers have a concrete starter config to copy
 * - verify the Superpowers tier defaults use the supported tier names
 * - keep optional per-tier thinking defaults documented in machine-readable form
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";

/**
 * Read and parse the default config template shipped with the extension.
 *
 * @returns Parsed JSON object for the default installer config.
 */
function readDefaultConfig(): Record<string, unknown> {
	const filePath = path.join(process.cwd(), "default-config.json");
	return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
}

describe("default-config.json", () => {
	it("ships a superpowers tier mapping with balanced and optional thinking", () => {
		const config = readDefaultConfig();
		const superpowers = config.superpowers as {
			modelTiers?: Record<string, { model?: string; thinking?: string }>;
		};

		assert.equal(superpowers.modelTiers?.cheap?.model, "openai/gpt-5.3-mini");
		assert.equal(superpowers.modelTiers?.balanced?.model, "openai/gpt-5.4");
		assert.equal(superpowers.modelTiers?.max?.model, "anthropic/claude-opus-4-6");
		assert.ok("thinking" in (superpowers.modelTiers?.cheap ?? {}));
		assert.ok("thinking" in (superpowers.modelTiers?.balanced ?? {}));
		assert.ok("thinking" in (superpowers.modelTiers?.max ?? {}));
	});
});
