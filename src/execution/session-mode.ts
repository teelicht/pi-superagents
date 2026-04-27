/**
 * Session-mode resolution and child-session launch helpers.
 *
 * Responsibilities:
 * - resolve effective session modes across explicit params, legacy aliases, agent defaults, and system defaults
 * - seed lineage-only child sessions that link to a parent without copying conversation turns
 * - preserve forked-session behavior through a single launch resolver interface
 *
 * Important dependencies or side effects:
 * - writes session JSONL headers to disk for lineage-only launches
 * - delegates forked-session creation to the runtime session manager
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { LegacyExecutionContext, SessionMode, TaskDeliveryMode } from "../shared/types.ts";

export interface SessionLaunchManager {
	getSessionFile(): string | undefined;
	getLeafId(): string | null;
	createBranchedSession(leafId: string): string | undefined;
}

export interface SessionLaunchResolver {
	sessionFileForIndex(input: {
		sessionMode: SessionMode;
		index?: number;
		childCwd: string;
	}): string | undefined;
}

/**
 * Resolve the effective session mode for a child launch request.
 *
 * Precedence is:
 * 1. explicit `sessionMode`
 * 2. deprecated `context` alias
 * 3. agent frontmatter default
 * 4. system default
 *
 * @param input Session-mode inputs gathered from callers and agent config.
 * @returns Effective session mode for the child launch.
 */
export function resolveRequestedSessionMode(input: {
	sessionMode?: unknown;
	context?: unknown;
	agentSessionMode?: SessionMode;
	defaultSessionMode?: SessionMode;
}): SessionMode {
	if (input.sessionMode === "standalone" || input.sessionMode === "lineage-only" || input.sessionMode === "fork") {
		return input.sessionMode;
	}
	if (input.context === "fork") return "fork";
	if (input.context === "fresh") return "standalone";
	return input.agentSessionMode ?? input.defaultSessionMode ?? "standalone";
}

/**
 * Map a session mode to its current task-delivery mode.
 *
 * @param sessionMode Effective child session mode.
 * @returns `direct` for inherited fork launches and `artifact` for non-fork launches.
 */
export function resolveTaskDeliveryMode(sessionMode: SessionMode): TaskDeliveryMode {
	return sessionMode === "fork" ? "direct" : "artifact";
}

/**
 * Seed a lineage-only child session file with a parent link and no turns.
 *
 * @param params Parent/session metadata for the child launch.
 */
export function seedLineageOnlySessionFile(params: {
	parentSessionFile: string;
	childSessionFile: string;
	childCwd: string;
}): void {
	const header = {
		type: "session",
		version: 3,
		id: randomUUID(),
		timestamp: new Date().toISOString(),
		cwd: params.childCwd,
		parentSession: params.parentSessionFile,
	};

	fs.mkdirSync(path.dirname(params.childSessionFile), { recursive: true });
	fs.writeFileSync(params.childSessionFile, `${JSON.stringify(header)}\n`, "utf-8");
}

/**
 * Create a stable path for a seeded lineage-only child session.
 *
 * @param sessionRoot Run-scoped session directory.
 * @param index Child index within the current run.
 * @returns Absolute session file path for the child.
 */
function getLineageOnlySessionPath(sessionRoot: string, index: number): string {
	return path.join(sessionRoot, `child-${index}.jsonl`);
}

/**
 * Create a resolver that preserves fork behavior and adds lineage-only seeding.
 *
 * @param input Runtime launch dependencies for child session creation.
 * @returns Resolver that returns the effective session file for each child index.
 */
export function createSessionLaunchResolver(input: {
	sessionManager: SessionLaunchManager;
	sessionRoot: string;
}): SessionLaunchResolver {
	const forkedSessionFiles = new Map<number, string>();
	const lineageOnlySessionFiles = new Map<number, string>();

	return {
		sessionFileForIndex({
			sessionMode,
			index = 0,
			childCwd,
		}: {
			sessionMode: SessionMode;
			index?: number;
			childCwd: string;
		}): string | undefined {
			if (sessionMode === "standalone") return undefined;

			const parentSessionFile = input.sessionManager.getSessionFile();
			if (!parentSessionFile) {
				const modeLabel = sessionMode === "fork" ? "Forked" : "Lineage-only";
				throw new Error(`${modeLabel} subagent context requires a persisted parent session.`);
			}

			if (sessionMode === "lineage-only") {
				const cachedSessionFile = lineageOnlySessionFiles.get(index);
				if (cachedSessionFile) return cachedSessionFile;
				const sessionFile = getLineageOnlySessionPath(input.sessionRoot, index);
				seedLineageOnlySessionFile({
					parentSessionFile,
					childSessionFile: sessionFile,
					childCwd,
				});
				lineageOnlySessionFiles.set(index, sessionFile);
				return sessionFile;
			}

			const cachedSessionFile = forkedSessionFiles.get(index);
			if (cachedSessionFile) return cachedSessionFile;

			const leafId = input.sessionManager.getLeafId();
			if (!leafId) {
				throw new Error("Forked subagent context requires a current leaf to fork from.");
			}

			try {
				const sessionFile = input.sessionManager.createBranchedSession(leafId);
				if (!sessionFile) {
					throw new Error("Session manager did not return a session file.");
				}
				forkedSessionFiles.set(index, sessionFile);
				return sessionFile;
			} catch (error) {
				const cause = error instanceof Error ? error : new Error(String(error));
				throw new Error(`Failed to create forked subagent session: ${cause.message}`, { cause });
			}
		},
	};
}
