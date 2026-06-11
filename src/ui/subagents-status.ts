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

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { matchesKey } from "@earendil-works/pi-tui";
import { globalRunHistory, type RunEntry } from "../execution/run-history.ts";
import { renderFramedPanel } from "./render-helpers.ts";
import { buildRows, renderSubagentsStatusBody, runKey, type StatusRow } from "./subagents-status-render.ts";

const DEFAULT_REFRESH_MS = 2000;
const DEFAULT_RECENT_LIMIT = 20;

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
		return renderFramedPanel("Subagents Status", bodyLines, Math.min(width, 84), this.theme, "↑↓ select | q close | Ctrl+Option+S");
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

	// fallow-ignore-next-line unused-class-member
	invalidate(): void {
		this.tui.requestRender();
	}

	dispose(): void {
		clearInterval(this.refreshTimer);
	}

	private reloadRows(): void {
		const selectedRun = this.selectedRun();
		const previousKey = selectedRun ? runKey(selectedRun) : undefined;
		const activeRuns = this.deps.getActiveRuns?.() ?? Array.from(globalRunHistory.activeRuns.values());
		const recentRuns = this.deps.getRecentRuns?.(DEFAULT_RECENT_LIMIT) ?? globalRunHistory.getRecent(DEFAULT_RECENT_LIMIT);
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
		const selectedIndex = this.rows.findIndex((row) => row.kind === "run" && row.run && runKey(row.run) === runKey(selected));
		if (selectedIndex === -1) return;
		if (selectedIndex < this.scrollOffset) this.scrollOffset = selectedIndex;
		if (selectedIndex >= this.scrollOffset + this.viewportHeight) {
			this.scrollOffset = selectedIndex - this.viewportHeight + 1;
		}
	}

	private renderBody(width: number): string[] {
		return renderSubagentsStatusBody({
			rows: this.rows,
			selectedRun: this.selectedRun(),
			scrollOffset: this.scrollOffset,
			viewportHeight: this.viewportHeight,
			width,
			theme: this.theme,
		});
	}
}
