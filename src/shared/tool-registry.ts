/**
 * Shared tool registry constants for subagent policy enforcement.
 *
 * Responsibilities:
 * - define delegation tool names stripped from bounded role tool lists
 * - define the safe read-only tool baseline used for agents without explicit tool declarations
 *
 * These constants are consumed by superpowers-policy and any future
 * policy modules that need to reason about tool access.
 */

/** Tool names that enable agent delegation — stripped from bounded role tool lists. */
export const DELEGATION_TOOLS: ReadonlySet<string> = Object.freeze(
	new Set(["subagent", "subagent_status"]),
);

/**
 * Safe read-only tool baseline for bounded agents that declare no tools.
 *
 * This is a conservative fallback: agents that specify tools in their
 * frontmatter use those lists directly. This baseline only applies when
 * a bounded agent has no tool declaration at all.
 */
export const READ_ONLY_TOOLS: ReadonlyArray<string> = Object.freeze(
	["read", "grep", "find", "ls"],
);