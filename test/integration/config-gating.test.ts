/**
 * Integration coverage for fail-closed config handling at the extension boundary.
 *
 * Responsibilities:
 * - verify invalid config diagnostics are shown on Pi session start
 * - verify execution tools refuse to run while config is blocked
 * - verify session_start notification surfaces diagnostic field names
 * - verify config diagnostic notifications are deduplicated within a session
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
 * @param sessionFile Optional session file path for stable session ID derivation.
 * @returns Extension context mock.
 */
function createCtx(notifications: Array<{ message: string; type?: string }>, sessionFile: string | null = null) {
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
			getSessionFile: () => sessionFile,
			getEntries: () => [],
		},
		modelRegistry: {
			getAvailable: () => [],
		},
	};
}

void describe("extension config gating", { skip: !available ? "extension not importable" : undefined }, () => {
	const originalHome = process.env.HOME;
	const originalUserProfile = process.env.USERPROFILE;
	const tempDirs: string[] = [];

	afterEach(() => {
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;
		if (originalUserProfile === undefined) delete process.env.USERPROFILE;
		else process.env.USERPROFILE = originalUserProfile;
		for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
	});

	/**
	 * Point every Node home-directory source at a temporary test home.
	 *
	 * @param home Temporary home directory for config lookup.
	 */
	function setTestHome(home: string): void {
		process.env.HOME = home;
		process.env.USERPROFILE = home;
	}

	void it("notifies on session start and blocks subagent execution when config is invalid", async () => {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-config-gate-home-"));
		tempDirs.push(home);
		setTestHome(home);
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
		// AgentToolResult does not include isError; verify the tool responded with non-empty content.
		const content = (result as { content?: unknown[] }).content;
		assert.ok(Array.isArray(content) && content.length > 0, "blocked subagent must return non-empty content");
		assert.match(JSON.stringify(result), /config\.json needs attention/);
	});

	void it("session_start notification message surfaces diagnostic field names from invalid config", async () => {
		// The session_start notification is now the primary surface for config diagnostics
		// (the removed subagent_status tool is no longer available).
		// Verify the notification exposes the offending field name so users can act on it.
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-config-fieldname-home-"));
		tempDirs.push(home);
		setTestHome(home);
		const extensionDir = path.join(home, ".pi", "agent", "extensions", "subagent");
		fs.mkdirSync(extensionDir, { recursive: true });
		fs.writeFileSync(path.join(extensionDir, "config.json"), JSON.stringify({ maxSubagentDepth: -1 }), "utf-8");

		const mock = createPiMock();
		registerSubagentExtension!(mock.pi as never);

		const notifications: Array<{ message: string; type?: string }> = [];
		const ctx = createCtx(notifications);
		mock.emitLifecycle("session_start", { type: "session_start", reason: "startup" }, ctx);

		assert.equal(notifications.length, 1, "exactly one diagnostic notification should be emitted");
		assert.equal(notifications[0].type, "error", "removed key is an error-level diagnostic");
		// The notification message must identify the offending field so the user knows what to fix.
		assert.match(notifications[0].message, /maxSubagentDepth/, "notification message must name the offending field");
	});

	void it("session_start config diagnostic notification is deduplicated within the same session", async () => {
		// The extension guards against spamming the user with repeated notifications when
		// session_start fires multiple times for the same session (e.g. restore, reconnect).
		// Deduplication is keyed on the session file path — same path → notify at most once.
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-config-dedup-home-"));
		tempDirs.push(home);
		setTestHome(home);
		const extensionDir = path.join(home, ".pi", "agent", "extensions", "subagent");
		fs.mkdirSync(extensionDir, { recursive: true });
		fs.writeFileSync(path.join(extensionDir, "config.json"), JSON.stringify({ asyncByDefalt: true }), "utf-8");

		const mock = createPiMock();
		registerSubagentExtension!(mock.pi as never);

		const notifications: Array<{ message: string; type?: string }> = [];
		// Use a fixed session file path so both session_start events share the same session ID.
		const sessionFile = path.join(home, "test-session.jsonl");
		const ctx = createCtx(notifications, sessionFile);

		mock.emitLifecycle("session_start", { type: "session_start", reason: "startup" }, ctx);
		mock.emitLifecycle("session_start", { type: "session_start", reason: "restore" }, ctx);

		assert.equal(notifications.length, 1, "config diagnostic must not be repeated for the same session");
	});
});
