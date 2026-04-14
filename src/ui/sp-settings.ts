/**
 * Superpowers workflow settings overlay.
 *
 * Responsibilities:
 * - display current Superpowers/subagent workflow settings
 * - expose safe toggle keybindings for supported boolean config values
 * - write config changes through config-writer helpers
 *
 * Important side effects:
 * - writes to the user's Pi extension config file when toggles are invoked
 */

import * as fs from "node:fs";
import type { Theme } from "@mariozechner/pi-coding-agent";
import type { Component, TUI } from "@mariozechner/pi-tui";
import { matchesKey } from "@mariozechner/pi-tui";
import type { ExtensionConfig, SubagentState } from "../shared/types.ts";
import {
	toggleSuperpowersBoolean,
	toggleSuperpowersWorktrees,
	updateSuperpowersConfigText,
} from "../superpowers/config-writer.ts";
import { renderFramedPanel } from "./render-helpers.ts";

export class SuperpowersSettingsComponent implements Component {
	private lastWriteMessage = "";
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly state: SubagentState;
	private readonly config: ExtensionConfig;
	private readonly done: () => void;

	constructor(
		tui: TUI,
		theme: Theme,
		state: SubagentState,
		config: ExtensionConfig,
		done: () => void,
	) {
		this.tui = tui;
		this.theme = theme;
		this.state = state;
		this.config = config;
		this.done = done;
	}

	render(width: number): string[] {
		return renderFramedPanel(
			"Superpowers Settings",
			this.renderBody(),
			Math.min(width, 84),
			this.theme,
			"s subagents | t tdd | w worktrees | q close",
		);
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "q") || matchesKey(data, "ctrl+c")) {
			this.done();
			return;
		}
		if (matchesKey(data, "s")) {
			this.toggleUseSubagents();
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "t")) {
			this.toggleUseTestDrivenDevelopment();
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "w")) {
			this.toggleWorktrees();
			this.tui.requestRender();
		}
	}

	invalidate(): void {}

	toggleUseSubagents(): void {
		this.writeConfig((config) => toggleSuperpowersBoolean(config, "useSubagents"));
	}

	toggleUseTestDrivenDevelopment(): void {
		this.writeConfig((config) => toggleSuperpowersBoolean(config, "useTestDrivenDevelopment"));
	}

	toggleWorktrees(): void {
		this.writeConfig((config) => toggleSuperpowersWorktrees(config));
	}

	private renderBody(): string[] {
		const settings = this.config.superagents ?? {};
		const commands = Object.entries(settings.commands ?? {});
		const modelTiers = Object.entries(settings.modelTiers ?? {});
		const lines = [
			`useSubagents: ${settings.useSubagents ?? true} (s)`,
			`useTestDrivenDevelopment: ${settings.useTestDrivenDevelopment ?? true} (t)`,
			`configStatus: ${this.state.configGate.blocked ? "blocked" : "valid"}`,
			`worktrees.enabled: ${settings.worktrees?.enabled ?? false} (w)`,
			`worktrees.root: ${settings.worktrees?.root ?? "default"}`,
			"",
			"Commands:",
			...(commands.length
				? commands.map(
						([name, preset]) =>
							`- ${name}: subagents=${preset.useSubagents ?? "default"}, tdd=${preset.useTestDrivenDevelopment ?? "default"}`,
					)
				: ["- none"]),
			"",
			"Model tiers:",
			...(modelTiers.length
				? modelTiers.map(([name, value]) => `- ${name}: ${tierModel(value)}`)
				: ["- none"]),
		];

		if (this.state.configGate.message) lines.push("", this.state.configGate.message);
		if (this.lastWriteMessage) lines.push("", this.lastWriteMessage);
		return lines;
	}

	private writeConfig(update: Parameters<typeof updateSuperpowersConfigText>[1]): void {
		const configPath = this.state.configGate.configPath;
		if (!configPath) {
			this.lastWriteMessage = "Config path is unavailable. Restart Pi and try again.";
			return;
		}
		try {
			const current = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf-8") : "{}\n";
			const next = updateSuperpowersConfigText(current, update);
			fs.writeFileSync(configPath, next, "utf-8");
			this.lastWriteMessage = `Wrote ${configPath}. Restart or reload Pi to apply command registration changes.`;
		} catch (error) {
			this.lastWriteMessage = error instanceof Error ? error.message : String(error);
		}
	}
}

function tierModel(value: unknown): string {
	if (typeof value === "string") return value;
	if (value && typeof value === "object" && "model" in value) {
		const model = (value as { model?: unknown }).model;
		return typeof model === "string" ? model : "unknown";
	}
	return "unknown";
}
