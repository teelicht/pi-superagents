/**
 * Thinking level resolution utilities shared across the execution pipeline.
 *
 * Key responsibilities:
 * - resolve effective thinking level with proper fallback priority (no
 *   extension-side validation: unknown values are passed through for Pi to
 *   validate at runtime)
 * - extract thinking suffix from model strings (e.g. "openai/gpt-4o:medium"),
 *   again deferring validity to Pi by returning any non-empty suffix as opaque
 *   Pi input
 *
 * Important dependencies:
 * - src/shared/types.ts (ThinkingLevel type)
 *
 * Consumed by:
 * - src/execution/child-runner.ts (launch thinking resolution)
 * - src/execution/subagent-executor.ts (pending progress thinking)
 * - src/execution/pi-args.ts (thinking suffix application)
 */

import type { ThinkingLevel } from "./types.ts";

/**
 * Resolve the effective thinking level with proper fallback priority.
 *
 * Priority:
 * 1. Agent thinking, if defined (always wins when present)
 * 2. Tier thinking, when no model override is active
 * 3. undefined
 *
 * No validation is performed: any defined agent thinking is returned as-is so
 * Pi can validate it at runtime. Keeping precedence without a local allowlist
 * means the extension can never silently reject a level Pi later supports.
 *
 * @param thinking Agent thinking string; any defined value passes through.
 * @param tierThinking Tier thinking string; used as fallback when no model override.
 * @param hasModelOverride Whether a runtime model override is active.
 * @returns The resolved value typed for Pi, or undefined.
 */
export function toThinkingLevel(thinking: string | undefined, tierThinking: string | undefined, hasModelOverride: boolean): ThinkingLevel | undefined {
	if (thinking !== undefined) return thinking as ThinkingLevel;
	return hasModelOverride ? undefined : (tierThinking as ThinkingLevel | undefined);
}

/**
 * Extract the suffix from a model string and return it as an opaque Pi input.
 *
 * Inspects the suffix after the last colon in a model string (e.g. the
 * `medium` in `"openai/gpt-4o:medium"`) and returns it without validating
 * against a local allowlist. Pi validates the value at runtime; the extension
 * only checks for presence of a non-empty suffix to detect an existing
 * thinking-suffix override on the model string.
 *
 * @param model A model string, possibly with a thinking suffix.
 * @returns The extracted suffix as a ThinkingLevel, or undefined when no
 *          colon-separated suffix is present or the suffix is empty.
 */
export function extractThinkingSuffix(model: string | undefined): ThinkingLevel | undefined {
	if (!model) return undefined;
	const suffix = model.slice(model.lastIndexOf(":") + 1);
	return model.includes(":") && suffix ? (suffix as ThinkingLevel) : undefined;
}
