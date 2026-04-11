import * as fs from "node:fs";
import * as path from "node:path";
import { formatDuration, shortenPath } from "../shared/formatters.ts";
import { type AsyncStatus } from "../shared/types.ts";
import { readStatus } from "../shared/utils.ts";

export interface AsyncRunStepSummary {
	index: number;
	agent: string;
	status: string;
	durationMs?: number;
	skills?: string[];
}

export interface AsyncRunSummary {
	id: string;
	asyncDir: string;
	state: "queued" | "running" | "complete" | "failed";
	mode: "single" | "chain";
	cwd?: string;
	startedAt: number;
	lastUpdate?: number;
	endedAt?: number;
	currentStep?: number;
	steps: AsyncRunStepSummary[];
	outputFile?: string;
	sessionFile?: string;
}

export interface AsyncRunListOptions {
	states?: Array<AsyncRunSummary["state"]>;
	limit?: number;
}

export interface AsyncRunOverlayData {
	active: AsyncRunSummary[];
	recent: AsyncRunSummary[];
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isNotFoundError(error: unknown): boolean {
	return typeof error === "object"
		&& error !== null
		&& "code" in error
		&& (error as NodeJS.ErrnoException).code === "ENOENT";
}

function isAsyncRunDir(root: string, entry: string): boolean {
	const entryPath = path.join(root, entry);
	try {
		return fs.statSync(entryPath).isDirectory();
	} catch (error) {
		if (isNotFoundError(error)) return false;
		throw new Error(`Failed to inspect async run path '${entryPath}': ${getErrorMessage(error)}`, {
			cause: error instanceof Error ? error : undefined,
		});
	}
}

function statusToSummary(asyncDirRoot: string, entry: string, status: AsyncStatus & { cwd?: string }): AsyncRunSummary {
	const asyncDir = path.join(asyncDirRoot, entry);
	return {
		id: status.runId || entry,
		asyncDir,
		state: status.state,
		mode: status.mode as "single" | "chain",
		cwd: status.cwd,
		startedAt: status.startedAt,
		lastUpdate: status.lastUpdate,
		endedAt: status.endedAt,
		currentStep: (status as any).currentStep,
		steps: (status.steps ?? []).map((step, index) => ({
			index,
			agent: step.agent,
			status: step.status,
			...(step.durationMs !== undefined ? { durationMs: step.durationMs } : {}),
			...(step.skills ? { skills: step.skills } : {}),
		})),
		...(status.outputFile ? { outputFile: status.outputFile } : {}),
		...(status.sessionFile ? { sessionFile: status.sessionFile } : {}),
	};
}

function sortRuns(runs: AsyncRunSummary[]): AsyncRunSummary[] {
	const rank = (state: AsyncRunSummary["state"]): number => {
		switch (state) {
			case "running": return 0;
			case "queued": return 1;
			case "failed": return 2;
			case "complete": return 3;
		}
	};
	return [...runs].sort((a, b) => {
		const byState = rank(a.state) - rank(b.state);
		if (byState !== 0) return byState;
		const aTime = a.lastUpdate ?? a.endedAt ?? a.startedAt;
		const bTime = b.lastUpdate ?? b.endedAt ?? b.startedAt;
		return bTime - aTime;
	});
}

export function listAsyncRuns(asyncDirRoot: string, options: AsyncRunListOptions = {}): AsyncRunSummary[] {
	let entries: string[];
	try {
		entries = fs.readdirSync(asyncDirRoot).filter((entry) => isAsyncRunDir(asyncDirRoot, entry));
	} catch (error) {
		if (isNotFoundError(error)) return [];
		throw new Error(`Failed to list async runs in '${asyncDirRoot}': ${getErrorMessage(error)}`, {
			cause: error instanceof Error ? error : undefined,
		});
	}

	const allowedStates = options.states ? new Set(options.states) : undefined;
	const runs: AsyncRunSummary[] = [];
	for (const entry of entries) {
		const asyncDir = path.join(asyncDirRoot, entry);
		const status = readStatus(asyncDir) as (AsyncStatus & { cwd?: string }) | null;
		if (!status) continue;
		const summary = statusToSummary(asyncDirRoot, entry, status);
		if (allowedStates && !allowedStates.has(summary.state)) continue;
		runs.push(summary);
	}

	const sorted = sortRuns(runs);
	return options.limit !== undefined ? sorted.slice(0, options.limit) : sorted;
}

export function listAsyncRunsForOverlay(asyncDirRoot: string, recentLimit = 5): AsyncRunOverlayData {
	const all = listAsyncRuns(asyncDirRoot);
	const recent = all
		.filter((run) => run.state === "complete" || run.state === "failed")
		.sort((a, b) => (b.lastUpdate ?? b.endedAt ?? b.startedAt) - (a.lastUpdate ?? a.endedAt ?? a.startedAt))
		.slice(0, recentLimit);
	return {
		active: all.filter((run) => run.state === "queued" || run.state === "running"),
		recent,
	};
}

function formatStepLine(step: AsyncRunStepSummary): string {
	const parts = [`${step.index + 1}. ${step.agent}`, step.status];
	if (step.durationMs !== undefined) parts.push(formatDuration(step.durationMs));
	return parts.join(" | ");
}

function formatRunHeader(run: AsyncRunSummary): string {
	const stepCount = run.steps.length || 1;
	const stepLabel = run.currentStep !== undefined ? `step ${run.currentStep + 1}/${stepCount}` : `steps ${stepCount}`;
	const cwd = run.cwd ? shortenPath(run.cwd) : shortenPath(run.asyncDir);
	return `${run.id} | ${run.state} | ${run.mode} | ${stepLabel} | ${cwd}`;
}

export function formatAsyncRunList(runs: AsyncRunSummary[], heading = "Active async runs"): string {
	if (runs.length === 0) return `No ${heading.toLowerCase()}.`;

	const lines = [`${heading}: ${runs.length}`, ""];
	for (const run of runs) {
		lines.push(`- ${formatRunHeader(run)}`);
		for (const step of run.steps) {
			lines.push(`  ${formatStepLine(step)}`);
		}
		if (run.sessionFile) lines.push(`  session: ${shortenPath(run.sessionFile)}`);
		lines.push("");
	}
	return lines.join("\n").trimEnd();
}
