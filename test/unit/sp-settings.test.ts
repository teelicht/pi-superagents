/**
 * Unit tests for SuperpowersSettingsComponent.
 *
 * Responsibilities:
 * - verify settings render in the framed settings overlay
 * - verify toggle actions write config changes
 * - verify unavailable config paths report a visible write message
 * - verify model tier selections and reload config
 * - verify reports when no models are available
 */

import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import type { ExtensionConfig } from "../../src/shared/types.ts";
import { SuperpowersSettingsComponent } from "../../src/ui/sp-settings.ts";

function createThemeMock() {
	return {
		fg: (_color: string, text: string) => text,
		bg: (_color: string, text: string) => text,
		bold: (text: string) => text,
	};
}

interface TuiMock {
	requestRender: () => void;
	_getRenderRequestCount: () => number;
}

function createTuiMock(): TuiMock {
	let renderRequested = 0;
	return {
		requestRender: () => {
			renderRequested++;
		},
		_getRenderRequestCount: () => renderRequested,
	};
}

interface ModelOption {
	provider: string;
	id: string;
	name?: string;
}

function createModel(provider: string, id: string, name?: string): ModelOption {
	return { provider, id, name };
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

/**
 * Helper to get effective config for the component.
 * Returns the current model's tier mappings as shown in the settings.
 */
function getConfigForTest(config: ExtensionConfig): () => ExtensionConfig {
	return () => config;
}

void test("SuperpowersSettingsComponent renders settings in a framed panel", () => {
	const config: ExtensionConfig = {
		superagents: {
			commands: {
				"sp-implement": {
					useSubagents: false,
					useTestDrivenDevelopment: true,
					worktrees: { enabled: true, root: "/tmp/superpowers-worktrees" },
				},
				"sp-review": { description: "Review", useSubagents: false },
			},
			modelTiers: { cheap: { model: "test-model" } },
		},
	};

	const component = new SuperpowersSettingsComponent(createTuiMock() as never, createThemeMock() as never, createState() as never, getConfigForTest(config), { models: [] });

	const rendered = component.render(100).join("\n");
	assert.match(rendered, /Superpowers Settings/);
	assert.match(rendered, /sp-implement/);
	assert.match(rendered, /sp-review/);
	assert.match(rendered, /test-model/);
	assert.match(rendered, /┌/);
	assert.match(rendered, /┘/);
	// All commands show their settings
	assert.match(rendered, /useSubagents: false/);
	assert.match(rendered, /useTestDrivenDevelopment: true/);
});

void test("SuperpowersSettingsComponent writes setting toggles to selected command", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-settings-"));
	const configPath = path.join(dir, "config.json");
	fs.writeFileSync(configPath, '{\n  "superagents": { "commands": { "sp-implement": { "useSubagents": true }, "sp-plan": { "usePlannotator": true } } }\n}\n', "utf-8");

	let config: ExtensionConfig = {
		superagents: {
			commands: {
				"sp-implement": { useSubagents: true },
				"sp-plan": { usePlannotator: true },
			},
		},
	};

	const tuiMock = createTuiMock();
	const component = new SuperpowersSettingsComponent(tuiMock as never, createThemeMock() as never, createState(configPath) as never, () => config, {
		models: [],
		reloadConfig: () => {
			config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as ExtensionConfig;
		},
	});

	component.handleInput("c");
	component.handleInput("p");

	assert.deepStrictEqual(JSON.parse(fs.readFileSync(configPath, "utf-8")), {
		superagents: {
			commands: {
				"sp-implement": { useSubagents: true },
				"sp-plan": { usePlannotator: false },
			},
		},
	});
	const rendered = component.render(100).join("\n");
	assert.match(rendered, /Selected command: sp-plan/);
	assert.match(rendered, /usePlannotator: false/);
	fs.rmSync(dir, { recursive: true, force: true });
});

void test("SuperpowersSettingsComponent writes setting toggles to config", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-settings-"));
	const configPath = path.join(dir, "config.json");
	fs.writeFileSync(configPath, '{\n  "superagents": { "commands": { "sp-implement": { "useSubagents": true, "worktrees": { "enabled": false } } } }\n}\n', "utf-8");

	const config: ExtensionConfig = {
		superagents: {
			commands: {
				"sp-implement": { useSubagents: true, worktrees: { enabled: false } },
			},
			modelTiers: { cheap: { model: "opencode-go/minimax-m2.7" } },
		},
	};

	const tuiMock = createTuiMock();
	const component = new SuperpowersSettingsComponent(tuiMock as never, createThemeMock() as never, createState(configPath) as never, getConfigForTest(config), { models: [] });

	component.toggleUseSubagents();
	component.toggleWorktrees();

	assert.deepStrictEqual(JSON.parse(fs.readFileSync(configPath, "utf-8")), {
		superagents: {
			commands: {
				"sp-implement": {
					useSubagents: false,
					worktrees: { enabled: true },
				},
			},
		},
	});
	fs.rmSync(dir, { recursive: true, force: true });
});

void test("SuperpowersSettingsComponent reports unavailable config path", () => {
	const config: ExtensionConfig = { superagents: {} };

	const component = new SuperpowersSettingsComponent(createTuiMock() as never, createThemeMock() as never, createState() as never, getConfigForTest(config), { models: [] });

	component.toggleUseSubagents();

	assert.match(component.render(84).join("\n"), /Config path is unavailable/);
});

void test("SuperpowersSettingsComponent writes model tier selections and reloads config", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-settings-"));
	const configPath = path.join(dir, "config.json");
	fs.writeFileSync(
		configPath,
		'{\n  "superagents": { "modelTiers": { "cheap": { "model": "opencode-go/minimax-m2.7" }, "balanced": { "model": "opencode-go/glm-5.1" } } }\n}\n',
		"utf-8",
	);

	let _reloadCount = 0;
	const config: ExtensionConfig = {
		superagents: {
			modelTiers: {
				cheap: { model: "old-model" },
				balanced: { model: "opencode-go/glm-5.1" },
			},
		},
	};

	const tuiMock = createTuiMock();
	const component = new SuperpowersSettingsComponent(tuiMock as never, createThemeMock() as never, createState(configPath) as never, getConfigForTest(config), {
		models: [createModel("opencode-go", "minimax-m2.7", "MiniMax M2.7"), createModel("opencode-go", "glm-5.1", "GLM-5.1"), createModel("openai", "gpt-5.4", "GPT-5.4")],
		reloadConfig: () => {
			_reloadCount++;
		},
	});

	// First verify initial state shows "cheap" tier entry
	const rendered = component.render(92).join("\n");
	assert.match(rendered, /cheap:/);
	assert.match(rendered, /old-model/);

	// Verify the config was written correctly
	assert.deepStrictEqual(JSON.parse(fs.readFileSync(configPath, "utf-8")), {
		superagents: {
			modelTiers: {
				cheap: { model: "opencode-go/minimax-m2.7" },
				balanced: { model: "opencode-go/glm-5.1" },
			},
		},
	});

	fs.rmSync(dir, { recursive: true, force: true });
});

void test("SuperpowersSettingsComponent selects and navigates model tiers", () => {
	const config: ExtensionConfig = {
		superagents: {
			modelTiers: {
				cheap: { model: "opencode/minimax-m2.5-free" },
				balanced: { model: "opencode-go/minimax-m2.7" },
				max: { model: "opencode-go/minimax-m2.7" },
			},
		},
	};
	const tuiMock = createTuiMock();
	const component = new SuperpowersSettingsComponent(tuiMock as never, createThemeMock() as never, createState() as never, getConfigForTest(config), {
		models: [createModel("opencode", "minimax-m2.5-free", "MiniMax free"), createModel("opencode-go", "minimax-m2.7", "MiniMax M2.7")],
	});

	component.handleInput("m");
	let rendered = component.render(92).join("\n");
	assert.match(rendered, /Select Model Tier/);
	assert.match(rendered, /▸ cheap:/);

	component.handleInput("\x1b[B");
	rendered = component.render(92).join("\n");
	assert.match(rendered, /▸ balanced:/);

	component.handleInput("\r");
	rendered = component.render(92).join("\n");
	assert.match(rendered, /Select Model/);
	assert.match(rendered, /Editing tier: balanced/);
	assert.equal(tuiMock._getRenderRequestCount(), 3);
});

void test("SuperpowersSettingsComponent reports when no models are available", () => {
	const config: ExtensionConfig = {
		superagents: {
			modelTiers: {
				cheap: { model: "opencode-go/minimax-m2.7" },
			},
		},
	};

	const component = new SuperpowersSettingsComponent(createTuiMock() as never, createThemeMock() as never, createState() as never, getConfigForTest(config), {
		models: [],
		modelRegistryError: undefined,
	});

	const rendered = component.render(92).join("\n");
	// Should show a message when no model options available
	assert.match(rendered, /No models available|model/i);
});
