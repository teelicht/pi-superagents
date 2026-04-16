/**
 * Type definitions for the subagent extension
 *
 * Key responsibilities:
 * - define config contracts (ExtensionConfig, SuperpowersSettings, etc.)
 * - define execution options (RunSyncOptions)
 * - define result and artifact types
 * - define display, error, and async types
 *
 * Important dependencies:
 * - @mariozechner/pi-ai (Message type)
 * - @mariozechner/pi-coding-agent (ExtensionContext)
 * - node:os, node:path, node:fs
 */

import type { Message } from "@mariozechner/pi-ai";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

// ============================================================================
// Basic Types
// ============================================================================

export interface MaxOutputConfig {
	bytes?: number;
	lines?: number;
}

export interface TruncationResult {
	text: string;
	truncated: boolean;
	originalBytes?: number;
	originalLines?: number;
	artifactPath?: string;
}

export interface Usage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	turns: number;
}

export type WorkflowMode = "superpowers";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

/**
 * Model tier identifier.
 *
 * Built-in tiers: cheap, balanced, max
 * Users can define custom tiers (e.g., "creative", "free") in config.json.
 */
export type ModelTier = string;

export interface ModelTierConfig {
	model: string;
	thinking?: ThinkingLevel;
}

export type ModelTierSetting = string | ModelTierConfig;

export type ExecutionRole =
	| "root-planning"
	| "sp-recon"
	| "sp-research"
	| "sp-implementer"
	| "sp-spec-review"
	| "sp-code-review"
	| "sp-debug";

// ============================================================================
// Skills
// ============================================================================

export interface ResolvedSkill {
	name: string;
	path: string;
	content: string;
	source: "project" | "user";
	scope?: "root" | "agent";
}

// ============================================================================
// Progress Tracking
// ============================================================================
export interface AgentProgress {
	index: number;
	agent: string;
	status: "pending" | "running" | "completed" | "failed";
	task: string;
	skills?: string[];
	currentTool?: string;
	currentToolArgs?: string;
	recentTools: Array<{ tool: string; args: string; endMs: number }>;
	recentOutput: string[];
	toolCount: number;
	durationMs: number;
	error?: string;
	failedTool?: string;
}

export interface ProgressSummary {
	toolCount: number;
	durationMs: number;
}
// ============================================================================
// Results
// ============================================================================

export interface SingleResult {
	agent: string;
	task: string;
	exitCode: number;
	messages: Message[];
	usage: Usage;
	model?: string;
	error?: string;
	sessionFile?: string;
	skills?: string[];
	skillsWarning?: string;
	progress?: AgentProgress;
	progressSummary?: ProgressSummary;
	artifactPaths?: ArtifactPaths;
	truncation?: TruncationResult;
	finalOutput?: string;
	savedOutputPath?: string;
	outputSaveError?: string;
}

export interface Details {
	mode: "single" | "parallel";
	context?: "fresh" | "fork";
	results: SingleResult[];
	progress?: AgentProgress[];
	progressSummary?: ProgressSummary;
	artifacts?: {
		dir: string;
		files: ArtifactPaths[];
	};
	truncation?: {
		truncated: boolean;
		originalBytes?: number;
		originalLines?: number;
		artifactPath?: string;
	};
}

// ============================================================================
// Artifacts
// ============================================================================

export interface ArtifactPaths {
	inputPath: string;
	outputPath: string;
	jsonlPath: string;
	metadataPath: string;
}

export interface ArtifactConfig {
	enabled: boolean;
	includeInput: boolean;
	includeOutput: boolean;
	includeJsonl: boolean;
	includeMetadata: boolean;
	cleanupDays: number;
}

export interface ConfigGateState {
	blocked: boolean;
	diagnostics: ConfigDiagnostic[];
	message: string;
	configPath?: string;
	examplePath?: string;
}

export interface SubagentState {
	baseCwd: string;
	currentSessionId: string | null;
	lastUiContext: ExtensionContext | null;
	configGate: ConfigGateState;
}

// ============================================================================
// Display
// ============================================================================

export type DisplayItem =
	| { type: "text"; text: string }
	| { type: "tool"; name: string; args: Record<string, unknown> };

// ============================================================================
// Error Handling
// ============================================================================

export interface ErrorInfo {
	hasError: boolean;
	exitCode?: number;
	errorType?: string;
	details?: string;
}

// ============================================================================
// Execution Options
// ============================================================================

export interface RunSyncOptions {
	cwd?: string;
	signal?: AbortSignal;
	onUpdate?: (r: import("@mariozechner/pi-agent-core").AgentToolResult<Details>) => void;
	maxOutput?: MaxOutputConfig;
	artifactsDir?: string;
	artifactConfig?: ArtifactConfig;
	runId: string;
	index?: number;
	sessionFile?: string;
	outputPath?: string;
	maxSubagentDepth?: number;
	/** Override the agent's default model (format: "provider/id" or just "id") */
	modelOverride?: string;
	/** Skills to inject; `false` disables all configured skills for this run. */
	skills?: string[] | false;
	/** Extension config for command-scoped execution policy resolution. */
	config?: ExtensionConfig;
	/** Execution workflow mode. */
	workflow?: WorkflowMode;
	/** Whether to use test-driven development for implementer runs. */
	useTestDrivenDevelopment?: boolean;
}

export type ConfigDiagnosticLevel = "warning" | "error";

export interface ConfigDiagnostic {
	level: ConfigDiagnosticLevel;
	code: string;
	path: string;
	message: string;
	action?: string;
}

/**
 * Mapping from a root skill name to additional skill names loaded with it.
 *
 * Shape: { [rootSkillName]: [overlaySkillName, ...] }
 *
 * Example:
 * {
 *   "brainstorming": ["react-native-best-practices", "supabase-postgres-best-practices"],
 *   "writing-plans": ["supabase-postgres-best-practices"]
 * }
 */
export type SkillOverlayConfig = Record<string, string[]>;

/** Preset for a named superpowers command. */
export interface SuperpowersCommandPreset {
	description?: string;
	entrySkill?: string;
	useBranches?: boolean;
	useSubagents?: boolean;
	useTestDrivenDevelopment?: boolean;
	usePlannotator?: boolean;
	worktrees?: SuperpowersCommandWorktreeSettings;
}

/** Worktree settings allowed inside command presets. */
export interface SuperpowersCommandWorktreeSettings {
	enabled?: boolean;
	root?: string | null;
}

/** Worktree settings for superagents parallel execution. */
export interface SuperpowersWorktreeSettings {
	enabled?: boolean;
	root?: string | null;
}

export interface SuperpowersSettings {
	commands?: Record<string, SuperpowersCommandPreset>;
	modelTiers?: Record<string, ModelTierSetting>;
	skillOverlays?: SkillOverlayConfig;
	interceptSkillCommands?: string[];
	superpowersSkills?: string[];
}

export interface ExtensionConfig {
	superagents?: SuperpowersSettings;
	maxSubagentDepth?: number;
}

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_MAX_OUTPUT: Required<MaxOutputConfig> = {
	bytes: 200 * 1024,
	lines: 5000,
};

export const DEFAULT_ARTIFACT_CONFIG: ArtifactConfig = {
	enabled: true,
	includeInput: true,
	includeOutput: true,
	includeJsonl: false,
	includeMetadata: true,
	cleanupDays: 7,
};

export const MAX_PARALLEL = 8;
export const MAX_CONCURRENCY = 4;
export const DEFAULT_SUBAGENT_MAX_DEPTH = 2;

export const DEFAULT_FORK_PREAMBLE =
	"You are a delegated subagent with access to the parent session's context for reference. " +
	"Your sole job is to execute the task below. Do not continue or respond to the prior conversation " +
	"— focus exclusively on completing this task using your tools.";

export function wrapForkTask(task: string, preamble?: string | false): string {
	if (preamble === false) return task;
	const effectivePreamble = preamble ?? DEFAULT_FORK_PREAMBLE;
	const wrappedPrefix = `${effectivePreamble}\n\nTask:\n`;
	if (task.startsWith(wrappedPrefix)) return task;
	return `${wrappedPrefix}${task}`;
}

// ============================================================================
// Recursion Depth Guard
// ============================================================================

export function normalizeMaxSubagentDepth(value: unknown): number | undefined {
	const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
	if (!Number.isInteger(parsed) || parsed < 0) return undefined;
	return parsed;
}

export function resolveCurrentMaxSubagentDepth(configMaxDepth?: number): number {
	return (
		normalizeMaxSubagentDepth(process.env.PI_SUBAGENT_MAX_DEPTH) ??
		normalizeMaxSubagentDepth(configMaxDepth) ??
		DEFAULT_SUBAGENT_MAX_DEPTH
	);
}

export function resolveChildMaxSubagentDepth(parentMaxDepth: number, agentMaxDepth?: number): number {
	const normalizedParent = normalizeMaxSubagentDepth(parentMaxDepth) ?? DEFAULT_SUBAGENT_MAX_DEPTH;
	const normalizedAgent = normalizeMaxSubagentDepth(agentMaxDepth);
	return normalizedAgent === undefined ? normalizedParent : Math.min(normalizedParent, normalizedAgent);
}

export function checkSubagentDepth(configMaxDepth?: number): { blocked: boolean; depth: number; maxDepth: number } {
	const depth = Number(process.env.PI_SUBAGENT_DEPTH ?? "0");
	const maxDepth = resolveCurrentMaxSubagentDepth(configMaxDepth);
	const blocked = Number.isFinite(depth) && depth >= maxDepth;
	return { blocked, depth, maxDepth };
}

export function getSubagentDepthEnv(maxDepth?: number): Record<string, string> {
	const parentDepth = Number(process.env.PI_SUBAGENT_DEPTH ?? "0");
	const nextDepth = Number.isFinite(parentDepth) ? parentDepth + 1 : 1;
	return {
		PI_SUBAGENT_DEPTH: String(nextDepth),
		PI_SUBAGENT_MAX_DEPTH: String(normalizeMaxSubagentDepth(maxDepth) ?? resolveCurrentMaxSubagentDepth()),
	};
}

// ============================================================================
// Utility Functions
// ============================================================================

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function truncateOutput(
	output: string,
	config: Required<MaxOutputConfig>,
	artifactPath?: string,
): TruncationResult {
	const lines = output.split("\n");
	const bytes = Buffer.byteLength(output, "utf-8");

	if (bytes <= config.bytes && lines.length <= config.lines) {
		return { text: output, truncated: false };
	}

	let truncatedLines = lines;
	if (lines.length > config.lines) {
		truncatedLines = lines.slice(0, config.lines);
	}

	let result = truncatedLines.join("\n");
	if (Buffer.byteLength(result, "utf-8") > config.bytes) {
		let low = 0;
		let high = result.length;
		while (low < high) {
			const mid = Math.floor((low + high + 1) / 2);
			if (Buffer.byteLength(result.slice(0, mid), "utf-8") <= config.bytes) {
				low = mid;
			} else {
				high = mid - 1;
			}
		}
		result = result.slice(0, low);
	}

	const keptLines = result.split("\n").length;
	const marker = `[TRUNCATED: showing first ${keptLines} of ${lines.length} lines, ${formatBytes(Buffer.byteLength(result))} of ${formatBytes(bytes)}${artifactPath ? ` - full output at ${artifactPath}` : ""}]\n`;

	return {
		text: marker + result,
		truncated: true,
		originalBytes: bytes,
		originalLines: lines.length,
		artifactPath,
	};
}
