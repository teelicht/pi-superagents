/**
 * Module: Fork Context Resolution
 *
 * Purpose: Manages the context ("fresh" or "fork") and history inheritance for subagent execution sessions.
 * Key responsibilities:
 * - Determines if a subagent should start from scratch or inherit the parent's session state.
 * - Lazily clones and caches parent session files (forks) on demand using a given session manager.
 * Important dependencies or side effects:
 * - Interacts with `ForkableSessionManager` implementations to access and copy file-based session states.
 * - Caches cloned sessions in-memory by index to avoid unnecessary duplicate on-disk forks.
 */

export type SubagentExecutionContext = "fresh" | "fork";

export interface ForkableSessionManager {
	getSessionFile(): string | undefined;
	getLeafId(): string | null;
	createBranchedSession(leafId: string): string | undefined;
}

export interface ForkContextResolver {
	sessionFileForIndex(index?: number): string | undefined;
}

export function resolveSubagentContext(value: unknown): SubagentExecutionContext {
	return value === "fork" ? "fork" : "fresh";
}

export function createForkContextResolver(
	sessionManager: ForkableSessionManager,
	requestedContext: unknown,
): ForkContextResolver {
	if (resolveSubagentContext(requestedContext) !== "fork") {
		return {
			sessionFileForIndex: () => undefined,
		};
	}

	const parentSessionFile = sessionManager.getSessionFile();
	if (!parentSessionFile) {
		throw new Error("Forked subagent context requires a persisted parent session.");
	}

	const leafId = sessionManager.getLeafId();
	if (!leafId) {
		throw new Error("Forked subagent context requires a current leaf to fork from.");
	}

	const cachedSessionFiles = new Map<number, string>();

	return {
		sessionFileForIndex(index = 0): string | undefined {
			const cached = cachedSessionFiles.get(index);
			if (cached) return cached;
			try {
				const sessionFile = sessionManager.createBranchedSession(leafId);
				if (!sessionFile) {
					throw new Error("Session manager did not return a session file.");
				}
				cachedSessionFiles.set(index, sessionFile);
				return sessionFile;
			} catch (error) {
				const cause = error instanceof Error ? error : new Error(String(error));
				throw new Error(`Failed to create forked subagent session: ${cause.message}`, { cause });
			}
		},
	};
}
