import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface RunEntry {
	agent: string;
	task: string;
	ts: number;
	status: "ok" | "error";
	duration: number;
	exit?: number;
}

const HISTORY_PATH = path.join(os.homedir(), ".pi", "agent", "run-history.jsonl");
const ROTATE_READ_THRESHOLD = 1200;
const ROTATE_KEEP = 1000;

export function recordRun(agent: string, task: string, exitCode: number, durationMs: number): void {
	try {
		const entry: RunEntry = {
			agent,
			task: task.slice(0, 200),
			ts: Math.floor(Date.now() / 1000),
			status: exitCode === 0 ? "ok" : "error",
			duration: durationMs,
			...(exitCode !== 0 ? { exit: exitCode } : { /* empty */ }),
		};
		fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
		fs.appendFileSync(HISTORY_PATH, `${JSON.stringify(entry)}\n`);
	} catch {
		// Best-effort — never crash the execution flow for history recording
	}
}

export function loadRunsForAgent(agent: string): RunEntry[] {
	if (!fs.existsSync(HISTORY_PATH)) return [];
	let raw: string;
	try {
		raw = fs.readFileSync(HISTORY_PATH, "utf-8");
	} catch {
		return [];
	}

	let lines = raw.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);

	if (lines.length > ROTATE_READ_THRESHOLD) {
		lines = lines.slice(-ROTATE_KEEP);
		try { fs.writeFileSync(HISTORY_PATH, `${lines.join("\n")}\n`, "utf-8"); } catch { /* empty */ }
	}

	return lines
		.map((line) => { try { return JSON.parse(line) as RunEntry; } catch { return undefined; } })
		.filter((entry): entry is RunEntry => entry !== undefined && entry.agent === agent)
		.reverse();
}

/**
 * Load all recent runs from the history file.
 *
 * @returns Array of run entries, newest first.
 */
export function loadAllRuns(): RunEntry[] {
	if (!fs.existsSync(HISTORY_PATH)) return [];
	let raw: string;
	try {
		raw = fs.readFileSync(HISTORY_PATH, "utf-8");
	} catch {
		return [];
	}

	const lines = raw.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);

	return lines
		.map((line) => {
			try {
				return JSON.parse(line) as RunEntry;
			} catch {
				return undefined;
			}
		})
		.filter((entry): entry is RunEntry => Boolean(entry))
		.reverse();
}

/**
 * Global run history accessor for UI components.
 */
export const globalRunHistory = {
	/**
	 * Get the most recent runs.
	 *
	 * @param limit - Maximum number of runs to return.
	 * @returns Array of recent run entries.
	 */
	getRecent(limit = 50): RunEntry[] {
		return loadAllRuns().slice(0, limit);
	},
};
