/**
 * Superpowers prompt dispatch helpers.
 *
 * Responsibilities:
 * - display the user's task and a concise config summary to users
 * - inject the full root-session contract as hidden model context
 * - preserve normal and follow-up delivery behavior for slash commands
 *
 * Important dependencies and side effects:
 * - uses Pi `before_agent_start` to attach hidden custom messages
 * - sends visible user messages through `sendUserMessage`
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Custom message type used for hidden Superpowers root contracts. */
export const SUPERPOWERS_CONTRACT_CUSTOM_TYPE = "superpowers-root-contract";

/**
 * Build the hidden Superpowers contract message shape.
 *
 * Shared by the `before_agent_start` initial-bootstrap path and the
 * `context`-event compaction re-injection path so both produce the same
 * custom-type hidden message. Callers wrap the returned object in their
 * respective event-return shapes.
 *
 * @param content Contract or reminder text to inject as hidden model context.
 * @returns Custom message object with the Superpowers contract type and display disabled.
 */
export function buildSuperpowersContractMessage(content: string): {
	customType: string;
	content: string;
	display: boolean;
} {
	return {
		customType: SUPERPOWERS_CONTRACT_CUSTOM_TYPE,
		content,
		display: false,
	};
}

/** Prefix that identifies visible Superpowers command summaries. */
const SUPERPOWERS_VISIBLE_SUMMARY_PREFIX = "Superpowers ▸";

/**
 * Determine whether a prompt is a visible Superpowers option summary.
 *
 * Matches the "Superpowers ▸ <task>" header that starts every visible
 * summary produced by `buildSuperpowersVisiblePromptSummary`.
 *
 * @param prompt User-visible prompt text received by Pi.
 * @returns True when a pending hidden contract should be paired with the prompt.
 */
function isSuperpowersVisibleSummary(prompt: string): boolean {
	return prompt.startsWith(SUPERPOWERS_VISIBLE_SUMMARY_PREFIX);
}

/**
 * Create a dispatcher that pairs visible summaries with hidden contracts.
 *
 * @param pi Extension API used to register context injection and send messages.
 * @returns Prompt sender for Superpowers command handlers.
 */
export function createSuperpowersPromptDispatcher(pi: Pick<ExtensionAPI, "on" | "sendUserMessage">): {
	send(visiblePrompt: string, hiddenContract: string, ctx: Pick<ExtensionContext, "isIdle">): void;
} {
	const pendingHiddenContracts: string[] = [];
	const maybePi = pi as Pick<ExtensionAPI, "sendUserMessage"> & Partial<Pick<ExtensionAPI, "on">>;
	const canInjectHiddenContracts = typeof maybePi.on === "function";

	if (canInjectHiddenContracts) {
		maybePi.on?.("before_agent_start", (event) => {
			if (!isSuperpowersVisibleSummary(event.prompt)) return undefined;
			const hiddenContract = pendingHiddenContracts.shift();
			if (!hiddenContract) return undefined;
			return {
				message: buildSuperpowersContractMessage(hiddenContract),
			};
		});
	}

	return {
		/**
		 * Send a visible Superpowers summary and queue the hidden contract.
		 *
		 * @param visiblePrompt Concise user-visible option summary.
		 * @param hiddenContract Full model-facing root-session contract.
		 * @param ctx Command context used to choose direct versus follow-up delivery.
		 */
		send(visiblePrompt: string, hiddenContract: string, ctx: Pick<ExtensionContext, "isIdle">): void {
			const promptToShow = canInjectHiddenContracts ? visiblePrompt : hiddenContract;
			if (canInjectHiddenContracts) pendingHiddenContracts.push(hiddenContract);
			if (ctx.isIdle()) {
				pi.sendUserMessage(promptToShow);
				return;
			}
			pi.sendUserMessage(promptToShow, { deliverAs: "followUp" });
		},
	};
}
