/**
 * Tool-call display helper utilities.
 *
 * Responsibilities:
 * - convert tool-call argument objects into compact user-facing previews
 * - preserve special handling for MCP-style tool calls
 *
 * Important dependencies/side effects:
 * - no external dependencies and no side effects
 */

/**
 * Extract a compact preview of tool arguments for progress display.
 *
 * @param args Tool-call arguments keyed by argument name.
 * @returns A short preview string, or an empty string when no useful preview exists.
 */
export function extractToolArgsPreview(args: Record<string, unknown>): string {
	// Handle MCP tool calls - show server/tool info.
	if (args.tool && typeof args.tool === "string") {
		const server = args.server && typeof args.server === "string" ? `${args.server}/` : "";
		const toolArgs = args.args && typeof args.args === "string" ? ` ${args.args.slice(0, 40)}` : "";
		return `${server}${args.tool}${toolArgs}`;
	}

	const previewKeys = ["command", "path", "file_path", "pattern", "query", "url", "task", "describe", "search"];
	for (const key of previewKeys) {
		const value = args[key];
		if (value && typeof value === "string") {
			return value.length > 60 ? `${value.slice(0, 57)}...` : value;
		}
	}

	// Fallback: show first string value found.
	for (const [key, value] of Object.entries(args)) {
		if (typeof value === "string" && value.length > 0) {
			const preview = value.length > 50 ? `${value.slice(0, 47)}...` : value;
			return `${key}=${preview}`;
		}
	}
	return "";
}
