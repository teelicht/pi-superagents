/**
 * Unit tests for TUI rendering helpers.
 *
 * Responsibilities:
 * - verify string padding utilities
 * - verify scroll labels
 * - verify framed panel rendering uses theme border/background APIs
 */

import * as assert from "node:assert/strict";
import { test } from "node:test";
import { formatScrollInfo, pad, renderFramedPanel } from "../../src/ui/render-helpers.ts";

function createRecordingTheme() {
	const calls: string[] = [];
	return {
		calls,
		theme: {
			fg(color: string, text: string): string {
				calls.push(`fg:${color}`);
				return text;
			},
			bg(color: string, text: string): string {
				calls.push(`bg:${color}`);
				return text;
			},
			bold(text: string): string {
				return text;
			},
		},
	};
}

void test("pad strings correctly", () => {
	assert.strictEqual(pad("test", 6), "test  ");
	assert.strictEqual(pad("longtest", 4), "longtest");
});

void test("formatScrollInfo returns correct labels", () => {
	assert.strictEqual(formatScrollInfo(0, 0), "");
	assert.strictEqual(formatScrollInfo(2, 3), "↑ 2 more ... ↓ 3 more");
});

void test("renderFramedPanel wraps content in a stable green frame with background", () => {
	const { calls, theme } = createRecordingTheme();
	const lines = renderFramedPanel("Subagents Status", ["Active", "> sp-implementer | OK"], 32, theme as never, "q close");

	assert.deepStrictEqual(lines, [
		"┌──────────────────────────────┐",
		"│ Subagents Status             │",
		"├──────────────────────────────┤",
		"│ Active                       │",
		"│ > sp-implementer | OK        │",
		"├──────────────────────────────┤",
		"│ q close                      │",
		"└──────────────────────────────┘",
	]);
	assert.ok(calls.includes("fg:success"), "expected green success foreground calls");
	assert.ok(calls.includes("bg:toolSuccessBg"), "expected green background calls");
});

void test("renderFramedPanel truncates long rows inside the frame", () => {
	const { theme } = createRecordingTheme();
	const lines = renderFramedPanel("Title", ["abcdefghijklmnopqrstuvwxyz"], 14, theme as never);

	// The truncateToWidth function applies ANSI codes to the ellipsis.
	// Verify structure: content line contains truncated prefix and ellipsis.
	assert.ok(lines[3].startsWith("│ abcdefgh"), "should start with truncated prefix");
	assert.ok(lines[3].includes("..."), "should contain ellipsis");
	assert.ok(lines[3].endsWith("│"), "should end with closing border");
	assert.strictEqual(lines[0], "┌────────────┐");
	assert.strictEqual(lines[1], "│ Title      │");
	assert.strictEqual(lines[2], "├────────────┤");
	assert.strictEqual(lines[4], "└────────────┘");
});
