/**
 * Integration tests for lean Superpowers slash command registration and behavior.
 *
 * Responsibilities:
 * - verify only Superpowers commands and configured custom commands are registered
 * - verify /sp-implement sends a root-session prompt with resolved defaults
 * - verify custom commands apply presets and inline tokens override them
 * - verify /subagents-status, ctrl+alt+s, and /sp-settings open their respective overlays
 * - verify config-gated refusal blocks execution
 * - verify /sp-brainstorm sends a skill-entry prompt for brainstorming flows
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

type EventBus = {
	on(event: string, handler: (data: unknown) => void): () => void;
	emit(event: string, data: unknown): void;
};

type CommandSpec = {
	description?: string;
	handler(args: string, ctx: unknown): Promise<void>;
};

type ShortcutSpec = {
	description?: string;
	handler(ctx: unknown): Promise<void> | void;
};

interface RegisterSlashCommandsModule {
	registerSlashCommands?: (
		pi: {
			events: EventBus;
			registerCommand(
				name: string,
				spec: { description?: string; handler(args: string, ctx: unknown): Promise<void> },
			): void;
			registerShortcut(name: string, spec: ShortcutSpec): void;
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
			configGate: {
				blocked: boolean;
				diagnostics: unknown[];
				message: string;
				configPath?: string;
				examplePath?: string;
			};
		},
		config: {
			superagents?: {
				useBranches?: boolean;
				useSubagents?: boolean;
				useTestDrivenDevelopment?: boolean;
				usePlannotator?: boolean;
				commands?: Record<
					string,
					{
						description?: string;
						useBranches?: boolean;
						useSubagents?: boolean;
						useTestDrivenDevelopment?: boolean;
					}
				>;
				worktrees?: { enabled?: boolean };
				skillOverlays?: Record<string, string[]>;
			};
		},
	) => void;
}

let registerSlashCommands: RegisterSlashCommandsModule["registerSlashCommands"];
let available = true;
try {
	({ registerSlashCommands } = (await import(
		"../../src/slash/slash-commands.ts"
	)) as unknown as RegisterSlashCommandsModule);
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

function createPiHarness() {
	const commands = new Map<string, CommandSpec>();
	const shortcuts = new Map<string, ShortcutSpec>();
	const userMessages: Array<{ content: string | unknown[]; options?: { deliverAs?: "steer" | "followUp" } }> = [];

	const pi = {
		events: createEventBus(),
		registerCommand(name: string, spec: CommandSpec) {
			commands.set(name, spec);
		},
		registerShortcut(name: string, spec: ShortcutSpec) {
			shortcuts.set(name, spec);
		},
		sendMessage() {},
		sendUserMessage(content: string | unknown[], options?: { deliverAs?: "steer" | "followUp" }) {
			userMessages.push({ content, options });
		},
	};

	return { commands, shortcuts, userMessages, pi };
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

void describe(
	"lean superpowers slash commands",
	{ skip: !available ? "slash-commands.ts not importable" : undefined },
	() => {
		void it("registers only Superpowers commands and configured custom commands", () => {
			const { commands, shortcuts, pi } = createPiHarness();
			const config = {
				superagents: {
					commands: {
						review: { description: "Run code review", useSubagents: false },
					},
				},
			};
			registerSlashCommands!(pi, createState(process.cwd()), config);
			assert.ok(commands.has("sp-implement"), "expected /sp-implement to be registered");
			assert.ok(commands.has("sp-brainstorm"), "expected /sp-brainstorm to be registered");
			assert.ok(commands.has("subagents-status"), "expected /subagents-status to be registered");
			assert.ok(commands.has("sp-settings"), "expected /sp-settings to be registered");
			assert.ok(commands.has("review"), "expected /review preset to be registered");
			assert.ok(shortcuts.has("ctrl+alt+s"), "expected ctrl+alt+s shortcut to be registered");
			assert.ok(!commands.has("superpowers"), "expected /superpowers to NOT be registered");
			assert.ok(!commands.has("superpowers-status"), "expected /superpowers-status to NOT be registered");
			assert.ok(!commands.has("run"), "expected /run to NOT be registered");
			assert.ok(!commands.has("chain"), "expected /chain to NOT be registered");
			assert.ok(!commands.has("parallel"), "expected /parallel to NOT be registered");
			assert.ok(!commands.has("agents"), "expected /agents to NOT be registered");
			assert.equal(commands.get("review")!.description, "Run code review");
			assert.match(shortcuts.get("ctrl+alt+s")!.description ?? "", /subagents status/i);
		});

		void it("/sp-implement includes the plannotator review contract when enabled", async () => {
			const userMessages: Array<{ content: string | unknown[]; options?: { deliverAs?: "steer" | "followUp" } }> = [];
			const commands = new Map<string, CommandSpec>();
			const pi = {
				events: createEventBus(),
				registerCommand(name: string, spec: CommandSpec) {
					commands.set(name, spec);
				},
				registerShortcut() {},
				sendMessage() {},
				sendUserMessage(content: string | unknown[], options?: { deliverAs?: "steer" | "followUp" }) {
					userMessages.push({ content, options });
				},
			};

			registerSlashCommands!(pi, createState(process.cwd()), {
				superagents: {
					usePlannotator: true,
				},
			});
			await commands.get("sp-implement")!.handler("tdd implement auth fix", createCommandContext());

			assert.equal(userMessages.length, 1);
			const prompt = String(userMessages[0].content);
			assert.match(prompt, /usePlannotatorReview:\s*true/);
			assert.match(prompt, /superpowers_plan_review/);
		});

		void it("/sp-implement sends a root-session prompt with resolved defaults", async () => {
			const userMessages: Array<{ content: string | unknown[]; options?: { deliverAs?: "steer" | "followUp" } }> = [];
			const commands = new Map<string, CommandSpec>();
			const pi = {
				events: createEventBus(),
				registerCommand(name: string, spec: CommandSpec) {
					commands.set(name, spec);
				},
				registerShortcut() {},
				sendMessage() {},
				sendUserMessage(content: string | unknown[], options?: { deliverAs?: "steer" | "followUp" }) {
					userMessages.push({ content, options });
				},
			};

			registerSlashCommands!(pi, createState(process.cwd()), {});
			await commands.get("sp-implement")!.handler("tdd implement auth fix", createCommandContext());

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

		void it("sp-implement shows the user task and config flags, injecting the strict contract as hidden context", async () => {
			type BeforeAgentStartHandler = (event: { prompt: string }) =>
				| {
						message?: { customType: string; content: string; display: boolean };
				  }
				| undefined;
			let beforeAgentStart: BeforeAgentStartHandler | undefined;
			const userMessages: Array<{ content: string | unknown[]; options?: { deliverAs?: "steer" | "followUp" } }> = [];
			const commands = new Map<string, CommandSpec>();
			const pi = {
				events: createEventBus(),
				on(event: string, handler: BeforeAgentStartHandler) {
					if (event === "before_agent_start") beforeAgentStart = handler;
				},
				registerCommand(name: string, spec: CommandSpec) {
					commands.set(name, spec);
				},
				registerShortcut() {},
				sendMessage() {},
				sendUserMessage(content: string | unknown[], options?: { deliverAs?: "steer" | "followUp" }) {
					userMessages.push({ content, options });
				},
			};

			registerSlashCommands!(pi as never, createState(process.cwd()), {
				superagents: {
					useBranches: true,
					useSubagents: false,
					useTestDrivenDevelopment: true,
					usePlannotator: false,
					worktrees: { enabled: false },
				},
			});
			await commands.get("sp-implement")!.handler("implement auth fix", createCommandContext());

			assert.equal(userMessages.length, 1);
			const visiblePrompt = String(userMessages[0].content);
			assert.match(visiblePrompt, /Superpowers ▸ implement auth fix/);
			assert.match(visiblePrompt, /Config:/);
			assert.match(visiblePrompt, /useBranches:\s*true/);
			assert.match(visiblePrompt, /useSubagents:\s*false/);
			assert.match(visiblePrompt, /worktrees\.enabled:\s*false/);
			assert.doesNotMatch(visiblePrompt, /Superpowers Root Session Contract/);

			const hidden = beforeAgentStart?.({ prompt: visiblePrompt });
			assert.equal(hidden?.message?.customType, "superpowers-root-contract");
			assert.equal(hidden?.message?.display, false);
			assert.match(hidden?.message?.content ?? "", /Superpowers Root Session Contract/);
			assert.match(hidden?.message?.content ?? "", /implement auth fix/);
			assert.match(hidden?.message?.content ?? "", /Branch policy is ENABLED/);
		});

		void it("custom commands apply presets and inline tokens override them", async () => {
			const userMessages: Array<{ content: string | unknown[]; options?: { deliverAs?: "steer" | "followUp" } }> = [];
			const commands = new Map<string, CommandSpec>();
			const pi = {
				events: createEventBus(),
				registerCommand(name: string, spec: CommandSpec) {
					commands.set(name, spec);
				},
				registerShortcut() {},
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

		void it("/subagents-status opens the run status overlay", async () => {
			const { commands, pi } = createPiHarness();
			let customCalls = 0;
			registerSlashCommands!(pi, createState(process.cwd()), {});
			await commands.get("subagents-status")!.handler(
				"",
				createCommandContext({
					hasUI: true,
					custom: async () => {
						customCalls++;
						return undefined;
					},
				}),
			);
			assert.equal(customCalls, 1);
		});

		void it("ctrl+alt+s opens the run status overlay", async () => {
			const { shortcuts, pi } = createPiHarness();
			let customCalls = 0;
			registerSlashCommands!(pi, createState(process.cwd()), {});
			await shortcuts.get("ctrl+alt+s")!.handler(
				createCommandContext({
					hasUI: true,
					custom: async () => {
						customCalls++;
						return undefined;
					},
				}),
			);
			assert.equal(customCalls, 1);
		});

		void it("/sp-settings opens the settings overlay", async () => {
			const { commands, pi } = createPiHarness();
			let customCalls = 0;
			registerSlashCommands!(pi, createState(process.cwd()), {});
			await commands.get("sp-settings")!.handler(
				"",
				createCommandContext({
					hasUI: true,
					custom: async () => {
						customCalls++;
						return undefined;
					},
				}),
			);
			assert.equal(customCalls, 1);
		});

		void it("/subagents-status returns cleanly when UI is unavailable", async () => {
			const { commands, pi } = createPiHarness();
			registerSlashCommands!(pi, createState(process.cwd()), {});

			await assert.doesNotReject(async () => {
				await commands.get("subagents-status")!.handler("", {
					cwd: process.cwd(),
					isIdle: () => true,
					hasUI: false,
					modelRegistry: { getAvailable: () => [] },
				} as never);
			});
		});

		void it("/sp-settings returns cleanly when UI is unavailable", async () => {
			const { commands, pi } = createPiHarness();
			registerSlashCommands!(pi, createState(process.cwd()), {});

			await assert.doesNotReject(async () => {
				await commands.get("sp-settings")!.handler("", {
					cwd: process.cwd(),
					isIdle: () => true,
					hasUI: false,
					modelRegistry: { getAvailable: () => [] },
				} as never);
			});
		});

		void it("refuses to execute /sp-implement when config is blocked", async () => {
			const notifications: Array<{ message: string; type?: string }> = [];
			const commands = new Map<string, CommandSpec>();
			const pi = {
				events: createEventBus(),
				registerCommand(name: string, spec: CommandSpec) {
					commands.set(name, spec);
				},
				registerShortcut() {},
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
			await commands.get("sp-implement")!.handler("tdd fix bug", ctx);

			assert.equal(notifications.length, 1);
			assert.equal(notifications[0].type, "error");
			assert.match(notifications[0].message, /disabled because config\.json needs attention/);
		});

		void it("/sp-implement queues a follow-up when the agent is busy", async () => {
			const userMessages: Array<{ content: string | unknown[]; options?: { deliverAs?: "steer" | "followUp" } }> = [];
			const commands = new Map<string, CommandSpec>();
			const pi = {
				events: createEventBus(),
				registerCommand(name: string, spec: CommandSpec) {
					commands.set(name, spec);
				},
				registerShortcut() {},
				sendMessage() {},
				sendUserMessage(content: string | unknown[], options?: { deliverAs?: "steer" | "followUp" }) {
					userMessages.push({ content, options });
				},
			};

			registerSlashCommands!(pi, createState(process.cwd()), {});

			// isIdle() returns false → should use followUp delivery
			await commands.get("sp-implement")!.handler("direct update config", createCommandContext({ idle: false }));

			assert.equal(userMessages.length, 1);
			assert.equal(userMessages[0].options?.deliverAs, "followUp");
			assert.match(String(userMessages[0].content), /useTestDrivenDevelopment:\s*false/);
		});

		void it("shows usage hint when /sp-implement is called without a task", async () => {
			const notifications: Array<{ message: string; type?: string }> = [];
			const commands = new Map<string, CommandSpec>();
			const pi = {
				events: createEventBus(),
				registerCommand(name: string, spec: CommandSpec) {
					commands.set(name, spec);
				},
				registerShortcut() {},
				sendMessage() {},
				sendUserMessage() {},
			};

			registerSlashCommands!(pi, createState(process.cwd()), {});
			const ctx = createCommandContext({ hasUI: true });
			(ctx as { ui: { notify(message: string, type?: string): void } }).ui.notify = (message, type) => {
				notifications.push({ message, type });
			};

			await commands.get("sp-implement")!.handler("", ctx);
			assert.equal(notifications.length, 1);
			assert.equal(notifications[0].type, "error");
			assert.match(notifications[0].message, /Usage: \/sp-implement/);

			notifications.length = 0;
			await commands.get("sp-implement")!.handler("tdd", ctx);
			assert.equal(notifications.length, 1);
			assert.equal(notifications[0].type, "error");
			assert.match(notifications[0].message, /Usage: \/sp-implement/);
		});

		void it("ignores /sp-implement usage errors cleanly when UI is unavailable", async () => {
			const commands = new Map<string, CommandSpec>();
			const pi = {
				events: createEventBus(),
				registerCommand(name: string, spec: CommandSpec) {
					commands.set(name, spec);
				},
				registerShortcut() {},
				sendMessage() {},
				sendUserMessage() {},
			};

			registerSlashCommands!(pi, createState(process.cwd()), {});

			await assert.doesNotReject(async () => {
				await commands.get("sp-implement")!.handler("", {
					cwd: process.cwd(),
					isIdle: () => true,
					hasUI: false,
					modelRegistry: { getAvailable: () => [] },
				} as never);
			});
		});

		void it("SubagentsStatusComponent renders active and recent runs", async () => {
			const module = (await import("../../src/ui/subagents-status.ts")) as {
				SubagentsStatusComponent: new (...args: unknown[]) => { render(width: number): string[]; dispose(): void };
			};
			const component = new module.SubagentsStatusComponent(
				{ requestRender: () => {} },
				{ fg: (_color: string, text: string) => text, bg: (_color: string, text: string) => text },
				() => {},
				{
					refreshMs: 60_000,
					getActiveRuns: () => [
						{
							agent: "sp-implementer",
							task: "Fix auth bug",
							ts: 1,
							status: "ok",
							duration: 1250,
							model: "test",
							tokens: { total: 300 },
						},
					],
					getRecentRuns: () => [],
				},
			);
			const rendered = component.render(84).join("\n");
			assert.match(rendered, /Fix auth bug/);
			component.dispose();
		});

		void it("writes Superpowers setting toggles to the config file", async () => {
			const fs = await import("node:fs");
			const os = await import("node:os");
			const path = await import("node:path");
			const module = (await import("../../src/ui/sp-settings.ts")) as {
				SuperpowersSettingsComponent: new (
					...args: unknown[]
				) => {
					toggleUseSubagents(): void;
					toggleWorktrees(): void;
				};
			};
			const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-settings-"));
			const configPath = path.join(dir, "config.json");
			fs.writeFileSync(
				configPath,
				'{\n  "superagents": { "useSubagents": true, "worktrees": { "enabled": false } }\n}\n',
				"utf-8",
			);
			const state = createState(process.cwd());
			state.configGate.configPath = configPath;
			const component = new module.SuperpowersSettingsComponent(
				{ requestRender: () => {} },
				{ fg: (_color: string, text: string) => text, bg: (_color: string, text: string) => text },
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

		// ─────────────────────────────────────────────────────────────────────────────
		// /sp-brainstorm slash command tests
		// ─────────────────────────────────────────────────────────────────────────────

		void it("registers /sp-brainstorm and sends a brainstorming entry prompt", async () => {
			const userMessages: Array<{ content: string | unknown[]; options?: { deliverAs?: "steer" | "followUp" } }> = [];
			const commands = new Map<string, CommandSpec>();
			const pi = {
				events: createEventBus(),
				registerCommand(name: string, spec: CommandSpec) {
					commands.set(name, spec);
				},
				registerShortcut() {},
				sendMessage() {},
				sendUserMessage(content: string | unknown[], options?: { deliverAs?: "steer" | "followUp" }) {
					userMessages.push({ content, options });
				},
			};

			registerSlashCommands!(pi, createState(process.cwd()), {
				superagents: {
					usePlannotator: true,
					skillOverlays: {
						brainstorming: ["react-native-best-practices"],
					},
				} as never,
			});

			assert.ok(commands.has("sp-brainstorm"), "expected /sp-brainstorm to be registered");
			await commands.get("sp-brainstorm")!.handler("design onboarding", createCommandContext());

			assert.equal(userMessages.length, 1);
			const prompt = String(userMessages[0].content);
			assert.match(prompt, /Entry skill:/);
			assert.match(prompt, /Name: brainstorming/);
			assert.match(prompt, /design onboarding/);
			assert.match(prompt, /superpowers_spec_review/);
		});

		void it("/sp-brainstorm shows usage when no task is provided", async () => {
			const notifications: string[] = [];
			const commands = new Map<string, CommandSpec>();
			const pi = {
				events: createEventBus(),
				registerCommand(name: string, spec: CommandSpec) {
					commands.set(name, spec);
				},
				registerShortcut() {},
				sendMessage() {},
				sendUserMessage() {
					throw new Error("sendUserMessage should not be called");
				},
			};

			registerSlashCommands!(pi, createState(process.cwd()), {});
			await commands.get("sp-brainstorm")!.handler("", {
				...createCommandContext({ hasUI: true }),
				ui: {
					notify(message: string) {
						notifications.push(message);
					},
				},
			});

			assert.deepEqual(notifications, ["Usage: /sp-brainstorm <task>"]);
		});

		void it("/sp-brainstorm applies global Superpowers policy", async () => {
			const userMessages: Array<{ content: string | unknown[]; options?: { deliverAs?: "steer" | "followUp" } }> = [];
			const commands = new Map<string, CommandSpec>();
			const pi = {
				events: createEventBus(),
				registerCommand(name: string, spec: CommandSpec) {
					commands.set(name, spec);
				},
				registerShortcut() {},
				sendMessage() {},
				sendUserMessage(content: string | unknown[], options?: { deliverAs?: "steer" | "followUp" }) {
					userMessages.push({ content, options });
				},
			};

			registerSlashCommands!(pi, createState(process.cwd()), {
				superagents: {
					useSubagents: false,
					useTestDrivenDevelopment: false,
					worktrees: { enabled: false },
				},
			});

			await commands.get("sp-brainstorm")!.handler("design auth", createCommandContext());

			const prompt = String(userMessages[0].content);
			assert.match(prompt, /useSubagents:\s*false/);
			assert.match(prompt, /useTestDrivenDevelopment:\s*false/);
			assert.match(prompt, /worktrees\.enabled:\s*false/);
		});

		void it("/sp-brainstorm reports unresolved overlay skills without sending a prompt", async () => {
			const notifications: string[] = [];
			const userMessages: string[] = [];
			const commands = new Map<string, CommandSpec>();
			const pi = {
				events: createEventBus(),
				registerCommand(name: string, spec: CommandSpec) {
					commands.set(name, spec);
				},
				registerShortcut() {},
				sendMessage() {},
				sendUserMessage(content: string | unknown[]) {
					userMessages.push(String(content));
				},
			};

			registerSlashCommands!(pi, createState(process.cwd()), {
				superagents: {
					skillOverlays: {
						brainstorming: ["definitely-missing-skill"],
					},
				} as never,
			});

			await commands.get("sp-brainstorm")!.handler("design onboarding", {
				...createCommandContext({ hasUI: true }),
				ui: {
					notify(message: string) {
						notifications.push(message);
					},
				},
			});

			assert.deepEqual(userMessages, []);
			assert.deepEqual(notifications, ["Superpowers overlay skills could not be resolved: definitely-missing-skill"]);
		});
	},
);
