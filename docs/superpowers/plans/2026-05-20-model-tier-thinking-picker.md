# Model Tier Thinking Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `/sp-settings` select a thinking level immediately after selecting a model for a model tier.

**Architecture:** Extend the existing `SuperpowersSettingsComponent` picker state with a `thinking-picker` mode. Reuse config writer patterns so changing thinking preserves the selected model and `default` removes the explicit thinking override.

**Tech Stack:** TypeScript, Node test runner, existing Pi TUI component helpers.

---

### Task 1: Config writer support

**Files:**
- Modify: `src/superpowers/config-writer.ts`
- Test: `test/unit/superpowers-config-writer.test.ts`

- [ ] Write failing tests for setting, clearing, and preserving model tier thinking.
- [ ] Implement `setSuperpowersModelTierThinking(config, tierName, thinking)`.
- [ ] Verify writer tests pass.

### Task 2: Settings TUI thinking picker

**Files:**
- Modify: `src/ui/sp-settings.ts`
- Test: `test/unit/sp-settings.test.ts`

- [ ] Write failing test for model selection followed by thinking selection.
- [ ] Add `thinking-picker` mode with `default`, `low`, `medium`, `high` choices.
- [ ] After model selection, transition to thinking picker instead of returning to tier picker.
- [ ] Persist selected thinking and return to tier picker.
- [ ] Verify settings tests pass.

### Task 3: Documentation and verification

**Files:**
- Modify: `README.md`
- Modify: `docs/configuration.md`
- Modify: `docs/parameters.md`
- Modify: `docs/skills.md`
- Modify: `docs/worktrees.md`

- [ ] Update docs to mention the model → thinking picker flow.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
- [ ] Commit and push to `main`.
