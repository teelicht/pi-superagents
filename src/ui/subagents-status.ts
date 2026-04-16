/**
 * Subagents run status overlay.
 *
 * Responsibilities:
 * - display active and recent subagent runs
 * - keep run selection stable across refreshes
 * - render step-level run details
 * - auto-refresh until disposed
 *
 * Important side effects:
 * - starts an interval timer that requests TUI re-rendering
 */

import type { Theme } from "@mariozechner/pi-coding-agent";
import type { Component, TUI } from "@mariozechner/pi-tui";
import { matchesKey, truncateToWidth } from "@mariozechner/pi-tui";
import { globalRunHistory, type RunEntry } from "../execution/run-history.ts";
import { formatDuration, formatTokens } from "../shared/formatters.ts";
import { formatScrollInfo, renderFramedPanel } from "./render-helpers.ts";

const DEFAULT_REFRESH_MS = 2000;
const DEFAULT_RECENT_LIMIT = 20;

interface StatusRow {
	kind: "section" | "run";
	label?: string;
	run?: RunEntry;
	runIndex?: number;
}

export interface SubagentsStatusDeps {
	getActiveRuns?: () => RunEntry[];
	getRecentRuns?: (limit: number) => RunEntry[];
	refreshMs?: number;
}

export class SubagentsStatusComponent implements Component {
	private readonly refreshTimer: NodeJS.Timeout;
	private readonly viewportHeight = 12;
	private tui: TUI;
	private theme: Theme;
	private done: () => void;
	private deps: SubagentsStatusDeps;
	private cursorRunIndex = 0;
	private scrollOffset = 0;
	private rows: StatusRow[] = [];
	private runRows: StatusRow[] = [];

	constructor(tui: TUI, theme: Theme, done: () => void, deps: SubagentsStatusDeps = {}) {
		this.tui = tui;
		this.theme = theme;
		this.done = done;
		this.deps = deps;
		this.reloadRows();
		this.refreshTimer = setInterval(() => {
			this.reloadRows();
			this.tui.requestRender();
		}, deps.refreshMs ?? DEFAULT_REFRESH_MS);
		this.refreshTimer.unref?.();
	}

	render(width: number): string[] {
		this.reloadRows();
		const bodyLines = this.renderBody(Math.min(width, 84));
		return renderFramedPanel(
			"Subagents Status",
			bodyLines,
			Math.min(width, 84),
			this.theme,
			"↑↓ select | q close | Ctrl+Option+S",
		);
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "q") || matchesKey(data, "ctrl+c")) {
			this.done();
			return;
		}
		if (matchesKey(data, "up")) {
			this.cursorRunIndex = Math.max(0, this.cursorRunIndex - 1);
			this.ensureScrollVisible();
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "down")) {
			const maxCursor = Math.max(0, this.runRows.length - 1);
			this.cursorRunIndex = Math.min(maxCursor, this.cursorRunIndex + 1);
			this.ensureScrollVisible();
			this.tui.requestRender();
		}
	}

	invalidate(): void {
		this.reloadRows();
	}

	dispose(): void {
		clearInterval(this.refreshTimer);
	}

	private reloadRows(): void {
		const selectedRun = this.selectedRun();
		const previousKey = selectedRun ? runKey(selectedRun) : undefined;
		const activeRuns = this.deps.getActiveRuns?.() ?? Array.from(globalRunHistory.activeRuns.values());
		const recentRuns =
			this.deps.getRecentRuns?.(DEFAULT_RECENT_LIMIT) ?? globalRunHistory.getRecent(DEFAULT_RECENT_LIMIT);
		this.rows = buildRows(activeRuns, recentRuns);
		this.runRows = this.rows.filter((row) => row.kind === "run");
		this.restoreSelection(previousKey);
		this.ensureScrollVisible();
	}

	private restoreSelection(previousKey?: string): void {
		if (this.runRows.length === 0) {
			this.cursorRunIndex = 0;
			this.scrollOffset = 0;
			return;
		}
		if (previousKey) {
			const nextIndex = this.runRows.findIndex((row) => row.run && runKey(row.run) === previousKey);
			if (nextIndex !== -1) {
				this.cursorRunIndex = nextIndex;
				return;
			}
		}
		this.cursorRunIndex = Math.min(Math.max(0, this.cursorRunIndex), this.runRows.length - 1);
	}

	private selectedRun(): RunEntry | undefined {
		return this.runRows[this.cursorRunIndex]?.run;
	}

	private ensureScrollVisible(): void {
		if (this.rows.length <= this.viewportHeight || this.runRows.length === 0) {
			this.scrollOffset = 0;
			return;
		}
		const selected = this.selectedRun();
		if (!selected) {
			this.scrollOffset = 0;
			return;
		}
		const selectedIndex = this.rows.findIndex(
			(row) => row.kind === "run" && row.run && runKey(row.run) === runKey(selected),
		);
		if (selectedIndex === -1) return;
		if (selectedIndex < this.scrollOffset) this.scrollOffset = selectedIndex;
		if (selectedIndex >= this.scrollOffset + this.viewportHeight) {
			this.scrollOffset = selectedIndex - this.viewportHeight + 1;
		}
	}

	private renderBody(width: number): string[] {
		if (this.rows.length === 0) return ["No runs recorded."];
		const selected = this.selectedRun();
		const visibleRows = this.rows.slice(this.scrollOffset, this.scrollOffset + this.viewportHeight);
		const lines = visibleRows.map((row) => {
			if (row.kind === "section") return this.theme.fg("success", row.label ?? "");
			const run = row.run!;
			return truncateToWidth(formatRunRow(run, selected === run, this.theme), width - 4);
		});
		const scrollInfo = formatScrollInfo(
			this.scrollOffset,
			Math.max(0, this.rows.length - (this.scrollOffset + visibleRows.length)),
		);
		lines.push(scrollInfo ? this.theme.fg("dim", scrollInfo) : "");
		if (selected) lines.push(...this.renderRunDetails(selected, width - 4));
		else lines.push(this.theme.fg("dim", "No runs selected."));
		return lines;
	}

	private renderRunDetails(run: RunEntry, innerWidth: number): string[] {
		const lines = [
			this.theme.fg("success", "Selected Details:"),
			`  Agent:  ${run.agent}`,
			`  Status: ${run.status}`,
			`  Model:  ${run.model ?? "unknown"}`,
			`  Tokens: ${run.tokens ? formatTokens(run.tokens.total) : "0"}`,
			`  Time:   ${formatDuration(run.duration)}`,
		];
		for (const step of run.steps ?? []) {
			const duration = step.durationMs !== undefined ? ` | ${formatDuration(step.durationMs)}` : "";
			const tokens = step.tokens ? ` | ${formatTokens(step.tokens.total)} tok` : "";
			lines.push(
				truncateToWidth(`  ${step.index + 1}. ${step.agent} | ${step.status}${duration}${tokens}`, innerWidth),
			);
			if (step.error) lines.push(truncateToWidth(`     ${step.error}`, innerWidth));
		}
		if (!run.steps || run.steps.length === 0) lines.push(this.theme.fg("dim", "  No step details available."));
		return lines;
	}
}

function buildRows(activeRuns: RunEntry[], recentRuns: RunEntry[]): StatusRow[] {
	const rows: StatusRow[] = [];
	let runIndex = 0;
	if (activeRuns.length > 0) {
		rows.push({ kind: "section", label: "Active" });
		for (const run of activeRuns) rows.push({ kind: "run", run, runIndex: runIndex++ });
	}
	if (recentRuns.length > 0) {
		rows.push({ kind: "section", label: "Recent" });
		for (const run of recentRuns) rows.push({ kind: "run", run, runIndex: runIndex++ });
	}
	return rows;
}

function runKey(run: RunEntry): string {
	return `${run.ts}:${run.agent}:${run.task}`;
}

function formatRunRow(run: RunEntry, selected: boolean, theme: Theme): string {
	const prefix = selected ? theme.fg("success", ">") : " ";
	const status = run.status === "ok" ? theme.fg("success", "OK ") : theme.fg("error", "ERR");
	const duration = formatDuration(run.duration).padStart(6);
	const task = run.task.length > 44 ? `${run.task.slice(0, 41)}...` : run.task;
	return `${prefix} ${run.agent.padEnd(15)} | ${status} | ${duration} | ${task}`;
}
