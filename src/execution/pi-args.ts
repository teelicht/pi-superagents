/**
 * Pi argument builder and utilities
 *
 * Key responsibilities:
 * - build CLI argument arrays for invoking the `pi` binary
 * - apply thinking-level suffixes to model identifiers
 * - manage temporary files for large tasks and system prompts
 * - handle session file and MCP tool configuration
 *
 * Important dependencies/side effects:
 * - node:fs (mkdtempSync, writeFileSync, rmSync) — creates/deletes temp directories
 * - node:os (tmpdir) — temp directory root
 * - node:path (join) — path construction
 *
 * Consumed by: src/execution/child-runner.ts for child process launch preparation and cleanup.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { isThinkingLevel, VALID_THINKING_LEVELS } from "../shared/thinking-levels.ts";

const TASK_ARG_LIMIT = 8000;

/**
 * Input contract for `buildPiArgs`.
 *
 * @see buildPiArgs
 */
export interface BuildPiArgsInput {
	baseArgs: string[];
	task: string;
	sessionEnabled: boolean;
	sessionFile?: string;
	taskFilePath?: string;
	model?: string;
	thinking?: string;
	tools?: string[];
	/**
	 * Controls extension discovery behavior.
	 *
	 * - **undefined**: Pi default extension discovery remains enabled. Path-like
	 *   tools (e.g. `"./tools/custom-tool.ts"`) are still emitted as `--extension`
	 *   arguments so they are available to pi.
	 *
	 * - **Defined array** (including `[]`): Emits `--no-extensions` to disable Pi's
	 *   built-in extension discovery, then emits `--extension` for each path in the
	 *   array. Use this to provide an explicit extension allowlist.
	 */
	extensions?: string[];
	skills?: string[];
	systemPrompt?: string | null;
	mcpDirectTools?: string[];
	promptFileStem?: string;
}

/**
 * Output contract from `buildPiArgs`.
 *
 * @see buildPiArgs
 */
export interface BuildPiArgsResult {
	args: string[];
	env: Record<string, string | undefined>;
	tempDir?: string;
}

/**
 * Appends a thinking-level suffix to a model identifier when the suffix differs
 * from what is already present.
 *
 * @param model   - The model string (e.g. `"anthropic/claude-3-5-sonnet"`).  May include an existing
 *                  thinking suffix separated by `:`.
 * @param thinking - Desired thinking level (e.g. `"medium"`).  Ignored if `"off"` or `undefined`.
 * @returns       - The model string with the suffix appended (e.g. `"anthropic/claude-3-5-sonnet:medium"`),
 *                  or the original model if no suffix change is needed.
 */
export function applyThinkingSuffix(model: string | undefined, thinking: string | undefined): string | undefined {
	if (!model || !thinking || thinking === "off") return model;
	const colonIdx = model.lastIndexOf(":");
	if (colonIdx !== -1 && isThinkingLevel(model.substring(colonIdx + 1))) return model;
	return `${model}:${thinking}`;
}

/**
 * Builds the CLI argument array and environment variables for launching the `pi` binary.
 *
 * - Session: when `sessionFile` is provided, emits `--session`; otherwise uses `sessionEnabled`
 *   to emit `--no-session` or nothing.
 * - Model: applies the thinking suffix via `applyThinkingSuffix` and emits `--models` (not `--model`,
 *   because pi CLI silently ignores `--model` without `--provider`).
 * - Tools: path-like tools (containing `/` or ending in `.ts`/`.js`) are emitted as `--extension`;
 *   builtin tool names are emitted as `--tools`.
 * - Extensions: when `extensions` is defined, emits `--no-extensions` then `--extension` for each path.
 * - System prompt: written to a temp file (mode `0o600`) and passed via `--append-system-prompt`.
 * - Task: passed as `@<file>` when `taskFilePath` is supplied or when `task` exceeds `TASK_ARG_LIMIT`;
 *   otherwise passed as a positional argument.
 *
 * @param input - Configuration for the pi invocation.
 * @returns     - `{ args, env, tempDir }`.  Callers must eventually call `cleanupTempDir(result.tempDir)`.
 * @see BuildPiArgsInput
 * @see BuildPiArgsResult
 */
export function buildPiArgs(input: BuildPiArgsInput): BuildPiArgsResult {
	const args = [...input.baseArgs];

	if (input.sessionFile) {
		args.push("--session", input.sessionFile);
	} else {
		if (!input.sessionEnabled) {
			args.push("--no-session");
		}
	}

	const modelArg = applyThinkingSuffix(input.model, input.thinking);
	if (modelArg) {
		// Use --models (not --model) because pi CLI silently ignores --model
		// without a companion --provider flag. --models resolves the provider
		// automatically via resolveModelScope. See: #8
		args.push("--models", modelArg);
	}

	const toolExtensionPaths: string[] = [];
	if (input.tools?.length) {
		const builtinTools: string[] = [];
		for (const tool of input.tools) {
			if (tool.includes("/") || tool.endsWith(".ts") || tool.endsWith(".js")) {
				toolExtensionPaths.push(tool);
			} else {
				builtinTools.push(tool);
			}
		}
		if (builtinTools.length > 0) {
			args.push("--tools", builtinTools.join(","));
		}
	}

	if (input.extensions !== undefined) {
		args.push("--no-extensions");
		for (const extPath of input.extensions) {
			args.push("--extension", extPath);
		}
	}
	for (const extPath of toolExtensionPaths) {
		args.push("--extension", extPath);
	}

	if ((input.skills?.length ?? 0) > 0) {
		args.push("--no-skills");
	}

	let tempDir: string | undefined;
	if (input.systemPrompt) {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-"));
		const stem = (input.promptFileStem ?? "prompt").replace(/[^\w.-]/g, "_");
		const promptPath = path.join(tempDir, `${stem}.md`);
		fs.writeFileSync(promptPath, input.systemPrompt, { mode: 0o600 });
		args.push("--append-system-prompt", promptPath);
	}

	if (input.taskFilePath) {
		args.push(`@${input.taskFilePath}`);
	} else if (input.task.length > TASK_ARG_LIMIT) {
		if (!tempDir) {
			tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-"));
		}
		const taskFilePath = path.join(tempDir, "task.md");
		fs.writeFileSync(taskFilePath, `Task: ${input.task}`, { mode: 0o600 });
		args.push(`@${taskFilePath}`);
	} else {
		args.push(`Task: ${input.task}`);
	}

	const env: Record<string, string | undefined> = {};
	if (input.mcpDirectTools?.length) {
		env.MCP_DIRECT_TOOLS = input.mcpDirectTools.join(",");
	} else {
		env.MCP_DIRECT_TOOLS = "__none__";
	}

	return { args, env, tempDir };
}

/**
 * Removes a temporary directory created by `buildPiArgs`.
 *
 * Cleanup is best-effort; errors are swallowed to avoid disrupting callers.
 *
 * @param tempDir - Path to the directory returned by `buildPiArgs`.  May be `null` or `undefined`
 *                  (no-op in that case).
 */
export function cleanupTempDir(tempDir: string | null | undefined): void {
	if (!tempDir) return;
	try {
		fs.rmSync(tempDir, { recursive: true, force: true });
	} catch {
		// Temp cleanup is best effort.
	}
}
