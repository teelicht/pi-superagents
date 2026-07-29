/**
 * Default-on Superpowers opt-in guards for root Pi sessions.
 *
 * Responsibilities:
 * - hide `using-superpowers` from ordinary model-driven skill selection
 * - neutralize obra/superpowers' automatic Pi bootstrap regardless of extension load order
 * - preserve explicit `/sp-*` and `/skill:*` activation paths
 *
 * Important dependencies and side effects:
 * - rewrites the per-turn system prompt through Pi's `before_agent_start` event
 * - injects one hidden context marker while opt-in-only mode is enabled
 */

import { type ExtensionAPI, formatSkillsForPrompt } from "@earendil-works/pi-coding-agent";
import type { ExtensionConfig } from "../shared/types.ts";
import { firstNonCompactionSummaryIndex } from "./compaction-durability.ts";

/** Marker used by obra/superpowers to detect its automatic Pi bootstrap. */
const UPSTREAM_SUPERPOWERS_BOOTSTRAP_MARKER = "superpowers:using-superpowers bootstrap for pi";

/** Custom message type for the hidden opt-in guard. */
const SUPERPOWERS_OPT_IN_GUARD_TYPE = "pi-superagents-opt-in-guard";

/**
 * Check whether the effective config requires explicit Superpowers activation.
 *
 * @param config Current effective extension config.
 * @returns True unless the user explicitly disables opt-in-only mode.
 */
function shouldMakeSuperpowersSkillsOptInOnly(config: ExtensionConfig): boolean {
	return config.superagents?.makeSuperpowersSkillsOptInOnly !== false;
}

/**
 * Identify the automatic bootstrap message injected by obra/superpowers.
 *
 * The strict message-shape checks avoid removing ordinary user messages that
 * merely quote the upstream marker while discussing the extension.
 *
 * @param message Candidate context message.
 * @returns True only for the upstream automatic bootstrap shape.
 */
function isUpstreamBootstrapMessage(message: unknown): boolean {
	const candidate = message as { role?: unknown; content?: unknown } | null;
	if (candidate?.role !== "user" || !Array.isArray(candidate.content) || candidate.content.length !== 1) return false;
	const part = candidate.content[0] as { type?: unknown; text?: unknown } | undefined;
	return (
		part?.type === "text" &&
		typeof part.text === "string" &&
		part.text.includes(UPSTREAM_SUPERPOWERS_BOOTSTRAP_MARKER) &&
		part.text.includes("<EXTREMELY_IMPORTANT>") &&
		part.text.includes("You have superpowers.")
	);
}

/**
 * Identify this extension's hidden opt-in guard message.
 *
 * @param message Candidate context message.
 * @returns True when the message is the guard owned by this extension.
 */
function isOptInGuardMessage(message: unknown): boolean {
	return (message as { customType?: unknown } | null)?.customType === SUPERPOWERS_OPT_IN_GUARD_TYPE;
}

/**
 * Build the hidden marker that blocks upstream automatic bootstrap injection.
 *
 * The upstream marker makes obra/superpowers' context hook no-op when this
 * handler runs first. The explicit instruction keeps `/sp-*` contracts authoritative.
 *
 * @returns Pi custom message suitable for context-event insertion.
 */
function buildOptInGuardMessage() {
	return {
		role: "custom" as const,
		customType: SUPERPOWERS_OPT_IN_GUARD_TYPE,
		content: `${UPSTREAM_SUPERPOWERS_BOOTSTRAP_MARKER}\nAutomatic Superpowers bootstrap is disabled by pi-superagents. Use Superpowers only after an explicit /sp-* or /skill:* invocation; follow any explicit pi-superagents Superpowers contract in the conversation.`,
		display: false,
		timestamp: Date.now(),
	};
}

/**
 * Register the default-on prompt and context guards.
 *
 * Pi chains context handlers in extension order. This handler is order-independent:
 * it removes an upstream bootstrap when it runs later, or inserts the marker that
 * causes the upstream hook to skip when it runs earlier.
 *
 * @param pi Pi extension API used for event registration.
 * @param getConfig Live effective-config accessor.
 */
export function registerSuperpowersOptInGuard(pi: ExtensionAPI, getConfig: () => ExtensionConfig): void {
	pi.on("before_agent_start", (event) => {
		if (!shouldMakeSuperpowersSkillsOptInOnly(getConfig())) return;
		const skills = event.systemPromptOptions?.skills;
		if (!Array.isArray(skills)) return;

		const currentSkillsPrompt = formatSkillsForPrompt(skills);
		const filteredSkillsPrompt = formatSkillsForPrompt(skills.map((skill) => (skill.name === "using-superpowers" ? { ...skill, disableModelInvocation: true } : skill)));
		if (!currentSkillsPrompt || currentSkillsPrompt === filteredSkillsPrompt || !event.systemPrompt.includes(currentSkillsPrompt)) return;
		return { systemPrompt: event.systemPrompt.replace(currentSkillsPrompt, filteredSkillsPrompt) };
	});

	pi.on("context", (event) => {
		if (!shouldMakeSuperpowersSkillsOptInOnly(getConfig())) return;

		const withoutUpstream = event.messages.filter((message) => !isUpstreamBootstrapMessage(message));
		if (withoutUpstream.some(isOptInGuardMessage)) {
			return withoutUpstream.length === event.messages.length ? undefined : { messages: withoutUpstream };
		}

		const insertAt = firstNonCompactionSummaryIndex(withoutUpstream);
		return {
			messages: [...withoutUpstream.slice(0, insertAt), buildOptInGuardMessage(), ...withoutUpstream.slice(insertAt)],
		};
	});
}
