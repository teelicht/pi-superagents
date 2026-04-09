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
	it("ships a superagents tier mapping with the supported tier keys", () => {
		const config = readDefaultConfig();
		const superagents = config.superagents as {
			modelTiers?: Record<string, { model?: string; thinking?: string }>;
		};

		assert.equal(typeof superagents.modelTiers?.cheap?.model, "string");
		assert.equal(typeof superagents.modelTiers?.balanced?.model, "string");
		assert.equal(typeof superagents.modelTiers?.max?.model, "string");
		assert.ok((superagents.modelTiers?.cheap?.model?.length ?? 0) > 0);
		assert.ok((superagents.modelTiers?.balanced?.model?.length ?? 0) > 0);
		assert.ok((superagents.modelTiers?.max?.model?.length ?? 0) > 0);
	});
});
