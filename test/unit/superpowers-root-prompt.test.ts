/**
 * Unit tests for Superpowers root prompt construction.
 *
 * Responsibilities:
 * - verify using-superpowers bootstrap wording
 * - verify delegation-enabled and delegation-disabled contracts
 * - verify recon-first wording is not reintroduced
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSuperpowersRootPrompt } from "../../src/superpowers/root-prompt.ts";

void describe("Superpowers root prompt", () => {
	void it("bootstraps using-superpowers and enables delegation when configured", () => {
		const prompt = buildSuperpowersRootPrompt({
			task: "fix auth",
			useSubagents: true,
			useTestDrivenDevelopment: true,
			worktreesEnabled: true,

			fork: false,
			usingSuperpowersSkill: {
				name: "using-superpowers",
				path: "/skills/using-superpowers/SKILL.md",
				content: "USING SUPERPOWERS BODY",
			},
		});

		assert.match(prompt, /This is a Superpowers session/);
		assert.match(prompt, /using-superpowers/);
		assert.match(prompt, /USING SUPERPOWERS BODY/);
		assert.match(prompt, /useSubagents: true/);
		assert.match(prompt, /useTestDrivenDevelopment: true/);
		assert.match(prompt, /worktrees\.enabled: true/);
		assert.match(prompt, /Subagent delegation is ENABLED/);
		assert.match(prompt, /must use the `subagent` tool/);
		assert.match(prompt, /Worktree isolation is ENABLED/);
	});

	void it("forbids subagent tools and worktrees when both are disabled", () => {
		const prompt = buildSuperpowersRootPrompt({
			task: "fix auth",
			useSubagents: false,
			useTestDrivenDevelopment: false,
			worktreesEnabled: false,

			fork: true,
			usingSuperpowersSkill: undefined,
		});

		assert.match(prompt, /useSubagents: false/);
		assert.match(prompt, /useTestDrivenDevelopment: false/);
		assert.match(prompt, /worktrees\.enabled: false/);
		assert.match(prompt, /Subagent delegation is DISABLED/);
		assert.match(prompt, /Do not call `subagent`/);
		assert.match(prompt, /Worktree isolation is DISABLED/);
		assert.match(prompt, /overrides any skill workflow/);
		assert.match(prompt, /Do not use the `using-git-worktrees` skill/);
		assert.match(prompt, /Do not create, switch to, or request git worktrees/);
		assert.match(prompt, /context: "fork"/);
		assert.match(prompt, /using-superpowers could not be resolved/);
	});
});
