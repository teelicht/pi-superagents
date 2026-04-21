/**
 * Unit tests for compact inline subagent result line formatting.
 *
 * Responsibilities:
 * - verify collapsed and expanded subagent display lines
 * - keep visual behavior independent from Pi TUI component rendering
 * - guard truncation and disclosure boundaries for subagent output
 */

import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { Details, SingleResult, Usage } from "../../src/shared/types.ts";
import { renderSubagentResultLines } from "../../src/ui/subagent-result-lines.ts";

const baseUsage: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	cost: 0,
	turns: 0,
};

/**
 * Creates the minimal result shape needed by compact-render tests.
 *
 * @param overrides Result fields that should differ from the default fixture.
 * @returns A complete single subagent result fixture.
 */
function singleResult(overrides: Partial<SingleResult> = {}): SingleResult {
	return {
		agent: "sp-recon",
		task: "Inspect auth flow",
		exitCode: 0,
		messages: [],
		usage: baseUsage,
		...overrides,
	};
}

/**
 * Wraps details in the AgentToolResult shape consumed by renderSubagentResult.
 *
 * @param details Subagent result details fixture.
 * @returns Tool result fixture with text content.
 */
function toolResult(details: Details): AgentToolResult<Details> {
	return {
		content: [{ type: "text", text: "done" }],
		details,
	};
}

void describe("renderSubagentResultLines collapsed single runs", () => {
	void it("renders a compact running single subagent and hides verbose details", () => {
		const lines = renderSubagentResultLines(toolResult({
			mode: "single",
			results: [
				singleResult({
					progress: {
						index: 0,
						agent: "sp-recon",
						status: "running",
						task: "Inspect auth flow",
						currentTool: "read",
						currentToolArgs: "src/auth/session.ts",
						recentTools: [{ tool: "rg", args: "{\"pattern\":\"token\"}", endMs: 1 }],
						recentOutput: ["Auth is split across middleware"],
						toolCount: 3,
						durationMs: 12_300,
					},
				}),
			],
		}), { expanded: false, width: 120 });

		const text = lines.join("\n");
		assert.match(text, /^Subagent\s+running/m);
		assert.match(text, /sp-recon/);
		assert.match(text, /Inspect auth flow/);
		assert.match(text, /3 tools/);
		assert.match(text, /12\.3s/);
		assert.match(text, /-> read src\/auth\/session\.ts/);
		assert.doesNotMatch(text, /recent:/);
		assert.doesNotMatch(text, /Auth is split across middleware/);
		assert.doesNotMatch(text, /Session:/);
		assert.doesNotMatch(text, /Artifacts:/);
	});
});
