/**
 * Unit tests for SubagentState compaction-durability fields.
 *
 * Responsibilities:
 * - verify new compaction-durability fields exist on SubagentState
 * - verify default values match the opt-in (false/null/empty) contract
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SubagentState } from "../../src/shared/types.ts";

void describe("SubagentState compaction-durability fields", () => {
	void it("accepts the four new compaction-durability fields", () => {
		const state: SubagentState = {
			baseCwd: "/tmp",
			currentSessionId: null,
			lastUiContext: null,
			configGate: { blocked: false, diagnostics: [], message: "", configPath: undefined, examplePath: undefined },
			superpowersActive: true,
			compactionSizing: "full",
			rootLifecycleSkillNames: ["verification-before-completion"],
			rootPromptProfile: {
				commandName: "sp-implement",
				task: "fix auth",
				entrySkill: "using-superpowers",
				fork: false,
				rootLifecycleSkillNames: ["verification-before-completion"],
			},
		};
		assert.equal(state.superpowersActive, true);
		assert.equal(state.compactionSizing, "full");
		assert.deepEqual(state.rootLifecycleSkillNames, ["verification-before-completion"]);
		assert.equal(state.rootPromptProfile?.task, "fix auth");
	});

	void it("allows opt-in defaults (false, null, empty)", () => {
		const state: SubagentState = {
			baseCwd: "/tmp",
			currentSessionId: null,
			lastUiContext: null,
			configGate: { blocked: false, diagnostics: [], message: "", configPath: undefined, examplePath: undefined },
			superpowersActive: false,
			compactionSizing: null,
			rootLifecycleSkillNames: [],
			rootPromptProfile: null,
		};
		assert.equal(state.superpowersActive, false);
		assert.equal(state.compactionSizing, null);
		assert.deepEqual(state.rootLifecycleSkillNames, []);
		assert.equal(state.rootPromptProfile, null);
	});
});
