/**
 * Thinking level resolution utilities shared across the execution pipeline.
 *
 * Key responsibilities:
 * - define the canonical list of valid thinking levels
 * - provide type-narrowing helpers for ThinkingLevel
 * - resolve effective thinking level with proper fallback priority
 * - extract thinking suffix from model strings (e.g. "openai/gpt-4o:medium")
 *
 * Important dependencies:
 * - src/shared/types.ts (ThinkingLevel type)
 *
 * Consumed by:
 * - src/execution/child-runner.ts (launch thinking resolution)
 * - src/execution/subagent-executor.ts (pending progress thinking)
 * - src/execution/pi-args.ts (thinking suffix application)
 * - src/execution/config-validation.ts (tier thinking validation)
 */

import type { ThinkingLevel } from "./types.ts";

/**
 * Canonical list of valid thinking level values.
 * Corresponds to the ThinkingLevel union in shared/types.ts.
 */
export const VALID_THINKING_LEVELS: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

/**
 * Type guard to narrow a string to a ThinkingLevel.
 *
 * @param value A string that may be a valid thinking level.
 * @returns True when the value is one of the valid ThinkingLevel values.
 */
export function isThinkingLevel(value: string | undefined): value is ThinkingLevel {
	return value !== undefined && VALID_THINKING_LEVELS.includes(value as ThinkingLevel);
}

/**
 * Resolve the effective thinking level with proper fallback priority.
 *
 * Priority:
 * 1. Valid agent thinking (always wins when present)
 * 2. Valid tier thinking (only when no model override is active)
 * 3. undefined
 *
 * @param thinking Raw thinking string from agent config.
 * @param tierThinking Optional thinking level from model tier config.
 * @param hasModelOverride Whether a runtime model override is active.
 * @returns Narrowed ThinkingLevel or undefined.
 */
export function toThinkingLevel(thinking: string | undefined, tierThinking: string | undefined, hasModelOverride: boolean): ThinkingLevel | undefined {
	// Valid agent thinking wins first
	if (isThinkingLevel(thinking)) {
		return thinking;
	}
	// If no model override and no valid agent thinking, use valid tier thinking
	if (!hasModelOverride && isThinkingLevel(tierThinking)) {
		return tierThinking;
	}
	return undefined;
}

/**
 * Extract a valid ThinkingLevel suffix from a model string.
 *
 * Inspects the suffix after the last colon in a model string and returns it
 * only if it is a known thinking level. Used to determine the effective thinking
 * level from a model string that may already include a thinking suffix (e.g.
 * "openai/gpt-4o:medium").
 *
 * @param model A model string, possibly with a thinking suffix.
 * @returns The extracted ThinkingLevel suffix, or undefined if none found.
 */
export function extractThinkingSuffix(model: string | undefined): ThinkingLevel | undefined {
	if (!model) return undefined;
	const colonIdx = model.lastIndexOf(":");
	if (colonIdx === -1) return undefined;
	const suffix = model.slice(colonIdx + 1);
	if (isThinkingLevel(suffix)) {
		return suffix;
	}
	return undefined;
}
