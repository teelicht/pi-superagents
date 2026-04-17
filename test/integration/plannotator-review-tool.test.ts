/**
 * Integration coverage for the Superpowers Plannotator review tool bridge.
 *
 * Responsibilities:
 * - verify the root-only review tool is registered when the extension loads
 * - verify approvals and revision requests flow through the shared event bridge
 * - verify unavailable and synchronous bridge failures fail softly with a warning
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";

/** Minimal tool result shape for these tests. */
interface ToolResult {
	content: Array<{ text: string }>;
	details: unknown;
}

interface RegisteredTool {
	name: string;
	execute(
		id: string,
		params: Record<string, unknown>,
		signal: AbortSignal | undefined,
		onUpdate: unknown,
		ctx: ReturnType<typeof createCtx>,
	): Promise<ToolResult>;
}

/**
 * Create a minimal event bus matching the extension bridge contract.
 *
 * @returns Event bus with `on` and `emit`.
 */
function createEventBus() {
	const handlers = new Map<string, Array<(data: unknown) => void>>();
	return {
		on(event: string, handler: (data: unknown) => void) {
			const existing = handlers.get(event) ?? [];
			existing.push(handler);
			handlers.set(event, existing);
			return () => {
				handlers.set(
					event,
					(handlers.get(event) ?? []).filter((entry) => entry !== handler),
				);
			};
		},
		emit(event: string, data: unknown) {
			for (const handler of handlers.get(event) ?? []) handler(data);
		},
	};
}

/**
 * Create a minimal Pi API mock that captures registered tools.
 *
 * @returns Mock Pi surface plus the registered tool map.
 */
function createPiMock(customEvents?: ReturnType<typeof createEventBus>) {
	const events = customEvents ?? createEventBus();
	const lifecycle = new Map<string, Array<(event: unknown, ctx: unknown) => void>>();
	const tools = new Map<string, RegisteredTool>();
	return {
		tools,
		pi: {
			events,
			registerTool(tool: RegisteredTool) {
				tools.set(tool.name, tool);
			},
			registerCommand() {},
			registerShortcut() {},
			registerMessageRenderer() {},
			sendMessage() {},
			on(event: string, handler: (event: unknown, ctx: unknown) => void) {
				const existing = lifecycle.get(event) ?? [];
				existing.push(handler);
				lifecycle.set(event, existing);
			},
		},
	};
}

/**
 * Create a minimal extension context with captured notifications.
 *
 * @param notifications Mutable list of UI notifications.
 * @returns Extension context mock.
 */
function createCtx(notifications: Array<{ message: string; type?: string }>) {
	return {
		cwd: process.cwd(),
		hasUI: true,
		ui: {
			notify(message: string, type?: string) {
				notifications.push({ message, type });
			},
			setWidget() {},
		},
		sessionManager: {
			getSessionFile: () => null,
			getEntries: () => [],
		},
		modelRegistry: {
			getAvailable: () => [],
		},
	};
}

void describe("superpowers_plan_review tool", () => {
	const originalHome = process.env.HOME;
	const tempDirs: string[] = [];

	afterEach(() => {
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;
		for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
	});

	/**
	 * Load the extension with Plannotator review enabled.
	 *
	 * @param customEvents Optional event bus override for error simulation.
	 * @returns Registered extension mock and event bus.
	 */
	async function loadExtensionWithPlannotatorEnabled(customEvents?: ReturnType<typeof createEventBus>) {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-plannotator-home-"));
		tempDirs.push(home);
		process.env.HOME = home;
		const extensionDir = path.join(home, ".pi", "agent", "extensions", "subagent");
		fs.mkdirSync(extensionDir, { recursive: true });
		fs.writeFileSync(
			path.join(extensionDir, "config.json"),
			JSON.stringify({ superagents: { commands: { "sp-plan": { usePlannotator: true } } } }),
			"utf-8",
		);
		const module = await import("../../src/extension/index.ts");
		const mock = createPiMock(customEvents);
		module.default(mock.pi as never);
		return mock;
	}

	void it("emits a plan-review request and returns approval", async () => {
		const mock = await loadExtensionWithPlannotatorEnabled();
		const tool = mock.tools.get("superpowers_plan_review");
		assert.ok(tool, "expected superpowers_plan_review tool to be registered");

		mock.pi.events.on("plannotator:request", (request) => {
			const typedRequest = request as {
				requestId: string;
				action: string;
				payload: { planContent: string; planFilePath?: string; origin: string };
				respond(response: unknown): void;
			};
			assert.equal(typedRequest.action, "plan-review");
			assert.equal(typedRequest.payload.origin, "pi-superagents");
			assert.equal(typedRequest.payload.planContent, "Final plan");
			assert.equal(typedRequest.payload.planFilePath, "docs/plan.md");
			typedRequest.respond({
				status: "handled",
				result: { status: "pending", reviewId: "review-1" },
			});
			mock.pi.events.emit("plannotator:review-result", {
				reviewId: "review-1",
				approved: true,
			});
		});

		const result = await tool.execute(
			"review-approval",
			{ planContent: "Final plan", planFilePath: "docs/plan.md" },
			undefined,
			undefined,
			createCtx([]),
		);

		assert.equal(result.content[0].text, "Plannotator approved the plan review. Continue the Superpowers workflow.");
	});

	void it("returns the disabled guidance when plannotator is not enabled", async () => {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-plannotator-disabled-home-"));
		tempDirs.push(home);
		process.env.HOME = home;
		const extensionDir = path.join(home, ".pi", "agent", "extensions", "subagent");
		fs.mkdirSync(extensionDir, { recursive: true });
		fs.writeFileSync(
			path.join(extensionDir, "config.json"),
			JSON.stringify({ superagents: { commands: { "sp-plan": { usePlannotator: false } } } }),
			"utf-8",
		);
		const module = await import("../../src/extension/index.ts");
		const mock = createPiMock();
		module.default(mock.pi as never);

		const tool = mock.tools.get("superpowers_plan_review");
		assert.ok(tool, "expected superpowers_plan_review tool to be registered");

		const result = await tool.execute(
			"review-disabled",
			{ planContent: "Final plan" },
			undefined,
			undefined,
			createCtx([]),
		);

		assert.equal(
			result.content[0].text,
			"Plannotator review is disabled in config. Continue with the normal text-based Superpowers approval flow.",
		);
	});

	void it("returns rejection feedback for revision", async () => {
		const mock = await loadExtensionWithPlannotatorEnabled();
		const tool = mock.tools.get("superpowers_plan_review");
		assert.ok(tool, "expected superpowers_plan_review tool to be registered");

		mock.pi.events.on("plannotator:request", (request) => {
			const typedRequest = request as { respond(response: unknown): void };
			typedRequest.respond({
				status: "handled",
				result: { status: "pending", reviewId: "review-2" },
			});
			mock.pi.events.emit("plannotator:review-result", {
				reviewId: "review-2",
				approved: false,
				feedback: "Add rollback steps.",
			});
		});

		const result = await tool.execute(
			"review-reject",
			{ planContent: "Final plan" },
			undefined,
			undefined,
			createCtx([]),
		);

		assert.equal(result.content[0].text, `Plannotator requested plan changes:\nAdd rollback steps.`);
	});

	void it("fails softly when Plannotator reports unavailable and notifies once", async () => {
		const mock = await loadExtensionWithPlannotatorEnabled();
		const tool = mock.tools.get("superpowers_plan_review");
		assert.ok(tool, "expected superpowers_plan_review tool to be registered");
		const notifications: Array<{ message: string; type?: string }> = [];

		mock.pi.events.on("plannotator:request", (request) => {
			const typedRequest = request as { respond(response: unknown): void };
			typedRequest.respond({ status: "unavailable", error: "Browser bridge offline" });
		});

		const result = await tool.execute(
			"review-unavailable",
			{ planContent: "Final plan" },
			undefined,
			undefined,
			createCtx(notifications),
		);

		assert.equal(notifications.length, 1);
		assert.deepEqual(notifications[0], {
			message: "Plannotator unavailable: Browser bridge offline. Falling back to text-based approval.",
			type: "warning",
		});
		assert.equal(
			result.content[0].text,
			`Plannotator unavailable: Browser bridge offline\nContinue with the normal text-based Superpowers approval flow.`,
		);
	});

	void it("fails softly when synchronous event-bus errors escape the bridge", async () => {
		const throwingEvents = {
			on() {
				return () => undefined;
			},
			emit() {
				throw new Error("Listener explosion");
			},
		};
		const mock = await loadExtensionWithPlannotatorEnabled(throwingEvents as ReturnType<typeof createEventBus>);
		const tool = mock.tools.get("superpowers_plan_review");
		assert.ok(tool, "expected superpowers_plan_review tool to be registered");
		const notifications: Array<{ message: string; type?: string }> = [];

		const result = await tool.execute(
			"review-sync-error",
			{ planContent: "Final plan" },
			undefined,
			undefined,
			createCtx(notifications),
		);

		assert.equal(notifications.length, 1);
		assert.equal(notifications[0]?.type, "warning");
		assert.match(notifications[0]?.message ?? "", /Listener explosion/);
		assert.match(result.content[0].text, /Continue with the normal text-based Superpowers approval flow/);
	});
});

void describe("superpowers_spec_review tool", () => {
	const originalHome = process.env.HOME;
	const tempDirs: string[] = [];

	afterEach(() => {
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;
		for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
	});

	/**
	 * Load the extension with Plannotator review enabled.
	 *
	 * @param customEvents Optional event bus override for error simulation.
	 * @returns Registered extension mock and event bus.
	 */
	async function loadExtensionWithPlannotatorEnabled(customEvents?: ReturnType<typeof createEventBus>) {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-spec-plannotator-home-"));
		tempDirs.push(home);
		process.env.HOME = home;
		const extensionDir = path.join(home, ".pi", "agent", "extensions", "subagent");
		fs.mkdirSync(extensionDir, { recursive: true });
		fs.writeFileSync(
			path.join(extensionDir, "config.json"),
			JSON.stringify({ superagents: { commands: { "sp-brainstorm": { usePlannotator: true } } } }),
			"utf-8",
		);
		const module = await import("../../src/extension/index.ts");
		const mock = createPiMock(customEvents);
		module.default(mock.pi as never);
		return mock;
	}

	void it("emits a saved-spec review request and returns approval", async () => {
		const mock = await loadExtensionWithPlannotatorEnabled();
		const tool = mock.tools.get("superpowers_spec_review");
		assert.ok(tool, "expected superpowers_spec_review tool to be registered");

		mock.pi.events.on("plannotator:request", (request) => {
			const typedRequest = request as {
				requestId: string;
				action: string;
				payload: { planContent: string; planFilePath?: string; origin: string };
				respond(response: unknown): void;
			};
			assert.equal(typedRequest.action, "plan-review");
			assert.equal(typedRequest.payload.origin, "pi-superagents");
			assert.equal(typedRequest.payload.planContent, "Final spec");
			assert.equal(typedRequest.payload.planFilePath, "docs/superpowers/specs/spec.md");
			typedRequest.respond({
				status: "handled",
				result: { status: "pending", reviewId: "spec-review-1" },
			});
			mock.pi.events.emit("plannotator:review-result", {
				reviewId: "spec-review-1",
				approved: true,
			});
		});

		const result = await tool.execute(
			"spec-review-approval",
			{ specContent: "Final spec", specFilePath: "docs/superpowers/specs/spec.md" },
			undefined,
			undefined,
			createCtx([]),
		);

		assert.equal(
			result.content[0].text,
			"Plannotator approved the saved spec review. Continue the Superpowers workflow.",
		);
	});

	void it("returns saved-spec rejection feedback for revision", async () => {
		const mock = await loadExtensionWithPlannotatorEnabled();
		const tool = mock.tools.get("superpowers_spec_review");
		assert.ok(tool, "expected superpowers_spec_review tool to be registered");

		mock.pi.events.on("plannotator:request", (request) => {
			const typedRequest = request as { respond(response: unknown): void };
			typedRequest.respond({
				status: "handled",
				result: { status: "pending", reviewId: "spec-review-2" },
			});
			mock.pi.events.emit("plannotator:review-result", {
				reviewId: "spec-review-2",
				approved: false,
				feedback: "Clarify interception opt-in.",
			});
		});

		const result = await tool.execute(
			"spec-review-rejected",
			{ specContent: "Final spec" },
			undefined,
			undefined,
			createCtx([]),
		);

		assert.match(result.content[0].text, /Plannotator requested saved spec changes/);
		assert.match(result.content[0].text, /Clarify interception opt-in/);
	});

	void it("returns the disabled guidance when plannotator is not enabled", async () => {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-spec-plannotator-disabled-home-"));
		tempDirs.push(home);
		process.env.HOME = home;
		const extensionDir = path.join(home, ".pi", "agent", "extensions", "subagent");
		fs.mkdirSync(extensionDir, { recursive: true });
		fs.writeFileSync(
			path.join(extensionDir, "config.json"),
			JSON.stringify({ superagents: { commands: { "sp-brainstorm": { usePlannotator: false } } } }),
			"utf-8",
		);
		const module = await import("../../src/extension/index.ts");
		const mock = createPiMock();
		module.default(mock.pi as never);

		const tool = mock.tools.get("superpowers_spec_review");
		assert.ok(tool, "expected superpowers_spec_review tool to be registered");

		const result = await tool.execute(
			"spec-review-disabled",
			{ specContent: "Final spec" },
			undefined,
			undefined,
			createCtx([]),
		);

		assert.equal(
			result.content[0].text,
			"Plannotator saved spec review is disabled in config. Continue with the normal text-based Superpowers review flow.",
		);
	});

	void it("fails softly when Plannotator reports unavailable and notifies once", async () => {
		const mock = await loadExtensionWithPlannotatorEnabled();
		const tool = mock.tools.get("superpowers_spec_review");
		assert.ok(tool, "expected superpowers_spec_review tool to be registered");
		const notifications: Array<{ message: string; type?: string }> = [];

		mock.pi.events.on("plannotator:request", (request) => {
			const typedRequest = request as { respond(response: unknown): void };
			typedRequest.respond({ status: "unavailable", error: "Browser bridge offline" });
		});

		const result = await tool.execute(
			"spec-review-unavailable",
			{ specContent: "Final spec" },
			undefined,
			undefined,
			createCtx(notifications),
		);

		assert.equal(notifications.length, 1);
		assert.deepEqual(notifications[0], {
			message: "Plannotator unavailable: Browser bridge offline. Falling back to text-based spec review.",
			type: "warning",
		});
		assert.equal(
			result.content[0].text,
			`Plannotator unavailable: Browser bridge offline\nContinue with the normal text-based Superpowers review flow.`,
		);
	});

	void it("fails softly when synchronous event-bus errors escape the bridge", async () => {
		const throwingEvents = {
			on() {
				return () => undefined;
			},
			emit() {
				throw new Error("Spec listener explosion");
			},
		};
		const mock = await loadExtensionWithPlannotatorEnabled(throwingEvents as ReturnType<typeof createEventBus>);
		const tool = mock.tools.get("superpowers_spec_review");
		assert.ok(tool, "expected superpowers_spec_review tool to be registered");
		const notifications: Array<{ message: string; type?: string }> = [];

		const result = await tool.execute(
			"spec-review-sync-error",
			{ specContent: "Final spec" },
			undefined,
			undefined,
			createCtx(notifications),
		);

		assert.equal(notifications.length, 1);
		assert.equal(notifications[0]?.type, "warning");
		assert.match(notifications[0]?.message ?? "", /Spec listener explosion/);
		assert.match(result.content[0].text, /Continue with the normal text-based Superpowers review flow/);
	});
});
