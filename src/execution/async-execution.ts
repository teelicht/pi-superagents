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
	resolveStepBehavior,
	type StepOverrides,
} from "./settings.ts";
import type { RunnerStep } from "./parallel-utils.ts";
import { resolvePiPackageRoot } from "./pi-spawn.ts";
import {
	buildSkillInjection,
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
	shareEnabled: boolean;
	sessionRoot?: string;
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
		workflow: input.workflow ?? "default",
		agentModel: input.model,
		config: input.config ?? {},
	});
	return applyThinkingSuffix(tierModel?.model ?? input.model, input.thinking ?? tierModel?.thinking);
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
		useTestDrivenDevelopment,
		config,
	} = params;
	const role = inferExecutionRole(agent);
	const configuredSkills = params.skills !== undefined ? params.skills : (agentConfig.skills ?? []);
	const { skillNames, resolvedSkills } = resolveExecutionSkills({
		cwd: ctx.cwd,
		workflow: workflow ?? "default",
		role,
		config,
		useTestDrivenDevelopment,
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
