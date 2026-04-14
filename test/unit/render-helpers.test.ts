// test/unit/render-helpers.test.ts
import { test } from "node:test";
import * as assert from "node:assert";
import { formatScrollInfo, pad } from "../../src/ui/render-helpers.ts";

test("pad strings correctly", () => {
	assert.strictEqual(pad("test", 6), "test  ");
	assert.strictEqual(pad("longtest", 4), "longtest");
});

test("formatScrollInfo returns correct labels", () => {
	assert.strictEqual(formatScrollInfo(0, 0), "");
	assert.strictEqual(formatScrollInfo(2, 3), "↑ 2 more ... ↓ 3 more");
});
