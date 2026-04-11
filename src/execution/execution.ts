/**
 * Core execution logic for running subagents
 */

import { spawn } from "node:child_process";
import type { Message } from "@mariozechner/pi-ai";
import type { AgentConfig } from "../agents/agents.ts";
import {
	ensureArtifactsDir,
	getArtifactPaths,
	writeArtifact,
	writeMetadata,
} from "../shared/artifacts.ts";
import {
	type AgentProgress,
	type ArtifactPaths,
	type RunSyncOptions,
	type SingleResult,
	DEFAULT_MAX_OUTPUT,
	truncateOutput,
	getSubagentDepthEnv,
} from "../shared/types.ts";
import {
	getFinalOutput,
	detectSubagentError,
	extractToolArgsPreview,
	extractTextFromContent,
} from "../shared/utils.ts";
import { buildSkillInjection, resolveExecutionSkills } from "../shared/skills.ts";
import { getPiSpawnCommand } from "./pi-spawn.ts";
import { createJsonlWriter } from "./jsonl-writer.ts";
import { applyThinkingSuffix, buildPiArgs, cleanupTempDir } from "./pi-args.ts";
import { captureSingleOutputSnapshot, resolveSingleOutput } from "./single-output.ts";
import {
	inferExecutionRole,
	resolveModelForAgent,
	resolveRoleTools,
} from "./superpowers-policy.ts";

/**
 * Run a subagent synchronously (blocking until complete)
 */
export async function runSync(
	runtimeCwd: string,
	agents: AgentConfig[],
	agentName: string,
	task: string,
	options: RunSyncOptions,
): Promise<SingleResult> {
	const { cwd, signal, onUpdate, maxOutput, artifactsDir, artifactConfig, runId, index, modelOverride } = options;
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

	const shareEnabled = options.share === true;
	const sessionEnabled = Boolean(options.sessionFile) || shareEnabled;
	const workflow = options.workflow ?? "superpowers";
	const useTestDrivenDevelopment = options.useTestDrivenDevelopment ?? true;
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
	const outputSnapshot = captureSingleOutputSnapshot(options.outputPath);
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

	let systemPrompt = agent.systemPrompt?.trim() || "";
	if (resolvedSkills.length > 0) {
		const skillInjection = buildSkillInjection(resolvedSkills);
		systemPrompt = systemPrompt ? `${systemPrompt}\n\n${skillInjection}` : skillInjection;
	}

	const { args, env: sharedEnv, tempDir } = buildPiArgs({
		baseArgs: ["--mode", "json", "-p"],
		task,
		sessionEnabled,
		sessionFile: options.sessionFile,
		model: effectiveModel,
		thinking: effectiveThinking,
		tools: effectiveTools,
		extensions: agent.extensions,
		skills: skillNames,
		systemPrompt,
		mcpDirectTools: agent.mcpDirectTools,
		promptFileStem: agent.name,
	});

	const result: SingleResult = {
		agent: agentName,
		task,
		exitCode: 0,
		messages: [],
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
		model: modelArg,
		skills: resolvedSkills.length > 0 ? resolvedSkills.map((s) => s.name) : undefined,
		skillsWarning: missingSkills.length > 0 ? `Skills not found: ${missingSkills.join(", ")}` : undefined,
	};

	const progress: AgentProgress = {
		index: index ?? 0,
		agent: agentName,
		status: "running",
		task,
		skills: resolvedSkills.length > 0 ? resolvedSkills.map((s) => s.name) : undefined,
		recentTools: [],
		recentOutput: [],
		toolCount: 0,
		durationMs: 0,
	};
	result.progress = progress;

	const startTime = Date.now();

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

	const spawnEnv = { ...process.env, ...sharedEnv, ...getSubagentDepthEnv(options.maxSubagentDepth) };

	let closeJsonlWriter: (() => Promise<void>) | undefined;
	const exitCode = await new Promise<number>((resolve) => {
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

		const fireUpdate = () => {
			if (!onUpdate || processClosed) return;
			progress.durationMs = Date.now() - startTime;
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
						if (!result.model && evt.message.model) result.model = evt.message.model;
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

		proc.stdout.on("data", (d) => {
			buf += d.toString();
			const lines = buf.split("\n");
			buf = lines.pop() || "";
			lines.forEach(processLine);
		});
		proc.stderr.on("data", (d) => {
			stderrBuf += d.toString();
		});
		proc.on("close", (code) => {
			processClosed = true;
			if (buf.trim()) processLine(buf);
			if (code !== 0 && stderrBuf.trim() && !result.error) {
				result.error = stderrBuf.trim();
			}
			resolve(code ?? 0);
		});
		proc.on("error", () => resolve(1));

		if (signal) {
			const kill = () => {
				proc.kill("SIGTERM");
				setTimeout(() => !proc.killed && proc.kill("SIGKILL"), 3000);
			};
			if (signal.aborted) kill();
			else signal.addEventListener("abort", kill, { once: true });
		}
	});

	if (closeJsonlWriter) {
		try {
			await closeJsonlWriter();
		} catch {
			// JSONL artifact flush is best effort.
		}
	}

	cleanupTempDir(tempDir);
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

	let fullOutput = getFinalOutput(result.messages);
	if (options.outputPath && result.exitCode === 0) {
		const resolvedOutput = resolveSingleOutput(options.outputPath, fullOutput, outputSnapshot);
		fullOutput = resolvedOutput.fullOutput;
		result.savedOutputPath = resolvedOutput.savedPath;
		result.outputSaveError = resolvedOutput.saveError;
	}
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

	if (shareEnabled) {
		const sessionFile = options.sessionFile;
		if (sessionFile) {
			result.sessionFile = sessionFile;
			// HTML export disabled - module resolution issues with global pi installation
			// Users can still access the session file directly
		}
	}

	return result;
}
