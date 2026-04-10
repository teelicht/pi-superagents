/**
 * Integration tests for slash command registration and bridge request payloads.
 *
 * Responsibilities:
 * - verify slash commands register expected handlers
 * - verify commands emit the right bridge request metadata
 * - verify inline slash result rendering remains stable
 */

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

const SLASH_RESULT_TYPE = "subagent-slash-result";
const SLASH_SUBAGENT_REQUEST_EVENT = "subagent:slash:request";
const SLASH_SUBAGENT_STARTED_EVENT = "subagent:slash:started";
const SLASH_SUBAGENT_RESPONSE_EVENT = "subagent:slash:response";

interface EventBus {
	on(event: string, handler: (data: unknown) => void): () => void;
	emit(event: string, data: unknown): void;
}

interface RegisterSlashCommandsModule {
	registerSlashCommands?: (
		pi: {
			events: EventBus;
			registerCommand(
				name: string,
				spec: { handler(args: string, ctx: unknown): Promise<void>; getArgumentCompletions?: (prefix: string) => unknown },
			): void;
			registerShortcut(key: string, spec: { handler(ctx: unknown): Promise<void> }): void;
			sendMessage(message: unknown): void;
			sendUserMessage(content: string | unknown[], options?: { deliverAs?: "steer" | "followUp" }): void;
		},
		state: {
			baseCwd: string;
			currentSessionId: string | null;
			asyncJobs: Map<string, unknown>;
			cleanupTimers: Map<string, ReturnType<typeof setTimeout>>;
			lastUiContext: unknown;
			poller: NodeJS.Timeout | null;
			completionSeen: Map<string, number>;
			watcher: unknown;
			watcherRestartTimer: ReturnType<typeof setTimeout> | null;
			resultFileCoalescer: { schedule(file: string, delayMs?: number): boolean; clear(): void };
		},
	) => void;
}

interface SlashLiveStateModule {
	clearSlashSnapshots?: typeof import("../../slash-live-state.ts").clearSlashSnapshots;
	getSlashRenderableSnapshot?: typeof import("../../slash-live-state.ts").getSlashRenderableSnapshot;
	resolveSlashMessageDetails?: typeof import("../../slash-live-state.ts").resolveSlashMessageDetails;
}

let registerSlashCommands: RegisterSlashCommandsModule["registerSlashCommands"];
let clearSlashSnapshots: SlashLiveStateModule["clearSlashSnapshots"];
let getSlashRenderableSnapshot: SlashLiveStateModule["getSlashRenderableSnapshot"];
let resolveSlashMessageDetails: SlashLiveStateModule["resolveSlashMessageDetails"];
let available = true;
try {
	({ registerSlashCommands } = await import("../../src/slash/slash-commands.ts") as RegisterSlashCommandsModule);
	({ clearSlashSnapshots, getSlashRenderableSnapshot, resolveSlashMessageDetails } = await import("../../src/slash/slash-live-state.ts") as SlashLiveStateModule);
} catch {
	available = false;
}

function createEventBus(): EventBus {
	const handlers = new Map<string, Array<(data: unknown) => void>>();
	return {
		on(event, handler) {
			const existing = handlers.get(event) ?? [];
			existing.push(handler);
			handlers.set(event, existing);
			return () => {
				const current = handlers.get(event) ?? [];
				handlers.set(event, current.filter((entry) => entry !== handler));
			};
		},
		emit(event, data) {
			for (const handler of handlers.get(event) ?? []) {
				handler(data);
			}
		},
	};
}

function createState(cwd: string) {
	return {
		baseCwd: cwd,
		currentSessionId: null,
		asyncJobs: new Map(),
		cleanupTimers: new Map(),
		lastUiContext: null,
		poller: null,
		completionSeen: new Map(),
		watcher: null,
		watcherRestartTimer: null,
		resultFileCoalescer: {
			schedule: () => false,
			clear: () => {},
		},
	};
}

function createCommandContext(
	overrides: Partial<{ hasUI: boolean; custom: (...args: unknown[]) => Promise<unknown>; idle: boolean }> = {},
) {
	return {
		cwd: process.cwd(),
		isIdle: () => overrides.idle ?? true,
		hasUI: overrides.hasUI ?? false,
		ui: {
			notify: (_message: string) => {},
			setStatus: (_key: string, _text: string | undefined) => {},
			onTerminalInput: () => () => {},
			custom: overrides.custom ?? (async () => undefined),
		},
		modelRegistry: { getAvailable: () => [] },
	};
}

describe("slash command custom message delivery", { skip: !available ? "slash-commands.ts not importable" : undefined }, () => {
	beforeEach(() => {
		clearSlashSnapshots?.();
	});

	it("/run sends an inline slash result message after a successful bridge response", async () => {
		const sent: unknown[] = [];
		const commands = new Map<string, { handler(args: string, ctx: unknown): Promise<void> }>();
		const events = createEventBus();
		events.on(SLASH_SUBAGENT_REQUEST_EVENT, (data) => {
			const requestId = (data as { requestId: string }).requestId;
			events.emit(SLASH_SUBAGENT_STARTED_EVENT, { requestId });
			events.emit(SLASH_SUBAGENT_RESPONSE_EVENT, {
				requestId,
				result: {
					content: [{ type: "text", text: "Scout finished" }],
					details: { mode: "single", results: [] },
				},
				isError: false,
			});
		});

		const pi = {
			events,
			registerCommand(name: string, spec: { handler(args: string, ctx: unknown): Promise<void> }) {
				commands.set(name, spec);
			},
			registerShortcut() {},
			sendMessage(message: unknown) {
				sent.push(message);
			},
			sendUserMessage() {},
		};

		registerSlashCommands!(pi, createState(process.cwd()));
		await commands.get("run")!.handler("scout inspect this", createCommandContext());

		assert.equal(sent.length, 2);
		assert.equal((sent[0] as { customType?: string; display?: boolean }).customType, SLASH_RESULT_TYPE);
		assert.equal((sent[0] as { display?: boolean }).display, true);
		assert.equal((sent[0] as { content?: string }).content, "inspect this");
		assert.equal((sent[1] as { customType?: string; display?: boolean }).customType, SLASH_RESULT_TYPE);
		assert.equal((sent[1] as { display?: boolean }).display, false);
		assert.equal((sent[1] as { content?: string }).content, "Scout finished");

		const visibleDetails = resolveSlashMessageDetails!((sent[0] as { details?: unknown }).details);
		assert.ok(visibleDetails);
		const visibleSnapshot = getSlashRenderableSnapshot!(visibleDetails!);
		assert.equal((visibleSnapshot.result.content[0] as { text?: string }).text, "Scout finished");
	});

	it("/run still sends an inline slash result message when the bridge returns an error", async () => {
		const sent: unknown[] = [];
		const commands = new Map<string, { handler(args: string, ctx: unknown): Promise<void> }>();
		const events = createEventBus();
		events.on(SLASH_SUBAGENT_REQUEST_EVENT, (data) => {
			const requestId = (data as { requestId: string }).requestId;
			events.emit(SLASH_SUBAGENT_STARTED_EVENT, { requestId });
			events.emit(SLASH_SUBAGENT_RESPONSE_EVENT, {
				requestId,
				result: {
					content: [{ type: "text", text: "Subagent failed" }],
					details: { mode: "single", results: [] },
				},
				isError: true,
				errorText: "Subagent failed",
			});
		});

		const pi = {
			events,
			registerCommand(name: string, spec: { handler(args: string, ctx: unknown): Promise<void> }) {
				commands.set(name, spec);
			},
			registerShortcut() {},
			sendMessage(message: unknown) {
				sent.push(message);
			},
			sendUserMessage() {},
		};

		registerSlashCommands!(pi, createState(process.cwd()));
		await commands.get("run")!.handler("scout inspect this", createCommandContext());

		assert.equal(sent.length, 2);
		assert.equal((sent[0] as { customType?: string; display?: boolean }).customType, SLASH_RESULT_TYPE);
		assert.equal((sent[0] as { display?: boolean }).display, true);
		assert.equal((sent[0] as { content?: string }).content, "inspect this");
		assert.equal((sent[1] as { customType?: string; display?: boolean }).customType, SLASH_RESULT_TYPE);
		assert.equal((sent[1] as { display?: boolean }).display, false);
		assert.equal((sent[1] as { content?: string }).content, "Subagent failed");

		const visibleDetails = resolveSlashMessageDetails!((sent[0] as { details?: unknown }).details);
		assert.ok(visibleDetails);
		const visibleSnapshot = getSlashRenderableSnapshot!(visibleDetails!);
		assert.equal((visibleSnapshot.result.content[0] as { text?: string }).text, "Subagent failed");
	});

	it("/superpowers sends a root-session workflow prompt instead of directly running sp-recon", async () => {
		const sent: unknown[] = [];
		const userMessages: Array<{ content: string | unknown[]; options?: { deliverAs?: "steer" | "followUp" } }> = [];
		const commands = new Map<string, { handler(args: string, ctx: unknown): Promise<void> }>();
		const events = createEventBus();

		const pi = {
			events,
			registerCommand(name: string, spec: { handler(args: string, ctx: unknown): Promise<void> }) {
				commands.set(name, spec);
			},
			registerShortcut() {},
			sendMessage(message: unknown) {
				sent.push(message);
			},
			sendUserMessage(content: string | unknown[], options?: { deliverAs?: "steer" | "followUp" }) {
				userMessages.push({ content, options });
			},
		};

		registerSlashCommands!(pi, createState(process.cwd()));
		await commands.get("superpowers")!.handler("tdd implement auth fix", createCommandContext());

		assert.equal(sent.length, 0);
		assert.equal(userMessages.length, 1);
		assert.match(String(userMessages[0]!.content), /workflow:\s*"superpowers"/);
		assert.match(String(userMessages[0]!.content), /implementerMode:\s*"tdd"/);
		assert.match(String(userMessages[0]!.content), /sp-recon/);
		assert.match(String(userMessages[0]!.content), /Do not stop after the recon subagent finishes/i);
	});

	it("/superpowers carries --bg and --fork through the root prompt contract", async () => {
		const userMessages: Array<{ content: string | unknown[]; options?: { deliverAs?: "steer" | "followUp" } }> = [];
		const commands = new Map<string, { handler(args: string, ctx: unknown): Promise<void> }>();
		const pi = {
			events: createEventBus(),
			registerCommand(name: string, spec: { handler(args: string, ctx: unknown): Promise<void> }) {
				commands.set(name, spec);
			},
			registerShortcut() {},
			sendMessage() {},
			sendUserMessage(content: string | unknown[], options?: { deliverAs?: "steer" | "followUp" }) {
				userMessages.push({ content, options });
			},
		};

		registerSlashCommands!(pi, createState(process.cwd()));
		await commands.get("superpowers")!.handler("direct harden auth flow --fork --bg", createCommandContext());

		assert.equal(userMessages.length, 1);
		const prompt = String(userMessages[0]!.content);
		assert.match(prompt, /workflow:\s*"superpowers"/);
		assert.match(prompt, /implementerMode:\s*"direct"/);
		assert.match(prompt, /async:\s*true/);
		assert.match(prompt, /clarify:\s*false/);
		assert.match(prompt, /context:\s*"fork"/);
	});

	it("/superpowers accepts flags in either order", async () => {
		const userMessages: Array<{ content: string | unknown[]; options?: { deliverAs?: "steer" | "followUp" } }> = [];
		const commands = new Map<string, { handler(args: string, ctx: unknown): Promise<void> }>();
		const pi = {
			events: createEventBus(),
			registerCommand(name: string, spec: { handler(args: string, ctx: unknown): Promise<void> }) {
				commands.set(name, spec);
			},
			registerShortcut() {},
			sendMessage() {},
			sendUserMessage(content: string | unknown[], options?: { deliverAs?: "steer" | "followUp" }) {
				userMessages.push({ content, options });
			},
		};

		registerSlashCommands!(pi, createState(process.cwd()));
		await commands.get("superpowers")!.handler("tdd stabilize cache invalidation --bg --fork", createCommandContext());

		assert.equal(userMessages.length, 1);
		const prompt = String(userMessages[0]!.content);
		assert.match(prompt, /async:\s*true/);
		assert.match(prompt, /context:\s*"fork"/);
	});

	it("/superpowers queues a follow-up root prompt when the agent is busy", async () => {
		const userMessages: Array<{ content: string | unknown[]; options?: { deliverAs?: "steer" | "followUp" } }> = [];
		const commands = new Map<string, { handler(args: string, ctx: unknown): Promise<void> }>();
		const pi = {
			events: createEventBus(),
			registerCommand(name: string, spec: { handler(args: string, ctx: unknown): Promise<void> }) {
				commands.set(name, spec);
			},
			registerShortcut() {},
			sendMessage() {},
			sendUserMessage(content: string | unknown[], options?: { deliverAs?: "steer" | "followUp" }) {
				userMessages.push({ content, options });
			},
		};

		registerSlashCommands!(pi, createState(process.cwd()));
		await commands.get("superpowers")!.handler("direct update config", createCommandContext({ idle: false }));

		assert.equal(userMessages.length, 1);
		assert.equal(userMessages[0]!.options?.deliverAs, "followUp");
		assert.match(String(userMessages[0]!.content), /implementerMode:\s*"direct"/);
	});
});

describe("subagents-status slash command", { skip: !available ? "slash-commands.ts not importable" : undefined }, () => {
	beforeEach(() => {
		clearSlashSnapshots?.();
	});

	it("opens the async status overlay", async () => {
		const commands = new Map<string, { handler(args: string, ctx: unknown): Promise<void> }>();
		const events = createEventBus();
		let customCalls = 0;
		const pi = {
			events,
			registerCommand(name: string, spec: { handler(args: string, ctx: unknown): Promise<void> }) {
				commands.set(name, spec);
			},
			registerShortcut() {},
			sendMessage(_message: unknown) {},
			sendUserMessage() {},
		};

		registerSlashCommands!(pi, createState(process.cwd()));
		assert.ok(commands.has("subagents-status"));

		await commands.get("subagents-status")!.handler("", createCommandContext({
			hasUI: true,
			custom: async () => {
				customCalls++;
				return undefined;
			},
		}));

		assert.equal(customCalls, 1);
	});
});
