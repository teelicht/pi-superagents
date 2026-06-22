/**
 * Compaction-durability helpers and handler registration.
 *
 * Responsibilities:
 * - map session_compact reason to a sizing class (full/trimmed/pointer)
 * - detect existing bootstrap markers for idempotent re-injection
 * - find the insertion point after leading compactionSummary messages
 * - register session_compact, context, and agent_end handlers that re-arm
 *   the Superpowers root contract after compaction, gated by SubagentState
 *
 * Important dependencies:
 * - pi ExtensionAPI (event handlers)
 * - SubagentState (opt-in gate + sizing + profile)
 * - buildSuperpowersRootPrompt / buildCompactionReminder (content production)
 * - buildResolvedSkillEntryPrompt (runtime skill re-resolution for full sizing)
 *
 * Side effects:
 * - mutates state.superpowersActive / state.compactionSizing on compaction events
 * - injects messages into the context event's messages array
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveAvailableSkill, resolveSkills } from "../shared/skills.ts";
import type { SubagentState } from "../shared/types.ts";
import { buildSuperpowersContractMessage } from "../superpowers/prompt-dispatch.ts";
import { buildCompactionReminder } from "../superpowers/root-prompt.ts";
import { buildResolvedSkillEntryPrompt } from "../superpowers/skill-entry.ts";

/** Marker string identifying a compaction-reminder injection. */
const COMPACTION_REMINDER_MARKER = "superpowers:compaction-reminder";

/** Marker string identifying the full root contract injection. */
const ROOT_CONTRACT_MARKER = "# Superpowers Root Session Contract";

/**
 * Map a session_compact reason to a re-injection sizing class.
 *
 * @param reason "threshold" | "overflow" | "manual" (or unknown).
 * @returns "full" for threshold, "trimmed" for overflow, "pointer" for manual/unknown.
 */
export function resolveCompactionSizing(reason: string): "full" | "trimmed" | "pointer" {
	if (reason === "threshold") return "full";
	if (reason === "overflow") return "trimmed";
	return "pointer";
}

/**
 * Check whether a message already contains a Superpowers bootstrap marker.
 *
 * Scans custom-type messages for the compaction-reminder or root-contract
 * marker so the context handler never double-injects.
 *
 * @param message A session message (any shape).
 * @returns True when the message carries a known bootstrap marker.
 */
export function messageContainsBootstrap(message: unknown): boolean {
	if (!message || typeof message !== "object") return false;
	const msg = message as { content?: unknown; customType?: string };
	if (msg.customType !== "superpowers-root-contract") return false;
	const content = typeof msg.content === "string" ? msg.content : "";
	return content.includes(COMPACTION_REMINDER_MARKER) || content.includes(ROOT_CONTRACT_MARKER);
}

/**
 * Find the index after leading compactionSummary messages.
 *
 * @param messages Session messages array (deep copy from the context event).
 * @returns Index where non-summary messages begin (0 when no leading summaries).
 */
export function firstNonCompactionSummaryIndex(messages: unknown[]): number {
	let index = 0;
	while ((messages[index] as { role?: unknown } | undefined)?.role === "compactionSummary") {
		index += 1;
	}
	return index;
}

/**
 * Dependency-injection interface for the handler registration.
 */
export interface CompactionDurabilityDeps {
	/** Current working directory for skill re-resolution. */
	cwd: () => string;
}

/**
 * Register compaction-durability event handlers with Pi.
 *
 * Registers three handlers:
 * - session_compact: re-arms the opt-in flag (only if already active) and
 *   sets compactionSizing from event.reason.
 * - context: re-injects the bootstrap sized by compactionSizing, with
 *   idempotency marker scan and insertion after compactionSummary messages.
 * - agent_end: consumes the opt-in flag after each turn.
 *
 * All handlers are fail-soft: errors are caught and never break compaction
 * or the LLM call.
 *
 * @param pi Extension API for event registration.
 * @param state SubagentState holding the opt-in gate and sizing.
 * @param deps Dependencies (cwd accessor for skill re-resolution).
 */
export function registerCompactionDurabilityHandlers(pi: ExtensionAPI, state: SubagentState, _deps: CompactionDurabilityDeps): void {
	pi.on("session_compact", (event: { reason?: string; willRetry?: boolean }) => {
		try {
			if (!state.superpowersActive) return;
			state.superpowersActive = true;
			state.compactionSizing = resolveCompactionSizing(event.reason ?? "manual");
		} catch {
			// Never break compaction — leave state as-is.
		}
	});

	pi.on("context", (event: { messages: unknown[] }) => {
		try {
			if (!state.superpowersActive) return;
			if (event.messages.some(messageContainsBootstrap)) return;

			const sizing = state.compactionSizing ?? "full";
			let content: string | null = null;

			if (sizing === "full" && state.rootPromptProfile) {
				const promptResult = buildResolvedSkillEntryPrompt({
					cwd: state.baseCwd,
					profile: state.rootPromptProfile,
					resolveSkill: resolveAvailableSkill,
					resolveSkillNames: resolveSkills,
				});
				if ("error" in promptResult) return;
				content = promptResult.prompt;
			} else if (sizing !== "full") {
				content = buildCompactionReminder(state.rootLifecycleSkillNames, sizing);
			}

			if (!content) return;

			const message = {
				role: "custom" as const,
				...buildSuperpowersContractMessage(content),
			};
			const insertAt = firstNonCompactionSummaryIndex(event.messages);
			return {
				messages: [...event.messages.slice(0, insertAt), message, ...event.messages.slice(insertAt)],
			};
		} catch {
			// Never break the LLM call — no-op on error.
		}
	});

	pi.on("agent_end", () => {
		try {
			state.superpowersActive = false;
		} catch {
			// Best effort — never break agent_end.
		}
	});
}
