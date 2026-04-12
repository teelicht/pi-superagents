/**
 * Subagent Tool
 *
 *
 * Config file: ~/.pi/agent/extensions/subagent/config.json
 *   { "maxSubagentDepth": 1, "superagents": { "worktrees": { "enabled": true } } }
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { type ExtensionAPI, type ExtensionContext, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { discoverAgents } from "../agents/agents.ts";
import { cleanupAllArtifactDirs, cleanupOldArtifacts, getArtifactsDir } from "../shared/artifacts.ts";
import { renderSubagentResult } from "../ui/render.ts";
import { SubagentParams } from "../shared/schemas.ts";
import { formatConfigDiagnostics, loadEffectiveConfig } from "../execution/config-validation.ts";
import type { ConfigDiagnostic } from "../shared/types.ts";
import { createSubagentExecutor, type SubagentParamsLike } from "../execution/subagent-executor.ts";
import { registerSlashCommands } from "../slash/slash-commands.ts";
import {
	type Details,
	type ExtensionConfig,
	type SubagentState,
	DEFAULT_ARTIFACT_CONFIG,
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
function readJsonConfig(filePath: string): unknown {
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
function _migrateCopiedDefaultConfig(state: LoadedConfigState): AgentToolResult<Details> {
	const canMigrate = state.diagnostics.some((diagnostic) => diagnostic.action === "replace_with_empty_override");
	if (!canMigrate) {
		return {
			content: [{ type: "text", text: "No safe config migration is available for the current config.json." }],
			details: { mode: "single", results: [] },
		};
	}
	const backupPath = `${state.configPath}.bak-${Date.now()}`;
	fs.copyFileSync(state.configPath, backupPath);
	fs.writeFileSync(state.configPath, "{}\n", "utf-8");
	return {
		content: [{ type: "text", text: `Migrated config.json to an empty override. Backup: ${backupPath}\nRestart or reload Pi to use the updated config.` }],
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
function _ensureAccessibleDir(dirPath: string): void {
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

export default function registerSubagentExtension(pi: ExtensionAPI): void {
	const configState = loadConfigState();
	const config = configState.config;
	const tempArtifactsDir = getArtifactsDir(null);
	cleanupAllArtifactDirs(DEFAULT_ARTIFACT_CONFIG.cleanupDays);

	const state: SubagentState = {
		baseCwd: process.cwd(),
		currentSessionId: null,
		lastUiContext: null,
		configGate: {
			blocked: configState.blocked,
			diagnostics: configState.diagnostics,
			message: configState.message,
			configPath: configState.configPath,
			examplePath: configState.examplePath,
		},
	};

	const executor = createSubagentExecutor({
		pi,
		state,
		config,
		tempArtifactsDir,
		getSubagentSessionRoot,
		expandTilde,
		discoverAgents,
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
			return executor.execute(id, params as unknown as SubagentParamsLike, signal ?? new AbortController().signal, onUpdate, ctx);
		},

		renderCall(args, theme) {
			const isParallel = (args.tasks?.length ?? 0) > 0;
			const parallelCount = effectiveParallelTaskCount(args.tasks as Array<{ count?: unknown }> | undefined);
			if (isParallel)
				return new Text(
					`${theme.fg("toolTitle", theme.bold("subagent "))}parallel (${parallelCount})`,
					0,
					0,
				);
			return new Text(
				`${theme.fg("toolTitle", theme.bold("subagent "))}${theme.fg("accent", args.agent || "?")}`,
				0,
				0,
			);
		},

		renderResult(result, options, theme) {
			return renderSubagentResult(result, options, theme);
		},

	};

	pi.registerTool(tool);
	registerSlashCommands(pi, state, config);

	pi.on("tool_result", (event, ctx) => {
		if (event.toolName !== "subagent") return;
		if (!ctx.hasUI) return;
		state.lastUiContext = ctx;
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
		// Nothing to clean up anymore
	});
}
