/**
 * Unit tests for SuperpowersSettingsComponent.
 *
 * Responsibilities:
 * - verify settings render in the framed settings overlay
 * - verify toggle actions write config changes
 * - verify unavailable config paths report a visible write message
 */

import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SuperpowersSettingsComponent } from "../../src/ui/sp-settings.ts";

function createThemeMock() {
	return {
		fg: (_color: string, text: string) => text,
		bg: (_color: string, text: string) => text,
		bold: (text: string) => text,
	};
}

function createTuiMock() {
	return { requestRender: () => {} };
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

void test("SuperpowersSettingsComponent renders settings in a framed panel", () => {
	const component = new SuperpowersSettingsComponent(
		createTuiMock() as never,
		createThemeMock() as never,
		createState() as never,
		{
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
		} as never,
		() => {},
	);

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

void test("SuperpowersSettingsComponent writes setting toggles to config", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-settings-"));
	const configPath = path.join(dir, "config.json");
	fs.writeFileSync(
		configPath,
		'{\n  "superagents": { "commands": { "sp-implement": { "useSubagents": true, "worktrees": { "enabled": false } } } }\n}\n',
		"utf-8",
	);
	const component = new SuperpowersSettingsComponent(
		createTuiMock() as never,
		createThemeMock() as never,
		createState(configPath) as never,
		{
			superagents: {
				commands: {
					"sp-implement": { useSubagents: true, worktrees: { enabled: false } },
				},
			},
		} as never,
		() => {},
	);

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
	const component = new SuperpowersSettingsComponent(
		createTuiMock() as never,
		createThemeMock() as never,
		createState() as never,
		{ superagents: {} } as never,
		() => {},
	);

	component.toggleUseSubagents();

	assert.match(component.render(84).join("\n"), /Config path is unavailable/);
});
