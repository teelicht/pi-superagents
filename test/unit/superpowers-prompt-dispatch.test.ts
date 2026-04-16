/**
 * Unit tests for Superpowers prompt dispatch.
 *
 * Responsibilities:
 * - verify visible command messages stay concise
 * - verify strict root contracts are injected as hidden model context
 * - verify follow-up delivery is preserved
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	createSuperpowersPromptDispatcher,
	SUPERPOWERS_CONTRACT_CUSTOM_TYPE,
} from "../../src/superpowers/prompt-dispatch.ts";

type BeforeAgentStartHandler = (event: { prompt: string }) =>
	| {
			message?: { customType: string; content: string; display: boolean };
	  }
	| undefined;

type SentMessage = {
	content: string;
	options?: { deliverAs?: "followUp" };
};

void describe("Superpowers prompt dispatcher", () => {
	void it("sends only the visible summary and injects the hidden contract before agent start", () => {
		let beforeAgentStart: BeforeAgentStartHandler | undefined;
		const sentMessages: SentMessage[] = [];
		const dispatcher = createSuperpowersPromptDispatcher({
			on(event: string, handler: BeforeAgentStartHandler) {
				if (event === "before_agent_start") beforeAgentStart = handler as typeof beforeAgentStart;
			},
			sendUserMessage(content: string | unknown[], options?: { deliverAs?: "followUp" }) {
				sentMessages.push({ content: String(content), options });
			},
		} as never);

		dispatcher.send(
			"Superpowers ▸ fix auth\n\nConfig:\nuseBranches: true",
			"# Superpowers Root Session Contract\nsecret runtime contract",
			{ isIdle: () => true },
		);

		assert.deepEqual(sentMessages, [
			{ content: "Superpowers ▸ fix auth\n\nConfig:\nuseBranches: true", options: undefined },
		]);
		const injected = beforeAgentStart?.({ prompt: sentMessages[0].content });
		assert.equal(injected?.message?.customType, SUPERPOWERS_CONTRACT_CUSTOM_TYPE);
		assert.equal(injected?.message?.display, false);
		assert.match(injected?.message?.content ?? "", /secret runtime contract/);
	});

	void it("keeps follow-up delivery for busy sessions", () => {
		const sentMessages: SentMessage[] = [];
		const dispatcher = createSuperpowersPromptDispatcher({
			on() {},
			sendUserMessage(content: string | unknown[], options?: { deliverAs?: "followUp" }) {
				sentMessages.push({ content: String(content), options });
			},
		} as never);

		dispatcher.send("Superpowers ▸ fix auth\n\nConfig:\nuseSubagents: true", "# Hidden contract", {
			isIdle: () => false,
		});

		assert.deepEqual(sentMessages, [
			{
				content: "Superpowers ▸ fix auth\n\nConfig:\nuseSubagents: true",
				options: { deliverAs: "followUp" },
			},
		]);
	});
});
