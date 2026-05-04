/**
 * Lifecycle sidecar helpers for child subagent processes.
 *
 * Responsibilities:
 * - derive `.exit` sidecar paths from child session files
 * - write child lifecycle signals atomically via temp-file-then-rename
 * - parse and consume parent-visible lifecycle sidecars without crashing execution
 *
 * Important dependencies and side effects:
 * - uses synchronous filesystem operations because lifecycle writes happen during tool shutdown
 * - removes consumed, malformed, and stale sidecars on a best-effort basis
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { LifecycleReadResult, LifecycleSignal } from "../shared/types.ts";

export interface ConsumeLifecycleSignalOptions {
	maxAgeMs?: number;
	/** If true (default), remove malformed sidecars on parse errors or invalid shapes.
	 *  If false, leave malformed sidecars in place in both cases. */
	removeMalformed?: boolean;
}

/**
 * Return the lifecycle sidecar path for a child session file.
 *
 * @param sessionFile Child Pi session JSONL path.
 * @returns Sidecar path with `.exit` suffix.
 */
export function getLifecycleSidecarPath(sessionFile: string): string {
	return `${sessionFile}.exit`;
}

/**
 * Validate unknown JSON as a supported lifecycle signal.
 *
 * @param value Parsed JSON value from the sidecar.
 * @returns Lifecycle signal when valid, otherwise `undefined`.
 */
function normalizeLifecycleSignal(value: unknown): LifecycleSignal | undefined {
	if (!value || typeof value !== "object") return undefined;
	const candidate = value as Record<string, unknown>;
	const outputTokens = typeof candidate.outputTokens === "number" && Number.isFinite(candidate.outputTokens) ? candidate.outputTokens : undefined;
	if (candidate.type === "done") return outputTokens === undefined ? { type: "done" } : { type: "done", outputTokens };
	if (candidate.type === "ping" && typeof candidate.message === "string" && candidate.message.trim().length > 0) {
		return {
			type: "ping",
			message: candidate.message,
			...(typeof candidate.name === "string" ? { name: candidate.name } : {}),
			...(outputTokens === undefined ? {} : { outputTokens }),
		};
	}
	return undefined;
}

/**
 * Best-effort removal helper used after sidecar consumption/fallback.
 *
 * @param filePath Path to remove.
 */
function removeBestEffort(filePath: string): void {
	try {
		fs.rmSync(filePath, { force: true });
	} catch {
		// Ignore cleanup failures; callers receive the original parse result.
	}
}

/**
 * Write a lifecycle signal using atomic temp-file-then-rename semantics.
 *
 * @param sessionFile Child session JSONL file path.
 * @param signal Lifecycle signal payload to write.
 */
export function writeLifecycleSignalAtomic(sessionFile: string, signal: LifecycleSignal): void {
	const sidecarPath = getLifecycleSidecarPath(sessionFile);
	fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
	const tempPath = `${sidecarPath}.tmp-${process.pid}-${randomUUID()}`;
	fs.writeFileSync(tempPath, JSON.stringify(signal), { encoding: "utf-8", mode: 0o600 });
	fs.renameSync(tempPath, sidecarPath);
}

/**
 * Consume and remove a lifecycle sidecar if one exists.
 *
 * @param sessionFile Child session JSONL file path.
 * @param options Parser behavior options, including stale max age.
 * @returns Controlled read result; never throws for expected filesystem races.
 */
export function consumeLifecycleSignal(sessionFile: string | undefined, options: ConsumeLifecycleSignalOptions = {}): LifecycleReadResult {
	const sidecarPath = getLifecycleSidecarPath(sessionFile ?? "");
	if (!sessionFile) return { status: "missing", path: sidecarPath, diagnostic: "No child session file was available." };

	let stat: fs.Stats;
	try {
		stat = fs.statSync(sidecarPath);
	} catch (error) {
		// ENOENT means the sidecar vanished or never existed — treat as missing.
		// Any other error (e.g. EACCES on the parent directory) makes it unreadable.
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return { status: "missing", path: sidecarPath };
		}
		return { status: "unreadable", path: sidecarPath, diagnostic: error instanceof Error ? error.message : String(error) };
	}

	if (options.maxAgeMs !== undefined && Date.now() - stat.mtimeMs > options.maxAgeMs) {
		removeBestEffort(sidecarPath);
		return { status: "stale", path: sidecarPath, diagnostic: `Lifecycle sidecar exceeded max age ${options.maxAgeMs}ms.` };
	}

	let raw: string;
	try {
		raw = fs.readFileSync(sidecarPath, "utf-8");
	} catch (error) {
		// ENOENT means the sidecar vanished between stat and read — treat as missing.
		// Any other error (e.g. EACCES on the file itself) makes it unreadable.
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return { status: "missing", path: sidecarPath };
		}
		return { status: "unreadable", path: sidecarPath, diagnostic: error instanceof Error ? error.message : String(error) };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		if (options.removeMalformed !== false) removeBestEffort(sidecarPath);
		return { status: "malformed", path: sidecarPath, diagnostic: error instanceof Error ? error.message : String(error) };
	}

	const signal = normalizeLifecycleSignal(parsed);
	if (!signal) {
		if (options.removeMalformed !== false) removeBestEffort(sidecarPath);
		return { status: "malformed", path: sidecarPath, diagnostic: "Lifecycle sidecar has unsupported shape." };
	}

	removeBestEffort(sidecarPath);
	return { status: "consumed", path: sidecarPath, signal };
}
