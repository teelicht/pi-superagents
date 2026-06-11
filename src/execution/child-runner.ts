/**
 * Child process runner for executing subagent tasks.
 *
 * Responsibilities:
 * - spawn Pi subprocess for agent execution
 * - parse and accumulate structured events from JSONL stdout
 * - manage progress, usage stats, and tool execution tracking
 * - handle abort signals, temp directories, and resource cleanup
 * - integrate lifecycle sidecar consumption for completed runs
 *
 * Important dependencies and side effects:
 * - spawns real child processes (test with mocks)
 * - writes JSONL and metadata artifacts to disk
 * - updates global run history for monitoring
 * - consumes lifecycle sidecars via consumeLifecycleSignal
 * - derives completion envelopes via deriveCompletionEnvelope
 */

import { spawn } from "node:child_process";
import type { Message } from "@earendil-works/pi-ai";
import type { AgentConfig } from "../agents/agents.ts";
import { ensureArtifactsDir, getArtifactPaths, writeArtifact, writeMetadata } from "../shared/artifacts.ts";
import { detectSubagentError, extractTextFromContent, getFinalOutput } from "../shared/message-utils.ts";
import { buildSkillInjection, getPublishedExecutionSkills, resolveExecutionSkills } from "../shared/skills.ts";
import { extractThinkingSuffix, toThinkingLevel } from "../shared/thinking-levels.ts";
import { extractToolArgsPreview } from "../shared/tool-utils.ts";
import {
	type AgentProgress,
	type ArtifactPaths,
	type ChildRunResult,
	DEFAULT_MAX_OUTPUT,
	getSubagentDepthEnv,
	type RunSyncOptions,
	type SingleResult,
	truncateOutput,
} from "../shared/types.ts";

const DEFAULT_LIFECYCLE_EXTENSION_ENTRY = new URL(["..", "extension", "index.ts"].join("/"), import.meta.url).pathname;

import { createJsonlWriter } from "./jsonl-writer.ts";
import { consumeLifecycleSignal } from "./lifecycle-signals.ts";
import { buildPiArgs, cleanupTempDir } from "./pi-args.ts";
import { getPiSpawnCommand } from "./pi-spawn.ts";
import { deriveCompletionEnvelope } from "./result-delivery.ts";
import { globalRunHistory } from "./run-history.ts";
import { findMissingSubagentExtensionPath, findMissingSubagentToolPath, resolveSubagentExtensions } from "./superagents-config.ts";
import { inferExecutionRole, resolveModelForAgent, resolveRoleTools } from "./superpowers-policy.ts";

/**
 * Attach lifecycle sidecar result and derive completion envelope.
 *
 * Consumes the lifecycle sidecar when available and derives a completion
 * envelope from the result. Missing sidecars leave lifecycle undefined
 * but still derive a standard completion envelope.
 */
function attachLifecycle(result: SingleResult, options: RunSyncOptions): ChildRunResult {
	const sessionFile = result.sessionFile ?? options.sessionFile;
	const lifecycle = consumeLifecycleSignal(sessionFile);
	const withLifecycle = lifecycle.status === "missing" ? result : { ...result, lifecycle };
	return { ...withLifecycle, completion: deriveCompletionEnvelope(withLifecycle) };
}

/**
 * Ensure session-backed child runs can load this extension's lifecycle tools.
 *
 * @param extensions Explicit extension allowlist resolved from config and agent frontmatter.
 * @param sessionFile Optional child session file; lifecycle tools are useful only for session-backed children.
 * @param lifecycleExtensionEntry Absolute path to this extension entrypoint, supplied by the registration layer.
 * @returns Extension allowlist with the current pi-superagents extension appended when needed.
 */
function includeLifecycleExtension(extensions: string[], sessionFile: string | undefined, lifecycleExtensionEntry: string | undefined): string[] {
	if (!sessionFile) return extensions;
	const entry = lifecycleExtensionEntry ?? DEFAULT_LIFECYCLE_EXTENSION_ENTRY;
	return extensions.includes(entry) ? extensions : [...extensions, entry];
}

/**
 * Runtime launch data derived before a child process is spawned.
 *
 * Carries normalized policy, prompt, tool, skill, argument, and progress state so
 * `runPreparedChild` can stay focused on orchestration rather than option derivation.
 */
interface PreparedChildLaunch {
	agent: AgentConfig;
	args: string[];
	sharedEnv: Record<string, string | undefined>;
	tempDir?: string;
	result: SingleResult;
	progress: AgentProgress;
	historyId: string;
	startTime: number;
}

/**
 * Prepared execution policy fields for a child launch.
 *
 * Values reflect the effective model, thinking level, tools, and skills that will
 * be passed to the Pi CLI after applying workflow, agent, and command config.
 */
interface ResolvedChildExecutionOptions {
	workflow: NonNullable<RunSyncOptions["workflow"]>;
	effectiveModel?: string;
	launchThinking: AgentProgress["thinking"];
	effectiveTools?: string[];
	skillNames: string[];
	resolvedSkillNames?: string[];
	skillsWarning?: string;
	systemPrompt: string;
}

/**
 * Mutable state shared by structured stdout line processing callbacks.
 *
 * Keeps parsing helpers explicit about the result/progress objects they mutate
 * and the update hooks they may invoke for streaming UI refreshes.
 */
interface LineProcessorContext {
	result: SingleResult;
	progress: AgentProgress;
	startTime: number;
	historyId: string;
	onUpdate?: RunSyncOptions["onUpdate"];
	processClosed: () => boolean;
	jsonlWriter: ReturnType<typeof createJsonlWriter>;
}

/**
 * Create the standard failed result for launch-preparation errors.
 *
 * @param agentName Requested agent name.
 * @param task Task text delivered to the child.
 * @param error Human-readable launch error.
 * @returns Failed child result with an empty message list and zero usage.
 */
function createLaunchErrorResult(agentName: string, task: string, error: string): ChildRunResult {
	return {
		agent: agentName,
		task,
		exitCode: 1,
		messages: [],
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
		error,
	};
}

/**
 * Resolve model, tools, skills, and system prompt for a child agent.
 *
 * @param runtimeCwd Directory used for skill and policy resolution.
 * @param agent Agent configuration being launched.
 * @param options Runtime execution options supplied by the caller.
 * @returns Effective execution fields used to build CLI args and progress state.
 */
function resolveChildExecutionOptions(runtimeCwd: string, agent: AgentConfig, options: RunSyncOptions): ResolvedChildExecutionOptions {
	const workflow = options.workflow ?? "superpowers";
	const useTestDrivenDevelopment = options.useTestDrivenDevelopment ?? false;
	const config = options.config ?? {};
	const role = inferExecutionRole(agent.name);
	const tierModel = resolveModelForAgent({
		workflow,
		agentModel: agent.model,
		config,
	});
	const effectiveModel = options.modelOverride ?? tierModel?.model ?? agent.model;
	const hasModelOverride = options.modelOverride !== undefined;
	const launchThinking = extractThinkingSuffix(effectiveModel) ?? toThinkingLevel(agent.thinking, tierModel?.thinking, hasModelOverride);
	const effectiveTools = resolveRoleTools({
		workflow,
		role,
		agentTools: agent.tools,
		configTools: config.superagents?.tools,
	});
	const configuredSkills = options.skills !== undefined ? options.skills : (agent.skills ?? []);
	const { skillNames, resolvedSkills, missingSkills } = resolveExecutionSkills({
		cwd: runtimeCwd,
		workflow,
		role,
		config,
		useTestDrivenDevelopment,
		skills: configuredSkills,
		includeProject: options.projectTrusted ?? true,
	});
	const resolvedSkillNames = getPublishedExecutionSkills(resolvedSkills);
	const skillsWarning = missingSkills.length > 0 ? `Skills not found: ${missingSkills.join(", ")}` : undefined;

	let systemPrompt = agent.systemPrompt?.trim() || "";
	if (resolvedSkills.length > 0) {
		const skillInjection = buildSkillInjection(resolvedSkills);
		systemPrompt = systemPrompt ? `${systemPrompt}\n\n${skillInjection}` : skillInjection;
	}

	return { workflow, effectiveModel, launchThinking, effectiveTools, skillNames, resolvedSkillNames, skillsWarning, systemPrompt };
}

/**
 * Build the environment used for the spawned child process.
 *
 * @param sharedEnv Environment fragment returned by Pi argument preparation.
 * @param agent Agent being launched, used for lifecycle metadata variables.
 * @param options Runtime options including session and max-depth settings.
 * @returns Spawn environment preserving process env, Pi args env, lifecycle env, and depth guard.
 */
function buildChildEnvironment(sharedEnv: Record<string, string | undefined>, agent: AgentConfig, options: RunSyncOptions): NodeJS.ProcessEnv {
	const lifecycleEnv = options.sessionFile
		? {
				PI_SUBAGENT_SESSION: options.sessionFile,
				PI_SUBAGENT_NAME: agent.name,
				PI_SUBAGENT_AGENT: agent.name,
				PI_SUBAGENT_AUTO_EXIT: "0",
			}
		: {};
	return { ...process.env, ...sharedEnv, ...lifecycleEnv, ...getSubagentDepthEnv(options.maxSubagentDepth) };
}

/**
 * Prepare all launch-time state for a child run.
 *
 * @param runtimeCwd Directory used to resolve config, skills, and extension paths.
 * @param agentName Name requested by the caller.
 * @param task Task text or task packet reference delivered to the child.
 * @param agent Resolved agent configuration.
 * @param options Runtime launch options.
 * @returns Prepared launch state or a failed result when configured paths are invalid.
 */
function prepareChildLaunch(runtimeCwd: string, agentName: string, task: string, agent: AgentConfig, options: RunSyncOptions): PreparedChildLaunch | ChildRunResult {
	const config = options.config ?? {};
	const missingExtension = findMissingSubagentExtensionPath(runtimeCwd, config.superagents?.extensions, agent.extensions);
	if (missingExtension) {
		return createLaunchErrorResult(
			agentName,
			task,
			`Extension path from ${missingExtension.source} does not exist: ${missingExtension.configuredPath} (resolved to ${missingExtension.resolvedPath})`,
		);
	}

	const missingTool = findMissingSubagentToolPath(runtimeCwd, config.superagents?.tools, agent.tools);
	if (missingTool) {
		return createLaunchErrorResult(agentName, task, `Tool path from ${missingTool.source} does not exist: ${missingTool.configuredPath} (resolved to ${missingTool.resolvedPath})`);
	}

	const execution = resolveChildExecutionOptions(runtimeCwd, agent, options);
	const effectiveExtensions = includeLifecycleExtension(
		resolveSubagentExtensions(config, agent.extensions, {
			agentSource: agent.source,
			projectTrusted: options.projectTrusted,
		}),
		options.sessionFile,
		options.lifecycleExtensionEntry,
	);
	const sessionEnabled = Boolean(options.sessionFile);
	const {
		args,
		env: sharedEnv,
		tempDir,
	} = buildPiArgs({
		baseArgs: ["--mode", "json", "-p"],
		task,
		sessionEnabled,
		sessionFile: options.sessionFile,
		model: execution.effectiveModel,
		thinking: execution.launchThinking,
		tools: execution.effectiveTools,
		extensions: effectiveExtensions,
		skills: execution.skillNames,
		systemPrompt: execution.systemPrompt,
		mcpDirectTools: agent.mcpDirectTools,
		promptFileStem: agent.name,
		taskFilePath: options.taskFilePath,
		projectTrusted: options.projectTrusted,
	});

	const result: SingleResult = {
		agent: agentName,
		task,
		exitCode: 0,
		messages: [],
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
		model: execution.effectiveModel,
		thinking: execution.launchThinking,
		skills: execution.resolvedSkillNames,
		skillsWarning: execution.skillsWarning,
		sessionMode: options.sessionMode,
		sessionFile: options.sessionFile,
	};
	const progress: AgentProgress = {
		index: options.index ?? 0,
		agent: agentName,
		status: "running",
		task,
		model: execution.effectiveModel,
		thinking: execution.launchThinking,
		skills: execution.resolvedSkillNames,
		recentTools: [],
		recentOutput: [],
		toolCount: 0,
		durationMs: 0,
	};
	result.progress = progress;

	return {
		agent,
		args,
		sharedEnv,
		tempDir,
		result,
		progress,
		historyId: options.runId ? `${options.runId}-${agentName}-${options.index ?? 0}` : `run-${Date.now()}-${agentName}`,
		startTime: Date.now(),
	};
}

/**
 * Emit a progress update for the current child result.
 *
 * @param context Shared line processor state.
 */
function fireChildProgressUpdate(context: LineProcessorContext): void {
	if (!context.onUpdate || context.processClosed()) return;
	context.progress.durationMs = Date.now() - context.startTime;

	globalRunHistory.updateRun(context.historyId, {
		duration: context.progress.durationMs,
		model: context.result.model,
		thinking: context.result.thinking,
		skills: context.result.skills,
		skillsWarning: context.result.skillsWarning,
		tokens: { total: context.result.usage.input + context.result.usage.output },
	});

	context.onUpdate({
		content: [{ type: "text", text: getFinalOutput(context.result.messages) || "(running...)" }],
		details: { mode: "single", results: [context.result], progress: [context.progress] },
	});
}

/**
 * Record textual progress snippets from a message.
 *
 * @param progress Progress object to mutate.
 * @param message Message whose content should be summarized.
 */
function recordProgressFromMessage(progress: AgentProgress, message: Message): void {
	const text = extractTextFromContent(message.content);
	if (!text) return;
	const lines = text
		.split("\n")
		.filter((line) => line.trim())
		.slice(-10);
	progress.recentOutput.push(...lines);
	if (progress.recentOutput.length > 50) {
		progress.recentOutput.splice(0, progress.recentOutput.length - 50);
	}
}

/**
 * Process one parsed structured JSONL event from child stdout.
 *
 * @param evt Parsed event object.
 * @param context Shared line processor state.
 */
function processJsonMessageLine(evt: { type?: string; message?: Message; toolName?: string; args?: unknown }, context: LineProcessorContext): void {
	const now = Date.now();
	context.progress.durationMs = now - context.startTime;

	if (evt.type === "tool_execution_start") {
		context.progress.toolCount++;
		context.progress.currentTool = evt.toolName;
		context.progress.currentToolArgs = extractToolArgsPreview((evt.args || {}) as Record<string, unknown>);
		fireChildProgressUpdate(context);
	}

	if (evt.type === "tool_execution_end") {
		if (context.progress.currentTool) {
			context.progress.recentTools.push({
				tool: context.progress.currentTool,
				args: context.progress.currentToolArgs || "",
				endMs: now,
			});
		}
		context.progress.currentTool = undefined;
		context.progress.currentToolArgs = undefined;
		fireChildProgressUpdate(context);
	}

	if (evt.type === "message_end" && evt.message) {
		context.result.messages.push(evt.message);
		if (evt.message.role === "assistant") {
			context.result.usage.turns++;
			const usage = evt.message.usage;
			if (usage) {
				context.result.usage.input += usage.input || 0;
				context.result.usage.output += usage.output || 0;
				context.result.usage.cacheRead += usage.cacheRead || 0;
				context.result.usage.cacheWrite += usage.cacheWrite || 0;
				context.result.usage.cost += usage.cost?.total || 0;
			}
			if (evt.message.model && !evt.message.errorMessage) {
				context.result.model = evt.message.model;
				context.progress.model = evt.message.model;
			}
			if (evt.message.errorMessage) context.result.error = evt.message.errorMessage;
			recordProgressFromMessage(context.progress, evt.message);
		}
		fireChildProgressUpdate(context);
	}

	if (evt.type === "tool_result_end" && evt.message) {
		context.result.messages.push(evt.message);
		recordProgressFromMessage(context.progress, evt.message);
		fireChildProgressUpdate(context);
	}
}

/**
 * Create a stdout line processor for child JSONL events.
 *
 * @param context Shared parsing and progress state.
 * @returns Function that writes raw JSONL and parses structured events best-effort.
 */
function createLineProcessor(context: LineProcessorContext): (line: string) => void {
	return (line: string) => {
		if (!line.trim()) return;
		context.jsonlWriter.writeLine(line);
		try {
			processJsonMessageLine(JSON.parse(line) as { type?: string; message?: Message; toolName?: string; args?: unknown }, context);
		} catch {
			// Non-JSON stdout lines are expected; only structured events are parsed.
		}
	};
}

/**
 * Finalize result, progress, artifact metadata, truncation, and run history.
 *
 * @param result Mutable child result accumulated during execution.
 * @param progress Mutable progress object associated with the result.
 * @param exitCode Process exit code observed by the runner.
 * @param startTime Timestamp captured before spawn.
 * @param historyId Run-history identifier.
 * @param options Runtime options controlling artifacts and truncation.
 * @param artifactPathsResult Optional artifact paths prepared before spawn.
 * @returns Child result with lifecycle and completion metadata attached.
 */
function finalizeChildResult(
	result: SingleResult,
	progress: AgentProgress,
	exitCode: number,
	startTime: number,
	historyId: string,
	options: RunSyncOptions,
	artifactPathsResult: ArtifactPaths | undefined,
): ChildRunResult {
	result.exitCode = exitCode;

	if (exitCode === 0 && !result.error) {
		const errInfo = detectSubagentError(result.messages);
		if (errInfo.hasError) {
			result.exitCode = errInfo.exitCode ?? 1;
			result.error = errInfo.details
				? `${errInfo.errorType} failed (exit ${errInfo.exitCode}): ${errInfo.details}`
				: `${errInfo.errorType} failed with exit code ${errInfo.exitCode}`;
		}
	}

	progress.status = result.exitCode === 0 ? "completed" : "failed";
	progress.durationMs = Date.now() - startTime;
	if (result.error) {
		progress.error = result.error;
		if (progress.currentTool) {
			progress.failedTool = progress.currentTool;
		}
	}

	// Sync progress from the result object so downstream UI, history, and artifacts
	// share the same source of truth. Runtime events currently update `model`; thinking
	// remains initialized from the actual CLI launch argument unless future events refine it.
	progress.model = result.model;
	progress.thinking = result.thinking;
	result.progress = progress;
	result.progressSummary = {
		toolCount: progress.toolCount,
		durationMs: progress.durationMs,
	};

	const fullOutput = getFinalOutput(result.messages);
	result.finalOutput = fullOutput;

	if (artifactPathsResult && options.artifactConfig?.enabled !== false) {
		result.artifactPaths = artifactPathsResult;

		if (options.artifactConfig?.includeOutput !== false) {
			writeArtifact(artifactPathsResult.outputPath, fullOutput);
		}
		if (options.artifactConfig?.includeMetadata !== false) {
			writeMetadata(artifactPathsResult.metadataPath, {
				runId: options.runId,
				agent: result.agent,
				task: result.task,
				exitCode: result.exitCode,
				usage: result.usage,
				model: result.model,
				thinking: result.thinking,
				durationMs: progress.durationMs,
				toolCount: progress.toolCount,
				error: result.error,
				skills: result.skills,
				skillsWarning: result.skillsWarning,
				timestamp: Date.now(),
			});
		}

		if (options.maxOutput) {
			const config = { ...DEFAULT_MAX_OUTPUT, ...options.maxOutput };
			const truncationResult = truncateOutput(fullOutput, config, artifactPathsResult.outputPath);
			if (truncationResult.truncated) {
				result.truncation = truncationResult;
			}
		}
	} else if (options.maxOutput) {
		const config = { ...DEFAULT_MAX_OUTPUT, ...options.maxOutput };
		const truncationResult = truncateOutput(fullOutput, config);
		if (truncationResult.truncated) {
			result.truncation = truncationResult;
		}
	}

	globalRunHistory.updateRun(historyId, {
		duration: progress.durationMs,
		model: result.model,
		thinking: result.thinking,
		skills: result.skills,
		skillsWarning: result.skillsWarning,
		tokens: { total: result.usage.input + result.usage.output },
	});
	globalRunHistory.finishRun(historyId, result.exitCode === 0 ? "ok" : "error", result.error);

	return attachLifecycle(result, options);
}

/**
 * Run a prepared child subagent synchronously (blocking until complete).
 *
 * @param runtimeCwd Directory used to resolve runtime configuration and extensions.
 * @param agents Available agent configurations.
 * @param agentName Name of the child agent to launch.
 * @param task Prepared task text or packet reference for the child.
 * @param options Launch, session, artifact, and progress options.
 * @returns Aggregated child execution result with lifecycle metadata when available.
 */
export async function runPreparedChild(runtimeCwd: string, agents: AgentConfig[], agentName: string, task: string, options: RunSyncOptions): Promise<ChildRunResult> {
	const { cwd, signal, artifactsDir, artifactConfig, runId, index } = options;
	const agent = agents.find((a) => a.name === agentName);
	if (!agent) return createLaunchErrorResult(agentName, task, `Unknown agent: ${agentName}`);

	const launch = prepareChildLaunch(runtimeCwd, agentName, task, agent, options);
	if ("exitCode" in launch) return launch;
	const { args, sharedEnv, tempDir, result, progress, historyId, startTime } = launch;

	globalRunHistory.startRun(historyId, {
		agent: agentName,
		task,
		skills: result.skills,
		skillsWarning: result.skillsWarning,
		model: result.model,
		thinking: result.thinking,
	});

	let artifactPathsResult: ArtifactPaths | undefined;
	let jsonlPath: string | undefined;
	if (artifactsDir && artifactConfig?.enabled !== false) {
		artifactPathsResult = getArtifactPaths(artifactsDir, runId, agentName, index);
		ensureArtifactsDir(artifactsDir);
		if (artifactConfig?.includeInput !== false) {
			writeArtifact(artifactPathsResult.inputPath, `# Task for ${agentName}\n\n${task}`);
		}
		if (artifactConfig?.includeJsonl !== false) {
			jsonlPath = artifactPathsResult.jsonlPath;
		}
	}

	const spawnEnv = buildChildEnvironment(sharedEnv, agent, options);
	let closeJsonlWriter: (() => Promise<void>) | undefined;
	let exitCode = 1;
	try {
		exitCode = await new Promise<number>((resolve) => {
			const spawnSpec = getPiSpawnCommand(args);
			const proc = spawn(spawnSpec.command, spawnSpec.args, {
				cwd: cwd ?? runtimeCwd,
				env: spawnEnv,
				stdio: ["ignore", "pipe", "pipe"],
			});
			const jsonlWriter = createJsonlWriter(jsonlPath, proc.stdout);
			closeJsonlWriter = () => jsonlWriter.close();
			let buf = "";
			let stderrBuf = "";
			let processClosed = false;
			let settled = false;
			let killTimer: NodeJS.Timeout | undefined;
			let abortListener: (() => void) | undefined;
			const processLine = createLineProcessor({
				result,
				progress,
				startTime,
				historyId,
				onUpdate: options.onUpdate,
				processClosed: () => processClosed,
				jsonlWriter,
			});

			/**
			 * Detach per-process abort resources once the child process settles.
			 */
			const cleanupProcessListeners = () => {
				if (killTimer) {
					clearTimeout(killTimer);
					killTimer = undefined;
				}
				if (signal && abortListener) {
					signal.removeEventListener("abort", abortListener);
					abortListener = undefined;
				}
			};

			const finish = (code: number | null) => {
				if (settled) return;
				settled = true;
				processClosed = true;
				if (buf.trim()) processLine(buf);
				if (code !== 0 && stderrBuf.trim() && !result.error) {
					result.error = stderrBuf.trim();
				}
				cleanupProcessListeners();
				resolve(code ?? 0);
			};

			proc.stdout.on("data", (data: Buffer) => {
				buf += data.toString();
				const lines = buf.split("\n");
				buf = lines.pop() || "";
				lines.forEach(processLine);
			});
			proc.stderr.on("data", (data: Buffer) => {
				stderrBuf += data.toString();
			});
			proc.on("close", finish);
			proc.on("error", () => finish(1));

			if (signal) {
				abortListener = () => {
					proc.kill("SIGTERM");
					killTimer = setTimeout(() => !proc.killed && proc.kill("SIGKILL"), 3000);
				};
				if (signal.aborted) abortListener();
				else signal.addEventListener("abort", abortListener, { once: true });
			}
		});
	} finally {
		if (closeJsonlWriter) {
			try {
				await closeJsonlWriter();
			} catch {
				// JSONL artifact flush is best effort.
			}
		}

		cleanupTempDir(tempDir);
	}

	return finalizeChildResult(result, progress, exitCode, startTime, historyId, options, artifactPathsResult);
}
