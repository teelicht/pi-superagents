/**
 * Request validation and execution orchestration for subagent runs.
 *
 * Responsibilities:
 * - normalize slash/tool parameters into concrete execution modes
 * - route single, parallel, and chain execution requests
 * - thread shared execution metadata into lower-level runners
 */

import { randomUUID } from "node:crypto";
// import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AgentConfig, AgentScope } from "../agents/agents.ts";
import { ensureArtifactsDir, getArtifactsDir, getPacketPath, removeArtifactFile, writeArtifact } from "../shared/artifacts.ts";
import { getPublishedExecutionSkills, normalizeSkillInput, resolveExecutionSkills } from "../shared/skills.ts";
import {
	type AgentProgress,
	type ArtifactConfig,
	type ArtifactPaths,
	checkSubagentDepth,
	DEFAULT_ARTIFACT_CONFIG,
	type Details,
	type ExecutionRole,
	type ExtensionConfig,
	MAX_CONCURRENCY,
	MAX_PARALLEL,
	type MaxOutputConfig,
	resolveChildMaxSubagentDepth,
	resolveCurrentMaxSubagentDepth,
	type SingleResult,
	type SubagentState,
	type SessionMode,
	type TaskDeliveryMode,
	type WorkflowMode,
	wrapForkTask,
} from "../shared/types.ts";
import { getSingleResultOutput, mapConcurrent } from "../shared/utils.ts";
import { runSync } from "./execution.ts";
import { aggregateParallelOutputs } from "./parallel-utils.ts";
import {
	createSessionLaunchResolver,
	resolveRequestedSessionMode,
	resolveTaskDeliveryMode,
	type SessionLaunchManager,
} from "./session-mode.ts";
import { resolveStepBehavior } from "./settings.ts";
import { resolveSuperagentWorktreeCreateOptions, resolveSuperagentWorktreeEnabled } from "./superagents-config.ts";
import { buildSuperpowersPacketContent, buildSuperpowersPacketPlan, injectSuperpowersPacketInstructions } from "./superpowers-packets.ts";
import {
	cleanupWorktrees,
	createWorktrees,
	diffWorktrees,
	findWorktreeTaskCwdConflict,
	formatWorktreeDiffSummary,
	formatWorktreeTaskCwdConflict,
	type WorktreeSetup,
} from "./worktree.ts";

interface TaskParam {
	agent: string;
	task: string;
	cwd?: string;
	model?: string;
	skill?: string | string[] | boolean;
}

export interface SubagentParamsLike {
	agent?: string;
	task?: string;
	tasks?: TaskParam[];
	workflow?: WorkflowMode;
	useTestDrivenDevelopment?: boolean;
	worktree?: boolean;
	sessionMode?: SessionMode;
	context?: "fresh" | "fork";
	cwd?: string;
	maxOutput?: MaxOutputConfig;
	artifacts?: boolean;
	includeProgress?: boolean;
	model?: string;
	skill?: string | string[] | boolean;
}

interface ExecutorDeps {
	pi: ExtensionAPI;
	state: SubagentState;
	/** Config accessor - supports both legacy config object and new getConfig() getter */
	config?: ExtensionConfig;
	getConfig?: () => ExtensionConfig;
	tempArtifactsDir: string;
	getSubagentSessionRoot: (parentSessionFile: string | null) => string;
	expandTilde: (p: string) => string;
	discoverAgents: (cwd: string, scope: AgentScope) => { agents: AgentConfig[] };
}

interface ExecutionContextData {
	params: SubagentParamsLike;
	ctx: ExtensionContext;
	signal: AbortSignal;
	onUpdate?: (r: AgentToolResult<Details>) => void;
	agents: AgentConfig[];
	runId: string;
	sessionFileForIndex: (input: { index?: number; childCwd: string; sessionMode: SessionMode }) => string | undefined;
	artifactConfig: ArtifactConfig;
	artifactsDir: string;
	workflow: WorkflowMode;
	useTestDrivenDevelopment: boolean;
	detailsSessionMode: SessionMode;
}

/**
 * Resolve the effective session mode for one child agent launch.
 *
 * @param params Tool or slash-command request parameters.
 * @param agentConfig Target agent configuration for the child.
 * @returns Effective session mode after applying caller precedence rules.
 */
function resolveAgentSessionMode(params: SubagentParamsLike, agentConfig: AgentConfig): SessionMode {
	return resolveRequestedSessionMode({
		sessionMode: params.sessionMode,
		context: params.context,
		agentSessionMode: agentConfig.sessionMode,
		defaultSessionMode: "standalone",
	});
}

/**
 * Derive the executor-level fork badge mode for the aggregate result.
 *
 * @param sessionModes Effective session modes for the children participating in this run.
 * @returns `fork` only when every child inherited the parent session branch.
 */
function resolveDetailsSessionMode(sessionModes: SessionMode[]): SessionMode {
	return sessionModes.length > 0 && sessionModes.every((mode) => mode === sessionModes[0])
		? sessionModes[0]
		: "standalone";
}

/**
 * Attach the effective session mode to one child result.
 *
 * @param result Child execution result from the lower-level runner.
 * @param sessionMode Effective session mode used for that child.
 * @returns Result annotated with explicit session-mode metadata.
 */
function withSingleResultSessionMode(result: SingleResult, sessionMode: SessionMode): SingleResult {
	return { ...result, sessionMode };
}

/**
 * Attach explicit session-mode metadata to a tool result while preserving the
 * deprecated `details.context` fork indicator for compatibility.
 *
 * @param result Tool result emitted by the executor.
 * @param sessionMode Effective session mode for the overall response.
 * @returns Tool result with explicit session-mode details.
 */
function withSessionModeDetails(
	result: AgentToolResult<Details>,
	sessionMode: SessionMode,
): AgentToolResult<Details> {
	if (!result.details) return result;
	const { context: _context, ...detailsWithoutContext } = result.details;
	return {
		...result,
		details:
			sessionMode === "fork"
				? { ...detailsWithoutContext, sessionMode, context: "fork" }
				: { ...detailsWithoutContext, sessionMode },
	};
}

/**
 * Attach session-mode metadata to child results emitted during progress updates.
 *
 * @param result Progress update from the lower-level runner.
 * @param sessionMode Effective session mode for the child result(s).
 * @returns Progress update with annotated child results.
 */
function withProgressResultSessionMode(
	result: AgentToolResult<Details>,
	sessionMode: SessionMode,
): AgentToolResult<Details> {
	if (!result.details?.results) return result;
	return {
		...result,
		details: {
			...result.details,
			results: result.details.results.map((childResult) => withSingleResultSessionMode(childResult, sessionMode)),
		},
	};
}

function validateExecutionInput(
	params: SubagentParamsLike,
	agents: AgentConfig[],
	hasTasks: boolean,
	hasSingle: boolean,
): AgentToolResult<Details> | null {
	if (Number(hasTasks) + Number(hasSingle) !== 1) {
		return withSessionModeDetails(
			{
				content: [
					{
						type: "text",
						text: `Provide exactly one mode. Agents: ${agents.map((a) => a.name).join(", ") || "none"}`,
					},
				],
				details: { mode: "single" as const, results: [] },
			},
			resolveRequestedSessionMode({
				sessionMode: params.sessionMode,
				context: params.context,
				defaultSessionMode: "standalone",
			}),
		);
	}

	return null;
}

function getRequestedModeLabel(params: SubagentParamsLike): Details["mode"] {
	if ((params.tasks?.length ?? 0) > 0) return "parallel";
	if (params.agent && params.task) return "single";
	return "single";
}

function _buildRequestedModeError(params: SubagentParamsLike, message: string): AgentToolResult<Details> {
	return withSessionModeDetails(
		{
			content: [{ type: "text", text: message }],
			details: { mode: getRequestedModeLabel(params), results: [] },
		},
		resolveRequestedSessionMode({
			sessionMode: params.sessionMode,
			context: params.context,
			defaultSessionMode: "standalone",
		}),
	);
}

function toExecutionErrorResult(params: SubagentParamsLike, error: unknown): AgentToolResult<Details> {
	const message = error instanceof Error ? error.message : String(error);
	return withSessionModeDetails(
		{
			content: [{ type: "text", text: message }],
			details: { mode: getRequestedModeLabel(params), results: [] },
		},
		resolveRequestedSessionMode({
			sessionMode: params.sessionMode,
			context: params.context,
			defaultSessionMode: "standalone",
		}),
	);
}

interface ForegroundParallelRunInput {
	tasks: TaskParam[];
	taskTexts: string[];
	agents: AgentConfig[];
	ctx: ExtensionContext;
	signal: AbortSignal;
	runId: string;
	sessionFileForIndex: (input: { index?: number; childCwd: string; sessionMode: SessionMode }) => string | undefined;
	artifactConfig: ArtifactConfig;
	artifactsDir: string;
	maxOutput?: MaxOutputConfig;
	paramsCwd?: string;
	maxSubagentDepths: number[];
	modelOverrides: (string | undefined)[];
	skillOverrides: (string[] | false | undefined)[];
	sessionModes: SessionMode[];
	behaviors: Array<ReturnType<typeof resolveStepBehavior>>;
	liveResults: (SingleResult | undefined)[];
	liveProgress: (AgentProgress | undefined)[];
	onUpdate?: (r: AgentToolResult<Details>) => void;
	worktreeSetup?: WorktreeSetup;
	config: ExtensionConfig;
	workflow: WorkflowMode;
	useTestDrivenDevelopment: boolean;
}

interface PreparedLaunch {
	sessionMode: SessionMode;
	taskDelivery: TaskDeliveryMode;
	sessionFile?: string;
	taskText: string;
	taskFilePath?: string;
	packetFile?: string;
	cleanup(): void;
}

function prepareLaunch(input: {
	agentConfig: AgentConfig;
	rawTask: string;
	sessionMode: SessionMode;
	artifactsDir: string;
	runId: string;
	index: number;
	sessionFile: string | undefined;
	useTestDrivenDevelopment: boolean;
}): PreparedLaunch {
	const taskDelivery = resolveTaskDeliveryMode(input.sessionMode);
	
	if (input.sessionMode === "fork") {
		return {
			sessionMode: input.sessionMode,
			taskDelivery,
			sessionFile: input.sessionFile,
			taskText: wrapForkTask(input.rawTask),
			cleanup() {},
		};
	}

	const packetFile = getPacketPath(input.artifactsDir, input.runId, input.agentConfig.name, input.index);
	ensureArtifactsDir(path.dirname(packetFile));
	writeArtifact(
		packetFile,
		buildSuperpowersPacketContent({
			agent: input.agentConfig.name,
			sessionMode: input.sessionMode,
			task: input.rawTask,
			useTestDrivenDevelopment: input.useTestDrivenDevelopment,
		}),
	);
	
	return {
		sessionMode: input.sessionMode,
		taskDelivery,
		sessionFile: input.sessionFile,
		taskText: input.rawTask,
		taskFilePath: packetFile,
		packetFile,
		cleanup() {
			removeArtifactFile(packetFile);
		},
	};
}

function buildParallelModeError(message: string): AgentToolResult<Details> {
	return {
		content: [{ type: "text", text: message }],
		details: { mode: "parallel" as const, results: [] },
	};
}

/**
 * Creates git worktrees for a parallel run when the caller enables worktree
 * isolation, while scoping any configured Superpowers root override to the
 * explicit Superpowers workflow only.
 *
 * @param enabled Whether parallel worktree isolation is enabled for the run.
 * @param cwd Shared working directory for the parallel tasks.
 * @param runId Unique identifier for the current run.
 * @param tasks Parallel task definitions used to label worktrees.
 * @param workflow Execution workflow metadata for the current run.
 * @param config Extension configuration, including optional Superpowers settings.
 * @returns A created worktree setup or an error result suitable for the caller.
 */
function createParallelWorktreeSetup(
	enabled: boolean | undefined,
	cwd: string,
	runId: string,
	tasks: TaskParam[],
	workflow: WorkflowMode,
	config: ExtensionConfig,
): { setup?: WorktreeSetup; errorResult?: AgentToolResult<Details> } {
	if (!enabled) return {};
	try {
		return {
			setup: createWorktrees(cwd, runId, tasks.length, {
				...resolveSuperagentWorktreeCreateOptions({
					workflow,
					config,
					agents: tasks.map((task) => task.agent),
				}),
			}),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { errorResult: buildParallelModeError(message) };
	}
}

function buildParallelWorktreeTaskCwdError(
	tasks: ReadonlyArray<{ agent: string; cwd?: string }>,
	sharedCwd: string,
): string | undefined {
	const conflict = findWorktreeTaskCwdConflict(tasks, sharedCwd);
	if (!conflict) return undefined;
	return formatWorktreeTaskCwdConflict(conflict, sharedCwd);
}

function resolveParallelTaskCwd(
	task: TaskParam,
	paramsCwd: string | undefined,
	worktreeSetup: WorktreeSetup | undefined,
	index: number,
): string | undefined {
	if (worktreeSetup) return worktreeSetup.worktrees[index].agentCwd;
	return task.cwd ?? paramsCwd;
}

/**
 * Resolve the cwd used for child-scoped runtime concerns such as skill lookup.
 *
 * @param task Parallel task configuration.
 * @param paramsCwd Shared cwd override supplied to the parallel run.
 * @param worktreeSetup Optional worktree mapping for isolated parallel runs.
 * @param index Parallel task index.
 * @param fallbackCwd Parent execution cwd when the child does not override it.
 * @returns Effective runtime cwd for the child task.
 */
function resolveParallelTaskRuntimeCwd(
	task: TaskParam,
	paramsCwd: string | undefined,
	worktreeSetup: WorktreeSetup | undefined,
	index: number,
	fallbackCwd: string,
): string {
	return resolveParallelTaskCwd(task, paramsCwd, worktreeSetup, index) ?? fallbackCwd;
}

function buildParallelWorktreeSuffix(
	worktreeSetup: WorktreeSetup | undefined,
	artifactsDir: string,
	tasks: TaskParam[],
): string {
	if (!worktreeSetup) return "";
	const diffsDir = path.join(artifactsDir, "worktree-diffs");
	const diffs = diffWorktrees(
		worktreeSetup,
		tasks.map((task) => task.agent),
		diffsDir,
	);
	return formatWorktreeDiffSummary(diffs);
}

async function runForegroundParallelTasks(input: ForegroundParallelRunInput): Promise<SingleResult[]> {
	return mapConcurrent(input.tasks, MAX_CONCURRENCY, async (task, index) => {
		const overrideSkills = input.skillOverrides[index];
		const effectiveSkills = overrideSkills === undefined ? input.behaviors[index]?.skills : overrideSkills;
		const taskCwd = resolveParallelTaskCwd(task, input.paramsCwd, input.worktreeSetup, index);
		const taskRuntimeCwd = resolveParallelTaskRuntimeCwd(
			task,
			input.paramsCwd,
			input.worktreeSetup,
			index,
			input.ctx.cwd,
		);
		const prepared = prepareLaunch({
			agentConfig: input.agents.find((a) => a.name === task.agent)!,
			rawTask: input.taskTexts[index],
			sessionMode: input.sessionModes[index],
			artifactsDir: input.artifactsDir,
			runId: input.runId,
			index,
			sessionFile: input.sessionFileForIndex({
				index,
				childCwd: taskRuntimeCwd,
				sessionMode: input.sessionModes[index],
			}),
			useTestDrivenDevelopment: input.useTestDrivenDevelopment,
		});

		let childResult: SingleResult;
		try {
			childResult = await runSync(taskRuntimeCwd, input.agents, task.agent, prepared.taskText, {
				cwd: taskCwd,
				signal: input.signal,
				runId: input.runId,
				index,
				sessionFile: prepared.sessionFile,
				sessionMode: prepared.sessionMode,
				taskDelivery: prepared.taskDelivery,
				taskFilePath: prepared.taskFilePath,
				artifactsDir: input.artifactConfig.enabled ? input.artifactsDir : undefined,
				artifactConfig: input.artifactConfig,
				maxOutput: input.maxOutput,
				maxSubagentDepth: input.maxSubagentDepths[index],
				modelOverride: input.modelOverrides[index],
				skills: effectiveSkills,
				config: input.config,
				workflow: input.workflow,
				useTestDrivenDevelopment: input.useTestDrivenDevelopment,
				onUpdate: input.onUpdate
					? (progressUpdate) => {
							const stepResults =
								withProgressResultSessionMode(progressUpdate, input.sessionModes[index]).details?.results || [];
							const stepProgress = progressUpdate.details?.progress || [];
							if (stepResults.length > 0) input.liveResults[index] = stepResults[0];
							if (stepProgress.length > 0) input.liveProgress[index] = stepProgress[0];
							const mergedResults = input.liveResults.filter((result): result is SingleResult => result !== undefined);
							const mergedProgress = input.liveProgress.filter(
								(progress): progress is AgentProgress => progress !== undefined,
							);
							input.onUpdate?.({
								content: progressUpdate.content,
								details: {
									mode: "parallel",
									results: mergedResults,
									progress: mergedProgress,
								},
							});
					  }
					: undefined,
			});
		} finally {
			prepared.cleanup();
		}
		return withSingleResultSessionMode(childResult, input.sessionModes[index]);
	});
}

async function runParallelPath(data: ExecutionContextData, deps: ExecutorDeps): Promise<AgentToolResult<Details>> {
	const {
		params,
		agents,
		ctx,
		signal,
		runId,
		sessionFileForIndex,
		artifactConfig,
		artifactsDir,
		onUpdate,
		workflow,
		useTestDrivenDevelopment,
		detailsSessionMode,
	} = data;
	const config = deps.getConfig?.() ?? deps.config!;
	const allProgress: AgentProgress[] = [];
	const allArtifactPaths: ArtifactPaths[] = [];
	const tasks = params.tasks!;

	if (tasks.length > MAX_PARALLEL)
		return {
			content: [{ type: "text", text: `Max ${MAX_PARALLEL} tasks` }],
			details: { mode: "parallel" as const, results: [] },
		};

	const agentConfigs: AgentConfig[] = [];
	for (const t of tasks) {
		const config = agents.find((a) => a.name === t.agent);
		if (!config) {
			return {
				content: [{ type: "text", text: `Unknown agent: ${t.agent}` }],
				details: { mode: "parallel" as const, results: [] },
			};
		}
		agentConfigs.push(config);
	}

	const currentMaxSubagentDepth = resolveCurrentMaxSubagentDepth(config.maxSubagentDepth);
	const maxSubagentDepths = agentConfigs.map((config) =>
		resolveChildMaxSubagentDepth(currentMaxSubagentDepth, config.maxSubagentDepth),
	);
	const effectiveWorktree = resolveSuperagentWorktreeEnabled(params.worktree, workflow, config);

	const effectiveCwd = params.cwd ?? ctx.cwd;
	if (effectiveWorktree) {
		const worktreeTaskCwdError = buildParallelWorktreeTaskCwdError(tasks, effectiveCwd);
		if (worktreeTaskCwdError) return buildParallelModeError(worktreeTaskCwdError);
	}

	const modelOverrides: (string | undefined)[] = tasks.map((t) => t.model);
	const skillOverrides: (string[] | false | undefined)[] = tasks.map((t) => normalizeSkillInput(t.skill));

	const behaviors = agentConfigs.map((config, i) => {
		const t = tasks[i];
		const skillOverride = normalizeSkillInput(t.skill);
		const packetDefaults = buildSuperpowersPacketPlan(config.name as ExecutionRole);
		return resolveStepBehavior(
			config,
			{
				reads: undefined,
				progress: undefined,
				skills: skillOverride,
				model: t.model,
			},
			packetDefaults,
		);
	});
	const sessionModes = agentConfigs.map((config) => resolveAgentSessionMode(params, config));
	const taskTexts = tasks.map((t, i) => injectSuperpowersPacketInstructions(t.task, behaviors[i]));
	const liveResults: (SingleResult | undefined)[] = Array(tasks.length).fill(undefined) as (SingleResult | undefined)[];
	const { setup: worktreeSetup, errorResult } = createParallelWorktreeSetup(
		effectiveWorktree,
		effectiveCwd,
		runId,
		tasks,
		workflow,
		config,
	);
	if (errorResult) return errorResult;

	try {
		const pendingProgress = tasks.map((task, index): AgentProgress => {
			const configuredSkills = skillOverrides[index] === undefined ? behaviors[index]?.skills : skillOverrides[index];
			const taskRuntimeCwd = resolveParallelTaskRuntimeCwd(task, params.cwd, worktreeSetup, index, ctx.cwd);
			const effectiveSkills = resolveExecutionSkills({
				cwd: taskRuntimeCwd,
				workflow,
				role: agentConfigs[index].name as ExecutionRole,
				config,
				useTestDrivenDevelopment,
				skills: configuredSkills,
			});
			return {
				index,
				agent: task.agent,
				status: "pending",
				task: taskTexts[index],
				skills: getPublishedExecutionSkills(effectiveSkills.resolvedSkills),
				recentTools: [],
				recentOutput: [],
				toolCount: 0,
				durationMs: 0,
			};
		});
		const liveProgress: (AgentProgress | undefined)[] = pendingProgress.map((progress) => ({ ...progress }));

		const results = await runForegroundParallelTasks({
			tasks,
			taskTexts,
			agents,
			ctx,
			signal,
			runId,
			sessionFileForIndex,
			artifactConfig,
			artifactsDir,
			maxOutput: params.maxOutput,
			paramsCwd: params.cwd,
			modelOverrides,
			skillOverrides,
			sessionModes,
			behaviors,
			maxSubagentDepths,
			liveResults,
			liveProgress,
			onUpdate,
			worktreeSetup,
			config: config,
			workflow,
			useTestDrivenDevelopment,
		});
		for (const result of results) {
			if (result.progress) allProgress.push(result.progress);
			if (result.artifactPaths) allArtifactPaths.push(result.artifactPaths);
		}

		// Ensure every task has a progress entry so the renderer can show pending rows
		for (let i = 0; i < tasks.length; i++) {
			if (!allProgress.some((p) => p.index === i)) {
				allProgress.push({ ...pendingProgress[i] });
			}
		}
		allProgress.sort((a, b) => a.index - b.index);

		const worktreeSuffix = buildParallelWorktreeSuffix(worktreeSetup, artifactsDir, tasks);
		const ok = results.filter((result) => result.exitCode === 0).length;
		const aggregatedOutput = aggregateParallelOutputs(
			results.map((result) => ({
				agent: result.agent,
				output: result.truncation?.text || getSingleResultOutput(result),
				exitCode: result.exitCode,
				error: result.error,
			})),
			(i, agent) => `=== Task ${i + 1}: ${agent} ===`,
		);

		const summary = `${ok}/${results.length} succeeded`;
		const fullContent = worktreeSuffix
			? `${summary}\n\n${aggregatedOutput}\n\n${worktreeSuffix}`
			: `${summary}\n\n${aggregatedOutput}`;

		return {
			content: [{ type: "text", text: fullContent }],
			details: {
				mode: "parallel",
				results,
				progress: allProgress,
				artifacts: allArtifactPaths.length ? { dir: artifactsDir, files: allArtifactPaths } : undefined,
			},
		};
	} finally {
		if (worktreeSetup) cleanupWorktrees(worktreeSetup);
	}
}

async function runSinglePath(data: ExecutionContextData, deps: ExecutorDeps): Promise<AgentToolResult<Details>> {
	const {
		params,
		agents,
		ctx,
		signal,
		runId,
		sessionFileForIndex,
		artifactConfig,
		artifactsDir,
		onUpdate,
		workflow,
		useTestDrivenDevelopment,
	} = data;
	const config = deps.getConfig?.() ?? deps.config!;
	const allProgress: AgentProgress[] = [];
	const allArtifactPaths: ArtifactPaths[] = [];
	const agentConfig = agents.find((a) => a.name === params.agent);
	if (!agentConfig) {
		return {
			content: [{ type: "text", text: `Unknown agent: ${params.agent}` }],
			details: { mode: "single", results: [] },
		};
	}

	let task = params.task!;
	const sessionMode = resolveAgentSessionMode(params, agentConfig);
	const modelOverride: string | undefined = params.model;
	const skillOverride: string[] | false | undefined = normalizeSkillInput(params.skill);
	const currentMaxSubagentDepth = resolveCurrentMaxSubagentDepth(config.maxSubagentDepth);
	const maxSubagentDepth = resolveChildMaxSubagentDepth(currentMaxSubagentDepth, agentConfig.maxSubagentDepth);

	const packetDefaults = buildSuperpowersPacketPlan(agentConfig.name as ExecutionRole);
	const behavior = resolveStepBehavior(
		agentConfig,
		{
			reads: undefined,
			progress: undefined,
			skills: skillOverride,
			model: modelOverride,
		},
		packetDefaults,
	);
	task = injectSuperpowersPacketInstructions(task, behavior);
	const _cleanTask = task;

	const effectiveSkills = skillOverride;
	const runtimeCwd = params.cwd ?? ctx.cwd;

	const r = withSingleResultSessionMode(
		await (async () => {
			const prepared = prepareLaunch({
				agentConfig,
				rawTask: task,
				sessionMode,
				artifactsDir,
				runId,
				index: 0,
				sessionFile: sessionFileForIndex({
					index: 0,
					childCwd: runtimeCwd,
					sessionMode,
				}),
				useTestDrivenDevelopment,
			});
			try {
				return await runSync(runtimeCwd, agents, params.agent!, prepared.taskText, {
					cwd: params.cwd,
					signal,
					runId,
					index: 0,
					sessionFile: prepared.sessionFile,
					sessionMode: prepared.sessionMode,
					taskDelivery: prepared.taskDelivery,
					taskFilePath: prepared.taskFilePath,
					artifactsDir: artifactConfig.enabled ? artifactsDir : undefined,
					artifactConfig,
					maxOutput: params.maxOutput,
					maxSubagentDepth,
					onUpdate: onUpdate
						? (progressUpdate) => onUpdate(withProgressResultSessionMode(progressUpdate, sessionMode))
						: undefined,
					modelOverride,
					skills: effectiveSkills,
					config,
					workflow,
					useTestDrivenDevelopment,
				});
			} finally {
				prepared.cleanup();
			}
		})(),
		sessionMode,
	);
	if (r.progress) allProgress.push(r.progress);
	if (r.artifactPaths) allArtifactPaths.push(r.artifactPaths);

	const fullOutput = getSingleResultOutput(r);
	const displayOutput = r.truncation?.text || fullOutput;

	if (r.exitCode !== 0)
		return {
			content: [{ type: "text", text: r.error || "Failed" }],
			details: {
				mode: "single",
				results: [r],
				progress: params.includeProgress ? allProgress : undefined,
				artifacts: allArtifactPaths.length ? { dir: artifactsDir, files: allArtifactPaths } : undefined,
				truncation: r.truncation,
			},
		};
	return {
		content: [{ type: "text", text: displayOutput || "(no output)" }],
		details: {
			mode: "single",
			results: [r],
			progress: params.includeProgress ? allProgress : undefined,
			artifacts: allArtifactPaths.length ? { dir: artifactsDir, files: allArtifactPaths } : undefined,
			truncation: r.truncation,
		},
	};
}

export function createSubagentExecutor(deps: ExecutorDeps): {
	execute: (
		id: string,
		params: SubagentParamsLike,
		signal: AbortSignal,
		onUpdate: ((r: AgentToolResult<Details>) => void) | undefined,
		ctx: ExtensionContext,
	) => Promise<AgentToolResult<Details>>;
} {
	const execute = async (
		_id: string,
		params: SubagentParamsLike,
		signal: AbortSignal,
		onUpdate: ((r: AgentToolResult<Details>) => void) | undefined,
		ctx: ExtensionContext,
	): Promise<AgentToolResult<Details>> => {
		deps.state.baseCwd = ctx.cwd;
		// Support both legacy `config` and new `getConfig()` accessor
		const config = deps.getConfig?.() ?? deps.config!;
		const { blocked, depth, maxDepth } = checkSubagentDepth(config.maxSubagentDepth);
		if (blocked) {
			return {
				content: [
					{
						type: "text",
						text:
							`Nested subagent call blocked (depth=${depth}, max=${maxDepth}). ` +
							"You are running at the maximum subagent nesting depth. " +
							"Complete your current task directly without delegating to further subagents.",
					},
				],
				details: { mode: "single" as const, results: [] },
			};
		}

		const parentSessionFile = ctx.sessionManager.getSessionFile() ?? null;
		deps.state.currentSessionId =
			parentSessionFile ?? `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const agents = deps.discoverAgents(ctx.cwd, "both").agents;
		const runId = randomUUID().slice(0, 8);
		const hasTasks = (params.tasks?.length ?? 0) > 0;
		const hasSingle = Boolean(params.agent && params.task);
		const validationError = validateExecutionInput(params, agents, hasTasks, hasSingle);
		if (validationError) return validationError;

		let detailsSessionMode = resolveRequestedSessionMode({
			sessionMode: params.sessionMode,
			context: params.context,
			defaultSessionMode: "standalone",
		});
		if (hasSingle && params.agent) {
			const agentConfig = agents.find((agent) => agent.name === params.agent);
			if (agentConfig) detailsSessionMode = resolveAgentSessionMode(params, agentConfig);
		} else if (hasTasks && params.tasks) {
			const taskModes = params.tasks
				.map((task) => agents.find((agent) => agent.name === task.agent))
				.filter((agentConfig): agentConfig is AgentConfig => agentConfig !== undefined)
				.map((agentConfig) => resolveAgentSessionMode(params, agentConfig));
			detailsSessionMode = resolveDetailsSessionMode(taskModes);
		}

		let sessionFileForIndex: (input: {
			index?: number;
			childCwd: string;
			sessionMode: SessionMode;
		}) => string | undefined = () => undefined;
		try {
			const sessionLaunchResolver = createSessionLaunchResolver({
				sessionManager: ctx.sessionManager as unknown as SessionLaunchManager,
				sessionRoot: path.join(deps.getSubagentSessionRoot(parentSessionFile), runId),
			});
			sessionFileForIndex = (input) => sessionLaunchResolver.sessionFileForIndex(input);
		} catch (error) {
			return toExecutionErrorResult(params, error);
		}

		const artifactConfig: ArtifactConfig = {
			...DEFAULT_ARTIFACT_CONFIG,
			enabled: params.artifacts !== false,
		};
		const artifactsDir = getArtifactsDir(parentSessionFile);

		const onUpdateWithContext = onUpdate
			? (r: AgentToolResult<Details>) => onUpdate(withSessionModeDetails(r, detailsSessionMode))
			: undefined;

		const execData: ExecutionContextData = {
			params,
			ctx,
			signal,
			onUpdate: onUpdateWithContext,
			agents,
			runId,
			sessionFileForIndex,
			artifactConfig,
			artifactsDir,
			workflow: params.workflow ?? "superpowers",
			useTestDrivenDevelopment:
				params.useTestDrivenDevelopment ??
				config.superagents?.commands?.["sp-implement"]?.useTestDrivenDevelopment ??
				true,
			detailsSessionMode,
		};

		try {
			if (hasTasks && params.tasks) {
				return withSessionModeDetails(await runParallelPath(execData, deps), detailsSessionMode);
			}

			if (hasSingle) {
				return withSessionModeDetails(await runSinglePath(execData, deps), detailsSessionMode);
			}
		} catch (error) {
			return toExecutionErrorResult(params, error);
		}

		return withSessionModeDetails(
			{
				content: [{ type: "text", text: "Invalid params" }],
				details: { mode: "single" as const, results: [] },
			},
			detailsSessionMode,
		);
	};

	return { execute };
}
