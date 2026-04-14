/**
 * Superpowers status and settings overlay.
 *
 * Responsibilities:
 * - display current Superpowers config defaults, commands, model tiers
 * - display config diagnostics and gate status
 * - display active and recent runs with live metrics
 * - provide toggle keybindings for boolean settings (writes to config file)
 * - implement the Component interface using string-array rendering
 *
 * Important side effects:
 * - writes to config file on toggle actions via config-writer module
 * - auto-refreshes via timer to show live run progress
 */

import * as fs from "node:fs";
import type { Component, TUI } from "@mariozechner/pi-tui";
import { matchesKey, truncateToWidth } from "@mariozechner/pi-tui";
import type { Theme } from "@mariozechner/pi-coding-agent";
import type { ExtensionConfig, SubagentState } from "../shared/types.ts";
import {
	toggleSuperpowersBoolean,
	toggleSuperpowersWorktrees,
	updateSuperpowersConfigText,
} from "../superpowers/config-writer.ts";
import { globalRunHistory } from "../execution/run-history.ts";
import { formatScrollInfo, renderFooter, renderHeader, row } from "./render-helpers.ts";

export class SuperpowersStatusComponent implements Component {
	private readonly width = 84;
	private readonly viewportHeight = 12;
	private readonly refreshTimer: NodeJS.Timeout;

	private lastWriteMessage = "";
	private activePane: "settings" | "runs" = "settings";

	private cursor = 0;
	private scrollOffset = 0;

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
		this.refreshTimer = setInterval(() => {
			this.tui.requestRender();
		}, 2000);
		this.refreshTimer.unref?.();
	}

	dispose(): void {
		clearInterval(this.refreshTimer);
	}

	render(width: number): string[] {
		const w = Math.min(width, this.width);
		const innerW = w - 2;

		const tabs = this.activePane === "settings" ? "[ Settings ]  Runs" : "Settings  [ Runs ]";
		const lines: string[] = [renderHeader(`Superpowers ${tabs}`, w, this.theme)];

		if (this.activePane === "settings") {
			lines.push(...this.renderSettingsPane(w, innerW));
		} else {
			lines.push(...this.renderRunsPane(w, innerW));
		}

		lines.push(renderFooter("Tab: Switch View | q: Close | ↑↓: Select", w, this.theme));
		return lines;
	}

	private renderSettingsPane(w: number, _innerW: number): string[] {
		const settings = this.config.superagents ?? {};
		const commands = Object.entries(settings.commands ?? {});
		const modelTiers = Object.entries(settings.modelTiers ?? {});
		const tierModel = (value: unknown): string => {
			if (typeof value === "string") return value;
			if (value && typeof value === "object" && "model" in value) {
				const model = (value as { model?: unknown }).model;
				return typeof model === "string" ? model : "unknown";
			}
			return "unknown";
		};

		const lines = [
			row(`useSubagents: ${settings.useSubagents ?? true} (s)`, w, this.theme),
			row(`useTestDrivenDevelopment: ${settings.useTestDrivenDevelopment ?? true} (t)`, w, this.theme),
			row(`configStatus: ${this.state.configGate.blocked ? "blocked" : "valid"}`, w, this.theme),
			row(`worktrees.enabled: ${settings.worktrees?.enabled ?? false} (w)`, w, this.theme),
			row(`worktrees.root: ${settings.worktrees?.root ?? "default"}`, w, this.theme),
			row("", w, this.theme),
			row("Commands:", w, this.theme),
			...(commands.length
				? commands.map(
						([name, preset]) =>
							row(`- ${name}: subagents=${preset.useSubagents ?? "default"}, tdd=${preset.useTestDrivenDevelopment ?? "default"}`, w, this.theme),
					)
				: [row("- none", w, this.theme)]),
			row("", w, this.theme),
			row("Model tiers:", w, this.theme),
			...(modelTiers.length
				? modelTiers.map(([name, value]) => row(`- ${name}: ${tierModel(value)}`, w, this.theme))
				: [row("- none", w, this.theme)]),
		];

		if (this.state.configGate.message) {
			lines.push(row("", w, this.theme), row(this.theme.fg("error", this.state.configGate.message), w, this.theme));
		}

		if (this.lastWriteMessage) {
			lines.push(row("", w, this.theme), row(this.theme.fg("warning", this.lastWriteMessage), w, this.theme));
		}

		return lines;
	}

	/**
	 * Build the flat rows array for the runs pane (section headers + run rows).
	 * Shared between renderRunsPane and handleInput arrow-key handlers
	 * so that cursor and scroll offset share the same coordinate space.
	 */
	private buildRunsPaneRows(): Array<{ kind: "section"; label: string } | { kind: "run"; run: import("../execution/run-history.ts").RunEntry }> {
		const activeRuns = Array.from(globalRunHistory.activeRuns.values());
		const recentRuns = globalRunHistory.getRecent(20);
		const rows: Array<{ kind: "section"; label: string } | { kind: "run"; run: import("../execution/run-history.ts").RunEntry }> = [];

		if (activeRuns.length > 0) {
			rows.push({ kind: "section", label: "Active" });
			for (const run of activeRuns) rows.push({ kind: "run", run });
		}
		if (recentRuns.length > 0) {
			rows.push({ kind: "section", label: "Recent" });
			for (const run of recentRuns) rows.push({ kind: "run", run });
		}

		return rows;
	}

	private renderRunsPane(w: number, innerW: number): string[] {
		const rows = this.buildRunsPaneRows();

		if (rows.length === 0) {
			return [row("No runs recorded.", w, this.theme)];
		}

		// Clamp cursor to a valid run row (skip section headers)
		if (this.cursor >= rows.length) this.cursor = rows.length - 1;
		if (rows[this.cursor]?.kind === "section") {
			// Move cursor to next run row
			for (let i = this.cursor + 1; i < rows.length; i++) {
				if (rows[i].kind === "run") { this.cursor = i; break; }
			}
		}
		if (rows[this.cursor]?.kind === "section" && this.cursor > 0) {
			// Move cursor to previous run row
			for (let i = this.cursor - 1; i >= 0; i--) {
				if (rows[i].kind === "run") { this.cursor = i; break; }
			}
		}

		const selectedRow = rows[this.cursor];
		const selectedRun = selectedRow?.kind === "run" ? selectedRow.run : undefined;

		const visibleRows = rows.slice(this.scrollOffset, this.scrollOffset + this.viewportHeight);

		const lines: string[] = [];
		for (const statusRow of visibleRows) {
			if (statusRow.kind === "section") {
				lines.push(row(this.theme.fg("accent", statusRow.label), w, this.theme));
				continue;
			}
			const run = statusRow.run;
			const isSelected = selectedRun === run;
			const prefix = isSelected ? this.theme.fg("accent", ">") : " ";
			const duration = (run.duration / 1000).toFixed(1) + "s";
			const statusStr = run.status === "ok" ? "OK" : "ERR";
			const color = run.status === "ok" ? "success" as const : "error" as const;
			const task = run.task.length > 40 ? run.task.slice(0, 37) + "..." : run.task;
			const formatted = `${prefix} ${run.agent.padEnd(15)} | ${this.theme.fg(color, statusStr.padEnd(3))} | ${duration.padStart(5)} | ${task}`;
			lines.push(row(truncateToWidth(formatted, innerW), w, this.theme));
		}

		const above = this.scrollOffset;
		const below = Math.max(0, rows.length - (this.scrollOffset + visibleRows.length));
		const scrollInfo = formatScrollInfo(above, below);
		if (scrollInfo) lines.push(row(this.theme.fg("dim", scrollInfo), w, this.theme));
		else lines.push(row("", w, this.theme));

		if (selectedRun) {
			lines.push(row(this.theme.fg("accent", "Selected Details:"), w, this.theme));
			lines.push(row(`  Model:  ${selectedRun.model || "unknown"}`, w, this.theme));
			lines.push(row(`  Tokens: ${selectedRun.tokens?.total || 0}`, w, this.theme));
			if (selectedRun.steps && selectedRun.steps.length > 0) {
				lines.push(row(`  Steps:  ${selectedRun.steps.length}`, w, this.theme));
			}
		}

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

	toggleUseSubagents(): void {
		this.writeConfig((config) => toggleSuperpowersBoolean(config, "useSubagents"));
	}

	toggleUseTestDrivenDevelopment(): void {
		this.writeConfig((config) => toggleSuperpowersBoolean(config, "useTestDrivenDevelopment"));
	}

	toggleWorktrees(): void {
		this.writeConfig((config) => toggleSuperpowersWorktrees(config));
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "q") || matchesKey(data, "ctrl+c")) {
			this.done();
			return;
		}
		if (matchesKey(data, "tab")) {
			this.activePane = this.activePane === "settings" ? "runs" : "settings";
			this.tui.requestRender();
			return;
		}

		if (this.activePane === "settings") {
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
		} else {
			if (matchesKey(data, "up")) {
				this.cursor = Math.max(0, this.cursor - 1);
				// Skip section headers
				const runsPaneRows = this.buildRunsPaneRows();
				while (this.cursor > 0 && runsPaneRows[this.cursor]?.kind === "section") {
					this.cursor--;
				}
				if (this.cursor < this.scrollOffset) this.scrollOffset = this.cursor;
				this.tui.requestRender();
			}
			if (matchesKey(data, "down")) {
				const runsPaneRows = this.buildRunsPaneRows();
				this.cursor = Math.min(runsPaneRows.length - 1, this.cursor + 1);
				// Skip section headers
				while (this.cursor < runsPaneRows.length - 1 && runsPaneRows[this.cursor]?.kind === "section") {
					this.cursor++;
				}
				if (this.cursor >= this.scrollOffset + this.viewportHeight) {
					this.scrollOffset = this.cursor - this.viewportHeight + 1;
				}
				this.tui.requestRender();
			}
		}
	}

	invalidate(): void {
		// No cached rendering state to invalidate
	}
}
