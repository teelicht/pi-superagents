/**
 * Subagent Tool
 *
 * Full-featured subagent with sync and async modes.
 * - Sync (default): Streams output, renders markdown, tracks usage
 * - Async: Background execution, emits events when done
 *
 * Modes: single (agent + task), parallel (tasks[]), chain (chain[] with {previous})
 * Toggle: async parameter (default: false, configurable via config.json)
 *
 * Config file: ~/.pi/agent/extensions/subagent/config.json
 *   { "asyncByDefault": true, "maxSubagentDepth": 1, "superagents": { "worktrees": { "enabled": true } } }
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { type ExtensionAPI, type ExtensionContext, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Box, Container, Spacer, Text } from "@mariozechner/pi-tui";
import { discoverAgents } from "../agents/agents.ts";
import { cleanupAllArtifactDirs, cleanupOldArtifacts, getArtifactsDir } from "../shared/artifacts.ts";
import { cleanupOldChainDirs } from "../execution/settings.ts";
import { renderWidget, renderSubagentResult } from "../ui/render.ts";
import { SubagentParams, StatusParams } from "../shared/schemas.ts";
import { findByPrefix, readStatus } from "../shared/utils.ts";
import { formatConfigDiagnostics, loadEffectiveConfig } from "../execution/config-validation.ts";
import type { ConfigDiagnostic } from "../shared/types.ts";
import { createSubagentExecutor } from "../execution/subagent-executor.ts";
import { createAsyncJobTracker } from "../ui/async-job-tracker.ts";
import { createResultWatcher } from "../ui/result-watcher.ts";
import { registerSlashCommands } from "../slash/slash-commands.ts";
import { clearSlashSnapshots, getSlashRenderableSnapshot, resolveSlashMessageDetails, restoreSlashFinalSnapshots, type SlashMessageDetails } from "../slash/slash-live-state.ts";
import { formatAsyncRunList, listAsyncRuns } from "../ui/async-status.ts";
import {
	type Details,
	type ExtensionConfig,
	type SubagentState,
	ASYNC_DIR,
	DEFAULT_ARTIFACT_CONFIG,
	RESULTS_DIR,
	SLASH_RESULT_TYPE,
	WIDGET_KEY,
} from "../shared/types.ts";

/**
 * Derive subagent session base directory from parent session file.
 * If parent session is ~/.pi/agent/sessions/abc123.jsonl,
 * returns ~/.pi/agent/sessions/abc123/ as the base.
 * Callers add runId to create the actual session root: abc123/{runId}/
 * Falls back to a unique temp directory if no parent session.
 */
function getSubagentSessionRoot(parentSessionFile: string | null): string {
	if (parentSessionFile) {
		const baseName = path.basename(parentSessionFile, ".jsonl");
		const sessionsDir = path.dirname(parentSessionFile);
		return path.join(sessionsDir, baseName);
	}
	return fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-session-"));
}

/**
 * Read one JSON config file from disk.
 *
 * @param filePath Absolute path to the JSON file.
 * @returns Parsed JSON value or `undefined` when the file is absent.
 */
function readJsonConfig(filePath: string): unknown | undefined {
	if (!fs.existsSync(filePath)) return undefined;
	return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

interface LoadedConfigState {
	config: ExtensionConfig;
	blocked: boolean;
	diagnostics: ConfigDiagnostic[];
	message: string;
	configPath: string;
	examplePath: string;
}

/**
 * Load and validate extension config, preserving diagnostics for user display.
 *
 * @returns Validated config state for runtime registration.
 */
function loadConfigState(): LoadedConfigState {
	const extensionDir = path.dirname(fileURLToPath(import.meta.url));
	const packageRoot = path.resolve(extensionDir, "..", "..");
	const bundledDefaultConfigPath = path.join(packageRoot, "default-config.json");
	const configPath = path.join(os.homedir(), ".pi", "agent", "extensions", "subagent", "config.json");
	const examplePath = path.join(os.homedir(), ".pi", "agent", "extensions", "subagent", "config.example.json");
	try {
		const bundledDefaults = (readJsonConfig(bundledDefaultConfigPath) ?? {}) as ExtensionConfig;
		const userConfig = readJsonConfig(configPath);
		const result = loadEffectiveConfig(bundledDefaults, userConfig);
		const message = result.diagnostics.length
			? formatConfigDiagnostics(result.diagnostics, { configPath, examplePath })
			: "";
		return { ...result, message, configPath, examplePath };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const diagnostics: ConfigDiagnostic[] = [{
			level: "error",
			code: "config_load_failed",
			path: "config.json",
			message,
		}];
		return {
			config: {},
			blocked: true,
			diagnostics,
			message: formatConfigDiagnostics(diagnostics, { configPath, examplePath }),
			configPath,
			examplePath,
		};
	}
}

/**
 * Apply the safe empty-override migration for a copied default config.
 *
 * @param state Current loaded config state.
 * @returns Tool result describing the migration outcome.
 */
function migrateCopiedDefaultConfig(state: LoadedConfigState): AgentToolResult<Details> {
	const canMigrate = state.diagnostics.some((diagnostic) => diagnostic.action === "replace_with_empty_override");
	if (!canMigrate) {
		return {
			content: [{ type: "text", text: "No safe config migration is available for the current config.json." }],
			isError: true,
			details: { mode: "single", results: [] },
		};
	}
	const backupPath = `${state.configPath}.bak-${Date.now()}`;
	fs.copyFileSync(state.configPath, backupPath);
	fs.writeFileSync(state.configPath, "{}\n", "utf-8");
	return {
		content: [{ type: "text", text: `Migrated config.json to an empty override. Backup: ${backupPath}\nRestart or reload Pi to use the updated config.` }],
		isError: false,
		details: { mode: "single", results: [] },
	};
}

function expandTilde(p: string): string {
	return p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;
}

/**
 * Create a directory and verify it is actually accessible.
 * On Windows with Azure AD/Entra ID, directories created shortly after
 * wake-from-sleep can end up with broken NTFS ACLs (null DACL) when the
 * cloud SID cannot be resolved without network connectivity. This leaves
 * the directory completely inaccessible to the creating user.
 */
function ensureAccessibleDir(dirPath: string): void {
	fs.mkdirSync(dirPath, { recursive: true });
	try {
		fs.accessSync(dirPath, fs.constants.R_OK | fs.constants.W_OK);
	} catch {
		try {
			fs.rmSync(dirPath, { recursive: true, force: true });
		} catch {
			// Best effort: retry mkdir/access even if cleanup fails.
		}
		fs.mkdirSync(dirPath, { recursive: true });
		fs.accessSync(dirPath, fs.constants.R_OK | fs.constants.W_OK);
	}
}

function isSlashResultRunning(result: { details?: Details }): boolean {
	return result.details?.progress?.some((entry) => entry.status === "running")
		|| result.details?.results.some((entry) => entry.progress?.status === "running")
		|| false;
}

function isSlashResultError(result: { details?: Details }): boolean {
	return result.details?.results.some((entry) => entry.exitCode !== 0 && entry.progress?.status !== "running") || false;
}

function rebuildSlashResultContainer(
	container: Container,
	result: AgentToolResult<Details>,
	options: { expanded: boolean },
	theme: ExtensionContext["ui"]["theme"],
): void {
	container.clear();
	container.addChild(new Spacer(1));
	const boxTheme = isSlashResultRunning(result) ? "toolPendingBg" : isSlashResultError(result) ? "toolErrorBg" : "toolSuccessBg";
	const box = new Box(1, 1, (text: string) => theme.bg(boxTheme, text));
	box.addChild(renderSubagentResult(result, options, theme));
	container.addChild(box);
}

function createSlashResultComponent(
	details: SlashMessageDetails,
	options: { expanded: boolean },
	theme: ExtensionContext["ui"]["theme"],
): Container {
	const container = new Container();
	let lastVersion = -1;
	container.render = (width: number): string[] => {
		const snapshot = getSlashRenderableSnapshot(details);
		if (snapshot.version !== lastVersion) {
			lastVersion = snapshot.version;
			rebuildSlashResultContainer(container, snapshot.result, options, theme);
		}
		return Container.prototype.render.call(container, width);
	};
	return container;
}

export default function registerSubagentExtension(pi: ExtensionAPI): void {
	ensureAccessibleDir(RESULTS_DIR);
	ensureAccessibleDir(ASYNC_DIR);
	cleanupOldChainDirs();

	const configState = loadConfigState();
	const config = configState.config;
	const asyncByDefault = config.asyncByDefault === true;
	const tempArtifactsDir = getArtifactsDir(null);
	cleanupAllArtifactDirs(DEFAULT_ARTIFACT_CONFIG.cleanupDays);

	const state: SubagentState = {
		baseCwd: process.cwd(),
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
			blocked: configState.blocked,
			diagnostics: configState.diagnostics,
			message: configState.message,
		},
	};

	const { startResultWatcher, primeExistingResults, stopResultWatcher } = createResultWatcher(
		pi,
		state,
		RESULTS_DIR,
		10 * 60 * 1000,
	);
	startResultWatcher();
	primeExistingResults();

	const { ensurePoller, handleStarted, handleComplete, resetJobs } = createAsyncJobTracker(state, ASYNC_DIR);
	const executor = createSubagentExecutor({
		pi,
		state,
		config,
		asyncByDefault,
		tempArtifactsDir,
		getSubagentSessionRoot,
		expandTilde,
		discoverAgents,
	});

	pi.registerMessageRenderer<SlashMessageDetails>(SLASH_RESULT_TYPE, (message, options, theme) => {
		const details = resolveSlashMessageDetails(message.details);
		if (!details) return undefined;
		return createSlashResultComponent(details, options, theme);
	});


	function effectiveParallelTaskCount(tasks: Array<{ count?: unknown }> | undefined): number {
		if (!tasks || tasks.length === 0) return 0;
		return tasks.reduce((total, task) => {
			const count = typeof task.count === "number" && Number.isInteger(task.count) && task.count >= 1 ? task.count : 1;
			return total + count;
		}, 0);
	}

	/**
 * Build a blocking tool result for invalid config.
 *
 * @param message User-facing config diagnostic message.
 * @returns Tool result that refuses execution.
 */
function configBlockedResult(message: string): AgentToolResult<Details> {
	return {
		content: [{ type: "text", text: message }],
		isError: true,
		details: { mode: "single", results: [] },
	};
}

const tool: ToolDefinition<typeof SubagentParams, Details> = {
		name: "subagent",
		label: "Subagent",
		description: `Delegate bounded work to Superpowers role subagents.

Use this tool only inside a Superpowers workflow when selected skills call for delegation.

SINGLE: { agent: "sp-recon", task: "Inspect the auth flow" }
PARALLEL: { tasks: [{ agent: "sp-research", task: "Check config" }, { agent: "sp-code-review", task: "Review diff" }] }

Allowed role agents: sp-recon, sp-research, sp-implementer, sp-spec-review, sp-code-review, sp-debug.
Bounded role agents are not allowed to call subagents.`,
		parameters: SubagentParams,

		execute(id, params, signal, onUpdate, ctx) {
			if (state.configGate.blocked) {
				return Promise.resolve(configBlockedResult(state.configGate.message));
			}
			return executor.execute(id, params, signal, onUpdate, ctx);
		},

		renderCall(args, theme) {
			const isParallel = (args.tasks?.length ?? 0) > 0;
			const parallelCount = effectiveParallelTaskCount(args.tasks as Array<{ count?: unknown }> | undefined);
			const asyncLabel = args.async === true && !isParallel ? theme.fg("warning", " [async]") : "";
			if (args.chain?.length)
				return new Text(
					`${theme.fg("toolTitle", theme.bold("subagent "))}chain (${args.chain.length})${asyncLabel}`,
					0,
					0,
				);
			if (isParallel)
				return new Text(
					`${theme.fg("toolTitle", theme.bold("subagent "))}parallel (${parallelCount})`,
					0,
					0,
				);
			return new Text(
				`${theme.fg("toolTitle", theme.bold("subagent "))}${theme.fg("accent", args.agent || "?")}${asyncLabel}`,
				0,
				0,
			);
		},

		renderResult(result, options, theme) {
			return renderSubagentResult(result, options, theme);
		},

	};

	const statusTool: ToolDefinition<typeof StatusParams, Details> = {
		name: "subagent_status",
		label: "Subagent Status",
		description: "Inspect async subagent run status and artifacts",
		parameters: StatusParams,

		async execute(_id, params, _signal, _onUpdate, _ctx) {
			if (params.action === "config") {
				return {
					content: [{ type: "text", text: state.configGate.message || "pi-superagents config is valid." }],
					isError: state.configGate.blocked,
					details: { mode: "single" as const, results: [] },
				};
			}
			if (params.action === "migrate-config") {
				return migrateCopiedDefaultConfig(configState);
			}
			if (params.action === "list") {
				try {
					const runs = listAsyncRuns(ASYNC_DIR, { states: ["queued", "running"] });
					return {
						content: [{ type: "text", text: formatAsyncRunList(runs) }],
						details: { mode: "single", results: [] },
					};
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					return {
						content: [{ type: "text", text: message }],
						isError: true,
						details: { mode: "single", results: [] },
					};
				}
			}

			let asyncDir: string | null = null;
			let resolvedId = params.id;

			if (params.dir) {
				asyncDir = path.resolve(params.dir);
			} else if (params.id) {
				const direct = path.join(ASYNC_DIR, params.id);
				if (fs.existsSync(direct)) {
					asyncDir = direct;
				} else {
					const match = findByPrefix(ASYNC_DIR, params.id);
					if (match) {
						asyncDir = match;
						resolvedId = path.basename(match);
					}
				}
			}

			const resultPath =
				params.id && !asyncDir ? findByPrefix(RESULTS_DIR, params.id, ".json") : null;

			if (!asyncDir && !resultPath) {
				return {
					content: [{ type: "text", text: "Async run not found. Provide id or dir." }],
					isError: true,
					details: { mode: "single" as const, results: [] },
				};
			}

			if (asyncDir) {
				let status;
				try {
					status = readStatus(asyncDir);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					return {
						content: [{ type: "text", text: message }],
						isError: true,
						details: { mode: "single" as const, results: [] },
					};
				}
				const logPath = path.join(asyncDir, `subagent-log-${resolvedId ?? "unknown"}.md`);
				const eventsPath = path.join(asyncDir, "events.jsonl");
				if (status) {
					const stepsTotal = status.steps?.length ?? 1;
					const current = status.currentStep !== undefined ? status.currentStep + 1 : undefined;
					const stepLine =
						current !== undefined ? `Step: ${current}/${stepsTotal}` : `Steps: ${stepsTotal}`;
					const started = new Date(status.startedAt).toISOString();
					const updated = status.lastUpdate ? new Date(status.lastUpdate).toISOString() : "n/a";

					const lines = [
						`Run: ${status.runId}`,
						`State: ${status.state}`,
						`Mode: ${status.mode}`,
						stepLine,
						`Started: ${started}`,
						`Updated: ${updated}`,
						`Dir: ${asyncDir}`,
					];
					if (status.sessionFile) lines.push(`Session: ${status.sessionFile}`);
					if (fs.existsSync(logPath)) lines.push(`Log: ${logPath}`);
					if (fs.existsSync(eventsPath)) lines.push(`Events: ${eventsPath}`);

					return { content: [{ type: "text", text: lines.join("\n") }], details: { mode: "single", results: [] } };
				}
			}

			if (resultPath) {
				try {
					const raw = fs.readFileSync(resultPath, "utf-8");
					const data = JSON.parse(raw) as { id?: string; success?: boolean; summary?: string };
					const status = data.success ? "complete" : "failed";
					const lines = [`Run: ${data.id ?? params.id}`, `State: ${status}`, `Result: ${resultPath}`];
					if (data.summary) lines.push("", data.summary);
					return { content: [{ type: "text", text: lines.join("\n") }], details: { mode: "single", results: [] } };
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					return {
						content: [{ type: "text", text: `Failed to read async result file: ${message}` }],
						isError: true,
						details: { mode: "single" as const, results: [] },
					};
				}
			}

			return {
				content: [{ type: "text", text: "Status file not found." }],
				isError: true,
				details: { mode: "single" as const, results: [] },
			};
		},
	};

	pi.registerTool(tool);
	pi.registerTool(statusTool);
	registerSlashCommands(pi, state, config);

	pi.events.on("subagent:started", handleStarted);
	pi.events.on("subagent:complete", handleComplete);

	pi.on("tool_result", (event, ctx) => {
		if (event.toolName !== "subagent") return;
		if (!ctx.hasUI) return;
		state.lastUiContext = ctx;
		if (state.asyncJobs.size > 0) {
			renderWidget(ctx, Array.from(state.asyncJobs.values()));
			ensurePoller();
		}
	});

	const cleanupSessionArtifacts = (ctx: ExtensionContext) => {
		try {
			const sessionFile = ctx.sessionManager.getSessionFile();
			if (sessionFile) {
				cleanupOldArtifacts(getArtifactsDir(sessionFile), DEFAULT_ARTIFACT_CONFIG.cleanupDays);
			}
		} catch {
			// Cleanup failures should not block session lifecycle events.
		}
	};

	const resetSessionState = (ctx: ExtensionContext) => {
		state.baseCwd = ctx.cwd;
		state.currentSessionId = ctx.sessionManager.getSessionFile() ?? `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		state.lastUiContext = ctx;
		cleanupSessionArtifacts(ctx);
		resetJobs(ctx);
		restoreSlashFinalSnapshots(ctx.sessionManager.getEntries());
	};

	let configDiagnosticNotifiedForSession: string | null = null;

	pi.on("session_start", (_event, ctx) => {
		resetSessionState(ctx);
		if (
			state.configGate.message
			&& ctx.hasUI
			&& configDiagnosticNotifiedForSession !== state.currentSessionId
		) {
			configDiagnosticNotifiedForSession = state.currentSessionId;
			ctx.ui.notify(state.configGate.message, state.configGate.blocked ? "error" : "warning");
		}
	});
	pi.on("session_shutdown", () => {
		stopResultWatcher();
		if (state.poller) clearInterval(state.poller);
		state.poller = null;
		for (const timer of state.cleanupTimers.values()) {
			clearTimeout(timer);
		}
		state.cleanupTimers.clear();
		state.asyncJobs.clear();
		clearSlashSnapshots();
		if (state.lastUiContext?.hasUI) {
			state.lastUiContext.ui.setWidget(WIDGET_KEY, undefined);
		}
	});
}
