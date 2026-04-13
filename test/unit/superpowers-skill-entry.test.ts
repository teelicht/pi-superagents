/**
 * Unit tests for Superpowers skill-entry parsing and prompt assembly helpers.
 *
 * Responsibilities:
 * - verify direct Pi skill command parsing
 * - verify interception opt-in decisions
 * - verify prompt inputs include entry and overlay skills
 *
 * Note: Integration with buildSuperpowersRootPrompt (entry/overlay content rendering)
 * is tested after Task 4 extends root-prompt.ts with entry skill and overlay blocks.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	buildSkillEntryPromptInput,
	buildResolvedSkillEntryPrompt,
	parseSkillCommandInput,
	shouldInterceptSkillCommand,
} from "../../src/superpowers/skill-entry.ts";

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

	void it("intercepts only configured supported skills", () => {
		assert.equal(shouldInterceptSkillCommand("brainstorming", {
			superagents: {
				interceptSkillCommands: ["brainstorming"],
			},
		}), true);
		assert.equal(shouldInterceptSkillCommand("writing-plans", {
			superagents: {
				interceptSkillCommands: ["brainstorming"],
			},
		}), false);
		assert.equal(shouldInterceptSkillCommand("brainstorming", {}), false);
	});

	void it("builds prompt input with resolved entry and overlay skills", () => {
		const input = buildSkillEntryPromptInput({
			profile: {
				commandName: "sp-brainstorm",
				task: "design onboarding",
				useSubagents: true,
				useTestDrivenDevelopment: true,
				usePlannotatorReview: true,
				worktreesEnabled: false,
				fork: false,
				entrySkill: { name: "brainstorming", source: "command" },
				overlaySkillNames: ["react-native-best-practices"],
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
			overlaySkills: [{
				name: "react-native-best-practices",
				path: "/skills/react-native-best-practices/SKILL.md",
				content: "RN BODY",
				source: "user",
			}],
		});

		assert.equal(input.task, "design onboarding");
		assert.equal(input.entrySkill?.name, "brainstorming");
		assert.equal(input.overlaySkills?.[0]?.name, "react-native-best-practices");
		assert.equal(input.entrySkillSource, "command");
	});

	void it("builds a prompt or reports missing overlay skills", () => {
		const profile = {
			commandName: "sp-brainstorm",
			task: "design onboarding",
			useSubagents: true,
			useTestDrivenDevelopment: true,
			usePlannotatorReview: false,
			worktreesEnabled: false,
			fork: false,
			entrySkill: { name: "brainstorming", source: "command" as const },
			overlaySkillNames: ["react-native-best-practices"],
		};
		const skills = new Map([
			["using-superpowers", {
				name: "using-superpowers",
				path: "/skills/using-superpowers/SKILL.md",
				content: "USING BODY",
				source: "user" as const,
			}],
			["brainstorming", {
				name: "brainstorming",
				path: "/skills/brainstorming/SKILL.md",
				content: "BRAINSTORM BODY",
				source: "user" as const,
			}],
			["react-native-best-practices", {
				name: "react-native-best-practices",
				path: "/skills/react-native-best-practices/SKILL.md",
				content: "RN BODY",
				source: "user" as const,
			}],
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
		// Note: Entry skill and overlay content in prompt are rendered by Task 4 (root-prompt.ts)
	});

	void it("returns error when entry skill cannot be resolved", () => {
		const profile = {
			commandName: "sp-brainstorm",
			task: "design onboarding",
			useSubagents: true,
			useTestDrivenDevelopment: true,
			usePlannotatorReview: false,
			worktreesEnabled: false,
			fork: false,
			entrySkill: { name: "brainstorming", source: "command" as const },
			overlaySkillNames: [],
		};
		const skills = new Map([
			["using-superpowers", {
				name: "using-superpowers",
				path: "/skills/using-superpowers/SKILL.md",
				content: "USING BODY",
				source: "user" as const,
			}],
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

	void it("returns error when overlay skills cannot be resolved", () => {
		const profile = {
			commandName: "sp-brainstorm",
			task: "design onboarding",
			useSubagents: true,
			useTestDrivenDevelopment: true,
			usePlannotatorReview: false,
			worktreesEnabled: false,
			fork: false,
			entrySkill: { name: "brainstorming", source: "command" as const },
			overlaySkillNames: ["definitely-missing-skill"],
		};
		const skills = new Map([
			["using-superpowers", {
				name: "using-superpowers",
				path: "/skills/using-superpowers/SKILL.md",
				content: "USING BODY",
				source: "user" as const,
			}],
			["brainstorming", {
				name: "brainstorming",
				path: "/skills/brainstorming/SKILL.md",
				content: "BRAINSTORM BODY",
				source: "user" as const,
			}],
		]);

		const result = buildResolvedSkillEntryPrompt({
			cwd: process.cwd(),
			profile,
			resolveSkill: (_cwd, name) => skills.get(name),
			resolveSkillNames: () => ({ resolved: [], missing: ["definitely-missing-skill"] }),
		});

		assert.ok("error" in result);
		assert.match((result as { error: string }).error, /overlay skills could not be resolved/i);
		assert.match((result as { error: string }).error, /definitely-missing-skill/);
	});

	void it("passes entry skill source through prompt input", () => {
		const input = buildSkillEntryPromptInput({
			profile: {
				commandName: "skill:brainstorming",
				task: "design middleware",
				useSubagents: true,
				useTestDrivenDevelopment: true,
				usePlannotatorReview: false,
				worktreesEnabled: false,
				fork: false,
				entrySkill: { name: "brainstorming", source: "intercepted-skill" },
				overlaySkillNames: [],
			},
			overlaySkills: [],
		});

		assert.equal(input.entrySkillSource, "intercepted-skill");
	});
});
