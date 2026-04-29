/**
 * Unit tests for Superpowers skill-entry parsing and prompt assembly helpers.
 *
 * Responsibilities:
 * - verify direct Pi skill command parsing
 * - verify interception opt-in decisions
 * - verify prompt inputs include entry and lifecycle skills
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildResolvedSkillEntryPrompt, buildSkillEntryPromptInput, parseSkillCommandInput, shouldInterceptSkillCommand } from "../../src/superpowers/skill-entry.ts";

void describe("Superpowers skill entry helpers", () => {
	void it("parses direct /skill commands", () => {
		assert.deepEqual(parseSkillCommandInput("/skill:brainstorming design onboarding"), {
			skillName: "brainstorming",
			task: "design onboarding",
		});
		assert.deepEqual(parseSkillCommandInput("/skill:writing-plans   draft plan"), {
			skillName: "writing-plans",
			task: "draft plan",
		});
		assert.equal(parseSkillCommandInput("/superpowers fix auth"), undefined);
		assert.equal(parseSkillCommandInput("/skill:brainstorming"), undefined);
	});

	void it("intercepts only configured supported skills including writing-plans", () => {
		assert.equal(
			shouldInterceptSkillCommand("brainstorming", {
				superagents: {
					interceptSkillCommands: ["brainstorming"],
				},
			}),
			true,
		);
		assert.equal(
			shouldInterceptSkillCommand("writing-plans", {
				superagents: {
					interceptSkillCommands: ["writing-plans"],
				},
			}),
			true,
		);
		assert.equal(
			shouldInterceptSkillCommand("writing-plans", {
				superagents: {
					interceptSkillCommands: ["brainstorming"],
				},
			}),
			false,
		);
		assert.equal(shouldInterceptSkillCommand("brainstorming", {}), false);
		assert.equal(
			shouldInterceptSkillCommand("unsupported-skill", {
				superagents: {
					interceptSkillCommands: ["brainstorming", "writing-plans"],
				},
			}),
			false,
		);
	});

	void it("builds prompt input with resolved entry and lifecycle skills", () => {
		const input = buildSkillEntryPromptInput({
			profile: {
				commandName: "sp-brainstorm",
				task: "design onboarding",
				entrySkill: "brainstorming",
				useBranches: false,
				useSubagents: true,
				useTestDrivenDevelopment: true,
				usePlannotatorReview: true,
				worktrees: { enabled: false },
				fork: false,
				rootLifecycleSkillNames: ["verification-before-completion"],
			},
			usingSuperpowersSkill: {
				name: "using-superpowers",
				path: "/skills/using-superpowers/SKILL.md",
				content: "USING BODY",
				source: "user",
			},
			entrySkill: {
				name: "brainstorming",
				path: "/skills/brainstorming/SKILL.md",
				content: "BRAINSTORM BODY",
				source: "user",
			},
			rootLifecycleSkills: [
				{
					name: "verification-before-completion",
					path: "/skills/verification-before-completion/SKILL.md",
					content: "VERIFY BODY",
					source: "user",
				},
			],
		});

		assert.equal(input.task, "design onboarding");
		assert.equal(input.entrySkill?.name, "brainstorming");
		assert.equal(input.rootLifecycleSkills?.[0]?.name, "verification-before-completion");
		assert.equal(input.useSubagents, true);
		assert.equal(input.usePlannotatorReview, true);
	});

	void it("builds a prompt or reports missing lifecycle skills", () => {
		const profile = {
			commandName: "sp-brainstorm",
			task: "design onboarding",
			entrySkill: "brainstorming",
			useBranches: false,
			useSubagents: true,
			useTestDrivenDevelopment: true,
			usePlannotatorReview: false,
			worktrees: { enabled: false },
			fork: false,
			rootLifecycleSkillNames: [],
		};
		const skills = new Map([
			[
				"using-superpowers",
				{
					name: "using-superpowers",
					path: "/skills/using-superpowers/SKILL.md",
					content: "USING BODY",
					source: "user" as const,
				},
			],
			[
				"brainstorming",
				{
					name: "brainstorming",
					path: "/skills/brainstorming/SKILL.md",
					content: "BRAINSTORM BODY",
					source: "user" as const,
				},
			],
		]);

		const result = buildResolvedSkillEntryPrompt({
			cwd: process.cwd(),
			profile,
			resolveSkill: (_cwd, name) => skills.get(name),
			resolveSkillNames: (names) => {
				const resolved = names.map((name) => skills.get(name)).filter((skill): skill is NonNullable<typeof skill> => Boolean(skill));
				const missing = names.filter((name) => !skills.has(name));
				return { resolved, missing };
			},
		});

		// Verify skill-entry logic returns a valid prompt result
		assert.ok("prompt" in result);
		// Verify basic Superpowers prompt structure is present
		assert.match((result as { prompt: string }).prompt, /Superpowers session/);
		assert.match((result as { prompt: string }).prompt, /design onboarding/);
	});

	void it("returns error when entry skill cannot be resolved", () => {
		const profile = {
			commandName: "sp-brainstorm",
			task: "design onboarding",
			entrySkill: "brainstorming",
			useBranches: false,
			useSubagents: true,
			useTestDrivenDevelopment: true,
			usePlannotatorReview: false,
			worktrees: { enabled: false },
			fork: false,
			rootLifecycleSkillNames: [],
		};
		const skills = new Map([
			[
				"using-superpowers",
				{
					name: "using-superpowers",
					path: "/skills/using-superpowers/SKILL.md",
					content: "USING BODY",
					source: "user" as const,
				},
			],
		]);

		const result = buildResolvedSkillEntryPrompt({
			cwd: process.cwd(),
			profile,
			resolveSkill: (_cwd, name) => skills.get(name),
			resolveSkillNames: () => ({ resolved: [], missing: [] }),
		});

		assert.ok("error" in result);
		assert.match((result as { error: string }).error, /entry skill could not be resolved/i);
	});

	void it("returns error when root lifecycle skills cannot be resolved", () => {
		const profile = {
			commandName: "sp-implement",
			task: "implement auth fix",
			entrySkill: "using-superpowers",
			useBranches: false,
			useSubagents: true,
			useTestDrivenDevelopment: true,
			usePlannotatorReview: false,
			worktrees: { enabled: false },
			fork: false,
			rootLifecycleSkillNames: ["definitely-missing-skill"],
		};
		const skills = new Map([
			[
				"using-superpowers",
				{
					name: "using-superpowers",
					path: "/skills/using-superpowers/SKILL.md",
					content: "USING BODY",
					source: "user" as const,
				},
			],
		]);

		const result = buildResolvedSkillEntryPrompt({
			cwd: process.cwd(),
			profile,
			resolveSkill: (_cwd, name) => skills.get(name),
			resolveSkillNames: () => ({ resolved: [], missing: ["definitely-missing-skill"] }),
		});

		assert.ok("error" in result);
		assert.match((result as { error: string }).error, /root lifecycle skills could not be resolved/i);
		assert.match((result as { error: string }).error, /definitely-missing-skill/);
	});

	void it("passes optional booleans through prompt input", () => {
		const input = buildSkillEntryPromptInput({
			profile: {
				commandName: "skill:brainstorming",
				task: "design middleware",
				entrySkill: "brainstorming",
				useBranches: false,
				useSubagents: true,
				useTestDrivenDevelopment: true,
				usePlannotatorReview: false,
				worktrees: { enabled: false },
				fork: false,
				rootLifecycleSkillNames: [],
			},
		});

		assert.equal(input.useBranches, false);
		assert.equal(input.useSubagents, true);
		assert.equal(input.usePlannotatorReview, false);
		assert.equal(input.worktrees?.enabled, false);
	});
});
