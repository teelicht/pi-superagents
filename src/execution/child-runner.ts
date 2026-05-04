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
 */

import { spawn } from "node:child_process";
import type { Message } from "@mariozechner/pi-ai";
import type { AgentConfig } from "../agents/agents.ts";
import { ensureArtifactsDir, getArtifactPaths, writeArtifact, writeMetadata } from "../shared/artifacts.ts";
import { buildSkillInjection, getPublishedExecutionSkills, resolveExecutionSkills } from "../shared/skills.ts";
import { type AgentProgress, type ArtifactPaths, type ChildRunResult, DEFAULT_MAX_OUTPUT, getSubagentDepthEnv, type RunSyncOptions, type SingleResult, truncateOutput } from "../shared/types.ts";
import { detectSubagentError, extractTextFromContent, extractToolArgsPreview, getFinalOutput } from "../shared/utils.ts";
import { createJsonlWriter } from "./jsonl-writer.ts";
import { applyThinkingSuffix, buildPiArgs, cleanupTempDir } from "./pi-args.ts";
import { getPiSpawnCommand } from "./pi-spawn.ts";
import { globalRunHistory } from "./run-history.ts";
import { findMissingSubagentExtensionPath, resolveSubagentExtensions } from "./superagents-config.ts";
import { inferExecutionRole, resolveModelForAgent, resolveRoleTools } from "./superpowers-policy.ts";
import { consumeLifecycleSignal } from "./lifecycle-signals.ts";

/**
 * Attach lifecycle sidecar result to a SingleResult when available.
 *
 * Only attaches when the lifecycle status is not "missing" (e.g., consumed,
 * malformed, unreadable, or stale diagnostics). Missing sidecars leave the
 * original result unchanged.
 */
function attachLifecycle(result: SingleResult, options: RunSyncOptions): ChildRunResult {
	const sessionFile = result.sessionFile ?? options.sessionFile;
	const lifecycle = consumeLifecycleSignal(sessionFile);
	if (lifecycle.status !== "missing") {
		result.lifecycle = lifecycle;
	}
	return result;
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
	const { cwd, signal, onUpdate, maxOutput, artifactsDir, artifactConfig, runId, index, modelOverride, sessionMode, taskFilePath } = options;
	const agent = agents.find((a) => a.name === agentName);
	if (!agent) {
		return {
			agent: agentName,
			task,
			exitCode: 1,
			messages: [],
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
			error: `Unknown agent: ${agentName}`,
		};
	}

	const sessionEnabled = Boolean(options.sessionFile);
	const workflow = options.workflow ?? "superpowers";
	const useTestDrivenDevelopment = options.useTestDrivenDevelopment ?? false;
	const config = options.config ?? {};
	const role = inferExecutionRole(agent.name);
	const tierModel = resolveModelForAgent({
		workflow,
		agentModel: agent.model,
		config,
	});
	const effectiveModel = modelOverride ?? tierModel?.model ?? agent.model;
	const effectiveThinking = agent.thinking ?? (modelOverride ? undefined : tierModel?.thinking);
	const modelArg = applyThinkingSuffix(effectiveModel, effectiveThinking);
	const effectiveTools = resolveRoleTools({
		workflow,
		role,
		agentTools: agent.tools,
	});
	const configuredSkills = options.skills !== undefined ? options.skills : (agent.skills ?? []);
	const { skillNames, resolvedSkills, missingSkills } = resolveExecutionSkills({
		cwd: runtimeCwd,
		workflow,
		role,
		config,
		useTestDrivenDevelopment,
		skills: configuredSkills,
	});
	const resolvedSkillNames = getPublishedExecutionSkills(resolvedSkills);
	const skillsWarning = missingSkills.length > 0 ? `Skills not found: ${missingSkills.join(", ")}` : undefined;

	let systemPrompt = agent.systemPrompt?.trim() || "";
	if (resolvedSkills.length > 0) {
		const skillInjection = buildSkillInjection(resolvedSkills);
		systemPrompt = systemPrompt ? `${systemPrompt}\n\n${skillInjection}` : skillInjection;
	}

	const missingExtension = findMissingSubagentExtensionPath(runtimeCwd, config.superagents?.extensions, agent.extensions);
	if (missingExtension) {
		return {
			agent: agentName,
			task,
			exitCode: 1,
			messages: [],
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
			error: `Extension path from ${missingExtension.source} does not exist: ${missingExtension.configuredPath} (resolved to ${missingExtension.resolvedPath})`,
		};
	}

	const effectiveExtensions = resolveSubagentExtensions(config, agent.extensions);

	const {
		args,
		env: sharedEnv,
		tempDir,
	} = buildPiArgs({
		baseArgs: ["--mode", "json", "-p"],
		task,
		sessionEnabled,
		sessionFile: options.sessionFile,
		model: effectiveModel,
		thinking: effectiveThinking,
		tools: effectiveTools,
		extensions: effectiveExtensions,
		skills: skillNames,
		systemPrompt,
		mcpDirectTools: agent.mcpDirectTools,
		promptFileStem: agent.name,
		taskFilePath,
	});

	const result: SingleResult = {
		agent: agentName,
		task,
		exitCode: 0,
		messages: [],
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
		model: modelArg,
		skills: resolvedSkillNames,
		skillsWarning,
		sessionMode,
		sessionFile: options.sessionFile,
	};

	const progress: AgentProgress = {
		index: index ?? 0,
		agent: agentName,
		status: "running",
		task,
		skills: resolvedSkillNames,
		recentTools: [],
		recentOutput: [],
		toolCount: 0,
		durationMs: 0,
	};
	result.progress = progress;

	const startTime = Date.now();
	const historyId = options.runId ? `${options.runId}-${agentName}-${index ?? 0}` : `run-${Date.now()}-${agentName}`;
	globalRunHistory.startRun(historyId, { agent: agentName, task, skills: resolvedSkillNames, skillsWarning });

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

	const lifecycleEnv = options.sessionFile
		? {
				PI_SUBAGENT_SESSION: options.sessionFile,
				PI_SUBAGENT_NAME: agent.name,
				PI_SUBAGENT_AGENT: agent.name,
				PI_SUBAGENT_AUTO_EXIT: "0",
			}
		: {};
	const spawnEnv = { ...process.env, ...sharedEnv, ...lifecycleEnv, ...getSubagentDepthEnv(options.maxSubagentDepth) };

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

			let processClosed = false;
			let settled = false;
			let killTimer: NodeJS.Timeout | undefined;
			let abortListener: (() => void) | undefined;

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

			const fireUpdate = () => {
				if (!onUpdate || processClosed) return;
				progress.durationMs = Date.now() - startTime;

				globalRunHistory.updateRun(historyId, {
					duration: progress.durationMs,
					model: result.model,
					skills: result.skills,
					skillsWarning: result.skillsWarning,
					tokens: { total: result.usage.input + result.usage.output },
				});

				onUpdate({
					content: [{ type: "text", text: getFinalOutput(result.messages) || "(running...)" }],
					details: { mode: "single", results: [result], progress: [progress] },
				});
			};

			const processLine = (line: string) => {
				if (!line.trim()) return;
				jsonlWriter.writeLine(line);
				try {
					const evt = JSON.parse(line) as { type?: string; message?: Message; toolName?: string; args?: unknown };
					const now = Date.now();
					progress.durationMs = now - startTime;

					if (evt.type === "tool_execution_start") {
						progress.toolCount++;
						progress.currentTool = evt.toolName;
						progress.currentToolArgs = extractToolArgsPreview((evt.args || {}) as Record<string, unknown>);
						fireUpdate();
					}

					if (evt.type === "tool_execution_end") {
						if (progress.currentTool) {
							progress.recentTools.push({
								tool: progress.currentTool,
								args: progress.currentToolArgs || "",
								endMs: now,
							});
						}
						progress.currentTool = undefined;
						progress.currentToolArgs = undefined;
						fireUpdate();
					}

					if (evt.type === "message_end" && evt.message) {
						result.messages.push(evt.message);
						if (evt.message.role === "assistant") {
							result.usage.turns++;
							const u = evt.message.usage;
							if (u) {
								result.usage.input += u.input || 0;
								result.usage.output += u.output || 0;
								result.usage.cacheRead += u.cacheRead || 0;
								result.usage.cacheWrite += u.cacheWrite || 0;
								result.usage.cost += u.cost?.total || 0;
							}
							if (evt.message.model && !evt.message.errorMessage) result.model = evt.message.model;
							if (evt.message.errorMessage) result.error = evt.message.errorMessage;

							const text = extractTextFromContent(evt.message.content);
							if (text) {
								const lines = text
									.split("\n")
									.filter((l) => l.trim())
									.slice(-10);
								// Append to existing recentOutput (keep last 50 total) - mutate in place for efficiency
								progress.recentOutput.push(...lines);
								if (progress.recentOutput.length > 50) {
									progress.recentOutput.splice(0, progress.recentOutput.length - 50);
								}
							}
						}
						fireUpdate();
					}
					if (evt.type === "tool_result_end" && evt.message) {
						result.messages.push(evt.message);
						// Also capture tool result text in recentOutput for streaming display
						const toolText = extractTextFromContent(evt.message.content);
						if (toolText) {
							const toolLines = toolText
								.split("\n")
								.filter((l) => l.trim())
								.slice(-10);
							// Append to existing recentOutput (keep last 50 total) - mutate in place for efficiency
							progress.recentOutput.push(...toolLines);
							if (progress.recentOutput.length > 50) {
								progress.recentOutput.splice(0, progress.recentOutput.length - 50);
							}
						}
						fireUpdate();
					}
				} catch {
					// Non-JSON stdout lines are expected; only structured events are parsed.
				}
			};

			let stderrBuf = "";

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

			proc.stdout.on("data", (d: Buffer) => {
				buf += d.toString();
				const lines = buf.split("\n");
				buf = lines.pop() || "";
				lines.forEach(processLine);
			});
			proc.stderr.on("data", (d: Buffer) => {
				stderrBuf += d.toString();
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

	result.progress = progress;
	result.progressSummary = {
		toolCount: progress.toolCount,
		durationMs: progress.durationMs,
	};

	const fullOutput = getFinalOutput(result.messages);
	result.finalOutput = fullOutput;

	if (artifactPathsResult && artifactConfig?.enabled !== false) {
		result.artifactPaths = artifactPathsResult;

		if (artifactConfig?.includeOutput !== false) {
			writeArtifact(artifactPathsResult.outputPath, fullOutput);
		}
		if (artifactConfig?.includeMetadata !== false) {
			writeMetadata(artifactPathsResult.metadataPath, {
				runId,
				agent: agentName,
				task,
				exitCode: result.exitCode,
				usage: result.usage,
				model: result.model,
				durationMs: progress.durationMs,
				toolCount: progress.toolCount,
				error: result.error,
				skills: result.skills,
				skillsWarning: result.skillsWarning,
				timestamp: Date.now(),
			});
		}

		if (maxOutput) {
			const config = { ...DEFAULT_MAX_OUTPUT, ...maxOutput };
			const truncationResult = truncateOutput(fullOutput, config, artifactPathsResult.outputPath);
			if (truncationResult.truncated) {
				result.truncation = truncationResult;
			}
		}
	} else if (maxOutput) {
		const config = { ...DEFAULT_MAX_OUTPUT, ...maxOutput };
		const truncationResult = truncateOutput(fullOutput, config);
		if (truncationResult.truncated) {
			result.truncation = truncationResult;
		}
	}

	globalRunHistory.updateRun(historyId, {
		duration: progress.durationMs,
		model: result.model,
		skills: result.skills,
		skillsWarning: result.skillsWarning,
		tokens: { total: result.usage.input + result.usage.output },
	});
	globalRunHistory.finishRun(historyId, result.exitCode === 0 ? "ok" : "error", result.error);

	// Attach lifecycle sidecar for completed subprocess runs (not for pre-spawn validation errors)
	return attachLifecycle(result, options);
}

/**
 * Compatibility alias for runPreparedChild.
 * @deprecated Use runPreparedChild directly.
 */
export const runSync = runPreparedChild;
