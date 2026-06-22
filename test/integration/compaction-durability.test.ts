/**
 * Integration tests for compaction-durability lifecycle.
 *
 * Responsibilities:
 * - verify opt-in gate: no injection without a Superpowers command
 * - verify session_compact reason → sizing → context injection
 * - verify idempotency (no double-injection)
 * - verify agent_end consumes the opt-in flag
 * - verify session_start resets the opt-in flag
 * - verify non-opted-in compaction stays unarmed
 * - verify the wiring in extension/index.ts and slash/slash-commands.ts
 *   end-to-end (handler registration + flag setting at both dispatch sites)
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCompactionDurabilityHandlers } from "../../src/extension/compaction-durability.ts";
import { clearSkillCache } from "../../src/shared/skills.ts";
import type { SubagentState } from "../../src/shared/types.ts";

type EventHandler = (event: unknown) => unknown;
type CtxHandler = (event: { messages: unknown[] }) => { messages: unknown[] } | undefined;

function createPiMock() {
	const handlers = new Map<string, EventHandler[]>();
	return {
		handlers,
		pi: {
			on(event: string, handler: EventHandler) {
				const existing = handlers.get(event) ?? [];
				existing.push(handler);
				handlers.set(event, existing);
			},
		} as unknown as ExtensionAPI,
	};
}

function createState(overrides: Partial<SubagentState> = {}): SubagentState {
	return {
		baseCwd: "/tmp",
		currentSessionId: null,
		lastUiContext: null,
		configGate: { blocked: false, diagnostics: [], message: "", configPath: undefined, examplePath: undefined },
		superpowersActive: false,
		compactionSizing: null,
		rootLifecycleSkillNames: ["verification-before-completion"],
		rootPromptProfile: null,
		...overrides,
	};
}

function fireHandler(handlers: Map<string, EventHandler[]>, event: string, payload: unknown): unknown[] {
	const list = handlers.get(event) ?? [];
	return list.map((h) => h(payload));
}

void describe("compaction-durability handlers", () => {
	void it("does not inject on context when superpowersActive is false", () => {
		const { handlers, pi } = createPiMock();
		const state = createState({ superpowersActive: false });
		registerCompactionDurabilityHandlers(pi, state, { cwd: () => "/tmp" });

		const results = fireHandler(handlers, "context", { messages: [{ role: "user" }] });
		assert.equal(results[0], undefined);
	});

	void it("re-arms and sets full sizing on threshold compaction", () => {
		const { handlers, pi } = createPiMock();
		const state = createState({ superpowersActive: true });
		registerCompactionDurabilityHandlers(pi, state, { cwd: () => "/tmp" });

		fireHandler(handlers, "session_compact", { reason: "threshold", willRetry: false });
		assert.equal(state.superpowersActive, true);
		assert.equal(state.compactionSizing, "full");
	});

	void it("sets trimmed sizing on overflow compaction", () => {
		const { handlers, pi } = createPiMock();
		const state = createState({ superpowersActive: true });
		registerCompactionDurabilityHandlers(pi, state, { cwd: () => "/tmp" });

		fireHandler(handlers, "session_compact", { reason: "overflow", willRetry: true });
		assert.equal(state.compactionSizing, "trimmed");
	});

	void it("sets pointer sizing on manual compaction", () => {
		const { handlers, pi } = createPiMock();
		const state = createState({ superpowersActive: true });
		registerCompactionDurabilityHandlers(pi, state, { cwd: () => "/tmp" });

		fireHandler(handlers, "session_compact", { reason: "manual", willRetry: false });
		assert.equal(state.compactionSizing, "pointer");
	});

	void it("injects a trimmed reminder on context after overflow compaction", () => {
		const { handlers, pi } = createPiMock();
		const state = createState({ superpowersActive: true, rootLifecycleSkillNames: ["verification-before-completion"] });
		registerCompactionDurabilityHandlers(pi, state, { cwd: () => "/tmp" });

		fireHandler(handlers, "session_compact", { reason: "overflow", willRetry: true });
		const results = fireHandler(handlers, "context", { messages: [{ role: "user" }] });
		const result = results[0] as { messages: unknown[] } | undefined;
		assert.ok(result, "expected context handler to return messages");
		assert.equal(result.messages.length, 2);
		const injected = result.messages[0] as { role: string; customType: string; content: string; display: boolean };
		assert.equal(injected.role, "custom");
		assert.equal(injected.customType, "superpowers-root-contract");
		assert.match(injected.content, /superpowers:compaction-reminder/);
		assert.match(injected.content, /verification-before-completion/);
	});

	void it("does not double-inject when marker is already present", () => {
		const { handlers, pi } = createPiMock();
		const state = createState({ superpowersActive: true, compactionSizing: "trimmed", rootLifecycleSkillNames: ["verification-before-completion"] });
		registerCompactionDurabilityHandlers(pi, state, { cwd: () => "/tmp" });

		const existingMessage = {
			role: "custom",
			customType: "superpowers-root-contract",
			content: "superpowers:compaction-reminder\nalready here",
			display: false,
		};
		const results = fireHandler(handlers, "context", { messages: [existingMessage, { role: "user" }] });
		assert.equal(results[0], undefined);
	});

	void it("inserts after leading compactionSummary messages", () => {
		const { handlers, pi } = createPiMock();
		const state = createState({ superpowersActive: true, compactionSizing: "trimmed", rootLifecycleSkillNames: [] });
		registerCompactionDurabilityHandlers(pi, state, { cwd: () => "/tmp" });

		const results = fireHandler(handlers, "context", {
			messages: [{ role: "compactionSummary" }, { role: "compactionSummary" }, { role: "user" }],
		});
		const result = results[0] as { messages: unknown[] };
		assert.equal(result.messages.length, 4);
		assert.equal((result.messages[0] as { role: string }).role, "compactionSummary");
		assert.equal((result.messages[1] as { role: string }).role, "compactionSummary");
		assert.equal((result.messages[2] as { role: string }).role, "custom");
	});

	void it("agent_end consumes the opt-in flag", () => {
		const { handlers, pi } = createPiMock();
		const state = createState({ superpowersActive: true });
		registerCompactionDurabilityHandlers(pi, state, { cwd: () => "/tmp" });

		fireHandler(handlers, "agent_end", {});
		assert.equal(state.superpowersActive, false);
	});

	void it("does not re-arm on session_compact when not opted in", () => {
		const { handlers, pi } = createPiMock();
		const state = createState({ superpowersActive: false });
		registerCompactionDurabilityHandlers(pi, state, { cwd: () => "/tmp" });

		fireHandler(handlers, "session_compact", { reason: "threshold", willRetry: false });
		assert.equal(state.superpowersActive, false);
		assert.equal(state.compactionSizing, null);
	});
});

// ============================================================================
// Wiring-level tests: validate the extension registers the handlers AND
// sets the opt-in flag at both dispatch sites (intercepted /skill: in
// extension/index.ts and /sp-* in slash/slash-commands.ts), resets it in
// session_start, and consumes it in agent_end. These tests load the real
// extension with a mock pi and observe behavior end-to-end.
// ============================================================================

type LifecycleHandler = (event: unknown, ctx?: unknown) => unknown;
type CommandSpec = {
	description?: string;
	handler(args: string, ctx: unknown): Promise<void>;
};

interface WiringMock {
	lifecycle: Map<string, LifecycleHandler[]>;
	commands: Map<string, CommandSpec>;
	userMessages: string[];
	pi: unknown;
}

function createWiringPiMock(): WiringMock {
	const lifecycle = new Map<string, LifecycleHandler[]>();
	const commands = new Map<string, CommandSpec>();
	const userMessages: string[] = [];
	return {
		lifecycle,
		commands,
		userMessages,
		pi: {
			events: {
				on() {
					return () => {};
				},
				emit() {},
			},
			registerTool() {},
			registerCommand(name: string, spec: CommandSpec) {
				commands.set(name, spec);
			},
			registerShortcut() {},
			registerMessageRenderer() {},
			sendMessage() {},
			sendUserMessage(content: string | unknown[]) {
				userMessages.push(String(content));
			},
			on(event: string, handler: LifecycleHandler) {
				const existing = lifecycle.get(event) ?? [];
				existing.push(handler);
				lifecycle.set(event, existing);
			},
		},
	};
}

function createWiringCtx(cwd: string, notifications: string[] = []) {
	return {
		cwd,
		hasUI: true,
		isIdle: () => true,
		ui: {
			notify(message: string) {
				notifications.push(message);
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

function setupBrainstormSkills(home: string): void {
	const projectSkillsDir = path.join(home, ".agents", "skills");
	for (const skillName of ["using-superpowers", "brainstorming"]) {
		fs.mkdirSync(path.join(projectSkillsDir, skillName), { recursive: true });
		fs.writeFileSync(
			path.join(projectSkillsDir, skillName, "SKILL.md"),
			`---\nname: ${skillName}\ndescription: Fixture ${skillName} skill\n---\n# ${skillName}\n\nFixture skill content.`,
			"utf-8",
		);
	}
}

async function loadExtensionWithBrainstormConfig(tempDirs: string[], config: unknown): Promise<{ mock: WiringMock; cwd: string }> {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-compaction-durability-home-"));
	tempDirs.push(home);
	process.env.HOME = home;
	process.env.USERPROFILE = home;
	const extensionDir = path.join(home, ".pi", "agent", "extensions", "subagent");
	fs.mkdirSync(extensionDir, { recursive: true });
	fs.writeFileSync(path.join(extensionDir, "config.json"), JSON.stringify(config), "utf-8");
	setupBrainstormSkills(home);
	clearSkillCache();
	const module = (await import("../../src/extension/index.ts")) as { default: (pi: unknown) => void };
	const mock = createWiringPiMock();
	module.default(mock.pi);
	return { mock, cwd: home };
}

void describe("compaction-durability wiring", () => {
	const originalHome = process.env.HOME;
	const originalUserProfile = process.env.USERPROFILE;
	const tempDirs: string[] = [];

	afterEach(() => {
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;
		if (originalUserProfile === undefined) delete process.env.USERPROFILE;
		else process.env.USERPROFILE = originalUserProfile;
		for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
		clearSkillCache();
	});

	void it("registers session_compact/context/agent_end handlers on extension load", async () => {
		const { mock } = await loadExtensionWithBrainstormConfig(tempDirs, { superagents: {} });
		assert.ok(mock.lifecycle.get("session_compact")?.[0], "expected session_compact handler to be registered");
		assert.ok(mock.lifecycle.get("context")?.[0], "expected context handler to be registered");
		assert.ok(mock.lifecycle.get("agent_end")?.[0], "expected agent_end handler to be registered");
	});

	void it("/sp-brainstorm dispatch arms full re-injection after threshold compaction", async () => {
		const { mock, cwd } = await loadExtensionWithBrainstormConfig(tempDirs, {
			superagents: {
				commands: { "sp-brainstorm": { usePlannotator: false } },
			},
		});
		const cmd = mock.commands.get("sp-brainstorm");
		assert.ok(cmd, "expected /sp-brainstorm to be registered");
		await cmd.handler("design middleware", createWiringCtx(cwd));

		const sessionCompact = mock.lifecycle.get("session_compact")?.[0];
		assert.ok(sessionCompact, "expected session_compact handler to be registered");
		sessionCompact({ reason: "threshold", willRetry: false });

		const contextHandler = mock.lifecycle.get("context")?.[0];
		assert.ok(contextHandler, "expected context handler to be registered");
		const result = (contextHandler as CtxHandler)({ messages: [{ role: "user" }] });
		assert.ok(result, "expected context handler to re-inject the contract");
		assert.equal(result.messages.length, 2);
		const injected = result.messages[0] as { role: string; customType: string; content: string; display: boolean };
		assert.equal(injected.customType, "superpowers-root-contract");
		assert.equal(injected.display, false);
		assert.match(injected.content, /Superpowers Root Session Contract/);
		assert.match(injected.content, /brainstorming/);
	});

	void it("/sp-brainstorm dispatch arms trimmed re-injection after overflow compaction", async () => {
		const { mock, cwd } = await loadExtensionWithBrainstormConfig(tempDirs, {
			superagents: {
				commands: { "sp-brainstorm": { usePlannotator: false } },
			},
		});
		const cmd = mock.commands.get("sp-brainstorm");
		assert.ok(cmd);
		await cmd.handler("design middleware", createWiringCtx(cwd));

		const sessionCompact = mock.lifecycle.get("session_compact")?.[0];
		assert.ok(sessionCompact);
		sessionCompact({ reason: "overflow", willRetry: true });

		const contextHandler = mock.lifecycle.get("context")?.[0];
		assert.ok(contextHandler);
		const result = (contextHandler as CtxHandler)({ messages: [{ role: "user" }] });
		assert.ok(result);
		const injected = result.messages[0] as { content: string };
		assert.match(injected.content, /superpowers:compaction-reminder/);
	});

	void it("/sp-brainstorm dispatch arms pointer re-injection after manual compaction", async () => {
		const { mock, cwd } = await loadExtensionWithBrainstormConfig(tempDirs, {
			superagents: {
				commands: { "sp-brainstorm": { usePlannotator: false } },
			},
		});
		const cmd = mock.commands.get("sp-brainstorm");
		assert.ok(cmd);
		await cmd.handler("design middleware", createWiringCtx(cwd));

		const sessionCompact = mock.lifecycle.get("session_compact")?.[0];
		assert.ok(sessionCompact);
		sessionCompact({ reason: "manual", willRetry: false });

		const contextHandler = mock.lifecycle.get("context")?.[0];
		assert.ok(contextHandler);
		const result = (contextHandler as CtxHandler)({ messages: [{ role: "user" }] });
		assert.ok(result);
		const injected = result.messages[0] as { content: string };
		assert.match(injected.content, /superpowers:compaction-reminder/);
	});

	void it("/skill:brainstorming interception arms re-injection after compaction", async () => {
		const { mock, cwd } = await loadExtensionWithBrainstormConfig(tempDirs, {
			superagents: {
				interceptSkillCommands: ["brainstorming"],
				commands: { "sp-brainstorm": { usePlannotator: false } },
			},
		});
		const inputHandler = mock.lifecycle.get("input")?.[0];
		assert.ok(inputHandler, "expected input handler to be registered");
		const result = (inputHandler as (event: unknown, ctx: unknown) => { action: string } | undefined)(
			{ text: "/skill:brainstorming design middleware", source: "interactive" },
			createWiringCtx(cwd),
		);
		assert.deepEqual(result, { action: "handled" });

		const sessionCompact = mock.lifecycle.get("session_compact")?.[0];
		assert.ok(sessionCompact, "expected session_compact handler to be registered");
		sessionCompact({ reason: "threshold", willRetry: false });

		const contextHandler = mock.lifecycle.get("context")?.[0];
		assert.ok(contextHandler);
		const contextResult = (contextHandler as CtxHandler)({ messages: [{ role: "user" }] });
		assert.ok(contextResult, "expected context handler to re-inject the contract");
		const injected = contextResult.messages[0] as { customType: string; content: string };
		assert.equal(injected.customType, "superpowers-root-contract");
		assert.match(injected.content, /brainstorming/);
	});

	void it("context re-injection is idempotent when fired twice", async () => {
		const { mock, cwd } = await loadExtensionWithBrainstormConfig(tempDirs, {
			superagents: {
				commands: { "sp-brainstorm": { usePlannotator: false } },
			},
		});
		const cmd = mock.commands.get("sp-brainstorm");
		assert.ok(cmd);
		await cmd.handler("design middleware", createWiringCtx(cwd));

		const sessionCompact = mock.lifecycle.get("session_compact")?.[0];
		assert.ok(sessionCompact);
		sessionCompact({ reason: "threshold", willRetry: false });

		const contextHandler = mock.lifecycle.get("context")?.[0];
		assert.ok(contextHandler);
		const first = (contextHandler as CtxHandler)({ messages: [{ role: "user" }] });
		assert.ok(first);
		const second = (contextHandler as CtxHandler)(first);
		assert.equal(second, undefined, "expected second context fire to no-op (idempotent)");
	});

	void it("session_start resets the opt-in flag", async () => {
		const { mock, cwd } = await loadExtensionWithBrainstormConfig(tempDirs, {
			superagents: {
				commands: { "sp-brainstorm": { usePlannotator: false } },
			},
		});
		const cmd = mock.commands.get("sp-brainstorm");
		assert.ok(cmd);
		await cmd.handler("design middleware", createWiringCtx(cwd));

		// Fire session_start to reset the opt-in flag.
		const sessionStart = mock.lifecycle.get("session_start")?.[0];
		assert.ok(sessionStart, "expected session_start handler to be registered");
		sessionStart({}, createWiringCtx(cwd));

		const sessionCompact = mock.lifecycle.get("session_compact")?.[0];
		assert.ok(sessionCompact);
		sessionCompact({ reason: "threshold", willRetry: false });

		const contextHandler = mock.lifecycle.get("context")?.[0];
		assert.ok(contextHandler);
		const result = (contextHandler as CtxHandler)({ messages: [{ role: "user" }] });
		assert.equal(result, undefined, "expected context to no-op after session_start reset");
	});

	void it("agent_end consumes the opt-in flag", async () => {
		const { mock, cwd } = await loadExtensionWithBrainstormConfig(tempDirs, {
			superagents: {
				commands: { "sp-brainstorm": { usePlannotator: false } },
			},
		});
		const cmd = mock.commands.get("sp-brainstorm");
		assert.ok(cmd);
		await cmd.handler("design middleware", createWiringCtx(cwd));

		const agentEnd = mock.lifecycle.get("agent_end")?.[0];
		assert.ok(agentEnd, "expected agent_end handler to be registered");
		agentEnd({});

		const sessionCompact = mock.lifecycle.get("session_compact")?.[0];
		assert.ok(sessionCompact);
		sessionCompact({ reason: "threshold", willRetry: false });

		const contextHandler = mock.lifecycle.get("context")?.[0];
		assert.ok(contextHandler);
		const result = (contextHandler as CtxHandler)({ messages: [{ role: "user" }] });
		assert.equal(result, undefined, "expected context to no-op after agent_end consume");
	});

	void it("no opt-in: session_compact is a no-op and context returns undefined", async () => {
		const { mock } = await loadExtensionWithBrainstormConfig(tempDirs, { superagents: {} });

		const sessionCompact = mock.lifecycle.get("session_compact")?.[0];
		assert.ok(sessionCompact, "expected session_compact handler to be registered");
		sessionCompact({ reason: "threshold", willRetry: false });

		const contextHandler = mock.lifecycle.get("context")?.[0];
		assert.ok(contextHandler);
		const result = (contextHandler as CtxHandler)({ messages: [{ role: "user" }] });
		assert.equal(result, undefined, "expected context to no-op when superpowers not active");
	});

	void it("inserts the trimmed reminder after leading compactionSummary messages", async () => {
		const { mock, cwd } = await loadExtensionWithBrainstormConfig(tempDirs, {
			superagents: {
				commands: { "sp-brainstorm": { usePlannotator: false } },
			},
		});
		const cmd = mock.commands.get("sp-brainstorm");
		assert.ok(cmd);
		await cmd.handler("design middleware", createWiringCtx(cwd));

		const sessionCompact = mock.lifecycle.get("session_compact")?.[0];
		assert.ok(sessionCompact);
		sessionCompact({ reason: "overflow", willRetry: true });

		const contextHandler = mock.lifecycle.get("context")?.[0];
		assert.ok(contextHandler);
		const result = (contextHandler as CtxHandler)({
			messages: [{ role: "compactionSummary" }, { role: "user" }],
		});
		assert.ok(result);
		assert.equal(result.messages.length, 3);
		assert.equal((result.messages[0] as { role: string }).role, "compactionSummary");
		assert.equal((result.messages[1] as { customType: string }).customType, "superpowers-root-contract");
		assert.equal((result.messages[2] as { role: string }).role, "user");
	});
});
