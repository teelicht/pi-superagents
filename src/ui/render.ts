/**
 * Rendering functions for subagent results.
 *
 * Responsibilities:
 * - wrap the compact line formatter into a Pi TUI component
 * - accept Pi's current tool-result expansion state
 *
 * Important dependencies:
 * - subagent-result-lines.ts for pure text line generation
 * - Pi TUI Text component for terminal rendering
 */

import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { type Component, Text } from "@mariozechner/pi-tui";
import type { Details } from "../shared/types.ts";
import { renderSubagentResultLines } from "./subagent-result-lines.ts";

/**
 * Get terminal width.
 *
 * @returns The current terminal column count, defaulting to 120.
 */
function getTermWidth(): number {
	return process.stdout.columns || 120;
}

/**
 * Render a subagent tool result using compact collapsed lines or expanded
 * inline detail lines, based on Pi's current tool-result expansion state.
 *
 * @param result Subagent tool result from the extension runtime.
 * @param options Pi render options, including expansion state.
 * @param _theme Current UI theme; accepted for the Pi renderer contract.
 * @returns TUI component for the subagent result.
 */
export function renderSubagentResult(result: AgentToolResult<Details>, options: { expanded: boolean }, _theme: unknown): Component {
	const width = Math.max(20, getTermWidth() - 4);
	return new Text(renderSubagentResultLines(result, { expanded: options.expanded, width }).join("\n"), 0, 0);
}
