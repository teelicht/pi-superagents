/**
 * Rendering functions for subagent results
 */

import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { type Component, Text } from "@mariozechner/pi-tui";
import type { Details } from "../shared/types.ts";
import { renderSubagentResultLines } from "./subagent-result-lines.ts";

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
 * Render a subagent tool result using compact collapsed lines or expanded
 * inline detail lines, based on Pi's current tool-result expansion state.
 *
 * @param result Subagent tool result from the extension runtime.
 * @param options Pi render options, including expansion state.
 * @param theme Current UI theme; accepted for the Pi renderer contract.
 * @returns TUI component for the subagent result.
 */
export function renderSubagentResult(
	result: AgentToolResult<Details>,
	options: { expanded: boolean },
	_theme: Theme,
): Component {
	const width = Math.max(20, getTermWidth() - 4);
	return new Text(renderSubagentResultLines(result, { expanded: options.expanded, width }).join("\n"), 0, 0);
}
