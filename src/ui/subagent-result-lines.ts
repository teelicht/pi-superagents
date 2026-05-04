/**
 * Pure line formatter for compact inline subagent result rendering.
 *
 * Key responsibilities:
 * - normalize subagent details into display rows
 * - render collapsed and expanded line arrays for Pi TUI wrappers
 * - keep width-bounded previews independent from terminal components
 *
 * Important dependencies:
 * - shared subagent result types
 * - shared formatting helpers for durations and paths
 */

import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { formatDuration, shortenPath } from "../shared/formatters.ts";
import type { AgentProgress, Details, ProgressSummary, SingleResult } from "../shared/types.ts";
import { getSingleResultOutput } from "../shared/utils.ts";

interface RenderSubagentResultLinesOptions {
	expanded: boolean;
	width: number;
}

type SubagentDisplayStatus = AgentProgress["status"] | "needs_parent";

interface SubagentDisplayRow {
	index: number;
	agent: string;
	task: string;
	status: SubagentDisplayStatus;
	result?: SingleResult;
	progress?: AgentProgress;
	summary?: ProgressSummary;
}

interface SubagentDisplaySummary {
	modeLabel: "Subagent" | "Subagents";
	statusLabel: string;
	okCount: number;
	totalCount: number;
	hasRunning: boolean;
	hasFailure: boolean;
	hasEmptyOutput: boolean;
	toolCount: number;
	durationMs: number;
	contextLabel: string;
}

/**
 * Renders subagent details as terminal-width-bounded lines.
 *
 * @param result Tool result passed by Pi to the subagent renderer.
 * @param options Expansion state and current rendering width.
 * @returns Lines ready to wrap in a TUI Text component.
 */
export function renderSubagentResultLines(result: AgentToolResult<Details>, options: RenderSubagentResultLinesOptions): string[] {
	const details = result.details;
	if (!details || details.results.length === 0) {
		const text = result.content[0]?.type === "text" ? result.content[0].text : "(no output)";
		const prefix = details?.sessionMode === "fork" ? "[fork] " : "";
		return [truncateLine(`${prefix}${text}`, options.width)];
	}

	const rows = buildDisplayRows(details);
	const summary = summarizeDetails(details, rows);
	if (options.expanded) return renderExpandedLines(summary, rows, options.width);
	return renderCollapsedLines(summary, rows, options.width);
}

/**
 * Converts Details into stable display rows, preferring live progress over
 * completed result summaries when both are available.
 *
 * @param details Raw subagent result details.
 * @returns Rows in task index order.
 */
function buildDisplayRows(details: Details): SubagentDisplayRow[] {
	const progressByIndex = new Map<number, AgentProgress>();
	for (const progress of details.progress ?? []) {
		progressByIndex.set(progress.index, progress);
	}

	const rows = details.results.map((result, index): SubagentDisplayRow => {
		const progress = result.progress ?? progressByIndex.get(index);
		return {
			index,
			agent: result.agent,
			task: result.task,
			status: inferStatus(result, progress),
			result,
			progress,
			summary: result.progressSummary ?? progress,
		};
	});

	for (const progress of details.progress ?? []) {
		if (rows.some((row) => row.index === progress.index)) continue;
		rows.push({
			index: progress.index,
			agent: progress.agent,
			task: progress.task,
			status: progress.status,
			progress,
			summary: progress,
		});
	}

	return rows.sort((a, b) => a.index - b.index);
}

/**
 * Infers the visual status for one row.
 *
 * @param result Completed or running result data.
 * @param progress Optional live progress data for the same task.
 * @returns Display status for the row.
 */
function inferStatus(result: SingleResult, progress: AgentProgress | undefined): SubagentDisplayStatus {
	if (result.completion?.status === "needs_parent") return "needs_parent";
	if (progress?.status) return progress.status;
	if (result.exitCode === 0) return "completed";
	return "failed";
}

/**
 * Builds top-line counts and aggregate status labels.
 *
 * @param details Raw details from the subagent result.
 * @param rows Normalized display rows.
 * @returns Header summary data.
 */
function summarizeDetails(details: Details, rows: SubagentDisplayRow[]): SubagentDisplaySummary {
	const totalCount = Math.max(rows.length, details.results.length);
	const okCount = rows.filter((row) => row.status === "completed" && row.result?.exitCode !== 1).length;
	const hasRunning = rows.some((row) => row.status === "running" || row.status === "pending");
	const hasNeedsParent = rows.some((row) => row.status === "needs_parent");
	const hasFailure = rows.some((row) => row.status === "failed" || (row.result !== undefined && row.result.exitCode !== 0));
	const hasEmptyOutput = rows.some((row) => row.result?.exitCode === 0 && !getSingleResultOutput(row.result).trim());
	const fallbackSummary = rows.reduce(
		(acc, row) => {
			const summary = row.summary;
			if (summary) {
				acc.toolCount += summary.toolCount;
				acc.durationMs = Math.max(acc.durationMs, summary.durationMs);
			}
			return acc;
		},
		{ toolCount: 0, durationMs: 0 },
	);
	const aggregate = details.progressSummary ?? fallbackSummary;
	const statusLabel = hasRunning
		? details.mode === "single"
			? "running"
			: `${okCount}/${totalCount} complete`
		: hasNeedsParent
			? `${okCount}/${totalCount} complete; needs parent input`
			: hasFailure
				? `${okCount}/${totalCount} complete error`
				: hasEmptyOutput
					? `${okCount}/${totalCount} complete empty output`
					: `${okCount}/${totalCount} complete ok`;

	return {
		modeLabel: details.mode === "single" ? "Subagent" : "Subagents",
		statusLabel,
		okCount,
		totalCount,
		hasRunning,
		hasFailure,
		hasEmptyOutput,
		toolCount: aggregate.toolCount,
		durationMs: aggregate.durationMs,
		contextLabel: details.sessionMode === "fork" ? " [fork]" : "",
	};
}

/**
 * Renders the compact collapsed state.
 *
 * @param summary Header summary data.
 * @param rows Normalized display rows.
 * @param width Available text width.
 * @returns Collapsed display lines.
 */
function renderCollapsedLines(summary: SubagentDisplaySummary, rows: SubagentDisplayRow[], width: number): string[] {
	const lines = [truncateLine(formatHeader(summary), width)];
	if (!summary.hasRunning) return lines;

	for (const row of rows) {
		lines.push(truncateLine(formatCollapsedRow(row, summary.modeLabel === "Subagents"), width));
		const activity = formatCurrentActivity(row.progress);
		if (activity) lines.push(truncateLine(`  -> ${activity}`, width));
	}

	return lines;
}

/**
 * Renders the expanded state with concise details for each subagent row.
 *
 * @param summary Header summary data.
 * @param rows Normalized display rows.
 * @param width Available text width.
 * @returns Expanded display lines.
 */
function renderExpandedLines(summary: SubagentDisplaySummary, rows: SubagentDisplayRow[], width: number): string[] {
	const lines = [truncateLine(formatHeader(summary), width)];
	for (const row of rows) {
		lines.push(truncateLine(formatExpandedRow(row), width));
		for (const detail of formatExpandedDetails(row)) {
			lines.push(truncateLine(`  ${detail}`, width));
		}
	}
	return lines;
}

/**
 * Formats the expanded row headline.
 *
 * @param row Normalized display row.
 * @returns Expanded row headline.
 */
function formatExpandedRow(row: SubagentDisplayRow): string {
	const summary = row.summary;
	const stats = summary && summary.toolCount > 0 ? `  ${summary.toolCount} tools  ${formatDuration(summary.durationMs)}` : "";
	return `- ${row.status}  ${row.agent}  ${row.task}${stats}`;
}

/**
 * Formats expanded detail lines for a subagent row.
 *
 * @param row Normalized display row.
 * @returns Detail lines without indentation.
 */
function formatExpandedDetails(row: SubagentDisplayRow): string[] {
	const lines: string[] = [];
	const result = row.result;
	const progress = row.progress;

	if (result?.model) lines.push(`model: ${result.model}`);
	const current = formatCurrentActivity(progress);
	if (current) lines.push(`current: ${current}`);

	const recentTools = (progress?.recentTools ?? []).slice(-3).map((tool) => `${tool.tool} ${tool.args}`);
	if (recentTools.length > 0) lines.push(`recent: ${recentTools.join(", ")}`);

	const recentOutput = (progress?.recentOutput ?? [])
		.map((line) => line.trim())
		.filter(Boolean)
		.slice(-5);
	for (const line of recentOutput) lines.push(`output: ${line}`);

	if (result?.skills?.length) lines.push(`skills: ${result.skills.join(", ")}`);
	if (progress?.skills?.length && !result?.skills?.length) lines.push(`skills: ${progress.skills.join(", ")}`);
	if (result?.skillsWarning) lines.push(`warning: ${result.skillsWarning}`);

	const output = formatFinalOutput(result);
	if (output) lines.push(`output: ${output}`);
	if (result?.error) lines.push(`error: ${result.error}`);
	if (result?.sessionFile) lines.push(`session: ${shortenPath(result.sessionFile)}`);
	if (result?.artifactPaths?.outputPath) lines.push(`artifact: ${shortenPath(result.artifactPaths.outputPath)}`);

	return lines;
}

/**
 * Extracts the first non-empty final output line for expanded completed rows.
 *
 * @param result Optional completed result.
 * @returns One-line output preview.
 */
function formatFinalOutput(result: SingleResult | undefined): string {
	if (!result || result.progress?.status === "running") return "";
	const output = result.truncation?.text || result.finalOutput || getSingleResultOutput(result);
	const firstLine = output
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find(Boolean);
	return firstLine ?? "";
}

/**
 * Formats the header line shown for both collapsed and expanded states.
 *
 * @param summary Header summary data.
 * @returns Header text.
 */
function formatHeader(summary: SubagentDisplaySummary): string {
	const stats = summary.toolCount > 0 ? `  ${summary.toolCount} tools  ${formatDuration(summary.durationMs)}` : "";
	return `${summary.modeLabel}${summary.contextLabel}  ${summary.statusLabel}${stats}`;
}

/**
 * Formats one collapsed row.
 *
 * @param row Normalized display row.
 * @param includeStatus Whether to include status at the start of the row.
 * @returns Row text.
 */
function formatCollapsedRow(row: SubagentDisplayRow, includeStatus: boolean): string {
	const summary = row.summary;
	const stats = summary && summary.toolCount > 0 ? `  ${summary.toolCount} tools  ${formatDuration(summary.durationMs)}` : "";
	const status = includeStatus ? `${row.status}  ` : "";
	return `- ${status}${row.agent}  ${row.task}${stats}`;
}

/**
 * Formats the current tool activity preview.
 *
 * @param progress Optional live progress data.
 * @returns A compact activity label or an empty string.
 */
function formatCurrentActivity(progress: AgentProgress | undefined): string {
	if (!progress?.currentTool) return "";
	return progress.currentToolArgs ? `${progress.currentTool} ${progress.currentToolArgs}` : progress.currentTool;
}

/**
 * Truncates a line to the requested width with a single ellipsis character.
 *
 * @param value Input line.
 * @param width Maximum visible width.
 * @returns Original or truncated line.
 */
function truncateLine(value: string, width: number): string {
	if (width <= 1) return "…";
	if (value.length <= width) return value;
	return `${value.slice(0, width - 1)}…`;
}
