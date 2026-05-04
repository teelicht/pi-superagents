/**
 * Shared tool registry constants for subagent policy enforcement.
 *
 * Responsibilities:
 * - define delegation tool names stripped from bounded role tool lists
 * - define child lifecycle tool names that survive bounded-role delegation stripping
 * - define the safe read-only tool baseline used for agents without explicit tool declarations
 *
 * These constants are consumed by superpowers-policy and any future
 * policy modules that need to reason about tool access.
 */

/** Tool names that enable agent delegation — stripped from bounded role tool lists. */
export const DELEGATION_TOOLS: ReadonlySet<string> = Object.freeze(new Set(["subagent", "subagent_status"]));

/**
 * Tool names that child subagents may use to report semantic lifecycle state.
 *
 * These tools are not delegation tools and are preserved in bounded role tool lists.
 * `subagent_done` records intentional completion; `caller_ping` records a
 * parent-help request without enabling further subagent delegation.
 */
export const CHILD_LIFECYCLE_TOOLS: ReadonlySet<string> = Object.freeze(new Set(["subagent_done", "caller_ping"]));

/**
 * Safe read-only tool baseline for bounded agents that declare no tools.
 *
 * This is a conservative fallback: agents that specify tools in their
 * frontmatter use those lists directly. This baseline only applies when
 * a bounded agent has no tool declaration at all.
 */
export const READ_ONLY_TOOLS: ReadonlyArray<string> = Object.freeze(["read", "grep", "find", "ls"]);
