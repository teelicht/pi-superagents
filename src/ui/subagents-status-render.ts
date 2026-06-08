/**
 * Pure rendering helpers for the subagents status overlay.
 *
 * Responsibilities:
 * - build active/recent status rows
 * - format selected run details and compact row labels
 * - generate body lines without owning TUI timers or input handling
 *
 * Important dependencies/side effects:
 * - depends on run-history data shapes, theme formatting, and render helper utilities
 * - performs no I/O and has no side effects
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { RunEntry } from "../execution/run-history.ts";
import { formatDuration, formatTokens } from "../shared/formatters.ts";
import { formatScrollInfo } from "./render-helpers.ts";

export interface StatusRow {
	kind: "section" | "run";
	label?: string;
	run?: RunEntry;
	runIndex?: number;
}

export interface SubagentsStatusRenderInput {
	rows: StatusRow[];
	selectedRun?: RunEntry;
	scrollOffset: number;
	viewportHeight: number;
	width: number;
	theme: Theme;
}

/**
 * Build display rows from active and recent run lists.
 *
 * @param activeRuns Currently running subagent runs.
 * @param recentRuns Recently completed subagent runs.
 * @returns Section and run rows in display order.
 */
export function buildRows(activeRuns: RunEntry[], recentRuns: RunEntry[]): StatusRow[] {
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

/**
 * Return a stable selection key for a run.
 *
 * @param run Run entry to identify.
 * @returns Key derived from timestamp, agent, and task.
 */
export function runKey(run: RunEntry): string {
	return `${run.ts}:${run.agent}:${run.task}`;
}

/**
 * Render status overlay body lines for already-prepared state.
 *
 * @param input Row, selection, scroll, width, and theme dependencies.
 * @returns Body lines for the framed panel.
 */
export function renderSubagentsStatusBody(input: SubagentsStatusRenderInput): string[] {
	const { rows, selectedRun, scrollOffset, viewportHeight, width, theme } = input;
	if (rows.length === 0) return ["No runs recorded."];
	const visibleRows = rows.slice(scrollOffset, scrollOffset + viewportHeight);
	const lines = visibleRows.map((row) => {
		if (row.kind === "section") return theme.fg("success", row.label ?? "");
		const run = row.run!;
		return truncateToWidth(formatRunRow(run, selectedRun === run, theme), width - 4);
	});
	const scrollInfo = formatScrollInfo(scrollOffset, Math.max(0, rows.length - (scrollOffset + visibleRows.length)));
	lines.push(scrollInfo ? theme.fg("dim", scrollInfo) : "");
	if (selectedRun) lines.push(...renderRunDetails(selectedRun, width - 4, theme));
	else lines.push(theme.fg("dim", "No runs selected."));
	return lines;
}

/**
 * Format a run model for row-level status display.
 *
 * @param model Runtime-confirmed model id, if available.
 * @returns A compact model label with an explicit unknown fallback.
 */
function compactModelLabel(model: string | undefined): string {
	if (!model) return "unknown";
	const tail = model.split("/").pop() ?? model;
	return tail.length > 22 ? `${tail.slice(0, 19)}...` : tail;
}

/**
 * Render one run row with compact model confirmation metadata.
 *
 * @param run Run entry to summarize.
 * @param selected Whether the row is currently selected.
 * @param theme Active Pi theme for status colors.
 * @returns A single width-bounded row string before outer truncation.
 */
function formatRunRow(run: RunEntry, selected: boolean, theme: Theme): string {
	const prefix = selected ? theme.fg("success", ">") : " ";
	const status = run.status === "ok" ? theme.fg("success", "OK ") : theme.fg("error", "ERR");
	const duration = formatDuration(run.duration).padStart(6);
	const model = compactModelLabel(run.model);
	const task = run.task.length > 36 ? `${run.task.slice(0, 33)}...` : run.task;
	return `${prefix} ${run.agent.padEnd(15)} | ${status} | ${duration} | ${model.padEnd(22)} | ${task}`;
}

/**
 * Render selected run detail lines.
 *
 * @param run Run entry selected by the cursor.
 * @param innerWidth Width available inside the panel body.
 * @param theme Active Pi theme for dim/status colors.
 * @returns Detail lines for the selected run.
 */
function renderRunDetails(run: RunEntry, innerWidth: number, theme: Theme): string[] {
	const lines = [theme.fg("success", "Selected Details:"), `  Agent:  ${run.agent}`, `  Status: ${run.status}`, `  Model:  ${run.model ?? "unknown"}`];
	if (run.thinking) {
		lines.push(`  Thinking: ${run.thinking}`);
	}
	lines.push(`  Tokens: ${run.tokens ? formatTokens(run.tokens.total) : "0"}`, `  Time:   ${formatDuration(run.duration)}`);
	if (run.skills?.length) {
		lines.push(truncateToWidth(`  Skills: ${run.skills.join(", ")}`, innerWidth));
	}
	if (run.skillsWarning) {
		lines.push(truncateToWidth(`  Skills warning: ${run.skillsWarning}`, innerWidth));
	}
	for (const step of run.steps ?? []) {
		const duration = step.durationMs !== undefined ? ` | ${formatDuration(step.durationMs)}` : "";
		const tokens = step.tokens ? ` | ${formatTokens(step.tokens.total)} tok` : "";
		lines.push(truncateToWidth(`  ${step.index + 1}. ${step.agent} | ${step.status}${duration}${tokens}`, innerWidth));
		if (step.skills?.length) {
			lines.push(truncateToWidth(`     skills: ${step.skills.join(", ")}`, innerWidth));
		}
		if (step.skillsWarning) {
			lines.push(truncateToWidth(`     skills warning: ${step.skillsWarning}`, innerWidth));
		}
		if (step.error) lines.push(truncateToWidth(`     ${step.error}`, innerWidth));
	}
	if (!run.steps || run.steps.length === 0) lines.push(theme.fg("dim", "  No step details available."));
	return lines;
}
