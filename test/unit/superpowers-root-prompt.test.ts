/**
 * Unit tests for Superpowers root prompt construction.
 *
 * Responsibilities:
 * - verify using-superpowers bootstrap wording
 * - verify delegation-enabled and delegation-disabled contracts
 * - verify presence-based contract emission
 * - verify skill entry and lifecycle skill rendering
 * - verify generic Plannotator contract
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSuperpowersRootPrompt, buildSuperpowersVisiblePromptSummary } from "../../src/superpowers/root-prompt.ts";

void describe("Superpowers root prompt", () => {
	void it("bootstraps using-superpowers and enables delegation when configured", () => {
		const prompt = buildSuperpowersRootPrompt({
			task: "fix auth",
			useBranches: true,
			useSubagents: true,
			useTestDrivenDevelopment: true,
			usePlannotatorReview: true,
			worktrees: { enabled: true },

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
		assert.match(prompt, /useBranches: true/);
		assert.match(prompt, /useTestDrivenDevelopment: true/);
		assert.match(prompt, /usePlannotatorReview: true/);
		assert.match(prompt, /worktrees\.enabled: true/);
		assert.match(prompt, /Subagent delegation is ENABLED/);
		assert.match(prompt, /Branch policy is ENABLED/);
		assert.match(prompt, /Use a dedicated git branch for this implementation plan\/spec before implementation work begins/);
		assert.match(prompt, /Treat git branches and Pi session forks as separate concepts/);
		assert.match(prompt, /superpowers_plan_review/);
		assert.match(prompt, /superpowers_spec_review/);
		assert.match(prompt, /returns rejected, treat the response as review feedback, revise the artifact, save it, and resubmit/);
		assert.match(prompt, /If the tool returns unavailable, show one concise warning/);
		assert.doesNotMatch(prompt, /exactly once/);
		assert.match(prompt, /must use the `subagent` tool/);
		assert.match(prompt, /pass `useTestDrivenDevelopment: true` in every `subagent` call/);
		assert.match(prompt, /Worktree isolation is ENABLED/);
		assert.match(prompt, /Task tracking is the responsibility of the root session/);
	});

	void it("forbids subagent tools and worktrees when both are disabled", () => {
		const prompt = buildSuperpowersRootPrompt({
			task: "fix auth",
			useBranches: false,
			useSubagents: false,
			useTestDrivenDevelopment: false,
			usePlannotatorReview: false,
			worktrees: { enabled: false },

			fork: true,
			usingSuperpowersSkill: undefined,
		});

		assert.match(prompt, /useSubagents: false/);
		assert.match(prompt, /useBranches: false/);
		assert.match(prompt, /useTestDrivenDevelopment: false/);
		assert.match(prompt, /usePlannotatorReview: false/);
		assert.match(prompt, /worktrees\.enabled: false/);
		assert.match(prompt, /Subagent delegation is DISABLED/);
		assert.match(prompt, /Branch policy is DISABLED/);
		assert.doesNotMatch(prompt, /Use a dedicated git branch/);
		assert.match(prompt, /Do not call `subagent`/);
		assert.match(prompt, /Worktree isolation is DISABLED/);
		assert.match(prompt, /overrides any skill workflow/);
		assert.match(prompt, /Do not use the `using-git-worktrees` skill/);
		assert.match(prompt, /Do not create, switch to, or request git worktrees/);
		assert.match(prompt, /sessionMode: fork/);
		assert.match(prompt, /using-superpowers could not be resolved/);
		assert.match(prompt, /Plannotator browser review is DISABLED/);
		assert.doesNotMatch(prompt, /superpowers_plan_review/);
		assert.doesNotMatch(prompt, /superpowers_spec_review/);
		assert.doesNotMatch(prompt, /Task tracking is the responsibility/);
	});

	void it("omits delegation, tdd, branch, worktree contracts when booleans are absent", () => {
		const prompt = buildSuperpowersRootPrompt({
			task: "design onboarding",
			usePlannotatorReview: true,
			fork: false,
			usingSuperpowersSkill: {
				name: "using-superpowers",
				path: "/skills/using-superpowers/SKILL.md",
				content: "USING BODY",
			},
			entrySkill: {
				name: "brainstorming",
				path: "/skills/brainstorming/SKILL.md",
				content: "BRAINSTORM BODY",
			},
		});

		assert.doesNotMatch(prompt, /Subagent delegation is/);
		assert.doesNotMatch(prompt, /Branch policy is/);
		assert.doesNotMatch(prompt, /Worktree isolation is/);
		assert.doesNotMatch(prompt, /Task tracking is/);
		assert.doesNotMatch(prompt, /test-driven/i);
		assert.match(prompt, /Plannotator browser review is ENABLED/);
		assert.match(prompt, /superpowers_spec_review/);
		assert.match(prompt, /superpowers_plan_review/);
		assert.doesNotMatch(prompt, /Overlay skills:/);
	});

	void it("includes entry skill content for brainstorming", () => {
		const prompt = buildSuperpowersRootPrompt({
			task: "design onboarding",
			useBranches: true,
			useSubagents: true,
			useTestDrivenDevelopment: true,
			usePlannotatorReview: true,
			worktrees: { enabled: false },
			fork: false,
			usingSuperpowersSkill: {
				name: "using-superpowers",
				path: "/skills/using-superpowers/SKILL.md",
				content: "USING BODY",
			},
			entrySkill: {
				name: "brainstorming",
				path: "/skills/brainstorming/SKILL.md",
				content: "BRAINSTORM BODY",
			},
		});

		assert.match(prompt, /Entry skill:/);
		assert.match(prompt, /Name: brainstorming/);
		assert.match(prompt, /BRAINSTORM BODY/);
		assert.match(prompt, /superpowers_spec_review/);
		assert.match(prompt, /superpowers_plan_review/);
		assert.doesNotMatch(prompt, /Overlay skills:/);
		assert.doesNotMatch(prompt, /saved brainstorming spec/);
	});

	void it("includes lifecycle skill triggers for root implementation entrypoints", () => {
		const prompt = buildSuperpowersRootPrompt({
			task: "implement auth fix",
			useBranches: false,
			useSubagents: true,
			useTestDrivenDevelopment: true,
			worktrees: { enabled: false },
			fork: false,
			usingSuperpowersSkill: {
				name: "using-superpowers",
				path: "/skills/using-superpowers/SKILL.md",
				content: "USING BODY",
			},
			rootLifecycleSkills: [
				{
					name: "verification-before-completion",
					path: "/skills/verification-before-completion/SKILL.md",
					content: "VERIFY BODY",
				},
				{
					name: "receiving-code-review",
					path: "/skills/receiving-code-review/SKILL.md",
					content: "REVIEW BODY",
				},
				{
					name: "finishing-a-development-branch",
					path: "/skills/finishing-a-development-branch/SKILL.md",
					content: "FINISH BODY",
				},
			],
		});

		assert.match(prompt, /Root lifecycle skills:/);
		assert.match(prompt, /Before claiming complete, fixed, passing, or ready: invoke `verification-before-completion`/);
		assert.match(prompt, /When receiving or acting on review feedback: invoke `receiving-code-review`/);
		assert.match(prompt, /After implementation is complete and verification passes: invoke `finishing-a-development-branch`/);
		assert.match(prompt, /VERIFY BODY/);
		assert.match(prompt, /REVIEW BODY/);
		assert.match(prompt, /FINISH BODY/);
		assert.doesNotMatch(prompt, /Overlay skills:/);
	});

	void it("omits trigger hints for lifecycle skills that are not assigned", () => {
		const prompt = buildSuperpowersRootPrompt({
			task: "implement auth fix",
			fork: false,
			usingSuperpowersSkill: {
				name: "using-superpowers",
				path: "/skills/using-superpowers/SKILL.md",
				content: "USING BODY",
			},
			rootLifecycleSkills: [
				{
					name: "verification-before-completion",
					path: "/skills/verification-before-completion/SKILL.md",
					content: "VERIFY BODY",
				},
			],
		});

		assert.match(prompt, /Before claiming complete, fixed, passing, or ready: invoke `verification-before-completion`/);
		assert.doesNotMatch(prompt, /receiving-code-review/);
		assert.doesNotMatch(prompt, /finishing-a-development-branch/);
		assert.doesNotMatch(prompt, /Overlay skills:/);
	});

	void it("builds a concise visible prompt summary without leaking the strict contract", () => {
		const summary = buildSuperpowersVisiblePromptSummary({
			task: "fix auth",
			useBranches: true,
			useSubagents: false,
			useTestDrivenDevelopment: true,
			usePlannotatorReview: false,
			worktrees: { enabled: false },
			fork: true,
		});

		assert.match(summary, /Superpowers ▸ fix auth/);
		assert.match(summary, /Config:/);
		assert.match(summary, /useBranches: true/);
		assert.match(summary, /useSubagents: false/);
		assert.match(summary, /useTestDrivenDevelopment: true/);
		assert.match(summary, /usePlannotatorReview: false/);
		assert.match(summary, /worktrees\.enabled: false/);
		assert.match(summary, /sessionMode: fork/);
		assert.doesNotMatch(summary, /Required bootstrap skill/);
		assert.doesNotMatch(summary, /Subagent delegation is/);
		assert.doesNotMatch(summary, /User Task/);
	});

	void it("shows only present fields in visible prompt summary", () => {
		const summary = buildSuperpowersVisiblePromptSummary({
			task: "design onboarding",
			usePlannotatorReview: true,
			fork: false,
		});

		assert.match(summary, /Superpowers ▸ design onboarding/);
		assert.match(summary, /usePlannotatorReview: true/);
		assert.match(summary, /sessionMode: lineage-only/);
		assert.doesNotMatch(summary, /context: fresh/);
		assert.doesNotMatch(summary, /useBranches/);
		assert.doesNotMatch(summary, /useSubagents/);
		assert.doesNotMatch(summary, /useTestDrivenDevelopment/);
		assert.doesNotMatch(summary, /worktrees/);
	});
});
