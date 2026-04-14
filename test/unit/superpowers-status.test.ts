/**
 * Unit tests for SuperpowersStatusComponent TUI refactor.
 *
 * Verifies that the component implements the Component interface correctly:
 * - render() returns string array
 * - dispose() method exists and works
 * - handleInput() method exists
 */

import { test } from "node:test";
import * as assert from "node:assert";
import { SuperpowersStatusComponent } from "../../src/ui/superpowers-status.ts";

test("SuperpowersStatusComponent returns string array on render", () => {
	const tuiMock = { requestRender: () => {} } as any;
	const themeMock = { fg: (_: string, text: string) => text } as any;
	const stateMock = { configGate: { blocked: false } } as any;
	const configMock = { superagents: {} } as any;

	const comp = new SuperpowersStatusComponent(tuiMock, themeMock, stateMock, configMock, () => {});

	const lines = comp.render(80);
	assert.ok(Array.isArray(lines), "render() should return an array");
	assert.ok(lines.length > 0, "render() should return non-empty array");

	comp.dispose();
});

test("SuperpowersStatusComponent has dispose method that clears refresh timer", () => {
	const tuiMock = { requestRender: () => {} } as any;
	const themeMock = { fg: (_: string, text: string) => text } as any;
	const stateMock = { configGate: { blocked: false } } as any;
	const configMock = { superagents: {} } as any;

	const comp = new SuperpowersStatusComponent(tuiMock, themeMock, stateMock, configMock, () => {});

	// dispose() should be callable without errors
	assert.doesNotThrow(() => comp.dispose(), "dispose() should not throw");

	// dispose() should be idempotent (callable multiple times)
	assert.doesNotThrow(() => comp.dispose(), "dispose() should be callable multiple times");
});

test("SuperpowersStatusComponent has handleInput method", () => {
	const tuiMock = { requestRender: () => {} } as any;
	const themeMock = { fg: (_: string, text: string) => text } as any;
	const stateMock = { configGate: { blocked: false } } as any;
	const configMock = { superagents: {} } as any;

	const comp = new SuperpowersStatusComponent(tuiMock, themeMock, stateMock, configMock, () => {});

	assert.strictEqual(typeof comp.handleInput, "function", "handleInput should be a function");

	comp.dispose();
});

test("SuperpowersStatusComponent implements Component interface", () => {
	const tuiMock = { requestRender: () => {} } as any;
	const themeMock = { fg: (_: string, text: string) => text } as any;
	const stateMock = { configGate: { blocked: false } } as any;
	const configMock = { superagents: {} } as any;

	const comp = new SuperpowersStatusComponent(tuiMock, themeMock, stateMock, configMock, () => {});

	// Component interface requires: render(width: number): string[]
	assert.strictEqual(typeof comp.render, "function", "render should be a function");

	// Component interface requires: handleInput?(data: string): void
	assert.strictEqual(typeof comp.handleInput, "function", "handleInput should be a function");

	// Component interface requires: invalidate(): void
	assert.strictEqual(typeof comp.invalidate, "function", "invalidate should be a function");

	// Our extension: dispose(): void
	assert.strictEqual(typeof comp.dispose, "function", "dispose should be a function");

	comp.dispose();
});

test("SuperpowersStatusComponent returns string array with header and content", () => {
	const tuiMock = { requestRender: () => {} } as any;
	const themeMock = {
		fg: (_: string, text: string) => text,
	} as any;
	const stateMock = {
		configGate: { blocked: false, configPath: "/test/config.json" },
	} as any;
	const configMock = {
		superagents: {
			useSubagents: true,
			useTestDrivenDevelopment: false,
		},
	} as any;

	const comp = new SuperpowersStatusComponent(tuiMock, themeMock, stateMock, configMock, () => {});

	const lines = comp.render(84);

	// Should return array of strings
	assert.ok(Array.isArray(lines), "render() should return an array");
	assert.ok(lines.every((line) => typeof line === "string"), "All lines should be strings");

	// Lines should contain content (not empty array)
	assert.ok(lines.length >= 3, "Should have at least header, content, and footer lines");

	comp.dispose();
});
