/**
 * Test support helpers for child-runner module tests.
 *
 * Responsibilities:
 * - provide dynamic import helper for child-runner module
 * - expose module exports without hard-coding the import path
 */

import type { ChildRunnerExports } from "./child-runner-exports.ts";

let _cache: ChildRunnerExports | null = null;

/**
 * Dynamically import and cache child-runner exports for tests.
 *
 * @returns Typed child-runner module exports.
 */
export async function getChildRunnerExports(): Promise<ChildRunnerExports> {
	if (_cache) return _cache;
	_cache = (await import("../../src/execution/child-runner.ts")) as ChildRunnerExports;
	return _cache;
}
