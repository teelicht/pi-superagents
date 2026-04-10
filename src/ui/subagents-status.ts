import type { Theme } from "@mariozechner/pi-coding-agent";
import type { Component, TUI } from "@mariozechner/pi-tui";
import { matchesKey, truncateToWidth } from "@mariozechner/pi-tui";
import { type AsyncRunOverlayData, type AsyncRunSummary, listAsyncRunsForOverlay } from "./async-status.ts";
import { ASYNC_DIR } from "../shared/types.ts";
import { formatDuration, formatTokens, shortenPath } from "../shared/formatters.ts";
import { formatScrollInfo, renderFooter, renderHeader, row } from "./render-helpers.ts";

const AUTO_REFRESH_MS = 2000;

interface StatusRow {
	kind: "section" | "run";
	label: string;
	run?: AsyncRunSummary;
}

interface StatusOverlayDeps {
	listRunsForOverlay?: (asyncDirRoot: string, recentLimit?: number) => AsyncRunOverlayData;
	refreshMs?: number;
}

function statusColor(theme: Theme, status: AsyncRunSummary["state"]): string {
	switch (status) {
		case "running": return theme.fg("warning", status);
		case "queued": return theme.fg("accent", status);
		case "complete": return theme.fg("success", status);
		case "failed": return theme.fg("error", status);
	}
}

function stepStatusColor(theme: Theme, status: string): string {
	if (status === "running") return theme.fg("warning", status);
	if (status === "pending") return theme.fg("dim", status);
	if (status === "complete" || status === "completed") return theme.fg("success", status);
	if (status === "failed") return theme.fg("error", status);
	return status;
}

function runLabel(theme: Theme, run: AsyncRunSummary, selected: boolean): string {
	const prefix = selected ? theme.fg("accent", ">") : " ";
	const stepCount = run.steps.length || 1;
	const stepLabel = run.currentStep !== undefined ? `step ${run.currentStep + 1}/${stepCount}` : `steps ${stepCount}`;
	const cwd = shortenPath(run.cwd ?? run.asyncDir);
	return `${prefix} ${run.id.slice(0, 8)} ${statusColor(theme, run.state)} | ${run.mode} | ${stepLabel} | ${cwd}`;
}

function selectedIndex(rows: StatusRow[], cursor: number): number {
	const runRows = rows.filter((row) => row.kind === "run");
	if (runRows.length === 0) return -1;
	return Math.max(0, Math.min(cursor, runRows.length - 1));
}

function selectedRun(rows: StatusRow[], cursor: number): AsyncRunSummary | undefined {
	const runRows = rows.filter((row) => row.kind === "run");
	const index = selectedIndex(rows, cursor);
	return index >= 0 ? runRows[index]?.run : undefined;
}

function buildRows(active: AsyncRunSummary[], recent: AsyncRunSummary[]): StatusRow[] {
	const rows: StatusRow[] = [];
	if (active.length > 0) {
		rows.push({ kind: "section", label: "Active" });
		for (const run of active) rows.push({ kind: "run", label: run.id, run });
	}
	if (recent.length > 0) {
		rows.push({ kind: "section", label: "Recent" });
		for (const run of recent) rows.push({ kind: "run", label: run.id, run });
	}
	return rows;
}

export class SubagentsStatusComponent implements Component {
	private readonly width = 84;
	private readonly viewportHeight = 12;
	private readonly listRunsForOverlay: (asyncDirRoot: string, recentLimit?: number) => AsyncRunOverlayData;
	private readonly refreshTimer: NodeJS.Timeout;
	private cursor = 0;
	private scrollOffset = 0;
	private active: AsyncRunSummary[] = [];
	private recent: AsyncRunSummary[] = [];
	private rows: StatusRow[] = [];
	private errorMessage?: string;

	constructor(
		private tui: TUI,
		private theme: Theme,
		private done: () => void,
		deps: StatusOverlayDeps = {},
	) {
		this.listRunsForOverlay = deps.listRunsForOverlay ?? listAsyncRunsForOverlay;
		const refreshMs = deps.refreshMs ?? AUTO_REFRESH_MS;
		this.reload();
		this.refreshTimer = setInterval(() => {
			this.reload();
			this.tui.requestRender();
		}, refreshMs);
		this.refreshTimer.unref?.();
	}

	private reload(): void {
		const previousSelectedId = selectedRun(this.rows, this.cursor)?.id;
		try {
			const overlayData = this.listRunsForOverlay(ASYNC_DIR, 5);
			this.active = overlayData.active;
			this.recent = overlayData.recent;
			this.rows = buildRows(this.active, this.recent);
			this.errorMessage = undefined;
			this.restoreSelection(previousSelectedId);
			this.ensureScrollVisible();
		} catch (error) {
			this.active = [];
			this.recent = [];
			this.rows = [];
			this.cursor = 0;
			this.scrollOffset = 0;
			this.errorMessage = error instanceof Error ? error.message : String(error);
		}
	}

	private restoreSelection(previousSelectedId?: string): void {
		const runRows = this.rows.filter((row) => row.kind === "run");
		if (runRows.length === 0) {
			this.cursor = 0;
			return;
		}
		if (!previousSelectedId) {
			this.cursor = Math.min(this.cursor, runRows.length - 1);
			return;
		}
		const nextIndex = runRows.findIndex((row) => row.run?.id === previousSelectedId);
		if (nextIndex !== -1) {
			this.cursor = nextIndex;
			return;
		}
		this.cursor = Math.min(this.cursor, runRows.length - 1);
	}

	private ensureScrollVisible(): void {
		if (this.rows.length <= this.viewportHeight) {
			this.scrollOffset = 0;
			return;
		}
		const selected = selectedRun(this.rows, this.cursor);
		if (!selected) {
			this.scrollOffset = 0;
			return;
		}
		const rowIndex = this.rows.findIndex((row) => row.kind === "run" && row.run?.id === selected.id);
		if (rowIndex === -1) return;
		if (rowIndex < this.scrollOffset) this.scrollOffset = rowIndex;
		if (rowIndex >= this.scrollOffset + this.viewportHeight) {
			this.scrollOffset = rowIndex - this.viewportHeight + 1;
		}
	}

	private renderRunDetails(run: AsyncRunSummary, width: number, innerW: number): string[] {
		const lines = [
			row(`cwd: ${truncateToWidth(shortenPath(run.cwd ?? run.asyncDir), innerW - 5)}`, width, this.theme),
		];
		for (const step of run.steps) {
			const duration = step.durationMs !== undefined ? ` | ${formatDuration(step.durationMs)}` : "";
			const tokens = step.tokens ? ` | ${formatTokens(step.tokens.total)} tok` : "";
			const line = `  ${step.index + 1}. ${step.agent} | ${stepStatusColor(this.theme, step.status)}${duration}${tokens}`;
			lines.push(row(truncateToWidth(line, innerW), width, this.theme));
		}
		if (run.steps.length === 0) {
			lines.push(row(this.theme.fg("dim", "  No step details available yet."), width, this.theme));
		}
		return lines;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "q") || matchesKey(data, "ctrl+c")) {
			this.done();
			return;
		}
		if (matchesKey(data, "up")) {
			this.cursor = Math.max(0, this.cursor - 1);
			this.ensureScrollVisible();
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "down")) {
			const maxCursor = Math.max(0, this.rows.filter((row) => row.kind === "run").length - 1);
			this.cursor = Math.min(maxCursor, this.cursor + 1);
			this.ensureScrollVisible();
			this.tui.requestRender();
		}
	}

	render(width: number): string[] {
		const w = Math.min(width, this.width);
		const innerW = w - 2;
		const lines: string[] = [renderHeader("Subagents Status", w, this.theme)];
		const rows = this.rows.length > 0 ? this.rows : [{ kind: "section" as const, label: "No async runs found" }];
		const selected = selectedRun(this.rows, this.cursor);
		const visibleRows = rows.slice(this.scrollOffset, this.scrollOffset + this.viewportHeight);
		for (const statusRow of visibleRows) {
			if (statusRow.kind === "section") {
				lines.push(row(this.theme.fg("accent", statusRow.label), w, this.theme));
				continue;
			}
			const isSelected = selected?.id === statusRow.run?.id;
			lines.push(row(truncateToWidth(runLabel(this.theme, statusRow.run!, isSelected), innerW), w, this.theme));
		}

		const above = this.scrollOffset;
		const below = Math.max(0, rows.length - (this.scrollOffset + visibleRows.length));
		const scrollInfo = formatScrollInfo(above, below);
		if (scrollInfo) lines.push(row(this.theme.fg("dim", scrollInfo), w, this.theme));
		else lines.push(row("", w, this.theme));

		if (this.errorMessage) {
			lines.push(row(this.theme.fg("error", truncateToWidth(this.errorMessage, innerW)), w, this.theme));
		} else if (selected) {
			lines.push(row(this.theme.fg("accent", `Selected: ${selected.id}`), w, this.theme));
			lines.push(...this.renderRunDetails(selected, w, innerW));
		} else {
			lines.push(row(this.theme.fg("dim", "No runs selected."), w, this.theme));
		}

		const footer = `↑↓ select  esc close  ${this.active.length} active / ${this.recent.length} recent`;
		lines.push(renderFooter(truncateToWidth(footer, innerW), w, this.theme));
		return lines;
	}

	dispose(): void {
		clearInterval(this.refreshTimer);
	}
}
