/**
 * Integration tests for lean Superpowers slash command registration and behavior.
 *
 * Responsibilities:
 * - verify only Superpowers commands and configured custom commands are registered
 * - verify /superpowers sends a root-session prompt with resolved defaults
 * - verify custom commands apply presets and inline tokens override them
 * - verify /superpowers-status opens the status overlay
 * - verify config-gated refusal blocks execution
 */

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

type EventBus = {
	on(event: string, handler: (data: unknown) => void): () => void;
	emit(event: string, data: unknown): void;
};

interface RegisterSlashCommandsModule {
	registerSlashCommands?: (
		pi: {
			events: EventBus;
			registerCommand(
				name: string,
				spec: { description?: string; handler(args: string, ctx: unknown): Promise<void> },
			): void;
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
			configGate: { blocked: boolean; diagnostics: unknown[]; message: string; configPath?: string; examplePath?: string };
		},
		config: {
			superagents?: {
				useSubagents?: boolean;
				useTestDrivenDevelopment?: boolean;
				commands?: Record<string, { description?: string; useSubagents?: boolean; useTestDrivenDevelopment?: boolean }>;
				worktrees?: { enabled?: boolean };
			};
		},
	) => void;
}

let registerSlashCommands: RegisterSlashCommandsModule["registerSlashCommands"];
let available = true;
try {
	({ registerSlashCommands } = (await import("../../src/slash/slash-commands.ts")) as unknown as RegisterSlashCommandsModule);
} catch {
	available = false;
}

function createEventBus(): EventBus {
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
		configGate: {
			blocked: false,
			diagnostics: [] as unknown[],
			message: "",
			configPath: undefined as string | undefined,
			examplePath: undefined as string | undefined,
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

void describe("lean superpowers slash commands", { skip: !available ? "slash-commands.ts not importable" : undefined }, () => {
	void it("registers only Superpowers commands and configured custom commands", () => {
		const commands = new Map<string, { description?: string; handler(args: string, ctx: unknown): Promise<void> }>();
		const pi = {
			events: createEventBus(),
			registerCommand(name: string, spec: { description?: string; handler(args: string, ctx: unknown): Promise<void> }) {
				commands.set(name, spec);
			},
			sendMessage() {},
			sendUserMessage() {},
		};

		const config = {
			superagents: {
				commands: {
					review: { description: "Run code review", useSubagents: false },
				},
			},
		};

		registerSlashCommands!(pi, createState(process.cwd()), config);

		// Should have superpowers, review, superpowers-status
		assert.ok(commands.has("superpowers"), "expected /superpowers to be registered");
		assert.ok(commands.has("superpowers-status"), "expected /superpowers-status to be registered");
		assert.ok(commands.has("review"), "expected /review preset to be registered");

		// Should NOT have old commands
		assert.ok(!commands.has("run"), "expected /run to NOT be registered");
		assert.ok(!commands.has("chain"), "expected /chain to NOT be registered");
		assert.ok(!commands.has("parallel"), "expected /parallel to NOT be registered");
		assert.ok(!commands.has("agents"), "expected /agents to NOT be registered");

		// review preset should have the configured description
		assert.equal(commands.get("review")!.description, "Run code review");
	});

	void it("/superpowers sends a root-session prompt with resolved defaults", async () => {
		const userMessages: Array<{ content: string | unknown[]; options?: { deliverAs?: "steer" | "followUp" } }> = [];
		const commands = new Map<string, { description?: string; handler(args: string, ctx: unknown): Promise<void> }>();
		const pi = {
			events: createEventBus(),
			registerCommand(name: string, spec: { description?: string; handler(args: string, ctx: unknown): Promise<void> }) {
				commands.set(name, spec);
			},
			sendMessage() {},
			sendUserMessage(content: string | unknown[], options?: { deliverAs?: "steer" | "followUp" }) {
				userMessages.push({ content, options });
			},
		};

		registerSlashCommands!(pi, createState(process.cwd()), {});
		await commands.get("superpowers")!.handler("tdd implement auth fix", createCommandContext());

		assert.equal(userMessages.length, 1);
		const prompt = String(userMessages[0].content);
		assert.match(prompt, /workflow:\s*"superpowers"/);
		assert.match(prompt, /useSubagents:\s*true/);
		assert.match(prompt, /useTestDrivenDevelopment:\s*true/);
		assert.match(prompt, /worktrees\.enabled:\s*true/);
		assert.match(prompt, /implement auth fix/);
		assert.match(prompt, /Required bootstrap skill/);
		// No options means it was sent directly (isIdle === true)
		assert.equal(userMessages[0].options, undefined);
	});

	void it("custom commands apply presets and inline tokens override them", async () => {
		const userMessages: Array<{ content: string | unknown[]; options?: { deliverAs?: "steer" | "followUp" } }> = [];
		const commands = new Map<string, { description?: string; handler(args: string, ctx: unknown): Promise<void> }>();
		const pi = {
			events: createEventBus(),
			registerCommand(name: string, spec: { description?: string; handler(args: string, ctx: unknown): Promise<void> }) {
				commands.set(name, spec);
			},
			sendMessage() {},
			sendUserMessage(content: string | unknown[], options?: { deliverAs?: "steer" | "followUp" }) {
				userMessages.push({ content, options });
			},
		};

		const config = {
			superagents: {
				useSubagents: false,
				useTestDrivenDevelopment: true,
				worktrees: { enabled: false },
				commands: {
					review: { description: "Run code review", useSubagents: false, useTestDrivenDevelopment: false },
				},
			},
		};

		registerSlashCommands!(pi, createState(process.cwd()), config);

		// /review inherits the preset so useSubagents: false, useTestDrivenDevelopment: false
		await commands.get("review")!.handler("check auth module for bugs", createCommandContext());
		assert.equal(userMessages.length, 1);
		const prompt = String(userMessages[0].content);
		assert.match(prompt, /useSubagents:\s*false/);
		assert.match(prompt, /useTestDrivenDevelopment:\s*false/);
		assert.match(prompt, /worktrees\.enabled:\s*false/);
		assert.match(prompt, /Do not use the `using-git-worktrees` skill/);

		// Inline override: /review subagents check auth module → useSubagents: true
		userMessages.length = 0;
		await commands.get("review")!.handler("subagents check auth module", createCommandContext());
		assert.equal(userMessages.length, 1);
		const overridePrompt = String(userMessages[0].content);
		assert.match(overridePrompt, /useSubagents:\s*true/);
	});

	void it("/superpowers-status opens the status and settings overlay", async () => {
		const commands = new Map<string, { description?: string; handler(args: string, ctx: unknown): Promise<void> }>();
		let customCalls = 0;
		const pi = {
			events: createEventBus(),
			registerCommand(name: string, spec: { description?: string; handler(args: string, ctx: unknown): Promise<void> }) {
				commands.set(name, spec);
			},
			sendMessage() {},
			sendUserMessage() {},
		};

		registerSlashCommands!(pi, createState(process.cwd()), {});

		await commands.get("superpowers-status")!.handler("", createCommandContext({
			hasUI: true,
			custom: async () => {
				customCalls++;
				return undefined;
			},
		}));

		assert.equal(customCalls, 1);
	});

	void it("refuses to execute /superpowers when config is blocked", async () => {
		const notifications: Array<{ message: string; type?: string }> = [];
		const commands = new Map<string, { description?: string; handler(args: string, ctx: unknown): Promise<void> }>();
		const pi = {
			events: createEventBus(),
			registerCommand(name: string, spec: { description?: string; handler(args: string, ctx: unknown): Promise<void> }) {
				commands.set(name, spec);
			},
			sendMessage() {},
			sendUserMessage() {},
		};
		const state = createState(process.cwd());
		state.configGate = {
			blocked: true,
			diagnostics: [{ level: "error", code: "unknown_key", path: "asyncByDefalt", message: "is not supported." }],
			message: "pi-superagents is disabled because config.json needs attention.",
			configPath: undefined,
			examplePath: undefined,
		};
		const ctx = createCommandContext({ hasUI: true });
		(ctx as { ui: { notify(message: string, type?: string): void } }).ui.notify = (message, type) => {
			notifications.push({ message, type });
		};

		registerSlashCommands!(pi, state, {});
		await commands.get("superpowers")!.handler("tdd fix bug", ctx);

		assert.equal(notifications.length, 1);
		assert.equal(notifications[0].type, "error");
		assert.match(notifications[0].message, /disabled because config\.json needs attention/);
	});

	void it("/superpowers queues a follow-up when the agent is busy", async () => {
		const userMessages: Array<{ content: string | unknown[]; options?: { deliverAs?: "steer" | "followUp" } }> = [];
		const commands = new Map<string, { description?: string; handler(args: string, ctx: unknown): Promise<void> }>();
		const pi = {
			events: createEventBus(),
			registerCommand(name: string, spec: { description?: string; handler(args: string, ctx: unknown): Promise<void> }) {
				commands.set(name, spec);
			},
			sendMessage() {},
			sendUserMessage(content: string | unknown[], options?: { deliverAs?: "steer" | "followUp" }) {
				userMessages.push({ content, options });
			},
		};

		registerSlashCommands!(pi, createState(process.cwd()), {});

		// isIdle() returns false → should use followUp delivery
		await commands.get("superpowers")!.handler("direct update config", createCommandContext({ idle: false }));

		assert.equal(userMessages.length, 1);
		assert.equal(userMessages[0].options?.deliverAs, "followUp");
		assert.match(String(userMessages[0].content), /useTestDrivenDevelopment:\s*false/);
	});

	void it("shows usage hint when /superpowers is called without a task", async () => {
		const notifications: Array<{ message: string; type?: string }> = [];
		const commands = new Map<string, { description?: string; handler(args: string, ctx: unknown): Promise<void> }>();
		const pi = {
			events: createEventBus(),
			registerCommand(name: string, spec: { description?: string; handler(args: string, ctx: unknown): Promise<void> }) {
				commands.set(name, spec);
			},
			sendMessage() {},
			sendUserMessage() {},
		};

		registerSlashCommands!(pi, createState(process.cwd()), {});
		const ctx = createCommandContext({ hasUI: true });
		(ctx as { ui: { notify(message: string, type?: string): void } }).ui.notify = (message, type) => {
			notifications.push({ message, type });
		};

		await commands.get("superpowers")!.handler("", ctx);
		assert.equal(notifications.length, 1);
		assert.equal(notifications[0].type, "error");
		assert.match(notifications[0].message, /Usage:/);

		notifications.length = 0;
		await commands.get("superpowers")!.handler("tdd", ctx);
		assert.equal(notifications.length, 1);
		assert.equal(notifications[0].type, "error");
		assert.match(notifications[0].message, /Usage:/);
	});

	void it("renders Superpowers defaults, worktrees, model tiers, and custom commands in the status component", async () => {
		const module = await import("../../src/ui/superpowers-status.ts") as {
			SuperpowersStatusComponent: new (...args: unknown[]) => { render(width: number): string[] };
		};
		const component = new module.SuperpowersStatusComponent(
			{},
			{},
			createState(process.cwd()),
			{
				superagents: {
					useSubagents: false,
					useTestDrivenDevelopment: true,
					commands: {
						"superpowers-lean": {
							description: "Lean mode",
							useSubagents: false,
							useTestDrivenDevelopment: false,
						},
					},
					worktrees: {
						enabled: true,
						root: "/tmp/superpowers-worktrees",
					},
					modelTiers: {
						cheap: { model: "opencode-go/minimax-m2.7" },
						balanced: { model: "opencode-go/glm-5.1" },
					},
				},
			},
			() => {},
		);

		const rendered = component.render(100).join("\n");
		assert.match(rendered, /useSubagents: false/);
		assert.match(rendered, /useTestDrivenDevelopment: true/);
		assert.match(rendered, /superpowers-lean/);
		assert.match(rendered, /worktrees\.enabled: true/);
		assert.match(rendered, /worktrees\.root: \/tmp\/superpowers-worktrees/);
		assert.match(rendered, /cheap: opencode-go\/minimax-m2.7/);
	});

	void it("writes Superpowers setting toggles to the config file", async () => {
		const fs = await import("node:fs");
		const os = await import("node:os");
		const path = await import("node:path");
		const module = await import("../../src/ui/superpowers-status.ts") as {
			SuperpowersStatusComponent: new (...args: unknown[]) => {
				toggleUseSubagents(): void;
				toggleWorktrees(): void;
			};
		};
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "superpowers-config-"));
		const configPath = path.join(dir, "config.json");
		fs.writeFileSync(configPath, '{\n  "superagents": { "useSubagents": true, "worktrees": { "enabled": false } }\n}\n', "utf-8");
		const state = createState(process.cwd());
		state.configGate.configPath = configPath;

		const component = new module.SuperpowersStatusComponent(
			{},
			{},
			state,
			{ superagents: { useSubagents: true, worktrees: { enabled: false } } },
			() => {},
		);
		component.toggleUseSubagents();
		component.toggleWorktrees();

		assert.deepEqual(JSON.parse(fs.readFileSync(configPath, "utf-8")), {
			superagents: {
				useSubagents: false,
				worktrees: { enabled: true },
			},
		});

		fs.rmSync(dir, { recursive: true, force: true });
	});
});
