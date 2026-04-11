/**
 * Superpowers status and settings overlay.
 *
 * Responsibilities:
 * - display current Superpowers config defaults, commands, model tiers
 * - display config diagnostics and gate status
 * - provide toggle keybindings for boolean settings (writes to config file)
 * - provide a focused replacement for the generic Agents Manager
 *
 * Important side effects:
 * - writes to config file on toggle actions via config-writer module
 */

import * as fs from "node:fs";
import { Container, Text, matchesKey } from "@mariozechner/pi-tui";
import type { ExtensionConfig, SubagentState } from "../shared/types.ts";
import {
	toggleSuperpowersBoolean,
	toggleSuperpowersWorktrees,
	updateSuperpowersConfigText,
} from "../superpowers/config-writer.ts";
import { globalRunHistory } from "../execution/run-history.ts";

/**
 * Focused Superpowers status/settings TUI component.
 *
 * Renders a display of the current Superpowers configuration
 * and config gate status, with keybindings for toggling boolean settings.
 */
export class SuperpowersStatusComponent extends Container {
	private lastWriteMessage = "";
	private activePane: "settings" | "runs" = "settings";

	constructor(
		_tui: unknown,
		_theme: unknown,
		private readonly state: SubagentState,
		private readonly config: ExtensionConfig,
		private readonly done: () => void,
	) {
		super();
	}

	override render(width: number): string[] {
		this.clear();

		const tabs = this.activePane === "settings" ? "[ Settings ]  Runs" : "Settings  [ Runs ]";
		const separator = "-".repeat(Math.max(20, tabs.length));

		const lines = ["Superpowers", "", tabs, separator, ""];

		if (this.activePane === "settings") {
			lines.push(...this.renderSettingsPane());
		} else {
			lines.push(...this.renderRunsPane());
		}

		lines.push("", "Tab: Switch View | q: Close");

		this.addChild(new Text(lines.join("\n"), 0, 0));
		return Container.prototype.render.call(this, width);
	}

	private renderSettingsPane(): string[] {
		const settings = this.config.superagents ?? {};
		const commands = Object.entries(settings.commands ?? {});
		const modelTiers = Object.entries(settings.modelTiers ?? {});
		const tierModel = (value: unknown): string => {
			if (typeof value === "string") return value;
			if (value && typeof value === "object" && "model" in value) {
				return String((value as { model?: unknown }).model ?? "unknown");
			}
			return "unknown";
		};

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

		if (this.state.configGate.message) {
			lines.push("", this.state.configGate.message);
		}

		if (this.lastWriteMessage) {
			lines.push("", this.lastWriteMessage);
		}

		return lines;
	}

	private renderRunsPane(): string[] {
		const runs = globalRunHistory.getRecent(20);
		if (runs.length === 0) {
			return ["No recent runs recorded."];
		}

		return [
			"Recent Runs:",
			"",
			...runs.map((run) => {
				const duration = (run.duration / 1000).toFixed(1) + "s";
				const status = run.status === "ok" ? "OK" : "ERR";
				const task = run.task.length > 50 ? run.task.slice(0, 47) + "..." : run.task;
				return `${run.agent.padEnd(15)} | ${status.padEnd(3)} | ${duration.padStart(5)} | ${task}`;
			}),
		];
	}

	/**
	 * Write config file using the provided update function.
	 *
	 * @param update - Mutator function for the config object.
	 */
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

	/** Toggle the useSubagents boolean setting in the config file. */
	toggleUseSubagents(): void {
		this.writeConfig((config) => toggleSuperpowersBoolean(config, "useSubagents"));
	}

	/** Toggle the useTestDrivenDevelopment boolean setting in the config file. */
	toggleUseTestDrivenDevelopment(): void {
		this.writeConfig((config) => toggleSuperpowersBoolean(config, "useTestDrivenDevelopment"));
	}

	/** Toggle the worktrees.enabled boolean setting in the config file. */
	toggleWorktrees(): void {
		this.writeConfig((config) => toggleSuperpowersWorktrees(config));
	}

	/**
	 * Handle keyboard input for key bindings.
	 *
	 * @param data - Raw terminal input data.
	 */
	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "q") || matchesKey(data, "ctrl+c")) {
			this.close();
			return;
		}
		if (matchesKey(data, "tab")) {
			this.activePane = this.activePane === "settings" ? "runs" : "settings";
			return;
		}
		if (this.activePane === "settings") {
			if (matchesKey(data, "s")) {
				this.toggleUseSubagents();
				return;
			}
			if (matchesKey(data, "t")) {
				this.toggleUseTestDrivenDevelopment();
				return;
			}
			if (matchesKey(data, "w")) {
				this.toggleWorktrees();
			}
		}
	}

	close(): void {
		this.done();
	}
}