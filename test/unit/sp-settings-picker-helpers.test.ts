/**
 * Unit tests for handlePickerInput helper functions.
 *
 * Responsibilities:
 * - verify pure key-handling logic extracted from handlePickerInput
 * - verify navigation decisions are made correctly in each picker mode
 * - verify model/thinking selection transitions
 */

import * as assert from "node:assert";
import { test } from "node:test";
import type { SuperpowersSettingsComponent } from "../../src/ui/sp-settings.ts";
import { SuperpowersSettingsComponent as TestedComponent } from "../../src/ui/sp-settings.ts";

// Re-export helper types for testing
export type { SettingsMode, SettingsModelOption } from "../../src/ui/sp-settings.ts";

function createThemeMock() {
	return {
		fg: (_color: string, text: string) => text,
		bg: (_color: string, text: string) => text,
		bold: (text: string) => text,
	};
}

function createTuiMock() {
	let renderRequested = 0;
	return {
		requestRender: () => {
			renderRequested++;
		},
		_getRenderRequestCount: () => renderRequested,
	};
}

function createState(configPath?: string) {
	return {
		configGate: {
			blocked: false,
			diagnostics: [],
			message: "",
			configPath,
		},
	};
}

function createModel(provider: string, id: string, name?: string) {
	return { provider, id, name };
}

void test("handlePickerInput helper: q key navigates back from tier-picker to settings", () => {
	const config = { superagents: { modelTiers: { cheap: { model: "test" } } } };
	const component = new TestedComponent(createTuiMock() as never, createThemeMock() as never, createState() as never, () => config, { models: [createModel("test", "model")] });

	// Enter tier-picker mode
	component.handleInput("m");
	assert.match(component.render(92).join("\n"), /Select Model Tier/);

	// Press q - should go back to settings
	component.handleInput("q");
	assert.match(component.render(92).join("\n"), /Superpowers Settings/);
});

void test("handlePickerInput helper: q key navigates back from thinking-picker to tier-picker", () => {
	const config = { superagents: { modelTiers: { cheap: { model: "test" } } } };
	const component = new TestedComponent(createTuiMock() as never, createThemeMock() as never, createState() as never, () => config, { models: [createModel("test", "model")] });

	// Navigate to thinking picker
	component.handleInput("m");
	component.handleInput("\r"); // Select tier
	assert.match(component.render(92).join("\n"), /Select Model/);
	component.handleInput("\r"); // Select model
	assert.match(component.render(92).join("\n"), /Select Thinking Level/);

	// Press q - should go back to tier-picker
	component.handleInput("q");
	assert.match(component.render(92).join("\n"), /Select Model Tier/);
});

void test("handlePickerInput helper: escape key in tier-picker goes to settings", () => {
	const config = { superagents: { modelTiers: { cheap: { model: "test" } } } };
	const component = new TestedComponent(createTuiMock() as never, createThemeMock() as never, createState() as never, () => config, { models: [createModel("test", "model")] });

	component.handleInput("m");
	component.handleInput("\x1b"); // Escape
	assert.match(component.render(92).join("\n"), /Superpowers Settings/);
});

void test("handlePickerInput helper: up arrow navigates tier picker", () => {
	const config = {
		superagents: {
			modelTiers: {
				cheap: { model: "cheap-model" },
				balanced: { model: "balanced-model" },
				max: { model: "max-model" },
			},
		},
	};
	const component = new TestedComponent(createTuiMock() as never, createThemeMock() as never, createState() as never, () => config, { models: [] });

	component.handleInput("m");
	// Should start at cheap
	assert.match(component.render(92).join("\n"), /▸ cheap:/);

	// Go down to balanced
	component.handleInput("\x1b[B"); // down arrow
	assert.match(component.render(92).join("\n"), /▸ balanced:/);

	// Go down to max
	component.handleInput("\x1b[B");
	assert.match(component.render(92).join("\n"), /▸ max:/);

	// Wrap around to cheap
	component.handleInput("\x1b[B");
	assert.match(component.render(92).join("\n"), /▸ cheap:/);
});

void test("handlePickerInput helper: k key navigates tier picker (vim-style)", () => {
	const config = {
		superagents: {
			modelTiers: {
				cheap: { model: "cheap-model" },
				balanced: { model: "balanced-model" },
			},
		},
	};
	const component = new TestedComponent(createTuiMock() as never, createThemeMock() as never, createState() as never, () => config, { models: [] });

	component.handleInput("m");
	assert.match(component.render(92).join("\n"), /▸ cheap:/);

	// k goes up (wraps to last)
	component.handleInput("k");
	assert.match(component.render(92).join("\n"), /▸ balanced:/);

	// k wraps around
	component.handleInput("k");
	assert.match(component.render(92).join("\n"), /▸ cheap:/);
});

void test("handlePickerInput helper: j key navigates tier picker (vim-style)", () => {
	const config = {
		superagents: {
			modelTiers: {
				cheap: { model: "cheap-model" },
				balanced: { model: "balanced-model" },
			},
		},
	};
	const component = new TestedComponent(createTuiMock() as never, createThemeMock() as never, createState() as never, () => config, { models: [] });

	component.handleInput("m");
	assert.match(component.render(92).join("\n"), /▸ cheap:/);

	// j goes down
	component.handleInput("j");
	assert.match(component.render(92).join("\n"), /▸ balanced:/);
});

void test("handlePickerInput helper: enter selects tier and enters model picker", () => {
	const config = { superagents: { modelTiers: { cheap: { model: "test" } } } };
	const component = new TestedComponent(createTuiMock() as never, createThemeMock() as never, createState() as never, () => config, { models: [createModel("test", "model")] });

	component.handleInput("m");
	component.handleInput("\r");
	assert.match(component.render(92).join("\n"), /Select Model/);
	assert.match(component.render(92).join("\n"), /Editing tier: cheap/);
});

void test("handlePickerInput helper: backspace in model picker removes last search char", () => {
	const config = { superagents: { modelTiers: { cheap: { model: "test" } } } };
	const component = new TestedComponent(createTuiMock() as never, createThemeMock() as never, createState() as never, () => config, {
		models: [createModel("test", "alpha"), createModel("test", "beta"), createModel("other", "gamma")],
	});

	component.handleInput("m");
	component.handleInput("\r"); // Enter model picker

	// Type search
	component.handleInput("a");
	assert.match(component.render(92).join("\n"), /Search: a_/);

	// Backspace
	component.handleInput("\x7f");
	assert.match(component.render(92).join("\n"), /Type to search/);
});

void test("handlePickerInput helper: escape in model picker with search clears search", () => {
	const config = { superagents: { modelTiers: { cheap: { model: "test" } } } };
	const component = new TestedComponent(createTuiMock() as never, createThemeMock() as never, createState() as never, () => config, { models: [createModel("test", "alpha")] });

	component.handleInput("m");
	component.handleInput("\r");
	component.handleInput("a");

	// Escape clears search
	component.handleInput("\x1b");
	assert.match(component.render(92).join("\n"), /Type to search/);
	assert.match(component.render(92).join("\n"), /Select Model/);
});

void test("handlePickerInput helper: escape in model picker without search goes to tier-picker", () => {
	const config = { superagents: { modelTiers: { cheap: { model: "test" } } } };
	const component = new TestedComponent(createTuiMock() as never, createThemeMock() as never, createState() as never, () => config, { models: [createModel("test", "alpha")] });

	component.handleInput("m");
	component.handleInput("\r");

	// Escape without search goes back
	component.handleInput("\x1b");
	assert.match(component.render(92).join("\n"), /Select Model Tier/);
});

void test("handlePickerInput helper: typing adds to search query in model picker", () => {
	const config = { superagents: { modelTiers: { cheap: { model: "test" } } } };
	const component = new TestedComponent(createTuiMock() as never, createThemeMock() as never, createState() as never, () => config, {
		models: [createModel("test", "alpha"), createModel("test", "beta")],
	});

	component.handleInput("m");
	component.handleInput("\r");

	// Type "al"
	component.handleInput("a");
	component.handleInput("l");

	const rendered = component.render(92).join("\n");
	assert.match(rendered, /Search: al_/);
	assert.match(rendered, /▸ test\/alpha/);
	assert.doesNotMatch(rendered, /test\/beta/);
});

void test("handlePickerInput helper: enter in model picker enters thinking picker", () => {
	const config = { superagents: { modelTiers: { cheap: { model: "old" } } } };
	const component = new TestedComponent(createTuiMock() as never, createThemeMock() as never, createState() as never, () => config, {
		models: [createModel("provider", "new-model", "New Model")],
	});

	component.handleInput("m");
	component.handleInput("\r"); // Enter model picker
	component.handleInput("\r"); // Select model

	assert.match(component.render(92).join("\n"), /Select Thinking Level/);
	assert.match(component.render(92).join("\n"), /Editing tier: cheap/);
});

void test("handlePickerInput helper: up/down navigate in thinking picker", () => {
	const config = { superagents: { modelTiers: { cheap: { model: "test" } } } };
	const component = new TestedComponent(createTuiMock() as never, createThemeMock() as never, createState() as never, () => config, { models: [createModel("test", "model")] });

	// Navigate to thinking picker
	component.handleInput("m");
	component.handleInput("\r");
	component.handleInput("\r");

	// Default selection should be first option (index 0 = default)
	assert.match(component.render(92).join("\n"), /▸ default/);

	// Down arrow goes to next option (index 1 = off)
	component.handleInput("\x1b[B");
	assert.match(component.render(92).join("\n"), /▸ off/);

	// Another down goes to index 2 = minimal
	component.handleInput("\x1b[B");
	assert.match(component.render(92).join("\n"), /▸ minimal/);
});

void test("handlePickerInput helper: enter in thinking picker returns to tier-picker", () => {
	const config = { superagents: { modelTiers: { cheap: { model: "old" } } } };
	const component = new TestedComponent(createTuiMock() as never, createThemeMock() as never, createState() as never, () => config, {
		models: [createModel("provider", "new", "New")],
	});

	component.handleInput("m");
	component.handleInput("\r");
	component.handleInput("\r");
	component.handleInput("\r");

	assert.match(component.render(92).join("\n"), /Select Model Tier/);
});

void test("handlePickerInput helper: j/k navigate in model picker", () => {
	const config = { superagents: { modelTiers: { cheap: { model: "test" } } } };
	const component = new TestedComponent(createTuiMock() as never, createThemeMock() as never, createState() as never, () => config, {
		models: [createModel("p", "a"), createModel("p", "b"), createModel("p", "c")],
	});

	component.handleInput("m");
	component.handleInput("\r");

	assert.match(component.render(92).join("\n"), /▸ p\/a/);

	component.handleInput("j");
	assert.match(component.render(92).join("\n"), /▸ p\/b/);

	component.handleInput("k");
	assert.match(component.render(92).join("\n"), /▸ p\/a/);
});

void test("handlePickerInput helper: j/k navigate in thinking picker", () => {
	const config = { superagents: { modelTiers: { cheap: { model: "test" } } } };
	const component = new TestedComponent(createTuiMock() as never, createThemeMock() as never, createState() as never, () => config, { models: [createModel("p", "m")] });

	component.handleInput("m");
	component.handleInput("\r");
	component.handleInput("\r");

	assert.match(component.render(92).join("\n"), /▸ default/);

	component.handleInput("j");
	assert.match(component.render(92).join("\n"), /▸ off/);

	component.handleInput("k");
	assert.match(component.render(92).join("\n"), /▸ default/);
});
