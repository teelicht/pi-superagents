/**
 * Execution planning for subagent child runs.
 *
 * Responsibilities:
 * - turn validated executor inputs into prepared child run plans
 * - own task delivery decisions for fork/direct and packet/artifact modes
 * - create and clean packet artifacts for non-fork sessions
 * - pass through already-resolved session file paths without creating/forking sessions
 * - carry runtime policy decisions to the child runner without spawning processes
 *
 * Important dependencies and side effects:
 * - writes temporary packet artifacts for non-fork launches
 * - does not spawn Pi child processes or own result delivery state
 */

import * as path from "node:path";
import type { AgentConfig } from "../agents/agents.ts";
import { ensureArtifactsDir, getPacketPath, removeArtifactFile, writeArtifact } from "../shared/artifacts.ts";
import type { ArtifactConfig, ExtensionConfig, MaxOutputConfig, PlannedChildRun, SessionMode, WorkflowMode } from "../shared/types.ts";
import { wrapForkTask } from "../shared/types.ts";
import { resolveTaskDeliveryMode } from "./session-mode.ts";
import { buildSuperpowersPacketContent } from "./superpowers-packets.ts";

export interface PlanChildRunInput {
	id: string;
	index: number;
	runtimeCwd: string;
	childCwd: string;
	agents: AgentConfig[];
	agentName: string;
	task: string;
	runId: string;
	artifactsDir: string;
	sessionMode: SessionMode;
	sessionFile?: string;
	workflow: WorkflowMode;
	modelOverride?: string;
	skills?: string[] | false;
	useTestDrivenDevelopment: boolean;
	includeProgress: boolean;
	config: ExtensionConfig;
	artifactConfig?: ArtifactConfig;
	maxOutput?: MaxOutputConfig;
	maxSubagentDepth?: number;
}

/**
 * Build a prepared child plan while preserving current synchronous launch semantics.
 *
 * @param input Validated child run planning input.
 * @returns Prepared child plan consumed by child-runner and result-delivery modules.
 * @throws When `agentName` does not exist in `agents`.
 */
export function planChildRun(input: PlanChildRunInput): PlannedChildRun {
	const agentConfig = input.agents.find((agent) => agent.name === input.agentName);
	if (!agentConfig) throw new Error(`Unknown agent: ${input.agentName}`);

	const taskDelivery = resolveTaskDeliveryMode(input.sessionMode);
	if (input.sessionMode === "fork") {
		return {
			id: input.id,
			index: input.index,
			agentName: input.agentName,
			task: input.task,
			runtimeCwd: input.runtimeCwd,
			childCwd: input.childCwd,
			workflow: input.workflow,
			sessionMode: input.sessionMode,
			taskDelivery,
			sessionFile: input.sessionFile,
			taskText: wrapForkTask(input.task),
			modelOverride: input.modelOverride,
			skills: input.skills,
			useTestDrivenDevelopment: input.useTestDrivenDevelopment,
			maxSubagentDepth: input.maxSubagentDepth,
			artifactsDir: input.artifactsDir,
			artifactConfig: input.artifactConfig,
			maxOutput: input.maxOutput,
			includeProgress: input.includeProgress,
			config: input.config,
			cleanupLaunchArtifacts() {},
		};
	}

	const packetFile = getPacketPath(input.artifactsDir, input.runId, input.agentName, input.index);
	ensureArtifactsDir(path.dirname(packetFile));
	writeArtifact(
		packetFile,
		buildSuperpowersPacketContent({
			agent: input.agentName,
			sessionMode: input.sessionMode,
			task: input.task,
			useTestDrivenDevelopment: input.useTestDrivenDevelopment,
		}),
	);

	return {
		id: input.id,
		index: input.index,
		agentName: input.agentName,
		task: input.task,
		runtimeCwd: input.runtimeCwd,
		childCwd: input.childCwd,
		workflow: input.workflow,
		sessionMode: input.sessionMode,
		taskDelivery,
		sessionFile: input.sessionFile,
		taskText: input.task,
		taskFilePath: packetFile,
		packetFile,
		modelOverride: input.modelOverride,
		skills: input.skills,
		useTestDrivenDevelopment: input.useTestDrivenDevelopment,
		maxSubagentDepth: input.maxSubagentDepth,
		artifactsDir: input.artifactsDir,
		artifactConfig: input.artifactConfig,
		maxOutput: input.maxOutput,
		includeProgress: input.includeProgress,
		config: input.config,
		cleanupLaunchArtifacts() {
			removeArtifactFile(packetFile);
		},
	};
}
