/**
 * Type definitions for child-runner module exports.
 * Used by test support helpers to type dynamic imports.
 */

import type { AgentConfig } from "../../src/agents/agents.ts";
import type { SingleResult } from "../../src/shared/types.ts";

export interface RunPreparedChildOptions {
	cwd?: string;
	signal?: AbortSignal;
	onUpdate?: (r: unknown) => void;
	maxOutput?: { bytes?: number; lines?: number };
	artifactsDir?: string;
	artifactConfig?: unknown;
	runId: string;
	index?: number;
	sessionFile?: string;
	sessionMode?: string;
	taskDelivery?: string;
	taskFilePath?: string;
	maxSubagentDepth?: number;
	modelOverride?: string;
	skills?: string[] | false;
	config?: unknown;
	workflow?: string;
	useTestDrivenDevelopment?: boolean;
}

export interface ChildRunnerExports {
	runPreparedChild: (runtimeCwd: string, agents: AgentConfig[], agentName: string, task: string, options: RunPreparedChildOptions) => Promise<SingleResult>;
}
