/**
 * Async execution logic for subagent tool
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { AgentConfig } from "../agents/agents.ts";
import { applyThinkingSuffix } from "./pi-args.ts";
import { injectSingleOutputInstruction, resolveSingleOutputPath } from "./single-output.ts";
import {
	resolveSuperagentWorktreeRuntimeOptions,
} from "./superagents-config.ts";
import {
	buildSuperpowersPacketPlan,
	injectSuperpowersPacketInstructions,
} from "./superpowers-packets.ts";
import {
	resolveStepBehavior,
	type StepOverrides,
} from "./settings.ts";
import type { RunnerStep } from "./parallel-utils.ts";
import { resolvePiPackageRoot } from "./pi-spawn.ts";
import {
	buildSkillInjection,
	normalizeSkillInput,
	resolveExecutionSkills,
} from "../shared/skills.ts";
import { inferExecutionRole, resolveModelForAgent, resolveRoleTools } from "./superpowers-policy.ts";
import {
	type ArtifactConfig,
	type Details,
	type ExtensionConfig,
	type MaxOutputConfig,
	type WorkflowMode,
	ASYNC_DIR,
	RESULTS_DIR,
	resolveChildMaxSubagentDepth,
} from "../shared/types.ts";

const require = createRequire(import.meta.url);
const piPackageRoot = resolvePiPackageRoot();
const jitiCliPath: string | undefined = (() => {
	const candidates: Array<() => string> = [
		() => path.join(path.dirname(require.resolve("jiti/package.json")), "lib/jiti-cli.mjs"),
		() => path.join(path.dirname(require.resolve("@mariozechner/jiti/package.json")), "lib/jiti-cli.mjs"),
		() => {
			const piEntry = fs.realpathSync(process.argv[1]);
			const piRequire = createRequire(piEntry);
			return path.join(path.dirname(piRequire.resolve("@mariozechner/jiti/package.json")), "lib/jiti-cli.mjs");
		},
	];
	for (const candidate of candidates) {
		try {
			const p = candidate();
			if (fs.existsSync(p)) return p;
		} catch {
			// Candidate not available in this install, continue probing.
		}
	}
	return undefined;
})();

export interface AsyncExecutionContext {
	pi: ExtensionAPI;
	cwd: string;
	currentSessionId: string;
}

export interface AsyncSingleParams {
	agent: string;
	task: string;
	agentConfig: AgentConfig;
	ctx: AsyncExecutionContext;
	cwd?: string;
	maxOutput?: MaxOutputConfig;
	artifactsDir?: string;
	artifactConfig: ArtifactConfig;
	sessionFile?: string;
	skills?: string[] | false;
	output?: string | false;
	maxSubagentDepth: number;
	workflow?: WorkflowMode;
	useTestDrivenDevelopment?: boolean;
	config?: ExtensionConfig;
}

export interface AsyncExecutionResult {
	content: Array<{ type: "text"; text: string }>;
	details: Details;
	isError?: boolean;
}

/**
 * Check if jiti is available for async execution
 */
export function isAsyncAvailable(): boolean {
	return jitiCliPath !== undefined;
}

/**
 * Spawn the async runner process
 */
function spawnRunner(cfg: object, suffix: string, cwd: string): number | undefined {
	if (!jitiCliPath) return undefined;
	
	const cfgPath = path.join(os.tmpdir(), `pi-async-cfg-${suffix}.json`);
	fs.writeFileSync(cfgPath, JSON.stringify(cfg));
	const runner = path.join(path.dirname(fileURLToPath(import.meta.url)), "subagent-runner.ts");
	
	const proc = spawn(process.execPath, [jitiCliPath, runner, cfgPath], {
		cwd,
		detached: true,
		stdio: "ignore",
		windowsHide: true,
	});
	proc.unref();
	return proc.pid;
}

/**
 * Resolve the concrete model string for an async Superpowers step.
 *
 * Inputs/outputs:
 * - accepts an optional explicit model override plus the agent default model/thinking
 * - returns a concrete `provider/model[:thinking]` string when resolution succeeds
 *
 * Invariants:
 * - explicit model overrides win over agent defaults
 * - Superpowers tier aliases resolve through `config.superagents.modelTiers`
 *
 * Failure modes:
 * - unresolved tiers fall back to the raw configured model string
 */
function resolveAsyncModel(input: {
	workflow?: WorkflowMode;
	config?: ExtensionConfig;
	model?: string;
	thinking?: string;
}): string | undefined {
	const tierModel = resolveModelForAgent({
		workflow: input.workflow ?? "superpowers",
		agentModel: input.model,
		config: input.config ?? {},
	});
	return applyThinkingSuffix(tierModel?.model ?? input.model, input.thinking ?? tierModel?.thinking);
}

export interface AsyncParallelParams {
	tasks: Array<{
		agent: string;
		task: string;
		cwd?: string;
		model?: string;
		skill?: string | string[] | boolean;
	}>;
	agents: AgentConfig[];
	ctx: AsyncExecutionContext;
	cwd?: string;
	maxOutput?: MaxOutputConfig;
	artifactsDir?: string;
	artifactConfig: ArtifactConfig;
	sessionFileForIndex: (idx: number) => string | undefined;
	maxSubagentDepth: number;
	workflow?: WorkflowMode;
	useTestDrivenDevelopment?: boolean;
	config?: ExtensionConfig;
	worktree?: boolean;
}

/**
 * Execute multiple agents concurrently in the background.
 */
export function executeAsyncParallel(
	id: string,
	params: AsyncParallelParams,
): AsyncExecutionResult {
	const {
		tasks,
		agents,
		ctx,
		cwd,
		maxOutput,
		artifactsDir,
		artifactConfig,
		sessionFileForIndex,
		maxSubagentDepth,
		workflow,
		useTestDrivenDevelopment,
		config,
		worktree,
	} = params;

	const runnerSubagentSteps: RunnerSubagentStep[] = tasks.map((t, i) => {
		const agentConfig = agents.find((a) => a.name === t.agent)!;
		const role = inferExecutionRole(t.agent);
		const skillOverride = normalizeSkillInput(t.skill);
		const configuredSkills = skillOverride !== undefined ? skillOverride : (agentConfig.skills ?? []);
		const { skillNames, resolvedSkills } = resolveExecutionSkills({
			cwd: ctx.cwd,
			workflow: workflow ?? "superpowers",
			role,
			config: config ?? {},
			useTestDrivenDevelopment: useTestDrivenDevelopment ?? true,
			skills: configuredSkills,
		});

		const packetDefaults = buildSuperpowersPacketPlan(t.agent);
		const behavior = resolveStepBehavior(
			agentConfig,
			{
				output: undefined,
				skills: skillOverride === true ? undefined : skillOverride,
				model: t.model,
			},
			undefined,
			packetDefaults,
		);
		const instructedTask = injectSuperpowersPacketInstructions(t.task, behavior);

		let systemPrompt = agentConfig.systemPrompt?.trim() || null;
		if (resolvedSkills.length > 0) {
			const injection = buildSkillInjection(resolvedSkills);
			systemPrompt = systemPrompt ? `${systemPrompt}\n\n${injection}` : injection;
		}

		const outputPath = resolveSingleOutputPath(behavior.output || undefined, ctx.cwd, t.cwd ?? cwd);
		const taskWithOutputInstruction = injectSingleOutputInstruction(instructedTask, outputPath);

		return {
			agent: t.agent,
			task: taskWithOutputInstruction,
			cwd: t.cwd ?? cwd,
			model: resolveAsyncModel({
				workflow,
				config,
				model: agentConfig.model,
				thinking: agentConfig.thinking,
			}),
			tools: resolveRoleTools({
				workflow: workflow ?? "superpowers",
				role,
				agentTools: agentConfig.tools,
			}),
			extensions: agentConfig.extensions,
			mcpDirectTools: agentConfig.mcpDirectTools,
			systemPrompt,
			skills: resolvedSkills.map((r) => r.name),
			outputPath,
			sessionFile: sessionFileForIndex(i),
			maxSubagentDepth: resolveChildMaxSubagentDepth(maxSubagentDepth, agentConfig.maxSubagentDepth),
		};
	});

	const asyncDir = path.join(ASYNC_DIR, id);
	try {
		fs.mkdirSync(asyncDir, { recursive: true });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			content: [{ type: "text", text: `Failed to create async run directory '${asyncDir}': ${message}` }],
			isError: true,
			details: { mode: "parallel" as const, results: [] },
		};
	}

	const runnerCwd = cwd ?? ctx.cwd;
	const worktreeOptions = resolveSuperagentWorktreeRuntimeOptions(workflow ?? "superpowers", config ?? {});
	const pid = spawnRunner(
		{
			id,
			step: {
				parallel: runnerSubagentSteps,
				worktree,
			},
			resultPath: path.join(RESULTS_DIR, `${id}.json`),
			cwd: runnerCwd,
			placeholder: "{previous}",
			maxOutput,
			artifactsDir: artifactConfig.enabled ? artifactsDir : undefined,
			artifactConfig,
			asyncDir,
			sessionId: ctx.currentSessionId,
			piPackageRoot,
			// Worktree global settings mapped to runner config
			worktreeRootDir: worktreeOptions.rootDir,
			worktreeRequireIgnoredRoot: worktreeOptions.requireIgnoredRoot,
			worktreeSetupHook: worktreeOptions.setupHook?.hookPath,
			worktreeSetupHookTimeoutMs: worktreeOptions.setupHook?.timeoutMs,
		},
		id,
		runnerCwd,
	);

	if (pid) {
		ctx.pi.events.emit("subagent:started", {
			id,
			pid,
			agent: tasks.length === 1 ? tasks[0].agent : "parallel",
			task: tasks.length === 1 ? tasks[0].task.slice(0, 50) : `${tasks.length} tasks`,
			cwd: runnerCwd,
			asyncDir,
		});
	}

	return {
		content: [{ type: "text", text: `Async Parallel: ${tasks.length} tasks [${id}]` }],
		details: { mode: "parallel", results: [], asyncId: id, asyncDir },
	};
}

/**
 * Execute a single agent asynchronously
 */
export function executeAsyncSingle(
	id: string,
	params: AsyncSingleParams,
): AsyncExecutionResult {
	const {
		agent,
		task,
		agentConfig,
		ctx,
		cwd,
		maxOutput,
		artifactsDir,
		artifactConfig,
		sessionFile,
		maxSubagentDepth,
		workflow,
		useTestDrivenDevelopment,
		config,
	} = params;
	const role = inferExecutionRole(agent);
	const configuredSkills = params.skills !== undefined ? params.skills : (agentConfig.skills ?? []);
	const { skillNames, resolvedSkills } = resolveExecutionSkills({
		cwd: ctx.cwd,
		workflow: workflow ?? "superpowers",
		role,
		config,
		useTestDrivenDevelopment,
		skills: configuredSkills,
	});

	const packetDefaults = buildSuperpowersPacketPlan(agent);
	const behavior = resolveStepBehavior(
		agentConfig,
		{
			output: params.output === true ? undefined : params.output,
			skills: params.skills,
		},
		undefined,
		packetDefaults,
	);
	const instructedTask = injectSuperpowersPacketInstructions(task, behavior);

	let systemPrompt = agentConfig.systemPrompt?.trim() || null;
	if (resolvedSkills.length > 0) {
		const injection = buildSkillInjection(resolvedSkills);
		systemPrompt = systemPrompt ? `${systemPrompt}\n\n${injection}` : injection;
	}

	const asyncDir = path.join(ASYNC_DIR, id);
	try {
		fs.mkdirSync(asyncDir, { recursive: true });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			content: [{ type: "text", text: `Failed to create async run directory '${asyncDir}': ${message}` }],
			isError: true,
			details: { mode: "single" as const, results: [] },
		};
	}

	const runnerCwd = cwd ?? ctx.cwd;
	const outputPath = resolveSingleOutputPath(behavior.output || undefined, ctx.cwd, cwd);
	const taskWithOutputInstruction = injectSingleOutputInstruction(instructedTask, outputPath);
	const pid = spawnRunner(
		{
			id,
			step: {
				agent,
				task: taskWithOutputInstruction,
				cwd,
				model: resolveAsyncModel({
					workflow,
					config,
					model: agentConfig.model,
					thinking: agentConfig.thinking,
				}),
				tools: resolveRoleTools({
					workflow: workflow ?? "superpowers",
					role,
					agentTools: agentConfig.tools,
				}),
				extensions: agentConfig.extensions,
				mcpDirectTools: agentConfig.mcpDirectTools,
				systemPrompt,
				skills: resolvedSkills.map((r) => r.name),
				outputPath,
				sessionFile,
				maxSubagentDepth: resolveChildMaxSubagentDepth(maxSubagentDepth, agentConfig.maxSubagentDepth),
			},
			resultPath: path.join(RESULTS_DIR, `${id}.json`),
			cwd: runnerCwd,
			placeholder: "{previous}",
			maxOutput,
			artifactsDir: artifactConfig.enabled ? artifactsDir : undefined,
			artifactConfig,
			asyncDir,
			sessionId: ctx.currentSessionId,
			piPackageRoot,
		},
		id,
		runnerCwd,
	);

	if (pid) {
		ctx.pi.events.emit("subagent:started", {
			id,
			pid,
			agent,
			task: task?.slice(0, 50),
			cwd: runnerCwd,
			asyncDir,
		});
	}

	return {
		content: [{ type: "text", text: `Async: ${agent} [${id}]` }],
		details: { mode: "single", results: [], asyncId: id, asyncDir },
	};
}
