/**
 * Integration coverage for fail-closed config handling at the extension boundary.
 *
 * Responsibilities:
 * - verify invalid config diagnostics are shown on Pi session start
 * - verify execution tools refuse to run while config is blocked
 * - verify diagnostic-safe config inspection stays available
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";

let registerSubagentExtension: typeof import("../../src/extension/index.ts").default | undefined;
let available = false;
try {
	registerSubagentExtension = (await import("../../src/extension/index.ts")).default;
	available = true;
} catch {
	// Extension may not be importable in minimal test environments.
}

interface RegisteredTool {
	name: string;
	execute(id: string, params: Record<string, unknown>, signal: AbortSignal | undefined, onUpdate: unknown, ctx: unknown): Promise<unknown>;
}

/**
 * Create a minimal event bus matching what the extension uses.
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
				handlers.set(event, (handlers.get(event) ?? []).filter((entry) => entry !== handler));
			};
		},
		emit(event: string, data: unknown) {
			for (const handler of handlers.get(event) ?? []) handler(data);
		},
	};
}

/**
 * Create a minimal Pi API mock for extension registration tests.
 *
 * @returns Mock API plus captured tools, commands, and messages.
 */
function createPiMock() {
	const events = createEventBus();
	const lifecycle = new Map<string, Array<(event: unknown, ctx: unknown) => void>>();
	const tools = new Map<string, RegisteredTool>();
	const messages: unknown[] = [];
	return {
		tools,
		messages,
		pi: {
			events,
			registerTool(tool: RegisteredTool) {
				tools.set(tool.name, tool);
			},
			registerCommand() {},
			registerShortcut() {},
			registerMessageRenderer() {},
			sendMessage(message: unknown) {
				messages.push(message);
			},
			on(event: string, handler: (event: unknown, ctx: unknown) => void) {
				const existing = lifecycle.get(event) ?? [];
				existing.push(handler);
				lifecycle.set(event, existing);
			},
		},
		emitLifecycle(event: string, payload: unknown, ctx: unknown) {
			for (const handler of lifecycle.get(event) ?? []) handler(payload, ctx);
		},
	};
}

/**
 * Create a minimal extension context with notification capture.
 *
 * @param notifications Mutable notification list.
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

void describe("extension config gating", { skip: !available ? "extension not importable" : undefined }, () => {
	const originalHome = process.env.HOME;
	const tempDirs: string[] = [];

	afterEach(() => {
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;
		for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
	});

	void it("notifies on session start and blocks subagent execution when config is invalid", async () => {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-config-gate-home-"));
		tempDirs.push(home);
		process.env.HOME = home;
		const extensionDir = path.join(home, ".pi", "agent", "extensions", "subagent");
		fs.mkdirSync(extensionDir, { recursive: true });
		fs.writeFileSync(path.join(extensionDir, "config.json"), JSON.stringify({ asyncByDefalt: true }), "utf-8");

		const mock = createPiMock();
		registerSubagentExtension!(mock.pi as never);

		const notifications: Array<{ message: string; type?: string }> = [];
		const ctx = createCtx(notifications);
		mock.emitLifecycle("session_start", { type: "session_start", reason: "startup" }, ctx);

		assert.equal(notifications.length, 1);
		assert.equal(notifications[0].type, "error");
		assert.match(notifications[0].message, /pi-superagents is disabled/);
		assert.match(notifications[0].message, /asyncByDefalt/);

		const result = await mock.tools.get("subagent")!.execute("blocked", { agent: "scout", task: "inspect" }, undefined, undefined, ctx);
		assert.equal((result as { isError?: boolean }).isError, true);
		assert.match(JSON.stringify(result), /config\.json needs attention/);
	});

	void it("keeps config diagnostics available through subagent_status", async () => {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-config-status-home-"));
		tempDirs.push(home);
		process.env.HOME = home;
		const extensionDir = path.join(home, ".pi", "agent", "extensions", "subagent");
		fs.mkdirSync(extensionDir, { recursive: true });
		fs.writeFileSync(path.join(extensionDir, "config.json"), JSON.stringify({ maxSubagentDepth: -1 }), "utf-8");

		const mock = createPiMock();
		registerSubagentExtension!(mock.pi as never);
		const result = await mock.tools.get("subagent_status")!.execute(
			"config",
			{ action: "config" },
			undefined,
			undefined,
			createCtx([]),
		);

		assert.equal((result as { isError?: boolean }).isError, true);
		assert.match(JSON.stringify(result), /maxSubagentDepth/);
	});

	void it("can safely migrate an unchanged copied default config to an empty override", async () => {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-config-migrate-home-"));
		tempDirs.push(home);
		process.env.HOME = home;
		const extensionDir = path.join(home, ".pi", "agent", "extensions", "subagent");
		fs.mkdirSync(extensionDir, { recursive: true });
		const defaultConfig = JSON.parse(fs.readFileSync(path.resolve("default-config.json"), "utf-8"));
		const configPath = path.join(extensionDir, "config.json");
		fs.writeFileSync(configPath, `${JSON.stringify(defaultConfig, null, 2)}\n`, "utf-8");

		const mock = createPiMock();
		registerSubagentExtension!(mock.pi as never);
		const result = await mock.tools.get("subagent_status")!.execute(
			"migrate-config",
			{ action: "migrate-config" },
			undefined,
			undefined,
			createCtx([]),
		);

		assert.equal((result as { isError?: boolean }).isError, false);
		assert.equal(fs.readFileSync(configPath, "utf-8"), "{}\n");
		assert.match(JSON.stringify(result), /Restart or reload Pi/);
	});
});