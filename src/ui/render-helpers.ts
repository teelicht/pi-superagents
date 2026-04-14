/**
 * TUI render helper utilities.
 *
 * Provides layout primitives for border-box string array components:
 * - pad: right-pad strings to a minimum width
 * - row: identity row helper (for future theme integration)
 * - renderHeader: themed dashed header with title
 * - renderFooter: themed dashed footer with help text
 * - formatScrollInfo: scroll indicator labels
 */

import type { Theme } from "@mariozechner/pi-coding-agent";

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
