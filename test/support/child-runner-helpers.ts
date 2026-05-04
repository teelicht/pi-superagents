/**
 * Test support helpers for child-runner module tests.
 *
 * Responsibilities:
 * - provide dynamic import helper for child-runner module
 * - expose module exports without hard-coding the import path
 */

import type { childRunnerExports } from "./child-runner-exports.ts";

let _cache: childRunnerExports | null = null;

export async function getChildRunnerExports(): Promise<childRunnerExports> {
	if (_cache) return _cache;
	_cache = await import("../../src/execution/child-runner.ts") as childRunnerExports;
	return _cache;
}