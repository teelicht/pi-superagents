import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { buildCompletionKey, markSeenWithTtl } from "./completion-dedupe.ts";
import { createFileCoalescer } from "./file-coalescer.ts";
import type { SubagentState } from "../shared/types.ts";

function isNotFoundError(error: unknown): boolean {
	return typeof error === "object"
		&& error !== null
		&& "code" in error
		&& (error as NodeJS.ErrnoException).code === "ENOENT";
}

export function createResultWatcher(
	pi: ExtensionAPI,
	state: SubagentState,
	resultsDir: string,
	completionTtlMs: number,
): {
	startResultWatcher: () => void;
	primeExistingResults: () => void;
	stopResultWatcher: () => void;
} {
	const handleResult = (file: string) => {
		const resultPath = path.join(resultsDir, file);
		if (!fs.existsSync(resultPath)) return;
		try {
			const data = JSON.parse(fs.readFileSync(resultPath, "utf-8")) as {
				sessionId?: string;
				cwd?: string;
			};
			if (data.sessionId && data.sessionId !== state.currentSessionId) return;
			if (!data.sessionId && data.cwd && data.cwd !== state.baseCwd) return;

			const now = Date.now();
			const completionKey = buildCompletionKey(data, `result:${file}`);
			if (markSeenWithTtl(state.completionSeen, completionKey, now, completionTtlMs)) {
				try {
					fs.unlinkSync(resultPath);
				} catch {}
				return;
			}

			pi.events.emit("subagent:complete", data);
			fs.unlinkSync(resultPath);
		} catch (error) {
			if (isNotFoundError(error)) return;
			console.error(`Failed to process subagent result file '${resultPath}':`, error);
		}
	};

	state.resultFileCoalescer = createFileCoalescer(handleResult, 50);

	const scheduleRestart = () => {
		state.watcherRestartTimer = setTimeout(() => {
			try {
				fs.mkdirSync(resultsDir, { recursive: true });
				startResultWatcher();
			} catch (error) {
				console.error(`Failed to restart subagent result watcher for '${resultsDir}':`, error);
			}
		}, 3000);
	};

	const startResultWatcher = () => {
		state.watcherRestartTimer = null;
		try {
			state.watcher = fs.watch(resultsDir, (ev, file) => {
				if (ev !== "rename" || !file) return;
				const fileName = file.toString();
				if (!fileName.endsWith(".json")) return;
				state.resultFileCoalescer.schedule(fileName);
			});
			state.watcher.on("error", (error) => {
				console.error(`Subagent result watcher failed for '${resultsDir}':`, error);
				state.watcher = null;
				scheduleRestart();
			});
			state.watcher.unref?.();
		} catch (error) {
			console.error(`Failed to start subagent result watcher for '${resultsDir}':`, error);
			state.watcher = null;
			scheduleRestart();
		}
	};

	const primeExistingResults = () => {
		fs.readdirSync(resultsDir)
			.filter((f) => f.endsWith(".json"))
			.forEach((file) => state.resultFileCoalescer.schedule(file, 0));
	};

	const stopResultWatcher = () => {
		state.watcher?.close();
		state.watcher = null;
		if (state.watcherRestartTimer) {
			clearTimeout(state.watcherRestartTimer);
		}
		state.watcherRestartTimer = null;
		state.resultFileCoalescer.clear();
	};

	return { startResultWatcher, primeExistingResults, stopResultWatcher };
}
