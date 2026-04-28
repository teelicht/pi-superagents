/**
 * TUI render helper utilities.
 *
 * Provides layout primitives for border-box string array components:
 * - pad: right-pad strings to a minimum width
 * - row: identity row helper (for future theme integration)
 * - renderHeader: themed dashed header with title
 * - renderFooter: themed dashed footer with help text
 * - formatScrollInfo: scroll indicator labels
 * - renderFramedPanel: stable green framed panel with themed background
 */

import type { Theme } from "@mariozechner/pi-coding-agent";
import { truncateToWidth } from "@mariozechner/pi-tui";

/** Right-pad `text` with `char` to reach `length` columns.  No-op if already ≥ `length`. */
export function pad(text: string, length: number, char = " "): string {
	if (text.length >= length) return text;
	return text + char.repeat(length - text.length);
}

/** Identity row helper — returns text unchanged. Reserved for future theme-aware padding. */
export function row(text: string, _width: number, _theme: Theme): string {
	return text;
}

/** Render a themed dashed header: `--[ Title ]-----` */
export function renderHeader(title: string, width: number, theme: Theme): string {
	const prefix = "--[ ";
	const suffix = " ]";
	const dashCount = Math.max(2, width - prefix.length - title.length - suffix.length);
	return theme.fg("accent", `${prefix}${title}${suffix}${"-".repeat(dashCount)}`);
}

/** Render a themed dashed footer with help text. */
export function renderFooter(text: string, width: number, theme: Theme): string {
	const dashes = "-".repeat(width);
	return theme.fg("dim", `${dashes}\n${text}`);
}

/** Format a scroll indicator showing items above/below the viewport. */
export function formatScrollInfo(above: number, below: number): string {
	if (above === 0 && below === 0) return "";
	if (above > 0 && below > 0) return `↑ ${above} more ... ↓ ${below} more`;
	if (above > 0) return `↑ ${above} more`;
	return `↓ ${below} more`;
}

/**
 * Apply the configured panel background to one complete frame row.
 *
 * @param line Row content already padded to panel width.
 * @param _width Visible row width, retained to document the stable-width invariant.
 * @param theme Pi theme used for the background.
 * @returns Themed row string.
 */
function stylePanelRow(line: string, _width: number, theme: Theme): string {
	return theme.bg("toolSuccessBg", line);
}

/**
 * Render a stable green framed panel with themed background on every row.
 *
 * @param title Title shown in the framed panel header.
 * @param bodyLines Body rows to render inside the frame.
 * @param width Requested total panel width, including borders.
 * @param theme Pi theme used for green border and panel background.
 * @param footer Optional footer/help row shown above the bottom border.
 * @returns Fully framed string rows, each padded to the same visible width.
 */
export function renderFramedPanel(title: string, bodyLines: string[], width: number, theme: Theme, footer?: string): string[] {
	const panelWidth = Math.max(12, width);
	const innerWidth = panelWidth - 2;
	const border = (left: string, fill: string, right: string): string => stylePanelRow(theme.fg("success", `${left}${fill.repeat(innerWidth)}${right}`), panelWidth, theme);
	const content = (text: string): string => {
		const padded = truncateToWidth(text, innerWidth, "...", true);
		return stylePanelRow(`${theme.fg("success", "│")}${padded}${theme.fg("success", "│")}`, panelWidth, theme);
	};

	const lines = [border("┌", "─", "┐"), content(` ${title}`), border("├", "─", "┤"), ...bodyLines.map((line) => content(line.length === 0 ? "" : ` ${line}`))];

	if (footer !== undefined) {
		lines.push(border("├", "─", "┤"), content(` ${footer}`));
	}

	lines.push(border("└", "─", "┘"));
	return lines;
}
