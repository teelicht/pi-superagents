/**
 * Request validation and execution orchestration for subagent runs.
 *
 * Responsibilities:
 * - normalize slash/tool parameters into concrete execution modes
 * - route single and parallel execution requests
 * - prepare launch artifacts (packets or fork wrappers)
 * - execute child sessions via `runPreparedChild` and aggregate results
 *
 * Important dependencies or side effects:
 * - launches child Pi processes through `runPreparedChild`
 * - writes and removes temporary Superpowers packet artifacts
 * - creates and cleans up parallel worktrees when configured
 * - seeds or forks child session files through the session launch resolver
 */

import { randomUUID } from "node:crypto";
import * as path from "node:path";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
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
	type SessionMode,
	type SingleResult,
	type SubagentState,
	type TaskDeliveryMode,
	type WorkflowMode,
	wrapForkTask,
} from "../shared/types.ts";
import { getSingleResultOutput, mapConcurrent } from "../shared/utils.ts";
import { runPreparedChild } from "./child-runner.ts";
import {
	buildParallelModeError,
	resolveAgentSessionMode,
	resolveDetailsSessionMode,
	toExecutionErrorResult,
	validateExecutionInput,
	withProgressResultSessionMode,
	withSessionModeDetails,
	withSingleResultSessionMode,
} from "./executor-validation.ts";
import { aggregateParallelOutputs } from "./parallel-utils.ts";
import { createSessionLaunchResolver, resolveRequestedSessionMode, resolveTaskDeliveryMode, type SessionLaunchManager } from "./session-mode.ts";
import { resolveStepBehavior } from "./settings.ts";
import { resolveSuperagentWorktreeEnabled } from "./superagents-config.ts";
import { buildSuperpowersPacketContent, buildSuperpowersPacketPlan, injectSuperpowersPacketInstructions } from "./superpowers-packets.ts";
import {
	buildParallelWorktreeSuffix,
	buildParallelWorktreeTaskCwdError,
	cleanupWorktrees,
	createParallelWorktreeSetup,
	resolveParallelTaskCwd,
	resolveParallelTaskRuntimeCwd,
	type WorktreeSetup,
} from "./worktree.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
	cwd?: string;
	maxOutput?: MaxOutputConfig;
	artifacts?: boolean;
	includeProgress?: boolean;
	model?: string;
	skill?: string | string[] | boolean;
}

interface ExecutorDeps {
	state: SubagentState;
	getConfig: () => ExtensionConfig;
	getSubagentSessionRoot: (parentSessionFile: string | null) => string;
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
}

// ---------------------------------------------------------------------------
// Launch preparation
// ---------------------------------------------------------------------------

interface PreparedLaunch {
	sessionMode: SessionMode;
	taskDelivery: TaskDeliveryMode;
	sessionFile?: string;
	taskText: string;
	taskFilePath?: string;
	packetFile?: string;
	cleanup(): void;
}

/**
 * Prepare the task text, session metadata, and temporary packet artifacts for a child launch.
 *
 * @param input Child agent, task, session, and artifact metadata.
 * @returns Launch metadata consumed by `runPreparedChild`, plus a cleanup hook for packet files.
 *
 * Invariants:
 * - fork launches receive the task directly and never create packet files
 * - non-fork launches receive a scoped packet file that is removed by `cleanup`
 */
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

// ---------------------------------------------------------------------------
// Per-task execution (shared by single and parallel paths)
// ---------------------------------------------------------------------------

interface RunChildInput {
	agentConfig: AgentConfig;
	agentName: string;
	preparedTaskText: string;
	sessionMode: SessionMode;
	index: number;
	taskCwd: string | undefined;
	taskRuntimeCwd: string;
	skills: string[] | false | undefined;
	modelOverride: string | undefined;
	maxSubagentDepth: number;
	// shared execution context
	runId: string;
	artifactsDir: string;
	artifactConfig: ArtifactConfig;
	maxOutput?: MaxOutputConfig;
	sessionFileForIndex: (input: { index?: number; childCwd: string; sessionMode: SessionMode }) => string | undefined;
	signal: AbortSignal;
	agents: AgentConfig[];
	config: ExtensionConfig;
	workflow: WorkflowMode;
	useTestDrivenDevelopment: boolean;
	onUpdate?: (r: AgentToolResult<Details>) => void;
}

/**
 * Execute one child subagent task: prepare launch, run prepared child, cleanup, annotate.
 *
 * @param input Fully resolved child execution metadata and shared runtime context.
 * @returns Child result annotated with the effective session mode.
 *
 * Invariants:
 * - temporary launch packets are cleaned up even when `runPreparedChild` fails
 * - child results always carry the session mode used for the launch
 *
 * Failure modes:
 * - propagates unexpected launch/session errors to the caller
 * - normal child process failures are represented in the returned `SingleResult`
 */
async function runChild(input: RunChildInput): Promise<SingleResult> {
	const prepared = prepareLaunch({
		agentConfig: input.agentConfig,
		rawTask: input.preparedTaskText,
		sessionMode: input.sessionMode,
		artifactsDir: input.artifactsDir,
		runId: input.runId,
		index: input.index,
		sessionFile: input.sessionFileForIndex({
			index: input.index,
			childCwd: input.taskRuntimeCwd,
			sessionMode: input.sessionMode,
		}),
		useTestDrivenDevelopment: input.useTestDrivenDevelopment,
	});
	try {
		const result = await runPreparedChild(input.taskRuntimeCwd, input.agents, input.agentName, prepared.taskText, {
			cwd: input.taskCwd,
			signal: input.signal,
			runId: input.runId,
			index: input.index,
			sessionFile: prepared.sessionFile,
			sessionMode: prepared.sessionMode,
			taskDelivery: prepared.taskDelivery,
			taskFilePath: prepared.taskFilePath,
			artifactsDir: input.artifactConfig.enabled ? input.artifactsDir : undefined,
			artifactConfig: input.artifactConfig,
			maxOutput: input.maxOutput,
			maxSubagentDepth: input.maxSubagentDepth,
			modelOverride: input.modelOverride,
			skills: input.skills,
			config: input.config,
			workflow: input.workflow,
			useTestDrivenDevelopment: input.useTestDrivenDevelopment,
			onUpdate: input.onUpdate,
		});
		return withSingleResultSessionMode(result, input.sessionMode);
	} finally {
		prepared.cleanup();
	}
}

// ---------------------------------------------------------------------------
// Parallel helpers
// ---------------------------------------------------------------------------

interface ForegroundParallelRunInput {
	tasks: TaskParam[];
	taskTexts: string[];
	agentConfigs: AgentConfig[];
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

/**
 * Merge one child progress update into the aggregate parallel progress state.
 *
 * @param input Child update, session mode, mutable live state arrays, and parent callback.
 * @returns Nothing; mutates live state arrays and publishes an aggregate update.
 *
 * Invariants:
 * - live results and progress are stored by task index
 * - published aggregate updates omit unresolved task slots while preserving known order
 */
function publishParallelProgressUpdate(input: {
	progressUpdate: AgentToolResult<Details>;
	index: number;
	sessionMode: SessionMode;
	liveResults: (SingleResult | undefined)[];
	liveProgress: (AgentProgress | undefined)[];
	onUpdate: (r: AgentToolResult<Details>) => void;
}): void {
	const stepResults = withProgressResultSessionMode(input.progressUpdate, input.sessionMode).details?.results || [];
	const stepProgress = input.progressUpdate.details?.progress || [];
	if (stepResults.length > 0) input.liveResults[input.index] = stepResults[0];
	if (stepProgress.length > 0) input.liveProgress[input.index] = stepProgress[0];
	const mergedResults = input.liveResults.filter((result): result is SingleResult => result !== undefined);
	const mergedProgress = input.liveProgress.filter((progress): progress is AgentProgress => progress !== undefined);
	input.onUpdate({
		content: input.progressUpdate.content,
		details: {
			mode: "parallel",
			results: mergedResults,
			progress: mergedProgress,
		},
	});
}

/**
 * Execute all parallel child tasks in the foreground concurrency pool.
 *
 * @param input Resolved task text, agent config, cwd, session, skill, and progress state.
 * @returns Ordered child results matching the input task order.
 *
 * Invariants:
 * - progress updates are merged into stable task-index order for the parent renderer
 * - per-task cwd/session/skill settings are resolved before calling the shared child runner
 *
 * Failure modes:
 * - propagates child execution failures as `SingleResult` values from `runChild`
 * - propagates unexpected setup errors from cwd/session resolution
 */
async function runForegroundParallelTasks(input: ForegroundParallelRunInput): Promise<SingleResult[]> {
	return mapConcurrent(input.tasks, MAX_CONCURRENCY, async (task, index) => {
		const overrideSkills = input.skillOverrides[index];
		const effectiveSkills = overrideSkills === undefined ? input.behaviors[index]?.skills : overrideSkills;
		const taskCwd = resolveParallelTaskCwd(task, input.paramsCwd, input.worktreeSetup, index);
		const taskRuntimeCwd = resolveParallelTaskRuntimeCwd(task, input.paramsCwd, input.worktreeSetup, index, input.ctx.cwd);
		const publishProgress = input.onUpdate;

		const parallelOnUpdate = publishProgress
			? (progressUpdate: AgentToolResult<Details>) => {
					publishParallelProgressUpdate({
						progressUpdate,
						index,
						sessionMode: input.sessionModes[index],
						liveResults: input.liveResults,
						liveProgress: input.liveProgress,
						onUpdate: publishProgress,
					});
				}
			: undefined;

		return runChild({
			agentConfig: input.agentConfigs[index],
			agentName: task.agent,
			preparedTaskText: input.taskTexts[index],
			sessionMode: input.sessionModes[index],
			index,
			taskCwd,
			taskRuntimeCwd,
			skills: effectiveSkills,
			modelOverride: input.modelOverrides[index],
			maxSubagentDepth: input.maxSubagentDepths[index],
			runId: input.runId,
			artifactsDir: input.artifactsDir,
			artifactConfig: input.artifactConfig,
			maxOutput: input.maxOutput,
			sessionFileForIndex: input.sessionFileForIndex,
			signal: input.signal,
			agents: input.agents,
			config: input.config,
			workflow: input.workflow,
			useTestDrivenDevelopment: input.useTestDrivenDevelopment,
			onUpdate: parallelOnUpdate,
		});
	});
}

/**
 * Resolve behavior settings for one child execution request.
 *
 * @param agentConfig Agent frontmatter and defaults for the child.
 * @param skillOverride Optional runtime skill override after normalization.
 * @param modelOverride Optional runtime model override.
 * @returns Effective step behavior after applying Superpowers packet defaults.
 */
function resolveChildBehavior(agentConfig: AgentConfig, skillOverride: string[] | false | undefined, modelOverride: string | undefined): ReturnType<typeof resolveStepBehavior> {
	const packetDefaults = buildSuperpowersPacketPlan(agentConfig.name as ExecutionRole);
	return resolveStepBehavior(
		agentConfig,
		{
			reads: undefined,
			progress: undefined,
			skills: skillOverride,
			model: modelOverride,
		},
		packetDefaults,
	);
}

/**
 * Build the common details payload for a single-child response.
 *
 * @param input Child result and optional progress/artifact metadata.
 * @returns Single-mode details object shared by success and failure responses.
 */
function buildSingleDetails(input: {
	result: SingleResult;
	progress: AgentProgress[];
	artifactPaths: ArtifactPaths[];
	artifactsDir: string;
	includeProgress: boolean | undefined;
}): Details {
	return {
		mode: "single",
		results: [input.result],
		progress: input.includeProgress ? input.progress : undefined,
		artifacts: input.artifactPaths.length ? { dir: input.artifactsDir, files: input.artifactPaths } : undefined,
		truncation: input.result.truncation,
	};
}

// ---------------------------------------------------------------------------
// Execution paths
// ---------------------------------------------------------------------------

/**
 * Execute a parallel subagent request and aggregate child results.
 *
 * @param data Request, runtime, session, artifact, and progress context for this execution.
 * @param deps Executor dependencies used for fresh config resolution.
 * @returns Parallel tool result containing aggregate text, ordered child results, progress, and artifacts.
 *
 * Invariants:
 * - task order is preserved in result and progress arrays
 * - worktree setup, if created, is cleaned up in a `finally` block
 * - every task receives a pending progress row even if no child progress event arrives
 *
 * Failure modes:
 * - returns structured validation errors for unknown agents, too many tasks, or worktree conflicts
 * - propagates unexpected setup errors to the executor-level catch block
 */
async function runParallelPath(data: ExecutionContextData, deps: ExecutorDeps): Promise<AgentToolResult<Details>> {
	const { params, agents, ctx, signal, runId, sessionFileForIndex, artifactConfig, artifactsDir, onUpdate, workflow, useTestDrivenDevelopment } = data;
	const config = deps.getConfig();
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
		const c = agents.find((a) => a.name === t.agent);
		if (!c) {
			return {
				content: [{ type: "text", text: `Unknown agent: ${t.agent}` }],
				details: { mode: "parallel" as const, results: [] },
			};
		}
		agentConfigs.push(c);
	}

	const currentMaxSubagentDepth = resolveCurrentMaxSubagentDepth(config.maxSubagentDepth);
	const maxSubagentDepths = agentConfigs.map((agentConfig) => resolveChildMaxSubagentDepth(currentMaxSubagentDepth, agentConfig.maxSubagentDepth));
	const effectiveWorktree = resolveSuperagentWorktreeEnabled(params.worktree, workflow, config);

	const effectiveCwd = params.cwd ?? ctx.cwd;
	if (effectiveWorktree) {
		const worktreeTaskCwdError = buildParallelWorktreeTaskCwdError(tasks, effectiveCwd);
		if (worktreeTaskCwdError) return buildParallelModeError(worktreeTaskCwdError);
	}

	const modelOverrides: (string | undefined)[] = tasks.map((t) => t.model);
	const skillOverrides: (string[] | false | undefined)[] = tasks.map((t) => normalizeSkillInput(t.skill));
	const behaviors = agentConfigs.map((agentConfig, i) => resolveChildBehavior(agentConfig, skillOverrides[i], modelOverrides[i]));
	const sessionModes = agentConfigs.map((agentConfig) => resolveAgentSessionMode(params, agentConfig));
	const taskTexts = tasks.map((t, i) => injectSuperpowersPacketInstructions(t.task, behaviors[i]));
	const liveResults: (SingleResult | undefined)[] = Array(tasks.length).fill(undefined) as (SingleResult | undefined)[];
	const { setup: worktreeSetup, errorResult } = createParallelWorktreeSetup(effectiveWorktree, effectiveCwd, runId, tasks, workflow, config);
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
			agentConfigs,
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
			config,
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
		const fullContent = worktreeSuffix ? `${summary}\n\n${aggregatedOutput}\n\n${worktreeSuffix}` : `${summary}\n\n${aggregatedOutput}`;

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

/**
 * Execute a single child subagent request and format its tool response.
 *
 * @param data Request, runtime, session, artifact, and progress context for this execution.
 * @param deps Executor dependencies used for fresh config resolution.
 * @returns Tool result containing the child result, optional progress, artifacts, and truncation metadata.
 */
async function runSinglePath(data: ExecutionContextData, deps: ExecutorDeps): Promise<AgentToolResult<Details>> {
	const { params, agents, ctx, signal, runId, sessionFileForIndex, artifactConfig, artifactsDir, onUpdate, workflow, useTestDrivenDevelopment } = data;
	const config = deps.getConfig();
	const allProgress: AgentProgress[] = [];
	const allArtifactPaths: ArtifactPaths[] = [];
	const agentConfig = agents.find((a) => a.name === params.agent);
	if (!agentConfig) {
		return {
			content: [{ type: "text", text: `Unknown agent: ${params.agent}` }],
			details: { mode: "single", results: [] },
		};
	}

	const sessionMode = resolveAgentSessionMode(params, agentConfig);
	const modelOverride: string | undefined = params.model;
	const skillOverride: string[] | false | undefined = normalizeSkillInput(params.skill);
	const currentMaxSubagentDepth = resolveCurrentMaxSubagentDepth(config.maxSubagentDepth);
	const maxSubagentDepth = resolveChildMaxSubagentDepth(currentMaxSubagentDepth, agentConfig.maxSubagentDepth);

	const behavior = resolveChildBehavior(agentConfig, skillOverride, modelOverride);
	const taskText = injectSuperpowersPacketInstructions(params.task!, behavior);
	const runtimeCwd = params.cwd ?? ctx.cwd;

	const r = await runChild({
		agentConfig,
		agentName: params.agent!,
		preparedTaskText: taskText,
		sessionMode,
		index: 0,
		taskCwd: params.cwd,
		taskRuntimeCwd: runtimeCwd,
		skills: skillOverride,
		modelOverride,
		maxSubagentDepth,
		runId,
		artifactsDir,
		artifactConfig,
		maxOutput: params.maxOutput,
		sessionFileForIndex,
		signal,
		agents,
		config,
		workflow,
		useTestDrivenDevelopment,
		onUpdate: onUpdate ? (progressUpdate) => onUpdate(withProgressResultSessionMode(progressUpdate, sessionMode)) : undefined,
	});
	if (r.progress) allProgress.push(r.progress);
	if (r.artifactPaths) allArtifactPaths.push(r.artifactPaths);

	const fullOutput = getSingleResultOutput(r);
	const displayOutput = r.truncation?.text || fullOutput;

	if (r.exitCode !== 0)
		return {
			content: [{ type: "text", text: r.error || "Failed" }],
			details: buildSingleDetails({
				result: r,
				progress: allProgress,
				artifactPaths: allArtifactPaths,
				artifactsDir,
				includeProgress: params.includeProgress,
			}),
		};
	return {
		content: [{ type: "text", text: displayOutput || "(no output)" }],
		details: buildSingleDetails({
			result: r,
			progress: allProgress,
			artifactPaths: allArtifactPaths,
			artifactsDir,
			includeProgress: params.includeProgress,
		}),
	};
}

// ---------------------------------------------------------------------------
// Executor factory
// ---------------------------------------------------------------------------

/**
 * Create the stateful subagent executor used by the extension tool handler.
 *
 * @param deps Runtime dependencies for config lookup, agent discovery, session roots, and shared state.
 * @returns Executor facade with an `execute` method matching the Pi tool handler shape.
 *
 * Failure modes:
 * - validation and setup failures are returned as structured tool results
 * - child execution failures are captured in child result metadata instead of throwing
 */
export function createSubagentExecutor(deps: ExecutorDeps): {
	execute: (
		id: string,
		params: SubagentParamsLike,
		signal: AbortSignal,
		onUpdate: ((r: AgentToolResult<Details>) => void) | undefined,
		ctx: ExtensionContext,
	) => Promise<AgentToolResult<Details>>;
} {
	/**
	 * Execute one subagent tool request.
	 *
	 * @param _id Tool-call identifier supplied by Pi; currently unused.
	 * @param params Raw single or parallel execution parameters.
	 * @param signal Abort signal forwarded to child processes.
	 * @param onUpdate Optional live-progress callback for TUI rendering.
	 * @param ctx Pi extension context containing cwd, UI, model, and session services.
	 * @returns Structured tool result for the selected execution mode.
	 */
	const execute = async (
		_id: string,
		params: SubagentParamsLike,
		signal: AbortSignal,
		onUpdate: ((r: AgentToolResult<Details>) => void) | undefined,
		ctx: ExtensionContext,
	): Promise<AgentToolResult<Details>> => {
		deps.state.baseCwd = ctx.cwd;
		const config = deps.getConfig();
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
		deps.state.currentSessionId = parentSessionFile ?? `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const agents = deps.discoverAgents(ctx.cwd, "both").agents;
		const runId = randomUUID().slice(0, 8);
		const hasTasks = (params.tasks?.length ?? 0) > 0;
		const hasSingle = Boolean(params.agent && params.task);
		const validationError = validateExecutionInput(params, agents, hasTasks, hasSingle);
		if (validationError) return validationError;

		let detailsSessionMode = resolveRequestedSessionMode({
			sessionMode: params.sessionMode,
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

		let sessionFileForIndex: (input: { index?: number; childCwd: string; sessionMode: SessionMode }) => string | undefined = () => undefined;
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

		const onUpdateWithSessionMode = onUpdate ? (r: AgentToolResult<Details>) => onUpdate(withSessionModeDetails(r, detailsSessionMode)) : undefined;

		const execData: ExecutionContextData = {
			params,
			ctx,
			signal,
			onUpdate: onUpdateWithSessionMode,
			agents,
			runId,
			sessionFileForIndex,
			artifactConfig,
			artifactsDir,
			workflow: params.workflow ?? "superpowers",
			useTestDrivenDevelopment: params.useTestDrivenDevelopment ?? false,
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
