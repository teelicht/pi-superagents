import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	buildModelCandidates,
	isRetryableModelFailure,
	resolveModelCandidate,
} from "../../model-fallback.ts";

describe("model fallback helpers", () => {
	const availableModels = [
		{ provider: "openai", id: "gpt-5-mini", fullId: "openai/gpt-5-mini" },
		{ provider: "anthropic", id: "claude-sonnet-4", fullId: "anthropic/claude-sonnet-4" },
	];

	it("keeps explicit provider/model ids unchanged", () => {
		assert.equal(resolveModelCandidate("openai/gpt-5-mini", availableModels), "openai/gpt-5-mini");
	});

	it("resolves a bare id when there is exactly one registry match", () => {
		assert.equal(resolveModelCandidate("gpt-5-mini", availableModels), "openai/gpt-5-mini");
	});

	it("preserves thinking suffix when resolving a bare id", () => {
		assert.equal(resolveModelCandidate("gpt-5-mini:high", availableModels), "openai/gpt-5-mini:high");
	});

	it("leaves ambiguous bare ids untouched", () => {
		const ambiguous = [
			...availableModels,
			{ provider: "github-copilot", id: "gpt-5-mini", fullId: "github-copilot/gpt-5-mini" },
		];
		assert.equal(resolveModelCandidate("gpt-5-mini", ambiguous), "gpt-5-mini");
	});

	it("prefers the current provider when an ambiguous bare id exists there", () => {
		const ambiguous = [
			...availableModels,
			{ provider: "github-copilot", id: "gpt-5-mini", fullId: "github-copilot/gpt-5-mini" },
		];
		assert.equal(resolveModelCandidate("gpt-5-mini", ambiguous, "github-copilot"), "github-copilot/gpt-5-mini");
	});

	it("falls back to the unique registry match when the current provider does not offer the model", () => {
		assert.equal(resolveModelCandidate("claude-sonnet-4", availableModels, "github-copilot"), "anthropic/claude-sonnet-4");
	});

	it("builds a deduplicated ordered candidate list", () => {
		assert.deepEqual(
			buildModelCandidates("gpt-5-mini", ["openai/gpt-5-mini", "anthropic/claude-sonnet-4", "gpt-5-mini"], availableModels),
			["openai/gpt-5-mini", "anthropic/claude-sonnet-4"],
		);
	});

	it("applies the current provider preference to fallback candidates too", () => {
		const ambiguous = [
			...availableModels,
			{ provider: "github-copilot", id: "gpt-5-mini", fullId: "github-copilot/gpt-5-mini" },
		];
		assert.deepEqual(
			buildModelCandidates("gpt-5-mini", ["gpt-5-mini", "anthropic/claude-sonnet-4"], ambiguous, "github-copilot"),
			["github-copilot/gpt-5-mini", "anthropic/claude-sonnet-4"],
		);
	});

	it("detects retryable provider/model failures", () => {
		assert.equal(isRetryableModelFailure("rate limit exceeded for provider"), true);
		assert.equal(isRetryableModelFailure("model unavailable"), true);
		assert.equal(isRetryableModelFailure("authentication failed"), true);
	});

	it("does not treat ordinary task/tool failures as retryable model failures", () => {
		assert.equal(isRetryableModelFailure("bash failed (exit 1): command not found"), false);
		assert.equal(isRetryableModelFailure("read failed (exit 1): no such file or directory"), false);
		assert.equal(isRetryableModelFailure(undefined), false);
	});
});
