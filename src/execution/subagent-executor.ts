/**
 * Request validation and execution orchestration for subagent runs.
 *
 * Responsibilities:
 * - normalize slash/tool parameters into concrete execution modes
 * - route single and parallel execution requests
 * - prepare launch artifacts (packets or fork wrappers) via execution planner
 * - execute child sessions via result delivery store and child runner
 * - aggregate results for parallel execution
 *
 * Important dependencies or side effects:
 * - launches child Pi processes through `runPreparedChild`
 * - writes and removes temporary Superpowers packet artifacts via planner
 * - creates and cleans up parallel worktrees when configured
 * - seeds or forks child session files through the session launch resolver
 */

import { randomUUID } from "node:crypto";
import * as path from "node:path";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AgentConfig, AgentScope } from "../agents/agents.ts";
import { getArtifactsDir } from "../shared/artifacts.ts";
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
	MAX_PARALLEL,
	type MaxOutputConfig,
	type PlannedChildRun,
	resolveChildMaxSubagentDepth,
	resolveCurrentMaxSubagentDepth,
	type SessionMode,
	type SingleResult,
	type SubagentState,
	type WorkflowMode,
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
import { createSessionLaunchResolver, resolveRequestedSessionMode, type SessionLaunchManager } from "./session-mode.ts";
import { resolveStepBehavior } from "./settings.ts";
import { resolveSuperagentWorktreeEnabled } from "./superagents-config.ts";
import { buildSuperpowersPacketPlan, injectSuperpowersPacketInstructions } from "./superpowers-packets.ts";
import {
	buildParallelWorktreeSuffix,
	buildParallelWorktreeTaskCwdError,
	cleanupWorktrees,
	createParallelWorktreeSetup,
	resolveParallelTaskCwd,
	resolveParallelTaskRuntimeCwd,
	type WorktreeSetup,
} from "./worktree.ts";
import { planChildRun, type PlanChildRunInput } from "./execution-planner.ts";
import { createResultDeliveryStore } from "./result-delivery.ts";

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
// Per-task execution helpers
// ---------------------------------------------------------------------------

interface RunPlannedChildInput {
	plan: PlannedChildRun;
	agents: AgentConfig[];
	signal: AbortSignal;
	onUpdate?: (r: AgentToolResult<Details>) => void;
	runId: string;
	config: ExtensionConfig;
}

/**
 * Execute a prepared child run: launch child, then clean up launch artifacts.
 *
 * @param input Planned child run, shared execution context, and abort signal.
 * @returns Child run result with session mode from the plan.
 *
 * Invariants:
 * - launch artifacts (packets) are cleaned up in `finally` even on failure
 * - child results always carry the session mode from the plan
 *
 * Failure modes:
 * - propagates unexpected launch/session errors
 * - normal child process failures are represented in the returned result
 */
/**
 * Convert an unexpected child launch exception into an isolated child result.
 *
 * @param plan Child plan whose launch failed unexpectedly.
 * @param error Unknown thrown value from child launch orchestration.
 * @returns Failed child result scoped to the affected child only.
 */
function toUnexpectedChildFailure(plan: PlannedChildRun, error: unknown): SingleResult {
	const message = error instanceof Error ? error.message : String(error);
	return withSingleResultSessionMode(
		{
			agent: plan.agentName,
			task: plan.task,
			exitCode: 1,
			messages: [],
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
			error: message,
		},
		plan.sessionMode,
	);
}

async function runPlannedChild(input: RunPlannedChildInput): Promise<SingleResult> {
	try {
		const result = await runPreparedChild(input.plan.runtimeCwd, input.agents, input.plan.agentName, input.plan.taskText, {
			cwd: input.plan.childCwd,
			signal: input.signal,
			runId: input.runId,
			index: input.plan.index,
			sessionFile: input.plan.sessionFile,
			sessionMode: input.plan.sessionMode,
			taskDelivery: input.plan.taskDelivery,
			taskFilePath: input.plan.taskFilePath,
			artifactsDir: input.plan.artifactsDir,
			artifactConfig: input.plan.artifactConfig,
			maxOutput: input.plan.maxOutput,
			maxSubagentDepth: input.plan.maxSubagentDepth,
			modelOverride: input.plan.modelOverride,
			skills: input.plan.skills,
			config: input.plan.config,
			workflow: input.plan.workflow,
			useTestDrivenDevelopment: input.plan.useTestDrivenDevelopment,
			onUpdate: input.onUpdate,
		});
		return withSingleResultSessionMode(result, input.plan.sessionMode);
	} finally {
		input.plan.cleanupLaunchArtifacts();
	}
}

// ---------------------------------------------------------------------------
// Parallel helpers
// ---------------------------------------------------------------------------

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

		// Create delivery store for parallel execution
		const deliveryStore = createResultDeliveryStore();

		// Build all plans upfront respecting worktree cwd/session mapping
		const plans: PlannedChildRun[] = [];
		for (let i = 0; i < tasks.length; i++) {
			const taskCwd = resolveParallelTaskCwd(tasks[i], params.cwd, worktreeSetup, i);
			const taskRuntimeCwd = resolveParallelTaskRuntimeCwd(tasks[i], params.cwd, worktreeSetup, i, ctx.cwd);
			const childId = `${runId}:${i}:${tasks[i].agent}`;

			const planInput: PlanChildRunInput = {
				id: childId,
				index: i,
				runtimeCwd: taskRuntimeCwd,
				childCwd: taskCwd ?? taskRuntimeCwd,
				agents,
				agentName: tasks[i].agent,
				task: taskTexts[i],
				runId,
				artifactsDir,
				sessionMode: sessionModes[i],
				sessionFile: sessionFileForIndex({
					index: i,
					childCwd: taskRuntimeCwd,
					sessionMode: sessionModes[i],
				}),
				workflow,
				modelOverride: modelOverrides[i],
				skills: skillOverrides[i],
				useTestDrivenDevelopment,
				includeProgress: true,
				config,
				artifactConfig,
				maxOutput: params.maxOutput,
				maxSubagentDepth: maxSubagentDepths[i],
			};

			plans.push(planChildRun(planInput));
		}

		// Launch through mapConcurrent to preserve the pre-refactor concurrency
		// contract and task-order startup behavior while deliveryStore owns result
		// ownership/join semantics.
		const launchResults = mapConcurrent(plans, MAX_PARALLEL, async (plan, i) => {
			const parallelOnUpdate = onUpdate
				? (progressUpdate: AgentToolResult<Details>) => {
						publishParallelProgressUpdate({
							progressUpdate,
							index: i,
							sessionMode: sessionModes[i],
							liveResults,
							liveProgress,
							onUpdate,
						});
					}
				: undefined;

			try {
				return await runPlannedChild({
					plan,
					agents,
					signal,
					onUpdate: parallelOnUpdate,
					runId,
					config,
				});
			} catch (error) {
				return toUnexpectedChildFailure(plan, error);
			}
		});

		for (let i = 0; i < plans.length; i++) {
			const plan = plans[i];
			deliveryStore.register({
				id: plan.id,
				agent: plan.agentName,
				task: plan.task,
				completion: launchResults.then((results) => results[i]),
			});
		}

		// Join children in task order through result store
		const childIds = plans.map((plan) => plan.id);
		const joined = await deliveryStore.join(childIds);

		if ("error" in joined) {
			const errorMessage = joined.error.message + (joined.error.ids ? ` [${joined.error.ids.join(", ")}]` : "");
			return toExecutionErrorResult(params, new Error(errorMessage));
		}

		const results: SingleResult[] = joined.results;

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
	const childId = `${runId}:0:${params.agent}`;

	// Create delivery store for single execution
	const deliveryStore = createResultDeliveryStore();

	// Plan one child with current variables
	const plan = planChildRun({
		id: childId,
		index: 0,
		runtimeCwd,
		childCwd: params.cwd ?? runtimeCwd,
		agents,
		agentName: params.agent!,
		task: taskText,
		runId,
		artifactsDir,
		sessionMode,
		sessionFile: sessionFileForIndex({
			index: 0,
			childCwd: runtimeCwd,
			sessionMode,
		}),
		workflow,
		modelOverride,
		skills: skillOverride,
		useTestDrivenDevelopment,
		includeProgress: params.includeProgress === true,
		config,
		artifactConfig,
		maxOutput: params.maxOutput,
		maxSubagentDepth,
	});

	// Register completion promise
	deliveryStore.register({
		id: childId,
		agent: plan.agentName,
		task: plan.task,
		completion: runPlannedChild({
			plan,
			agents,
			signal,
			onUpdate: onUpdate ? (progressUpdate) => onUpdate(withProgressResultSessionMode(progressUpdate, sessionMode)) : undefined,
			runId,
			config,
		}),
	});

	// Join one child and return result
	const joined = await deliveryStore.join([childId]);
	if ("error" in joined) {
		const errorMessage = joined.error.message + (joined.error.ids ? ` [${joined.error.ids.join(", ")}]` : "");
		return toExecutionErrorResult(params, new Error(errorMessage));
	}

	const r = joined.results[0];

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
