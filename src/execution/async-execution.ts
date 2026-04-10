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
	applySuperagentWorktreeDefaultsToChain,
	resolveSuperagentWorktreeRuntimeOptions,
} from "./superagents-config.ts";
import {
	buildChainInstructions,
	isParallelStep,
	resolveStepBehavior,
	type ChainStep,
	type PacketDefaults,
	type SequentialStep,
	type StepOverrides,
} from "./settings.ts";
import type { RunnerStep } from "./parallel-utils.ts";
import { resolvePiPackageRoot } from "./pi-spawn.ts";
import {
	buildSkillInjection,
	normalizeSkillInput,
	resolveExecutionSkills,
} from "../shared/skills.ts";
import { buildSuperpowersPacketPlan } from "./superpowers-packets.ts";
import { inferExecutionRole, resolveModelForAgent, resolveRoleTools } from "./superpowers-policy.ts";
import {
	type ArtifactConfig,
	type Details,
	type ExtensionConfig,
	type MaxOutputConfig,
	type SuperpowersImplementerMode,
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

export interface AsyncChainParams {
	chain: ChainStep[];
	agents: AgentConfig[];
	ctx: AsyncExecutionContext;
	cwd?: string;
	maxOutput?: MaxOutputConfig;
	artifactsDir?: string;
	artifactConfig: ArtifactConfig;
	shareEnabled: boolean;
	sessionRoot?: string;
	chainSkills?: string[];
	sessionFilesByFlatIndex?: (string | undefined)[];
	maxSubagentDepth: number;
	workflow?: WorkflowMode;
	implementerMode?: SuperpowersImplementerMode;
	config?: ExtensionConfig;
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
	shareEnabled: boolean;
	sessionRoot?: string;
	sessionFile?: string;
	skills?: string[] | false;
	output?: string | false;
	maxSubagentDepth: number;
	workflow?: WorkflowMode;
	implementerMode?: SuperpowersImplementerMode;
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
 * Resolves packet defaults for async chain steps.
 *
 * Inputs/outputs:
 * - accepts an agent name and optional workflow mode
 * - returns packet defaults for Superpowers packet-producing roles
 *
 * Invariants:
 * - only the explicit Superpowers workflow injects packet defaults
 * - missing or default workflow metadata never falls back to role-name heuristics
 */
function resolveAsyncPacketDefaults(
	agentName: string,
	workflow?: WorkflowMode,
): PacketDefaults | undefined {
	if (workflow !== "superpowers") return undefined;
	const role = inferExecutionRole(agentName);
	if (role === "root-planning") return undefined;
	const packetPlan = buildSuperpowersPacketPlan(role);
	if (packetPlan.reads.length === 0 && packetPlan.output === false && packetPlan.progress === false) {
		return undefined;
	}
	return packetPlan;
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
		workflow: input.workflow ?? "default",
		agentModel: input.model,
		config: input.config ?? {},
	});
	return applyThinkingSuffix(tierModel?.model ?? input.model, input.thinking ?? tierModel?.thinking);
}

/**
 * Execute a chain asynchronously
 */
export function executeAsyncChain(
	id: string,
	params: AsyncChainParams,
): AsyncExecutionResult {
	const {
		chain: rawChain,
		agents,
		ctx,
		cwd,
		maxOutput,
		artifactsDir,
		artifactConfig,
		shareEnabled,
		sessionRoot,
		sessionFilesByFlatIndex,
		maxSubagentDepth,
		workflow,
		implementerMode,
		config,
	} = params;
	const chainSkills = params.chainSkills ?? [];
	const effectiveWorkflow = workflow ?? "default";
	const effectiveConfig = config ?? {};
	const chain = applySuperagentWorktreeDefaultsToChain(rawChain, effectiveWorkflow, effectiveConfig);

	// Validate all agents exist before building steps
	for (const s of chain) {
		const stepAgents = isParallelStep(s)
			? s.parallel.map((t) => t.agent)
			: [(s as SequentialStep).agent];
		for (const agentName of stepAgents) {
			if (!agents.find((x) => x.name === agentName)) {
				return {
					content: [{ type: "text", text: `Unknown agent: ${agentName}` }],
					isError: true,
					details: { mode: "chain" as const, results: [] },
				};
			}
		}
	}

	const asyncDir = path.join(ASYNC_DIR, id);
	try {
		fs.mkdirSync(asyncDir, { recursive: true });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			content: [{ type: "text", text: `Failed to create async run directory '${asyncDir}': ${message}` }],
			isError: true,
			details: { mode: "chain" as const, results: [] },
		};
	}

	/** Build a resolved runner step from a SequentialStep */
	const buildSeqStep = (s: SequentialStep, sessionFile?: string) => {
		const a = agents.find((x) => x.name === s.agent)!;
		const stepSkillInput = normalizeSkillInput(s.skill);
		const stepOverrides: StepOverrides = {
			output: s.output,
			reads: s.reads,
			progress: s.progress,
			skills: stepSkillInput,
		};
		const behavior = resolveStepBehavior(
			a,
			stepOverrides,
			chainSkills,
			resolveAsyncPacketDefaults(s.agent, workflow),
		);
		const role = inferExecutionRole(s.agent);
		const { skillNames, resolvedSkills } = resolveExecutionSkills({
			cwd: ctx.cwd,
			workflow: effectiveWorkflow,
			role,
			config: effectiveConfig,
			implementerMode,
			skills: behavior.skills,
		});

		let systemPrompt = a.systemPrompt?.trim() || null;
		if (resolvedSkills.length > 0) {
			const injection = buildSkillInjection(resolvedSkills);
			systemPrompt = systemPrompt ? `${systemPrompt}\n\n${injection}` : injection;
		}

		const chainDir = asyncDir;
		const outputPath = typeof behavior.output === "string"
			? resolveSingleOutputPath(behavior.output, chainDir, chainDir)
			: undefined;
		const templateTask = (s.task ?? "{previous}").replace(/\{chain_dir\}/g, chainDir);
		const { prefix, suffix } = buildChainInstructions(behavior, chainDir, false);
		const task = `${prefix}${templateTask}${suffix}`;

		return {
			agent: s.agent,
			task,
			cwd: s.cwd,
			model: resolveAsyncModel({
				workflow: effectiveWorkflow,
				config: effectiveConfig,
				model: s.model ?? a.model,
				thinking: s.model ? undefined : a.thinking,
			}),
			tools: resolveRoleTools({
				workflow: effectiveWorkflow,
				role,
				agentTools: a.tools,
			}),
			extensions: a.extensions,
			mcpDirectTools: a.mcpDirectTools,
			systemPrompt,
			skills: resolvedSkills.map((r) => r.name),
			outputPath,
			sessionFile,
			maxSubagentDepth: resolveChildMaxSubagentDepth(maxSubagentDepth, a.maxSubagentDepth),
		};
	};

	let flatStepIndex = 0;
	const nextSessionFile = (): string | undefined => {
		const sessionFile = sessionFilesByFlatIndex?.[flatStepIndex];
		flatStepIndex++;
		return sessionFile;
	};

	// Build runner steps — sequential steps become flat objects,
	// parallel steps become { parallel: [...], concurrency?, failFast? }
	const steps: RunnerStep[] = chain.map((s) => {
		if (isParallelStep(s)) {
			return {
				parallel: s.parallel.map((t) => buildSeqStep({
					agent: t.agent,
					task: t.task,
					cwd: t.cwd,
					skill: t.skill,
					model: t.model,
					output: t.output,
					reads: t.reads,
					progress: t.progress,
				}, nextSessionFile())),
				concurrency: s.concurrency,
				failFast: s.failFast,
				worktree: s.worktree,
			};
		}
		return buildSeqStep(s as SequentialStep, nextSessionFile());
	});

	const runnerCwd = cwd ?? ctx.cwd;
	const worktreeOptions = resolveSuperagentWorktreeRuntimeOptions(effectiveWorkflow, effectiveConfig);
	const pid = spawnRunner(
		{
			id,
			steps,
			resultPath: path.join(RESULTS_DIR, `${id}.json`),
			cwd: runnerCwd,
			placeholder: "{previous}",
			maxOutput,
			artifactsDir: artifactConfig.enabled ? artifactsDir : undefined,
			artifactConfig,
			share: shareEnabled,
			sessionDir: sessionRoot ? path.join(sessionRoot, `async-${id}`) : undefined,
			asyncDir,
			sessionId: ctx.currentSessionId,
			piPackageRoot,
			worktreeRootDir: worktreeOptions.rootDir,
			worktreeRequireIgnoredRoot: worktreeOptions.requireIgnoredRoot,
			worktreeSetupHook: worktreeOptions.setupHook?.hookPath,
			worktreeSetupHookTimeoutMs: worktreeOptions.setupHook?.timeoutMs,
		},
		id,
		runnerCwd,
	);

	if (pid) {
		const firstStep = chain[0];
		const firstAgents = isParallelStep(firstStep)
			? firstStep.parallel.map((t) => t.agent)
			: [(firstStep as SequentialStep).agent];
		ctx.pi.events.emit("subagent:started", {
			id,
			pid,
			agent: firstAgents[0],
			task: isParallelStep(firstStep)
				? firstStep.parallel[0]?.task?.slice(0, 50)
				: (firstStep as SequentialStep).task?.slice(0, 50),
			chain: chain.map((s) =>
				isParallelStep(s) ? `[${s.parallel.map((t) => t.agent).join("+")}]` : (s as SequentialStep).agent,
			),
			cwd: runnerCwd,
			asyncDir,
		});
	}

	// Build chain description with parallel groups shown as [agent1+agent2]
	const chainDesc = chain
		.map((s) =>
			isParallelStep(s) ? `[${s.parallel.map((t) => t.agent).join("+")}]` : (s as SequentialStep).agent,
		)
		.join(" -> ");

	return {
		content: [{ type: "text", text: `Async chain: ${chainDesc} [${id}]` }],
		details: { mode: "chain", results: [], asyncId: id, asyncDir },
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
		shareEnabled,
		sessionRoot,
		sessionFile,
		maxSubagentDepth,
		workflow,
		implementerMode,
		config,
	} = params;
	const role = inferExecutionRole(agent);
	const configuredSkills = params.skills !== undefined ? params.skills : (agentConfig.skills ?? []);
	const { skillNames, resolvedSkills } = resolveExecutionSkills({
		cwd: ctx.cwd,
		workflow: workflow ?? "default",
		role,
		config,
		implementerMode,
		skills: configuredSkills,
	});
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
	const outputPath = resolveSingleOutputPath(params.output, ctx.cwd, cwd);
	const taskWithOutputInstruction = injectSingleOutputInstruction(task, outputPath);
	const pid = spawnRunner(
		{
			id,
			steps: [
				{
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
						workflow: workflow ?? "default",
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
			],
			resultPath: path.join(RESULTS_DIR, `${id}.json`),
			cwd: runnerCwd,
			placeholder: "{previous}",
			maxOutput,
			artifactsDir: artifactConfig.enabled ? artifactsDir : undefined,
			artifactConfig,
			share: shareEnabled,
			sessionDir: sessionRoot ? path.join(sessionRoot, `async-${id}`) : undefined,
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
