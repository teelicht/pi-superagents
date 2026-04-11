/**
 * Background subagent runner entrypoint.
 *
 * Responsibilities:
 * - execute serialized async single/chain plans in a detached process
 * - maintain status/event artifacts for polling and UI updates
 * - apply already-resolved worktree options to parallel background steps
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { appendJsonl, getArtifactPaths } from "../shared/artifacts.ts";
import { getPiSpawnCommand } from "./pi-spawn.ts";
import { captureSingleOutputSnapshot, resolveSingleOutput } from "./single-output.ts";
import {
	type ArtifactConfig,
	type ArtifactPaths,
	DEFAULT_MAX_OUTPUT,
	type MaxOutputConfig,
	truncateOutput,
	getSubagentDepthEnv,
} from "../shared/types.ts";
import {
	type RunnerSubagentStep as SubagentStep,
	type RunnerStep,
	isParallelGroup,
	mapConcurrent,
	MAX_PARALLEL_CONCURRENCY,
} from "./parallel-utils.ts";
import { buildPiArgs, cleanupTempDir } from "./pi-args.ts";
import {
	cleanupWorktrees,
	createWorktrees,
	findWorktreeTaskCwdConflict,
	formatWorktreeDiffSummary,
	formatWorktreeTaskCwdConflict,
	type WorktreeSetup,
} from "./worktree.ts";

interface SubagentRunConfig {
	id: string;
	step: RunnerStep;
	resultPath: string;
	cwd: string;
	placeholder: string;
	taskIndex?: number;
	totalTasks?: number;
	maxOutput?: MaxOutputConfig;
	artifactsDir?: string;
	artifactConfig?: Partial<ArtifactConfig>;
	asyncDir: string;
	sessionId?: string | null;
	piPackageRoot?: string;
	worktreeRootDir?: string;
	worktreeRequireIgnoredRoot?: boolean;
	worktreeSetupHook?: string;
	worktreeSetupHookTimeoutMs?: number;
}

interface StepResult {
	agent: string;
	output: string;
	success: boolean;
	skipped?: boolean;
	artifactPaths?: ArtifactPaths;
	truncated?: boolean;
}

const require = createRequire(import.meta.url);

function runPiStreaming(
	args: string[],
	cwd: string,
	outputFile: string,
	env?: Record<string, string | undefined>,
	piPackageRoot?: string,
	maxSubagentDepth?: number,
): Promise<{ stdout: string; exitCode: number | null }> {
	return new Promise((resolve) => {
		const outputStream = fs.createWriteStream(outputFile, { flags: "w" });
		const spawnEnv = { ...process.env, ...(env ?? {}), ...getSubagentDepthEnv(maxSubagentDepth) };
		const spawnSpec = getPiSpawnCommand(args, piPackageRoot ? { piPackageRoot } : undefined);
		const child = spawn(spawnSpec.command, spawnSpec.args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: spawnEnv });
		let stdout = "";

		child.stdout.on("data", (chunk: Buffer) => {
			const text = chunk.toString();
			stdout += text;
			outputStream.write(text);
		});

		child.stderr.on("data", (chunk: Buffer) => {
			outputStream.write(chunk.toString());
		});

		child.on("close", (exitCode) => {
			outputStream.end();
			resolve({ stdout, exitCode });
		});

		child.on("error", () => {
			outputStream.end();
			resolve({ stdout, exitCode: 1 });
		});
	});
}

function resolvePiPackageRootFallback(): string {
	// Try to resolve the main entry point and walk up to find the package root
	const entryPoint = require.resolve("@mariozechner/pi-coding-agent");
	// Entry point is typically /path/to/dist/index.js, so go up to find package root
	let dir = path.dirname(entryPoint);
	while (dir !== path.dirname(dir)) {
		const pkgJsonPath = path.join(dir, "package.json");
		try {
			const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
			if (pkg.name === "@mariozechner/pi-coding-agent") return dir;
		} catch {
			// Keep walking up until a readable package.json is found.
		}
		dir = path.dirname(dir);
	}
	throw new Error("Could not resolve @mariozechner/pi-coding-agent package root");
}

function writeJson(filePath: string, payload: object): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	const tempPath = path.join(
		path.dirname(filePath),
		`.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
	);
	try {
		fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), "utf-8");
		fs.renameSync(tempPath, filePath);
	} finally {
		if (fs.existsSync(tempPath)) {
			try {
				fs.unlinkSync(tempPath);
			} catch {}
		}
	}
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	const minutes = Math.floor(ms / 60000);
	const seconds = Math.floor((ms % 60000) / 1000);
	return `${minutes}m${seconds}s`;
}

function writeRunLog(
	logPath: string,
	input: {
		id: string;
		mode: "single" | "parallel";
		cwd: string;
		startedAt: number;
		endedAt: number;
		steps: Array<{
			agent: string;
			status: string;
			durationMs?: number;
		}>;
		summary: string;
		truncated: boolean;
		artifactsDir?: string;
		sessionFile?: string;
	},
): void {
	const lines: string[] = [];
	lines.push(`# Subagent run ${input.id}`);
	lines.push("");
	lines.push(`- **Mode:** ${input.mode}`);
	lines.push(`- **CWD:** ${input.cwd}`);
	lines.push(`- **Started:** ${new Date(input.startedAt).toISOString()}`);
	lines.push(`- **Ended:** ${new Date(input.endedAt).toISOString()}`);
	lines.push(`- **Duration:** ${formatDuration(input.endedAt - input.startedAt)}`);
	if (input.sessionFile) lines.push(`- **Session:** ${input.sessionFile}`);
	if (input.artifactsDir) lines.push(`- **Artifacts:** ${input.artifactsDir}`);
	lines.push("");
	lines.push("## Steps");
	lines.push("| Step | Agent | Status | Duration |");
	lines.push("| --- | --- | --- | --- |");
	input.steps.forEach((step, i) => {
		const duration = step.durationMs !== undefined ? formatDuration(step.durationMs) : "-";
		lines.push(`| ${i + 1} | ${step.agent} | ${step.status} | ${duration} |`);
	});
	lines.push("");
	lines.push("## Summary");
	if (input.truncated) {
		lines.push("_Output truncated_");
		lines.push("");
	}
	lines.push(input.summary.trim() || "(no output)");
	lines.push("");
	fs.writeFileSync(logPath, lines.join("\n"), "utf-8");
}

/** Context for running a single step */
interface SingleStepContext {
	previousOutput: string;
	placeholder: string;
	cwd: string;
	sessionEnabled: boolean;
	artifactsDir?: string;
	artifactConfig?: Partial<ArtifactConfig>;
	id: string;
	flatIndex: number;
	flatStepCount: number;
	outputFile: string;
	piPackageRoot?: string;
}

/** Run a single pi agent step, returning output and metadata */
async function runSingleStep(
	step: SubagentStep,
	ctx: SingleStepContext,
): Promise<{ agent: string; output: string; exitCode: number | null; artifactPaths?: ArtifactPaths }> {
	const placeholderRegex = new RegExp(ctx.placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
	const task = step.task.replace(placeholderRegex, () => ctx.previousOutput);
	const sessionEnabled = Boolean(step.sessionFile) || ctx.sessionEnabled;
	const outputSnapshot = captureSingleOutputSnapshot(step.outputPath);
	const { args, env, tempDir } = buildPiArgs({
		baseArgs: ["-p"],
		task,
		sessionEnabled,
		sessionFile: step.sessionFile,
		model: step.model,
		tools: step.tools,
		extensions: step.extensions,
		skills: step.skills,
		systemPrompt: step.systemPrompt,
		mcpDirectTools: step.mcpDirectTools,
		promptFileStem: step.agent,
	});

	let artifactPaths: ArtifactPaths | undefined;
	if (ctx.artifactsDir && ctx.artifactConfig?.enabled !== false) {
		const index = ctx.flatStepCount > 1 ? ctx.flatIndex : undefined;
		artifactPaths = getArtifactPaths(ctx.artifactsDir, ctx.id, step.agent, index);
		fs.mkdirSync(ctx.artifactsDir, { recursive: true });
		if (ctx.artifactConfig?.includeInput !== false) {
			fs.writeFileSync(artifactPaths.inputPath, `# Task for ${step.agent}\n\n${task}`, "utf-8");
		}
	}

	const result = await runPiStreaming(args, step.cwd ?? ctx.cwd, ctx.outputFile, env, ctx.piPackageRoot, step.maxSubagentDepth);
	cleanupTempDir(tempDir);

	const rawOutput = (result.stdout || "").trim();
	const resolvedOutput = step.outputPath && result.exitCode === 0
		? resolveSingleOutput(step.outputPath, rawOutput, outputSnapshot)
		: { fullOutput: rawOutput };
	const output = resolvedOutput.fullOutput;
	let outputForSummary = output;
	if (resolvedOutput.savedPath) {
		outputForSummary = output
			? `${output}\n\n📄 Output saved to: ${resolvedOutput.savedPath}`
			: `📄 Output saved to: ${resolvedOutput.savedPath}`;
	} else if (resolvedOutput.saveError && step.outputPath && result.exitCode === 0) {
		outputForSummary = output
			? `${output}\n\n⚠️ Failed to save output to: ${step.outputPath}\n${resolvedOutput.saveError}`
			: `⚠️ Failed to save output to: ${step.outputPath}\n${resolvedOutput.saveError}`;
	}

	if (artifactPaths && ctx.artifactConfig?.enabled !== false) {
		if (ctx.artifactConfig?.includeOutput !== false) {
			fs.writeFileSync(artifactPaths.outputPath, output, "utf-8");
		}
		if (ctx.artifactConfig?.includeMetadata !== false) {
			fs.writeFileSync(
				artifactPaths.metadataPath,
				JSON.stringify({
					runId: ctx.id,
					agent: step.agent,
					task,
					exitCode: result.exitCode,
					skills: step.skills,
					timestamp: Date.now(),
				}, null, 2),
				"utf-8",
			);
		}
	}

	return { agent: step.agent, output: outputForSummary, exitCode: result.exitCode, artifactPaths };
}

type RunnerStatusPayload = {
	runId: string;
	mode: "single" | "parallel";
	state: "queued" | "running" | "complete" | "failed";
	startedAt: number;
	endedAt?: number;
	lastUpdate: number;
	pid: number;
	cwd: string;
	currentStep: number;
	steps: Array<{
		agent: string;
		status: "pending" | "running" | "complete" | "failed";
		startedAt?: number;
		endedAt?: number;
		durationMs?: number;
		exitCode?: number | null;
		skills?: string[];
	}>;
	artifactsDir?: string;
	outputFile?: string;
	sessionFile?: string;
	error?: string;
};

function markParallelGroupSetupFailure(input: {
	statusPayload: RunnerStatusPayload;
	results: StepResult[];
	group: Extract<RunnerStep, { parallel: SubagentStep[] }>;
	groupStartFlatIndex: number;
	setupError: string;
	failedAt: number;
	statusPath: string;
	eventsPath: string;
	asyncDir: string;
	runId: string;
	stepIndex: number;
}): void {
	for (let taskIndex = 0; taskIndex < input.group.parallel.length; taskIndex++) {
		const flatTaskIndex = input.groupStartFlatIndex + taskIndex;
		input.statusPayload.steps[flatTaskIndex].status = "failed";
		input.statusPayload.steps[flatTaskIndex].startedAt = input.failedAt;
		input.statusPayload.steps[flatTaskIndex].endedAt = input.failedAt;
		input.statusPayload.steps[flatTaskIndex].durationMs = 0;
		input.statusPayload.steps[flatTaskIndex].exitCode = 1;
		input.results.push({ agent: input.group.parallel[taskIndex].agent, output: input.setupError, success: false });
	}
	input.statusPayload.currentStep = input.groupStartFlatIndex;
	input.statusPayload.lastUpdate = input.failedAt;
	input.statusPayload.outputFile = path.join(input.asyncDir, `output-${input.groupStartFlatIndex}.log`);
	writeJson(input.statusPath, input.statusPayload);
	appendJsonl(input.eventsPath, JSON.stringify({
		type: "subagent.parallel.completed",
		ts: input.failedAt,
		runId: input.runId,
		stepIndex: input.stepIndex,
		success: false,
	}));
}

function markParallelGroupRunning(input: {
	statusPayload: RunnerStatusPayload;
	group: Extract<RunnerStep, { parallel: SubagentStep[] }>;
	groupStartFlatIndex: number;
	groupStartTime: number;
	statusPath: string;
	eventsPath: string;
	asyncDir: string;
	runId: string;
	stepIndex: number;
}): void {
	for (let taskIndex = 0; taskIndex < input.group.parallel.length; taskIndex++) {
		const flatTaskIndex = input.groupStartFlatIndex + taskIndex;
		input.statusPayload.steps[flatTaskIndex].status = "running";
		input.statusPayload.steps[flatTaskIndex].startedAt = input.groupStartTime;
	}
	input.statusPayload.currentStep = input.groupStartFlatIndex;
	input.statusPayload.lastUpdate = input.groupStartTime;
	input.statusPayload.outputFile = path.join(input.asyncDir, `output-${input.groupStartFlatIndex}.log`);
	writeJson(input.statusPath, input.statusPayload);
	appendJsonl(input.eventsPath, JSON.stringify({
		type: "subagent.parallel.started",
		ts: input.groupStartTime,
		runId: input.runId,
		stepIndex: input.stepIndex,
		agents: input.group.parallel.map((task) => task.agent),
		count: input.group.parallel.length,
	}));
}

function prepareParallelTaskRun(
	task: SubagentStep,
	cwd: string,
	worktreeSetup: WorktreeSetup | undefined,
	taskIndex: number,
): { taskForRun: SubagentStep; taskCwd: string } {
	if (!worktreeSetup) return { taskForRun: task, taskCwd: cwd };
	return {
		taskForRun: { ...task, cwd: undefined },
		taskCwd: worktreeSetup.worktrees[taskIndex]!.agentCwd,
	};
}

async function runSubagent(config: SubagentRunConfig): Promise<void> {
	const { id, step, resultPath, cwd, placeholder, taskIndex, totalTasks, maxOutput, artifactsDir, artifactConfig } =
		config;
	const results: StepResult[] = [];
	const overallStartTime = Date.now();
	const asyncDir = config.asyncDir;
	const statusPath = path.join(asyncDir, "status.json");
	const eventsPath = path.join(asyncDir, "events.jsonl");
	const logPath = path.join(asyncDir, `subagent-log-${id}.md`);
	let latestSessionFile: string | undefined;

	// Flatten step for status tracking (parallel groups expand to individual entries)
	const flatSteps = isParallelGroup(step) ? step.parallel : [step];
	const sessionEnabled = flatSteps.some((s) => Boolean(s.sessionFile));
	const statusPayload: RunnerStatusPayload = {
		runId: id,
		mode: isParallelGroup(step) ? "parallel" : "single",
		state: "running",
		startedAt: overallStartTime,
		lastUpdate: overallStartTime,
		pid: process.pid,
		cwd,
		currentStep: 0,
		steps: flatSteps.map((s) => ({ agent: s.agent, status: "pending", skills: s.skills })),
		artifactsDir,
		outputFile: path.join(asyncDir, "output-0.log"),
	};

	fs.mkdirSync(asyncDir, { recursive: true });
	writeJson(statusPath, statusPayload);
	appendJsonl(
		eventsPath,
		JSON.stringify({
			type: "subagent.run.started",
			ts: overallStartTime,
			runId: id,
			mode: statusPayload.mode,
			cwd,
			pid: process.pid,
		}),
	);

	if (isParallelGroup(step)) {
		// === PARALLEL STEP GROUP ===
		const group = step;
		const concurrency = group.concurrency ?? MAX_PARALLEL_CONCURRENCY;
		const failFast = group.failFast ?? false;
		let aborted = false;
		let worktreeSetup: WorktreeSetup | undefined;
		if (group.worktree) {
			const worktreeTaskCwdConflict = findWorktreeTaskCwdConflict(group.parallel, cwd);
			if (worktreeTaskCwdConflict) {
				const failedAt = Date.now();
				markParallelGroupSetupFailure({
					statusPayload,
					results,
					group,
					groupStartFlatIndex: 0,
					setupError: formatWorktreeTaskCwdConflict(worktreeTaskCwdConflict, cwd),
					failedAt,
					statusPath,
					eventsPath,
					asyncDir,
					runId: id,
					stepIndex: 0,
				});
			} else {
				try {
					worktreeSetup = createWorktrees(cwd, `${id}-s0`, group.parallel.length, {
						rootDir: config.worktreeRootDir,
						requireIgnoredRoot: config.worktreeRequireIgnoredRoot,
						agents: group.parallel.map((task) => task.agent),
						setupHook: config.worktreeSetupHook
							? { hookPath: config.worktreeSetupHook, timeoutMs: config.worktreeSetupHookTimeoutMs }
							: undefined,
					});
				} catch (error) {
					const setupError = error instanceof Error ? error.message : String(error);
					const failedAt = Date.now();
					markParallelGroupSetupFailure({
						statusPayload,
						results,
						group,
						groupStartFlatIndex: 0,
						setupError,
						failedAt,
						statusPath,
						eventsPath,
						asyncDir,
						runId: id,
						stepIndex: 0,
					});
				}
			}
		}

		if (statusPayload.state === "running") {
			try {
				const groupStartTime = Date.now();
				markParallelGroupRunning({
					statusPayload,
					group,
					groupStartFlatIndex: 0,
					groupStartTime,
					statusPath,
					eventsPath,
					asyncDir,
					runId: id,
					stepIndex: 0,
				});
				const parallelResults = await mapConcurrent(
					group.parallel,
					concurrency,
					async (task, taskIdx) => {
						if (aborted && failFast) {
							return { agent: task.agent, output: "(skipped — fail-fast)", exitCode: -1 as number | null, skipped: true };
						}

						const taskStartTime = Date.now();
						appendJsonl(eventsPath, JSON.stringify({
							type: "subagent.step.started", ts: taskStartTime, runId: id, stepIndex: taskIdx, agent: task.agent,
						}));

						const { taskForRun, taskCwd } = prepareParallelTaskRun(task, cwd, worktreeSetup, taskIdx);

						const singleResult = await runSingleStep(taskForRun, {
							previousOutput: "", placeholder, cwd: taskCwd, sessionEnabled,
							artifactsDir, artifactConfig, id,
							flatIndex: taskIdx, flatStepCount: flatSteps.length,
							outputFile: path.join(asyncDir, `output-${taskIdx}.log`),
							piPackageRoot: config.piPackageRoot,
						});
						if (task.sessionFile) {
							latestSessionFile = task.sessionFile;
						}

						const taskEndTime = Date.now();
						const taskDuration = taskEndTime - taskStartTime;

						statusPayload.steps[taskIdx].status = singleResult.exitCode === 0 ? "complete" : "failed";
						statusPayload.steps[taskIdx].endedAt = taskEndTime;
						statusPayload.steps[taskIdx].durationMs = taskDuration;
						statusPayload.steps[taskIdx].exitCode = singleResult.exitCode;
						statusPayload.lastUpdate = taskEndTime;
						writeJson(statusPath, statusPayload);

						appendJsonl(eventsPath, JSON.stringify({
							type: singleResult.exitCode === 0 ? "subagent.step.completed" : "subagent.step.failed",
							ts: taskEndTime, runId: id, stepIndex: taskIdx, agent: task.agent,
							exitCode: singleResult.exitCode, durationMs: taskDuration,
						}));

						if (singleResult.exitCode !== 0 && failFast) aborted = true;
						return { ...singleResult, skipped: false };
					},
				);

				for (const pr of parallelResults) {
					results.push({
						agent: pr.agent,
						output: pr.output,
						success: pr.exitCode === 0,
						skipped: pr.skipped,
						artifactPaths: pr.artifactPaths,
					});
				}

				appendJsonl(eventsPath, JSON.stringify({
					type: "subagent.parallel.completed",
					ts: Date.now(),
					runId: id,
					stepIndex: 0,
					success: parallelResults.every((r) => r.exitCode === 0 || r.exitCode === -1),
				}));
			} finally {
				if (worktreeSetup) cleanupWorktrees(worktreeSetup);
			}
		}
	} else {
		// === SINGLE STEP ===
		const seqStep = step as SubagentStep;
		const stepStartTime = Date.now();
		statusPayload.currentStep = 0;
		statusPayload.steps[0].status = "running";
		statusPayload.steps[0].skills = seqStep.skills;
		statusPayload.steps[0].startedAt = stepStartTime;
		statusPayload.lastUpdate = stepStartTime;
		statusPayload.outputFile = path.join(asyncDir, "output-0.log");
		writeJson(statusPath, statusPayload);

		appendJsonl(eventsPath, JSON.stringify({
			type: "subagent.step.started",
			ts: stepStartTime,
			runId: id,
			stepIndex: 0,
			agent: seqStep.agent,
		}));

		const singleResult = await runSingleStep(seqStep, {
			previousOutput: "", placeholder, cwd, sessionEnabled,
			artifactsDir, artifactConfig, id,
			flatIndex: 0, flatStepCount: 1,
			outputFile: path.join(asyncDir, "output-0.log"),
			piPackageRoot: config.piPackageRoot,
		});
		if (seqStep.sessionFile) {
			latestSessionFile = seqStep.sessionFile;
		}

		results.push({
			agent: singleResult.agent,
			output: singleResult.output,
			success: singleResult.exitCode === 0,
			artifactPaths: singleResult.artifactPaths,
		});

		const stepEndTime = Date.now();
		statusPayload.steps[0].status = singleResult.exitCode === 0 ? "complete" : "failed";
		statusPayload.steps[0].endedAt = stepEndTime;
		statusPayload.steps[0].durationMs = stepEndTime - stepStartTime;
		statusPayload.steps[0].exitCode = singleResult.exitCode;
		statusPayload.lastUpdate = stepEndTime;
		writeJson(statusPath, statusPayload);

		appendJsonl(eventsPath, JSON.stringify({
			type: singleResult.exitCode === 0 ? "subagent.step.completed" : "subagent.step.failed",
			ts: stepEndTime,
			runId: id,
			stepIndex: 0,
			agent: seqStep.agent,
			exitCode: singleResult.exitCode,
			durationMs: stepEndTime - stepStartTime,
		}));
	}

	let summary = results.map((r) => `${r.agent}:\n${r.output}`).join("\n\n");
	let truncated = false;

	if (maxOutput) {
		const config = { ...DEFAULT_MAX_OUTPUT, ...maxOutput };
		const lastArtifactPath = results[results.length - 1]?.artifactPaths?.outputPath;
		const truncResult = truncateOutput(summary, config, lastArtifactPath);
		if (truncResult.truncated) {
			summary = truncResult.text;
			truncated = true;
		}
	}

	const agentName = flatSteps.length === 1
		? flatSteps[0].agent
		: "parallel";
	const effectiveSessionFile = latestSessionFile;

	const runEndedAt = Date.now();
	statusPayload.state = results.every((r) => r.success) ? "complete" : "failed";
	statusPayload.endedAt = runEndedAt;
	statusPayload.lastUpdate = runEndedAt;
	statusPayload.sessionFile = effectiveSessionFile;
	if (statusPayload.state === "failed") {
		const failedStep = statusPayload.steps.find((s) => s.status === "failed");
		if (failedStep?.agent) {
			statusPayload.error = `Step failed: ${failedStep.agent}`;
		}
	}
	writeJson(statusPath, statusPayload);
	appendJsonl(
		eventsPath,
		JSON.stringify({
			type: "subagent.run.completed",
			ts: runEndedAt,
			runId: id,
			status: statusPayload.state,
			durationMs: runEndedAt - overallStartTime,
		}),
	);
	writeRunLog(logPath, {
		id,
		mode: statusPayload.mode,
		cwd,
		startedAt: overallStartTime,
		endedAt: runEndedAt,
		steps: statusPayload.steps.map((step) => ({
			agent: step.agent,
			status: step.status,
			durationMs: step.durationMs,
		})),
		summary,
		truncated,
		artifactsDir,
		sessionFile: effectiveSessionFile,
	});

	try {
		writeJson(resultPath, {
			id,
			agent: agentName,
			success: results.every((r) => r.success),
			summary,
			results: results.map((r) => ({
				agent: r.agent,
				output: r.output,
				success: r.success,
				skipped: r.skipped || undefined,
				artifactPaths: r.artifactPaths,
				truncated: r.truncated,
			})),
			exitCode: results.every((r) => r.success) ? 0 : 1,
			timestamp: runEndedAt,
			durationMs: runEndedAt - overallStartTime,
			truncated,
			artifactsDir,
			cwd,
			asyncDir,
			sessionId: config.sessionId,
			sessionFile: effectiveSessionFile,
			...(taskIndex !== undefined && { taskIndex }),
			...(totalTasks !== undefined && { totalTasks }),
		});
	} catch (err) {
		console.error(`Failed to write result file ${resultPath}:`, err);
	}
}

const configArg = process.argv[2];
if (configArg) {
	try {
		const configJson = fs.readFileSync(configArg, "utf-8");
		const config = JSON.parse(configJson) as SubagentRunConfig;
		try {
			fs.unlinkSync(configArg);
		} catch {
			// Temp config cleanup is best effort.
		}
		runSubagent(config).catch((runErr) => {
			console.error("Subagent runner error:", runErr);
			process.exit(1);
		});
	} catch (err) {
		console.error("Subagent runner error:", err);
		process.exit(1);
	}
} else {
	let input = "";
	process.stdin.setEncoding("utf-8");
	process.stdin.on("data", (chunk) => {
		input += chunk;
	});
	process.stdin.on("end", () => {
		try {
			const config = JSON.parse(input) as SubagentRunConfig;
			runSubagent(config).catch((runErr) => {
				console.error("Subagent runner error:", runErr);
				process.exit(1);
			});
		} catch (err) {
			console.error("Subagent runner error:", err);
			process.exit(1);
		}
	});
}
