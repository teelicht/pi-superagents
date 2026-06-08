# Fallow Maintainability Refactors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the remaining Fallow maintainability findings by refactoring high-complexity production code first, then consolidating repeated test fixtures.

**Architecture:** Keep behavior unchanged and refactor by extracting small named helpers around existing logic. Prioritize production complexity hotspots before test duplication, and keep each task independently verifiable with typecheck, focused tests, and `npx fallow`.

**Tech Stack:** TypeScript, Node.js test runner, Fallow, Pi extension APIs.

---

## Implementation Order

1. Production complexity with highest cognitive scores.
2. High-impact shared files with many dependents.
3. Test duplication helpers.
4. Final Fallow calibration and verification.

---

### Task 1: Split `validateConfigObject` in `src/execution/config-validation.ts`

**Files:**
- Modify: `src/execution/config-validation.ts`
- Test: `test/unit/config-validation.test.ts`

- [x] Read `validateConfigObject` and identify its validation groups: top-level object checks, superagents config, worktree config, model/tier config, tool/extension config, and error reporting.
- [x] Extract helpers with narrow contracts, for example:
  - `validateSuperagentsSection(...)`
  - `validateWorktreeSection(...)`
  - `validateModelSections(...)`
  - `validateToolPathSections(...)`
  - `pushConfigIssue(...)`
- [x] Keep the public return shape and diagnostic messages byte-for-byte compatible where tests assert them.
- [x] Run `npm run typecheck`.
- [x] Run `node --experimental-strip-types --test test/unit/config-validation.test.ts`.
- [x] Run `npx fallow` and confirm `validateConfigObject` drops from the top target list or has a materially lower cognitive score.

### Task 2: Split `handlePickerInput` in `src/ui/sp-settings.ts`

**Files:**
- Modify: `src/ui/sp-settings.ts`
- Test: `test/unit/sp-settings.test.ts`

- [x] Map current key handling branches: navigation, model selection, thinking selection, toggles, save/cancel, and empty-state handling.
- [x] Extract pure helpers where possible:
  - `handleNavigationKey(...)`
  - `handleModelSelectionKey(...)`
  - `handleThinkingSelectionKey(...)`
  - `handleToggleKey(...)`
  - `applySettingsSelection(...)`
- [x] Keep rendering and TUI side effects in the component method; move decision logic into helpers.
- [x] Preserve the `Component.invalidate()` method and its Fallow suppression because it is required by the TUI interface.
- [x] Run `npm run typecheck`.
- [x] Run `node --experimental-strip-types --test test/unit/sp-settings.test.ts`.
- [x] Run `npx fallow` and confirm `handlePickerInput` is no longer the highest-complexity UI finding.

### Task 3: Split `runPreparedChild` and `processLine` in `src/execution/child-runner.ts`

**Files:**
- Modify: `src/execution/child-runner.ts`
- Test: `test/integration/single-execution.test.ts`
- Test: `test/integration/error-handling.test.ts`

- [x] Preserve the current lifecycle extension behavior: session-backed children must receive this extension path without reintroducing a static import cycle.
- [x] Extract launch preparation helpers:
  - `prepareChildLaunch(...)`
  - `resolveChildExecutionOptions(...)`
  - `buildChildEnvironment(...)`
- [x] Extract stream-processing helpers:
  - `createLineProcessor(...)`
  - `processJsonMessageLine(...)`
  - `recordProgressFromMessage(...)`
  - `finalizeChildResult(...)`
- [x] Keep artifact writing and error detection behavior unchanged.
- [x] Run `npm run typecheck`.
- [x] Run `npm run test:integration -- test/integration/single-execution.test.ts test/integration/error-handling.test.ts` if supported; otherwise run `npm run test:integration`.
- [x] Run `npx fallow` and confirm `runPreparedChild` / `processLine` cognitive scores decrease.

### Task 4: Split `loadAgentsFromDir` in `src/agents/agents.ts`

**Files:**
- Modify: `src/agents/agents.ts`
- Test: `test/unit/path-resolution.test.ts`
- Test: any agent discovery tests currently covering `discoverAgents` / `discoverAgentsAll`

- [x] Extract file discovery from parsing:
  - `findAgentSkillFiles(...)`
  - `readAgentFrontmatter(...)`
  - `normalizeAgentConfig(...)`
  - `mergeAgentConfig(...)`
- [x] Preserve dynamic export compatibility for `discoverAgentsAll`, which is used by tests and documented in `.fallowrc.json`.
- [x] Run `npm run typecheck`.
- [x] Run `node --experimental-strip-types --test test/unit/path-resolution.test.ts`.
- [x] Run `npx fallow` and confirm `loadAgentsFromDir` drops from the top target list.

### Task 5: Split `collectPackageSkillPaths` in `src/shared/skills.ts`

**Files:**
- Modify: `src/shared/skills.ts`
- Test: skill/path-resolution tests that cover package and root skill discovery

- [x] Extract package-skill discovery phases:
  - `collectConfiguredPackageRoots(...)`
  - `collectPackageSkillDirectories(...)`
  - `resolvePackageSkillMetadata(...)`
  - `dedupeSkillPaths(...)`
- [x] Preserve public helpers currently intentionally exported for dynamic tests: `resolveSkillPath` and `discoverAvailableSkills`.
- [x] Run `npm run typecheck`.
- [x] Run relevant unit tests for skill discovery.
- [x] Run `npx fallow` and confirm `collectPackageSkillPaths` cognitive complexity decreases.

### Task 6: Split high-impact shared utilities

**Files:**
- Modify: `src/shared/utils.ts`
- Potentially create: `src/shared/message-utils.ts`
- Potentially create: `src/shared/tool-utils.ts`
- Potentially create: `src/shared/path-utils.ts`
- Test: affected unit/integration tests

- [x] Group utilities by responsibility: message extraction, tool argument preview, path/display helpers, and error detection.
- [x] Move cohesive groups into focused modules while preserving existing imports through either direct updates or temporary re-exports.
- [x] Prefer direct import updates in files that consume the helpers; avoid growing `utils.ts` as a barrel unless needed for compatibility.
- [x] Run `npm run typecheck`.
- [x] Run `npm run test:unit`.
- [x] Run `npx fallow` and confirm the high-impact `src/shared/utils.ts` recommendation improves.

### Task 7: Split `src/ui/subagents-status.ts` by rendering responsibility

**Files:**
- Modify: `src/ui/subagents-status.ts`
- Potentially create: `src/ui/subagents-status-state.ts`
- Potentially create: `src/ui/subagents-status-render.ts`
- Test: unit tests covering `SubagentsStatusComponent` and result rendering

- [x] Separate state/navigation logic from render formatting.
- [x] Keep the class as the TUI component shell with `render()`, `handleInput()`, `dispose()`, and `invalidate()`.
- [x] Move pure row/line generation into helper functions that are easy to test without TUI objects.
- [x] Run `npm run typecheck`.
- [x] Run unit tests covering subagent status rendering.
- [x] Run `npx fallow` and confirm high-impact score improves.

### Task 8: Consolidate repeated integration-test fixtures

**Files:**
- Modify: `test/integration/config-gating.test.ts`
- Modify: `test/integration/plannotator-review-tool.test.ts`
- Modify: `test/integration/slash-commands.test.ts`
- Modify: `test/integration/caller-ping-lifecycle.test.ts`
- Modify: `test/integration/error-handling.test.ts`
- Modify: `test/integration/parallel-execution.test.ts`
- Potentially create: `test/support/integration-fixtures.ts`

- [ ] Extract repeated mock Pi setup into `createMockPiIntegrationHarness(...)`.
- [ ] Extract repeated fake extension context / command registration helpers.
- [ ] Extract repeated temporary HOME setup into `withTemporaryHome(...)` or `createTemporaryHomeFixture(...)`.
- [ ] Replace duplicated setup blocks in integration tests incrementally, one test file at a time.
- [ ] Run `npm run test:integration` after each group of replacements.
- [ ] Run `npx fallow` and confirm duplicate clone groups decrease from 23.

### Task 9: Consolidate repeated unit-test fixtures

**Files:**
- Modify: `test/unit/superpowers-root-prompt.test.ts`
- Modify: `test/unit/superpowers-policy.test.ts`
- Potentially create: `test/support/superpowers-fixtures.ts`

- [ ] Extract repeated superpowers config/prompt fixture builders.
- [ ] Keep tests readable by using domain-specific helper names instead of generic factories.
- [ ] Run targeted unit tests.
- [ ] Run `npm run test:unit`.
- [ ] Run `npx fallow` and confirm duplicated lines decrease materially.

### Task 10: Final verification and documentation

**Files:**
- Modify docs only if behavior, configuration, or developer workflow changes.

- [ ] Run `npx fallow`; expected: exit 0, lower refactoring-target severity, fewer duplicate clone groups.
- [ ] Run `npm run typecheck`; expected: exit 0.
- [ ] Run `npm run test:unit`; expected: 0 failures.
- [ ] Run `npm run test:integration`; expected: 0 failures.
- [ ] Run `npm run test:all`; expected: exit 0, with e2e skipped if `pi-test-harness` is unavailable.
- [ ] Update `README.md`, `docs/configuration.md`, `docs/worktrees.md`, `docs/parameters.md`, and `docs/skills.md` if any developer workflow or public contract changes.
- [ ] Summarize before/after Fallow metrics: refactoring targets, duplicated lines, duplicate clone groups, and maintainability score.

---

## Recommended Batching

Batch 1: Tasks 1 and 2 only. These are the highest cognitive-complexity findings.

Batch 2: Tasks 3, 4, and 5. These reduce production complexity in execution, agent discovery, and skill discovery.

Batch 3: Tasks 6 and 7. These address high-impact shared/UI files.

Batch 4: Tasks 8 and 9. These reduce test duplication after production code is stable.

Batch 5: Task 10 final verification and documentation.
