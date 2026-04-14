/**
 * Unit tests for SubagentsStatusComponent.
 *
 * Responsibilities:
 * - verify the status overlay renders as a framed subagents run monitor
 * - verify empty-run navigation cannot create a negative cursor
 * - verify selected run details include step metrics and errors
 * - verify timer cleanup is safe
 */

import { test } from "node:test";
import * as assert from "node:assert";
import type { RunEntry } from "../../src/execution/run-history.ts";
import { SubagentsStatusComponent } from "../../src/ui/subagents-status.ts";

function createThemeMock() {
	return {
		fg: (_color: string, text: string) => text,
		bg: (_color: string, text: string) => text,
		bold: (text: string) => text,
	};
}

function createTuiMock() {
	let renderCount = 0;
	return {
		tui: {
			requestRender: () => {
				renderCount++;
			},
		},
		get renderCount() {
			return renderCount;
		},
	};
}

function createRun(overrides: Partial<RunEntry> = {}): RunEntry {
	return {
		agent: "sp-implementer",
		task: "Implement auth fix",
		ts: 1,
		status: "ok",
		duration: 1250,
		model: "test-model",
		tokens: { total: 1536 },
		steps: [
			{ index: 0, agent: "sp-recon", status: "complete", durationMs: 250, tokens: { total: 256 } },
			{ index: 1, agent: "sp-implementer", status: "failed", durationMs: 1000, tokens: { total: 1280 }, error: "boom" },
		],
		...overrides,
	};
}

test("SubagentsStatusComponent renders a framed status panel", () => {
	const tuiMock = createTuiMock();
	const component = new SubagentsStatusComponent(
		tuiMock.tui as never,
		createThemeMock() as never,
		() => {},
		{
			refreshMs: 60_000,
			getActiveRuns: () => [createRun({ task: "Active task", duration: 0 })],
			getRecentRuns: () => [],
		},
	);

	const rendered = component.render(84).join("\n");
	assert.match(rendered, /Subagents Status/);
	assert.match(rendered, /Active/);
	assert.match(rendered, /Active task/);
	assert.match(rendered, /┌/);
	assert.match(rendered, /┘/);

	component.dispose();
});

test("SubagentsStatusComponent keeps empty-run navigation safe", () => {
	const tuiMock = createTuiMock();
	const component = new SubagentsStatusComponent(
		tuiMock.tui as never,
		createThemeMock() as never,
		() => {},
		{
			refreshMs: 60_000,
			getActiveRuns: () => [],
			getRecentRuns: () => [],
		},
	);

	component.handleInput("\u001b[B");
	const rendered = component.render(84).join("\n");

	assert.match(rendered, /No runs recorded/);
	assert.equal(tuiMock.renderCount, 1);
	component.dispose();
});

test("SubagentsStatusComponent renders selected step details", () => {
	const component = new SubagentsStatusComponent(
		createTuiMock().tui as never,
		createThemeMock() as never,
		() => {},
		{
			refreshMs: 60_000,
			getActiveRuns: () => [],
			getRecentRuns: () => [createRun()],
		},
	);

	const rendered = component.render(100).join("\n");

	assert.match(rendered, /Selected Details/);
	assert.match(rendered, /sp-recon/);
	assert.match(rendered, /complete/);
	assert.match(rendered, /256 tok/);
	assert.match(rendered, /sp-implementer/);
	assert.match(rendered, /failed/);
	assert.match(rendered, /boom/);
	component.dispose();
});

test("SubagentsStatusComponent closes and disposes safely", () => {
	let closed = 0;
	const component = new SubagentsStatusComponent(
		createTuiMock().tui as never,
		createThemeMock() as never,
		() => {
			closed++;
		},
		{
			refreshMs: 60_000,
			getActiveRuns: () => [],
			getRecentRuns: () => [],
		},
	);

	component.handleInput("q");
	assert.equal(closed, 1);
	assert.doesNotThrow(() => component.dispose());
	assert.doesNotThrow(() => component.dispose());
});
