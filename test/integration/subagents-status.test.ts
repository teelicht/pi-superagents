import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SubagentsStatusComponent } from "../../src/ui/subagents-status.ts";
import type { AsyncRunOverlayData } from "../../src/ui/async-status.ts";

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function createRun(id: string, state: "queued" | "running" | "complete" | "failed") {
	return {
		id,
		asyncDir: `/tmp/${id}`,
		state,
		mode: "single" as const,
		cwd: `/tmp/${id}`,
		startedAt: 100,
		lastUpdate: state === "running" ? 200 : 300,
		endedAt: state === "running" ? undefined : 300,
		currentStep: 0,
		steps: [{ index: 0, agent: "waiter", status: state === "running" ? "running" : "complete" }],
	};
}

const theme = {
	fg: (_token: string, text: string) => text,
	bg: (_token: string, text: string) => text,
};

describe("SubagentsStatusComponent", () => {
	it("auto-refreshes and keeps the same run selected when it moves to Recent", async () => {
		const states: AsyncRunOverlayData[] = [
			{ active: [createRun("run-a", "running")], recent: [] },
			{ active: [], recent: [createRun("run-a", "complete")] },
		];
		let callCount = 0;
		let renderRequests = 0;
		const component = new SubagentsStatusComponent(
			{ requestRender: () => { renderRequests++; } } as any,
			theme as any,
			() => {},
			{
				listRunsForOverlay: () => states[Math.min(callCount++, states.length - 1)]!,
				refreshMs: 10,
			},
		);

		try {
			await wait(25);
			const output = component.render(120).join("\n");
			assert.match(output, /Recent/);
			assert.match(output, /Selected: run-a/);
			assert.match(output, /0 active \/ 1 recent/);
			assert.doesNotMatch(output, /r refresh/);
			assert.ok(renderRequests >= 1, "expected auto-refresh to request a render");
		} finally {
			component.dispose();
		}
	});

	it("stops auto-refreshing after dispose", async () => {
		let renderRequests = 0;
		const component = new SubagentsStatusComponent(
			{ requestRender: () => { renderRequests++; } } as any,
			theme as any,
			() => {},
			{
				listRunsForOverlay: () => ({ active: [createRun("run-a", "running")], recent: [] }),
				refreshMs: 10,
			},
		);

		await wait(25);
		component.dispose();
		const before = renderRequests;
		await wait(25);
		assert.equal(renderRequests, before);
	});
});
