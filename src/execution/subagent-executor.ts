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
import { getArtifactsDir } from "../shared/artifacts.ts";
import { normalizeSkillInput } from "../shared/skills.ts";
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
	type WorkflowMode,
	wrapForkTask,
} from "../shared/types.ts";
import { getSingleResultOutput, mapConcurrent } from "../shared/utils.ts";
import { runSync } from "./execution.ts";
import { createForkContextResolver, type ForkableSessionManager } from "./fork-context.ts";
import { aggregateParallelOutputs } from "./parallel-utils.ts";
import { resolveStepBehavior } from "./settings.ts";
import { resolveSuperagentWorktreeCreateOptions, resolveSuperagentWorktreeEnabled } from "./superagents-config.ts";
import { buildSuperpowersPacketPlan, injectSuperpowersPacketInstructions } from "./superpowers-packets.ts";
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
	sessionFileForIndex: (idx?: number) => string | undefined;
	artifactConfig: ArtifactConfig;
	artifactsDir: string;
	workflow: WorkflowMode;
	useTestDrivenDevelopment: boolean;
}

function validateExecutionInput(
	_params: SubagentParamsLike,
	agents: AgentConfig[],
	hasTasks: boolean,
	hasSingle: boolean,
): AgentToolResult<Details> | null {
	if (Number(hasTasks) + Number(hasSingle) !== 1) {
		return {
			content: [
				{
					type: "text",
					text: `Provide exactly one mode. Agents: ${agents.map((a) => a.name).join(", ") || "none"}`,
				},
			],
			details: { mode: "single" as const, results: [] },
		};
	}

	return null;
}

function getRequestedModeLabel(params: SubagentParamsLike): Details["mode"] {
	if ((params.tasks?.length ?? 0) > 0) return "parallel";
	if (params.agent && params.task) return "single";
	return "single";
}

function _buildRequestedModeError(params: SubagentParamsLike, message: string): AgentToolResult<Details> {
	return withForkContext(
		{
			content: [{ type: "text", text: message }],
			details: { mode: getRequestedModeLabel(params), results: [] },
		},
		params.context,
	);
}

function withForkContext(
	result: AgentToolResult<Details>,
	context: SubagentParamsLike["context"],
): AgentToolResult<Details> {
	if (context !== "fork" || !result.details) return result;
	return {
		...result,
		details: {
			...result.details,
			context: "fork",
		},
	};
}

function toExecutionErrorResult(params: SubagentParamsLike, error: unknown): AgentToolResult<Details> {
	const message = error instanceof Error ? error.message : String(error);
	return withForkContext(
		{
			content: [{ type: "text", text: message }],
			details: { mode: getRequestedModeLabel(params), results: [] },
		},
		params.context,
	);
}

interface ForegroundParallelRunInput {
	tasks: TaskParam[];
	taskTexts: string[];
	agents: AgentConfig[];
	ctx: ExtensionContext;
	signal: AbortSignal;
	runId: string;
	sessionFileForIndex: (idx?: number) => string | undefined;
	artifactConfig: ArtifactConfig;
	artifactsDir: string;
	maxOutput?: MaxOutputConfig;
	paramsCwd?: string;
	maxSubagentDepths: number[];
	modelOverrides: (string | undefined)[];
	skillOverrides: (string[] | false | undefined)[];
	behaviors: Array<ReturnType<typeof resolveStepBehavior>>;
	liveResults: (SingleResult | undefined)[];
	liveProgress: (AgentProgress | undefined)[];
	onUpdate?: (r: AgentToolResult<Details>) => void;
	worktreeSetup?: WorktreeSetup;
	config: ExtensionConfig;
	workflow: WorkflowMode;
	useTestDrivenDevelopment: boolean;
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
		return runSync(input.ctx.cwd, input.agents, task.agent, input.taskTexts[index], {
			cwd: taskCwd,
			signal: input.signal,
			runId: input.runId,
			index,
			sessionFile: input.sessionFileForIndex(index),
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
						const stepResults = progressUpdate.details?.results || [];
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
	} = data;
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
	const taskTexts = tasks.map((t, i) => injectSuperpowersPacketInstructions(t.task, behaviors[i]));
	const liveResults: (SingleResult | undefined)[] = Array(tasks.length).fill(undefined) as (SingleResult | undefined)[];
	const liveProgress: (AgentProgress | undefined)[] = Array(tasks.length).fill(undefined) as (
		| AgentProgress
		| undefined
	)[];
	const { setup: worktreeSetup, errorResult } = createParallelWorktreeSetup(
		effectiveWorktree,
		effectiveCwd,
		runId,
		tasks,
		workflow,
		deps.config,
	);
	if (errorResult) return errorResult;

	try {
		if (params.context === "fork") {
			for (let i = 0; i < taskTexts.length; i++) {
				taskTexts[i] = wrapForkTask(taskTexts[i]);
			}
		}

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
				progress: params.includeProgress ? allProgress : undefined,
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

	if (params.context === "fork") {
		task = wrapForkTask(task);
	}
	const _cleanTask = task;

	const effectiveSkills = skillOverride;

	const r = await runSync(ctx.cwd, agents, params.agent!, task, {
		cwd: params.cwd,
		signal,
		runId,
		sessionFile: sessionFileForIndex(0),
		artifactsDir: artifactConfig.enabled ? artifactsDir : undefined,
		artifactConfig,
		maxOutput: params.maxOutput,
		maxSubagentDepth,
		onUpdate,
		modelOverride,
		skills: effectiveSkills,
		config: config,
		workflow,
		useTestDrivenDevelopment,
	});
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

		const scope: AgentScope = "both";
		const parentSessionFile = ctx.sessionManager.getSessionFile() ?? null;
		deps.state.currentSessionId =
			parentSessionFile ?? `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const agents = deps.discoverAgents(ctx.cwd, scope).agents;
		const runId = randomUUID().slice(0, 8);
		const hasTasks = (params.tasks?.length ?? 0) > 0;
		const hasSingle = Boolean(params.agent && params.task);
		const validationError = validateExecutionInput(params, agents, hasTasks, hasSingle);
		if (validationError) return validationError;

		let sessionFileForIndex: (idx?: number) => string | undefined = () => undefined;
		try {
			const forkContext = createForkContextResolver(
				ctx.sessionManager as unknown as ForkableSessionManager,
				params.context,
			);
			sessionFileForIndex = (idx?: number) => forkContext.sessionFileForIndex(idx);
		} catch (error) {
			return toExecutionErrorResult(params, error);
		}

		const artifactConfig: ArtifactConfig = {
			...DEFAULT_ARTIFACT_CONFIG,
			enabled: params.artifacts !== false,
		};
		const artifactsDir = getArtifactsDir(parentSessionFile);

		const onUpdateWithContext = onUpdate
			? (r: AgentToolResult<Details>) => onUpdate(withForkContext(r, params.context))
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
		};

		try {
			if (hasTasks && params.tasks) {
				return withForkContext(await runParallelPath(execData, deps), params.context);
			}

			if (hasSingle) {
				return withForkContext(await runSinglePath(execData, deps), params.context);
			}
		} catch (error) {
			return toExecutionErrorResult(params, error);
		}

		return withForkContext(
			{
				content: [{ type: "text", text: "Invalid params" }],
				details: { mode: "single" as const, results: [] },
			},
			params.context,
		);
	};

	return { execute };
}
