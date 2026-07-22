/**
 * Session-mode resolution and child-session launch helpers.
 *
 * Responsibilities:
 * - resolve effective session modes across explicit params, legacy aliases, agent defaults, and system defaults
 * - seed lineage-only child sessions that link to a parent without copying conversation turns
 * - preserve forked-session behavior through a single launch resolver interface
 * - validate resumed lineage-only session files for the bounded sp-implementer role
 *
 * Important dependencies or side effects:
 * - writes session JSONL headers to disk for lineage-only launches
 * - delegates forked-session creation to the runtime session manager
 * - reads the first JSONL line of a resumed session file to verify parent, cwd, role, and mode
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { SessionMode, TaskDeliveryMode } from "../shared/types.ts";

/** Pi-superagents marker block attached to every seeded lineage-only session header. */
const PI_SUPERAGENTS_OWNER = "pi-superagents";

/** The bounded implementer role authorized to resume lineage-only sessions. */
const RESUMABLE_IMPLEMENTER_AGENT = "sp-implementer";

export interface SessionLaunchManager {
	getSessionFile(): string | undefined;
	getLeafId(): string | null;
	createBranchedSession(leafId: string): string | undefined;
}

/**
 * Input contract for `sessionFileForIndex`.
 *
 * @see SessionLaunchResolver
 */
export interface SessionFileForIndexInput {
	sessionMode: SessionMode;
	index?: number;
	childCwd: string;
	/** Agent name driving the launch; required when `resumeSession` is supplied. */
	agentName: string;
	/** Optional path to a pre-existing lineage-only session file to continue. */
	resumeSession?: string;
}

export interface SessionLaunchResolver {
	sessionFileForIndex(input: SessionFileForIndexInput): string | undefined;
}

/**
 * Input contract for `validateResumeSessionFile`.
 *
 * @see validateResumeSessionFile
 */
export interface ValidateResumeSessionInput {
	/** Absolute path to the resumed lineage-only session JSONL file. */
	resumeSession: string;
	/** Resolved parent session path the resumed child must link back to. */
	parentSessionFile: string;
	/** Resolved cwd the resumed child was originally seeded for. */
	childCwd: string;
}

/**
 * Resolve the effective session mode for a child launch request.
 *
 * Precedence is:
 * 1. explicit `sessionMode`
 * 2. agent frontmatter default
 * 3. system default
 *
 * @param input Session-mode inputs gathered from callers and agent config.
 * @returns Effective session mode for the child launch.
 */
export function resolveRequestedSessionMode(input: { sessionMode?: unknown; agentSessionMode?: SessionMode; defaultSessionMode?: SessionMode }): SessionMode {
	if (input.sessionMode === "standalone" || input.sessionMode === "lineage-only" || input.sessionMode === "fork") {
		return input.sessionMode;
	}
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
 * Normalize a path for comparison against seeded or expected values.
 *
 * `path.resolve` handles relative segments; `fs.realpathSync` is used when the
 * file or directory exists so symlinks compare equal to their canonical targets.
 *
 * @param targetPath Path to canonicalize for header comparisons.
 * @returns Comparable absolute path.
 */
function resolveComparablePath(targetPath: string): string {
	const resolved = path.resolve(targetPath);
	try {
		return fs.realpathSync(resolved);
	} catch {
		return resolved;
	}
}

/**
 * Seed a lineage-only child session file with a parent link, no turns, and a
 * pi-superagents marker.
 *
 * The marker carries the agent name, the lineage-only mode, and a constant
 * owner so resumed sessions can be validated without trusting file contents.
 *
 * @param params Parent/session metadata for the child launch.
 */
export function seedLineageOnlySessionFile(params: { parentSessionFile: string; childSessionFile: string; childCwd: string; agentName: string }): void {
	const header = {
		type: "session",
		version: 3,
		id: randomUUID(),
		timestamp: new Date().toISOString(),
		cwd: params.childCwd,
		parentSession: params.parentSessionFile,
		piSuperagents: {
			owner: PI_SUPERAGENTS_OWNER,
			agent: params.agentName,
			sessionMode: "lineage-only" as const,
		},
	};

	fs.mkdirSync(path.dirname(params.childSessionFile), { recursive: true });
	fs.writeFileSync(params.childSessionFile, `${JSON.stringify(header)}\n`, "utf-8");
}

/**
 * Read and parse the first JSONL line of a session file.
 *
 * Only the first line is consumed because lineage-only resumed sessions must
 * not accumulate new turns before validation. Any subsequent content is
 * ignored by the resume contract.
 *
 * @param sessionFile Absolute path to a JSONL session file.
 * @returns Parsed header object, or `undefined` if the file is empty.
 */
function readFirstSessionLine(sessionFile: string): Record<string, unknown> | undefined {
	const raw = fs.readFileSync(sessionFile, "utf-8");
	const firstLine = raw.split("\n", 1)[0]?.trim();
	if (!firstLine) return undefined;
	return JSON.parse(firstLine) as Record<string, unknown>;
}

/**
 * Validate a resumed lineage-only session file for the bounded sp-implementer
 * role.
 *
 * The check is intentionally narrow: it only confirms the file is present, the
 * header is well-formed, the marker matches the pi-superagents owner and the
 * sp-implementer agent, the mode is `lineage-only`, and the resolved parent
 * path and cwd match the supplied context. It returns the resolved session
 * path so callers can launch the existing file directly.
 *
 * @param input Resume request and the parent/cwd the resume must match.
 * @returns Resolved absolute path to the validated session file.
 */
export function validateResumeSessionFile(input: ValidateResumeSessionInput): string {
	const resolved = path.resolve(input.resumeSession);
	if (!fs.existsSync(resolved)) {
		throw new Error(`resume session file does not exist: ${resolved}`);
	}

	let header: Record<string, unknown> | undefined;
	try {
		header = readFirstSessionLine(resolved);
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : String(cause);
		throw new Error(`malformed session header in ${resolved}: ${message}`);
	}
	if (!header) {
		throw new Error(`malformed session header in ${resolved}: file is empty`);
	}

	const marker = header.piSuperagents as Record<string, unknown> | undefined;
	if (!marker || typeof marker !== "object") {
		throw new Error(`missing pi-superagents marker in resumed session ${resolved}`);
	}
	if (marker.owner !== PI_SUPERAGENTS_OWNER) {
		throw new Error(`resumed session ${resolved} owner is not ${PI_SUPERAGENTS_OWNER}`);
	}
	if (marker.agent !== RESUMABLE_IMPLEMENTER_AGENT) {
		throw new Error(`resumed session ${resolved} agent is not ${RESUMABLE_IMPLEMENTER_AGENT}`);
	}
	if (marker.sessionMode !== "lineage-only") {
		throw new Error(`resumed session ${resolved} session mode is not lineage-only`);
	}

	const headerParent = typeof header.parentSession === "string" ? header.parentSession : undefined;
	if (!headerParent) {
		throw new Error(`resumed session ${resolved} is missing parent session path`);
	}
	if (resolveComparablePath(headerParent) !== resolveComparablePath(input.parentSessionFile)) {
		throw new Error(`resumed session ${resolved} parent session does not match the current parent`);
	}

	const headerCwd = typeof header.cwd === "string" ? header.cwd : undefined;
	if (!headerCwd) {
		throw new Error(`resumed session ${resolved} is missing cwd`);
	}
	if (resolveComparablePath(headerCwd) !== resolveComparablePath(input.childCwd)) {
		throw new Error(`resumed session ${resolved} cwd does not match the current child cwd`);
	}

	return resolved;
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
 * Create a resolver that preserves fork behavior, lineage-only seeding, and
 * lineage-only session continuation.
 *
 * @param input Runtime launch dependencies for child session creation.
 * @returns Resolver that returns the effective session file for each child index.
 */
export function createSessionLaunchResolver(input: { sessionManager: SessionLaunchManager; sessionRoot: string }): SessionLaunchResolver {
	const forkedSessionFiles = new Map<number, string>();
	const lineageOnlySessionFiles = new Map<number, string>();
	const resumedSessionFiles = new Set<string>();

	return {
		sessionFileForIndex({ sessionMode, index = 0, childCwd, agentName, resumeSession }: SessionFileForIndexInput): string | undefined {
			if (sessionMode === "standalone") return undefined;

			if (resumeSession) {
				if (sessionMode !== "lineage-only") {
					throw new Error(`resumeSession is only valid with sessionMode=lineage-only; got ${sessionMode}`);
				}
				if (agentName !== RESUMABLE_IMPLEMENTER_AGENT) {
					throw new Error(`resumeSession is only valid for the ${RESUMABLE_IMPLEMENTER_AGENT} agent; got ${agentName}`);
				}
				const parentSessionFile = input.sessionManager.getSessionFile();
				if (!parentSessionFile) {
					throw new Error("Lineage-only subagent context requires a persisted parent session.");
				}
				const resolved = validateResumeSessionFile({ resumeSession, parentSessionFile, childCwd });
				if (resumedSessionFiles.has(resolved)) {
					throw new Error(`resume session ${resolved} is already in use`);
				}
				resumedSessionFiles.add(resolved);
				return resolved;
			}

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
					agentName,
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
