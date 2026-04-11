# Lean Superpowers Runtime Pruning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the radical simplification of the `pi-superagents` runtime by removing all remaining generic code, dead modules, and legacy features to deliver a pure Superpowers-first product.

**Architecture:**
- **Types/Schemas First**: Narrow the tool and result contracts to remove generic execution parameters.
- **Executor/Runner Refactor**: Strip the execution engine of sequential "chain" support and legacy plumbing.
- **TUI Revamp**: Refactor the status overlay into a two-pane view (Settings and Runs).
- **Final Pruning**: Delete dead files and sync documentation.

**Tech Stack:** TypeScript, Node.js, Pi Extension API, TypeBox.

---

### Task 1: Type & Schema Pruning

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/schemas.ts`

- [ ] **Step 1: Update `SubagentParams` in `src/shared/schemas.ts`.**
  - Remove `async`, `sessionDir`, `agentScope` from the schema.
  - Update descriptions to emphasize Superpowers roles.

- [ ] **Step 2: Prune `Details` and `AsyncStatus` in `src/shared/types.ts`.**
  - Remove `chain` from `mode` enums.
  - Remove `chainAgents`, `totalSteps`, `currentStepIndex` from `Details`.
  - Remove `shareUrl`, `gistUrl`, `shareError` from `AsyncStatus` and `AsyncJobState`.

- [ ] **Step 3: Verify build.**
  - Run: `npm run test:unit`
  - Expected: Type errors in executor/runner that will be fixed in next tasks.

---

### Task 2: Subagent Executor Simplification

**Files:**
- Modify: `src/execution/subagent-executor.ts`

- [ ] **Step 1: Strip generic parameter normalization.**
  - Remove `expandTopLevelTaskCounts` and `normalizeRepeatedParallelCounts`.
  - Update `SubagentParamsLike` to match the pruned schema from Task 1.

- [ ] **Step 2: Remove `chain` branches.**
  - Delete logic in `createSubagentExecutor` that checks for `params.chain`.
  - Ensure `workflow` defaults strictly to `"superpowers"`.

- [ ] **Step 3: Fix `runAsyncPath` and `runSinglePath`.**
  - Remove passing of `async` and `sessionDir` to runners.

- [ ] **Step 4: Commit.**
  ```bash
  git add src/shared/types.ts src/shared/schemas.ts src/execution/subagent-executor.ts
  git commit -m "refactor: prune tool schema and executor generic logic"
  ```

---

### Task 3: Subagent Runner Pruning

**Files:**
- Modify: `src/execution/subagent-runner.ts`

- [ ] **Step 1: Remove sequential step loop.**
  - Refactor `runSubagent` to expect either a single step or a parallel group, not a list of `steps`.
  - Remove the loop over `steps`.

- [ ] **Step 2: Delete HTML export and Gist logic.**
  - Remove `exportSessionHtml` and `createShareLink`.
  - Remove `gh` CLI checks and sharing-related metadata updates.

- [ ] **Step 3: Update `RunnerStatusPayload` and `StepResult`.**
  - Align with narrowed types from Task 1.

- [ ] **Step 4: Commit.**
  ```bash
  git add src/execution/subagent-runner.ts
  git commit -m "refactor: remove chain execution and sharing logic from runner"
  ```

---

### Task 5: UI & Rendering Cleanup

**Files:**
- Modify: `src/ui/render.ts`
- Modify: `src/shared/formatters.ts`

- [ ] **Step 1: Remove chain rendering from `render.ts`.**
  - Delete `chainVis` logic and loops over `d.chainAgents`.
  - Simplify `renderSubagentResult` to focus on `single` and `parallel`.

- [ ] **Step 2: Remove `buildChainSummary` from `formatters.ts`.**
  - This is no longer used.

- [ ] **Step 3: Commit.**
  ```bash
  git add src/ui/render.ts src/shared/formatters.ts
  git commit -m "ui: remove legacy chain rendering"
  ```

---

### Task 6: Two-Pane Status TUI

**Files:**
- Modify: `src/ui/superpowers-status.ts`

- [ ] **Step 1: Add state for active pane.**
  - Add `private activePane: 'settings' | 'runs' = 'settings'` to `SuperpowersStatusComponent`.

- [ ] **Step 2: Implement pane rendering.**
  - Split `render` into `renderSettingsPane` and `renderRunsPane`.
  - Implement a scrollable list of recent runs in `renderRunsPane` (reading from `state.asyncJobs`).

- [ ] **Step 3: Add toggle keybindings.**
  - Update `handleInput` to support `Tab` or `s`/`r` for pane switching.

- [ ] **Step 4: Commit.**
  ```bash
  git add src/ui/superpowers-status.ts
  git commit -m "ui: implement two-pane status/settings overlay"
  ```

---

### Task 7: Final Pruning & Documentation

**Files:**
- Remove: `src/slash/slash-live-state.ts`
- Remove: `src/ui/subagents-status.ts`
- Modify: `docs/reference/configuration.md`
- Modify: `docs/reference/parameters.md`

- [ ] **Step 1: Delete dead modules.**
  ```bash
  rm src/slash/slash-live-state.ts src/ui/subagents-status.ts
  ```

- [ ] **Step 2: Update Reference Documentation.**
  - Remove `maxSubagentDepth`, `asyncByDefault` from `configuration.md`.
  - Remove legacy parameters from `parameters.md`.

- [ ] **Step 3: Final Verification.**
  - Run: `npm run test:all`
  - Expected: ALL PASS.

- [ ] **Step 4: Final Commit.**
  ```bash
  git add .
  git commit -m "chore: final lean pruning and documentation sync"
  ```
