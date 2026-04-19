/**
 * Rendering functions for subagent results
 */

import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { type ExtensionContext, getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { type Component, Container, Markdown, Spacer, Text, visibleWidth } from "@mariozechner/pi-tui";
import { formatDuration, formatToolCall, formatUsage, shortenPath } from "../shared/formatters.ts";
import type { AgentProgress, Details, ProgressSummary } from "../shared/types.ts";
import { getDisplayItems, getSingleResultOutput } from "../shared/utils.ts";

type Theme = ExtensionContext["ui"]["theme"];

function getTermWidth(): number {
	return process.stdout.columns || 120;
}

// Grapheme segmenter for proper Unicode handling (shared instance)
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Truncate a line to maxWidth, preserving ANSI styling through the ellipsis.
 *
 * pi-tui's truncateToWidth adds \x1b[0m before ellipsis which resets all styling,
 * causing background color bleed in the TUI. This implementation tracks active
 * ANSI styles and re-applies them before the ellipsis.
 *
 * Uses Intl.Segmenter for proper Unicode/emoji handling (not char-by-char).
 */
function truncLine(text: string, maxWidth: number): string {
	if (visibleWidth(text) <= maxWidth) return text;

	const targetWidth = maxWidth - 1; // Room for single ellipsis character
	let result = "";
	let currentWidth = 0;
	let activeStyles: string[] = []; // Track ALL active styles (not just last)
	let i = 0;

	while (i < text.length) {
		// Check for ANSI escape code
		const ansiMatch = text.slice(i).match(/^\x1b\[[0-9;]*m/);
		if (ansiMatch) {
			const code = ansiMatch[0];
			result += code;

			if (code === "\x1b[0m" || code === "\x1b[m") {
				activeStyles = []; // Reset clears all styles
			} else {
				activeStyles.push(code); // Stack styles (bold + color, etc.)
			}
			i += code.length;
			continue;
		}

		// Find end of non-ANSI text segment
		let end = i;
		while (end < text.length && !text.slice(end).match(/^\x1b\[[0-9;]*m/)) {
			end++;
		}

		// Segment into graphemes for proper Unicode handling
		const textPortion = text.slice(i, end);
		for (const seg of segmenter.segment(textPortion)) {
			const grapheme = seg.segment;
			const graphemeWidth = visibleWidth(grapheme);

			if (currentWidth + graphemeWidth > targetWidth) {
				// Re-apply all active styles before ellipsis to preserve background/colors
				return `${result + activeStyles.join("")}…`;
			}

			result += grapheme;
			currentWidth += graphemeWidth;
		}
		i = end;
	}

	// Reached end without exceeding width (shouldn't happen given initial check)
	return `${result + activeStyles.join("")}…`;
}

/**
 * Detect whether a completed subagent produced no visible inline output.
 *
 * @param output Final output extracted from the child PI JSONL stream.
 * @returns True when the rendered output is empty after trimming whitespace.
 */
function hasEmptyOutput(output: string): boolean {
	return !output.trim();
}

/**
 * Render a subagent result
 */
export function renderSubagentResult(
	result: AgentToolResult<Details>,
	_options: { expanded: boolean },
	theme: Theme,
): Component {
	const d = result.details;
	if (!d || !d.results.length) {
		const t = result.content[0];
		const text = t?.type === "text" ? t.text : "(no output)";
		const contextPrefix = d?.context === "fork" ? `${theme.fg("warning", "[fork]")} ` : "";
		return new Text(truncLine(`${contextPrefix}${text}`, getTermWidth() - 4), 0, 0);
	}

	const mdTheme = getMarkdownTheme();

	if (d.mode === "single" && d.results.length === 1) {
		const r = d.results[0];
		const isRunning = r.progress?.status === "running";
		const icon = isRunning
			? theme.fg("warning", "...")
			: r.exitCode === 0
				? theme.fg("success", "ok")
				: theme.fg("error", "X");
		const contextBadge = d.context === "fork" ? theme.fg("warning", " [fork]") : "";
		const output = r.truncation?.text || getSingleResultOutput(r);

		const progressInfo =
			isRunning && r.progress
				? ` | ${r.progress.toolCount} tools, ${formatDuration(r.progress.durationMs)}`
				: r.progressSummary
					? ` | ${r.progressSummary.toolCount} tools, ${formatDuration(r.progressSummary.durationMs)}`
					: "";

		const w = getTermWidth() - 4;
		const c = new Container();
		c.addChild(
			new Text(
				truncLine(`${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${contextBadge}${progressInfo}`, w),
				0,
				0,
			),
		);
		c.addChild(new Spacer(1));
		const taskMaxLen = Math.max(20, w - 8);
		const taskPreview = r.task.length > taskMaxLen ? `${r.task.slice(0, taskMaxLen)}...` : r.task;
		c.addChild(new Text(truncLine(theme.fg("dim", `Task: ${taskPreview}`), w), 0, 0));
		c.addChild(new Spacer(1));

		if (isRunning && r.progress) {
			if (r.progress.currentTool) {
				const maxToolArgsLen = Math.max(50, w - 20);
				const toolArgsPreview = r.progress.currentToolArgs
					? r.progress.currentToolArgs.length > maxToolArgsLen
						? `${r.progress.currentToolArgs.slice(0, maxToolArgsLen)}...`
						: r.progress.currentToolArgs
					: "";
				const toolLine = toolArgsPreview ? `${r.progress.currentTool}: ${toolArgsPreview}` : r.progress.currentTool;
				c.addChild(new Text(truncLine(theme.fg("warning", `> ${toolLine}`), w), 0, 0));
			}
			if (r.progress.recentTools?.length) {
				for (const t of r.progress.recentTools.slice(-3)) {
					const maxArgsLen = Math.max(40, w - 24);
					const argsPreview = t.args.length > maxArgsLen ? `${t.args.slice(0, maxArgsLen)}...` : t.args;
					c.addChild(new Text(truncLine(theme.fg("dim", `${t.tool}: ${argsPreview}`), w), 0, 0));
				}
			}
			for (const line of (r.progress.recentOutput ?? []).slice(-5)) {
				c.addChild(new Text(truncLine(theme.fg("dim", `  ${line}`), w), 0, 0));
			}
			if (r.progress.currentTool || r.progress.recentTools?.length || r.progress.recentOutput?.length) {
				c.addChild(new Spacer(1));
			}
		}

		const items = getDisplayItems(r.messages);
		for (const item of items) {
			if (item.type === "tool")
				c.addChild(new Text(truncLine(theme.fg("muted", formatToolCall(item.name, item.args)), w), 0, 0));
		}
		if (items.length) c.addChild(new Spacer(1));

		if (output) c.addChild(new Markdown(output, 0, 0, mdTheme));
		c.addChild(new Spacer(1));
		if (r.skills?.length) {
			c.addChild(new Text(truncLine(theme.fg("dim", `Skills: ${r.skills.join(", ")}`), w), 0, 0));
		}
		if (r.skillsWarning) {
			c.addChild(new Text(truncLine(theme.fg("warning", `⚠️ ${r.skillsWarning}`), w), 0, 0));
		}
		c.addChild(new Text(truncLine(theme.fg("dim", formatUsage(r.usage, r.model)), w), 0, 0));
		if (r.sessionFile) {
			c.addChild(new Text(truncLine(theme.fg("dim", `Session: ${shortenPath(r.sessionFile)}`), w), 0, 0));
		}

		if (r.artifactPaths) {
			c.addChild(new Spacer(1));
			c.addChild(
				new Text(truncLine(theme.fg("dim", `Artifacts: ${shortenPath(r.artifactPaths.outputPath)}`), w), 0, 0),
			);
		}
		return c;
	}

	const hasRunning =
		d.progress?.some((p) => p.status === "running") || d.results.some((r) => r.progress?.status === "running");
	const ok = d.results.filter(
		(r) => r.progress?.status === "completed" || (r.exitCode === 0 && r.progress?.status !== "running"),
	).length;
	const hasEmptyWithoutTarget = d.results.some(
		(r) =>
			r.exitCode === 0 &&
			r.progress?.status !== "running" &&
			hasEmptyOutput(getSingleResultOutput(r)),
	);
	const icon = hasRunning
		? theme.fg("warning", "...")
		: hasEmptyWithoutTarget
			? theme.fg("warning", "⚠")
			: ok === d.results.length
				? theme.fg("success", "ok")
				: theme.fg("error", "X");

	const totalSummary =
		d.progressSummary ||
		d.results.reduce(
			(acc, r) => {
				const prog = r.progress || r.progressSummary;
				if (prog) {
					acc.toolCount += prog.toolCount;
					acc.durationMs = Math.max(acc.durationMs, prog.durationMs);
				}
				return acc;
			},
			{ toolCount: 0, durationMs: 0 },
		);

	const summaryStr = totalSummary.toolCount
		? ` | ${totalSummary.toolCount} tools, ${formatDuration(totalSummary.durationMs)}`
		: "";

	const modeLabel = d.mode;
	const contextBadge = d.context === "fork" ? theme.fg("warning", " [fork]") : "";
	const totalCount = d.results.length;
	const stepInfo = hasRunning ? ` ${ok + 1}/${totalCount}` : ` ${ok}/${totalCount}`;

	const w = getTermWidth() - 4;
	const c = new Container();
	c.addChild(
		new Text(
			truncLine(`${icon} ${theme.fg("toolTitle", theme.bold(modeLabel))}${contextBadge}${stepInfo}${summaryStr}`, w),
			0,
			0,
		),
	);

	// === STATIC TASK LAYOUT (like clarification UI) ===
	// Each task gets a fixed section with task/output/status
	c.addChild(new Spacer(1));

	for (let i = 0; i < d.results.length; i++) {
		const r = d.results[i];
		const agentName = r?.agent || `task-${i + 1}`;

		if (!r) {
			// Pending task
			c.addChild(new Text(truncLine(theme.fg("dim", `  Task ${i + 1}: ${agentName}`), w), 0, 0));
			c.addChild(new Text(theme.fg("dim", `    status: ○ pending`), 0, 0));
			c.addChild(new Spacer(1));
			continue;
		}

		const progressFromArray =
			d.progress?.find((p) => p.index === i) || d.progress?.find((p) => p.agent === r.agent && p.status === "running");
		const rProg = (r.progress || progressFromArray || r.progressSummary) as
			| (Partial<AgentProgress> & ProgressSummary)
			| undefined;
		const rRunning = rProg?.status === "running";

		const resultOutput = getSingleResultOutput(r);
		const statusIcon = rRunning
			? theme.fg("warning", "●")
			: r.exitCode !== 0
				? theme.fg("error", "✗")
				: hasEmptyOutput(resultOutput)
					? theme.fg("warning", "⚠")
					: theme.fg("success", "✓");
		const stats = rProg ? ` | ${rProg.toolCount} tools, ${formatDuration(rProg.durationMs)}` : "";
		const modelDisplay = r.model ? theme.fg("dim", ` (${r.model})`) : "";
		const taskHeader = rRunning
			? `${statusIcon} Task ${i + 1}: ${theme.bold(theme.fg("warning", r.agent))}${modelDisplay}${stats}`
			: `${statusIcon} Task ${i + 1}: ${theme.bold(r.agent)}${modelDisplay}${stats}`;
		c.addChild(new Text(truncLine(taskHeader, w), 0, 0));

		const taskMaxLen = Math.max(20, w - 12);
		const taskPreview = r.task.length > taskMaxLen ? `${r.task.slice(0, taskMaxLen)}...` : r.task;
		c.addChild(new Text(truncLine(theme.fg("dim", `    task: ${taskPreview}`), w), 0, 0));

		if (r.skills?.length) {
			c.addChild(new Text(truncLine(theme.fg("dim", `    skills: ${r.skills.join(", ")}`), w), 0, 0));
		}
		if (r.skillsWarning) {
			c.addChild(new Text(truncLine(theme.fg("warning", `    ⚠️ ${r.skillsWarning}`), w), 0, 0));
		}

		if (rRunning && rProg) {
			if (rProg.skills?.length) {
				c.addChild(new Text(truncLine(theme.fg("accent", `    skills: ${rProg.skills.join(", ")}`), w), 0, 0));
			}
			// Current tool for running step
			if (rProg.currentTool) {
				const maxToolArgsLen = Math.max(50, w - 20);
				const toolArgsPreview = rProg.currentToolArgs
					? rProg.currentToolArgs.length > maxToolArgsLen
						? `${rProg.currentToolArgs.slice(0, maxToolArgsLen)}...`
						: rProg.currentToolArgs
					: "";
				const toolLine = toolArgsPreview ? `${rProg.currentTool}: ${toolArgsPreview}` : rProg.currentTool;
				c.addChild(new Text(truncLine(theme.fg("warning", `    > ${toolLine}`), w), 0, 0));
			}
			// Recent tools
			if (rProg.recentTools?.length) {
				for (const t of rProg.recentTools.slice(-3)) {
					const maxArgsLen = Math.max(40, w - 30);
					const argsPreview = t.args.length > maxArgsLen ? `${t.args.slice(0, maxArgsLen)}...` : t.args;
					c.addChild(new Text(truncLine(theme.fg("dim", `      ${t.tool}: ${argsPreview}`), w), 0, 0));
				}
			}
			// Recent output - let truncLine handle truncation entirely
			const recentLines = (rProg.recentOutput ?? []).slice(-5);
			for (const line of recentLines) {
				c.addChild(new Text(truncLine(theme.fg("dim", `      ${line}`), w), 0, 0));
			}
		}

		c.addChild(new Spacer(1));
	}

	if (d.artifacts) {
		c.addChild(new Spacer(1));
		c.addChild(new Text(truncLine(theme.fg("dim", `Artifacts dir: ${shortenPath(d.artifacts.dir)}`), w), 0, 0));
	}
	return c;
}
