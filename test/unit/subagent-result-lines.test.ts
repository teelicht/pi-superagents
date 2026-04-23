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
		const lines = renderSubagentResultLines(
			toolResult({
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
							recentTools: [{ tool: "rg", args: '{"pattern":"token"}', endMs: 1 }],
							recentOutput: ["Auth is split across middleware"],
							toolCount: 3,
							durationMs: 12_300,
						},
					}),
				],
			}),
			{ expanded: false, width: 120 },
		);

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

void describe("renderSubagentResultLines expanded single runs", () => {
	void it("shows bounded running details when expanded", () => {
		const lines = renderSubagentResultLines(
			toolResult({
				mode: "single",
				context: "fork",
				results: [
					singleResult({
						model: "openai/gpt-5.4-mini",
						skills: ["brainstorming"],
						skillsWarning: "Missing optional skill: product-designer",
						progress: {
							index: 0,
							agent: "sp-recon",
							status: "running",
							task: "Inspect auth flow",
							currentTool: "read",
							currentToolArgs: "src/auth/session.ts",
							recentTools: [
								{ tool: "rg", args: '{"pattern":"token"}', endMs: 1 },
								{ tool: "read", args: "middleware.ts", endMs: 2 },
								{ tool: "read", args: "session.ts", endMs: 3 },
								{ tool: "rg", args: '{"pattern":"cookie"}', endMs: 4 },
							],
							recentOutput: ["", "Auth is split across middleware", "Session refresh is handled separately"],
							toolCount: 4,
							durationMs: 15_500,
						},
					}),
				],
			}),
			{ expanded: true, width: 120 },
		);

		const text = lines.join("\n");
		assert.match(text, /Subagent \[fork\]\s+running/);
		assert.match(text, /model: openai\/gpt-5\.4-mini/);
		assert.match(text, /current: read src\/auth\/session\.ts/);
		assert.doesNotMatch(text, /\{"pattern":"token"\}/);
		assert.match(text, /recent: read middleware\.ts, read session\.ts, rg \{"pattern":"cookie"\}/);
		assert.match(text, /output: Auth is split across middleware/);
		assert.match(text, /output: Session refresh is handled separately/);
		assert.match(text, /skills: brainstorming/);
		assert.match(text, /warning: Missing optional skill: product-designer/);
	});

	void it("shows completed details, artifacts, session, output preview, and errors when expanded", () => {
		const lines = renderSubagentResultLines(
			toolResult({
				mode: "single",
				results: [
					singleResult({
						exitCode: 1,
						error: "Child process exited with 1",
						model: "anthropic/claude-sonnet-4.5",
						sessionFile: "/Users/thomas/.pi/sessions/session.jsonl",
						artifactPaths: {
							inputPath: "/tmp/input.md",
							outputPath: "/tmp/output.md",
							jsonlPath: "/tmp/events.jsonl",
							metadataPath: "/tmp/meta.json",
						},
						progressSummary: { toolCount: 7, durationMs: 22_100 },
						finalOutput: "The auth flow fails when token refresh is skipped.\nSecond line.",
					}),
				],
			}),
			{ expanded: true, width: 140 },
		);

		const text = lines.join("\n");
		assert.match(text, /Subagent\s+0\/1 complete error/);
		assert.match(text, /- failed\s+sp-recon\s+Inspect auth flow/);
		assert.match(text, /model: anthropic\/claude-sonnet-4\.5/);
		assert.match(text, /output: The auth flow fails when token refresh is skipped\./);
		assert.match(text, /error: Child process exited with 1/);
		assert.match(text, /session: .*session\.jsonl/);
		assert.match(text, /artifact: .*output\.md/);
	});
});

void describe("renderSubagentResultLines parallel runs", () => {
	void it("renders running parallel progress with pending rows while collapsed", () => {
		const lines = renderSubagentResultLines(
			toolResult({
				mode: "parallel",
				results: [
					singleResult({
						progress: {
							index: 0,
							agent: "sp-recon",
							status: "running",
							task: "Inspect auth flow",
							currentTool: "read",
							currentToolArgs: "src/auth/session.ts",
							recentTools: [],
							recentOutput: [],
							toolCount: 3,
							durationMs: 12_300,
						},
					}),
				],
				progress: [
					{
						index: 0,
						agent: "sp-recon",
						status: "running",
						task: "Inspect auth flow",
						currentTool: "read",
						currentToolArgs: "src/auth/session.ts",
						recentTools: [],
						recentOutput: [],
						toolCount: 3,
						durationMs: 12_300,
					},
					{
						index: 1,
						agent: "sp-code-review",
						status: "pending",
						task: "Review auth changes",
						recentTools: [],
						recentOutput: [],
						toolCount: 0,
						durationMs: 0,
					},
				],
			}),
			{ expanded: false, width: 120 },
		);

		const text = lines.join("\n");
		assert.match(text, /^Subagents\s+0\/2 complete/m);
		assert.match(text, /- running\s+sp-recon\s+Inspect auth flow\s+3 tools\s+12\.3s/);
		assert.match(text, /-> read src\/auth\/session\.ts/);
		assert.match(text, /- pending\s+sp-code-review\s+Review auth changes/);
		assert.doesNotMatch(text, /recent:/);
	});

	void it("renders a compact completed parallel success summary", () => {
		const lines = renderSubagentResultLines(
			toolResult({
				mode: "parallel",
				results: [
					singleResult({
						progressSummary: { toolCount: 7, durationMs: 20_000 },
						finalOutput: "Recon complete",
					}),
					singleResult({
						agent: "sp-code-review",
						task: "Review auth changes",
						progressSummary: { toolCount: 10, durationMs: 41_200 },
						finalOutput: "Review complete",
					}),
				],
			}),
			{ expanded: false, width: 120 },
		);

		assert.deepStrictEqual(lines, ["Subagents  2/2 complete ok  17 tools  41.2s"]);
	});

	void it("renders a compact completed parallel failure summary", () => {
		const lines = renderSubagentResultLines(
			toolResult({
				mode: "parallel",
				results: [
					singleResult({
						progressSummary: { toolCount: 7, durationMs: 20_000 },
						finalOutput: "Recon complete",
					}),
					singleResult({
						agent: "sp-code-review",
						task: "Review auth changes",
						exitCode: 1,
						error: "Review failed",
						progressSummary: { toolCount: 5, durationMs: 28_400 },
					}),
				],
			}),
			{ expanded: false, width: 120 },
		);

		assert.deepStrictEqual(lines, ["Subagents  1/2 complete error  12 tools  28.4s"]);
	});

	void it("truncates long task, tool, and output previews to the supplied width", () => {
		const lines = renderSubagentResultLines(
			toolResult({
				mode: "single",
				results: [
					singleResult({
						task: "Inspect an intentionally long authentication and authorization flow description",
						progress: {
							index: 0,
							agent: "sp-recon",
							status: "running",
							task: "Inspect an intentionally long authentication and authorization flow description",
							currentTool: "read",
							currentToolArgs: "src/auth/session-with-a-very-long-file-name.ts",
							recentTools: [],
							recentOutput: ["A long output line that should not leak in collapsed mode"],
							toolCount: 1,
							durationMs: 1_000,
						},
					}),
				],
			}),
			{ expanded: false, width: 48 },
		);

		assert.ok(
			lines.every((line) => line.length <= 48),
			`expected every line to fit: ${JSON.stringify(lines)}`,
		);
		assert.ok(
			lines.some((line) => line.endsWith("…")),
			"expected at least one truncated line",
		);
	});
});
