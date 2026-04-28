import assert from "node:assert/strict";
import { describe, it } from "node:test";

type RenderSubagentResult = (
	result: {
		content: Array<{ type: "text"; text: string }>;
		details?: {
			mode: "single" | "parallel" | "chain" | "management";
			sessionMode?: "standalone" | "lineage-only" | "fork";
			results: unknown[];
		};
	},
	options: { expanded: boolean },
	theme: {
		fg(name: string, text: string): string;
		bold(text: string): string;
	},
) => { render(width: number): string[] };

let renderSubagentResult: RenderSubagentResult | undefined;
let available = true;
try {
	({ renderSubagentResult } = (await import("../../src/ui/render.ts")) as unknown as {
		renderSubagentResult?: RenderSubagentResult;
	});
} catch {
	// Skip in plain unit mode where render.ts dependencies are unavailable.
	available = false;
}

const theme = {
	fg: (_name: string, text: string) => text,
	bold: (text: string) => text,
};

void describe("renderSubagentResult fork indicator", { skip: !available ? "render.ts not importable" : undefined }, () => {
	void it("shows [fork] when details are empty but sessionMode is fork", () => {
		const widget = renderSubagentResult!(
			{
				content: [{ type: "text", text: "Async: reviewer [abc123]" }],
				details: { mode: "single", sessionMode: "fork", results: [] },
			},
			{ expanded: false },
			theme,
		);

		const text = widget.render(120).join("\n");
		assert.match(text, /\[fork\]/);
	});

	void it("shows [fork] on single-result header", () => {
		const widget = renderSubagentResult!(
			{
				content: [{ type: "text", text: "done" }],
				details: {
					mode: "single",
					sessionMode: "fork",
					results: [
						{
							agent: "reviewer",
							task: "review",
							exitCode: 0,
							messages: [],
							usage: {
								input: 0,
								output: 0,
								cacheRead: 0,
								cacheWrite: 0,
								cost: 0,
								turns: 0,
							},
						},
					],
				},
			},
			{ expanded: false },
			theme,
		);

		const text = widget.render(120).join("\n");
		assert.match(text, /\[fork\]/);
	});

	void it("renders collapsed single results through the compact line formatter", () => {
		const widget = renderSubagentResult!(
			{
				content: [{ type: "text", text: "done" }],
				details: {
					mode: "single",
					results: [
						{
							agent: "sp-recon",
							task: "Inspect auth flow",
							exitCode: 0,
							messages: [],
							usage: {
								input: 0,
								output: 0,
								cacheRead: 0,
								cacheWrite: 0,
								cost: 0,
								turns: 0,
							},
							progress: {
								index: 0,
								agent: "sp-recon",
								status: "running",
								task: "Inspect auth flow",
								currentTool: "read",
								currentToolArgs: "src/auth/session.ts",
								recentTools: [],
								recentOutput: ["verbose output hidden while collapsed"],
								toolCount: 3,
								durationMs: 12_300,
							},
						},
					],
				},
			},
			{ expanded: false },
			theme,
		);

		const text = widget.render(120).join("\n");
		assert.match(text, /^Subagent\s+running/m);
		assert.match(text, /-> read src\/auth\/session\.ts/);
		assert.doesNotMatch(text, /verbose output hidden while collapsed/);
		assert.doesNotMatch(text, /Task:/);
		assert.doesNotMatch(text, /Session:/);
	});
});
