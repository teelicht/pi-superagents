/**
 * Superpowers prompt dispatch helpers.
 *
 * Responsibilities:
 * - display only concise Superpowers option summaries to users
 * - inject the full root-session contract as hidden model context
 * - preserve normal and follow-up delivery behavior for slash commands
 *
 * Important dependencies and side effects:
 * - uses Pi `before_agent_start` to attach hidden custom messages
 * - sends visible user messages through `sendUserMessage`
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

/** Custom message type used for hidden Superpowers root contracts. */
export const SUPERPOWERS_CONTRACT_CUSTOM_TYPE = "superpowers-root-contract";

/** Prefix that identifies visible Superpowers command summaries. */
export const SUPERPOWERS_VISIBLE_SUMMARY_PREFIX = "Superpowers options:";

/**
 * Determine whether a prompt is a visible Superpowers option summary.
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
				message: {
					customType: SUPERPOWERS_CONTRACT_CUSTOM_TYPE,
					content: hiddenContract,
					display: false,
				},
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
