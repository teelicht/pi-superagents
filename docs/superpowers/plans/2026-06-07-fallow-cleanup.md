# Fallow Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `npx fallow` pass by fixing high-confidence static-analysis findings without broad unrelated refactors.

**Architecture:** Keep lifecycle extension path ownership in the extension layer and pass it down through executor dependencies/options, so child-runner no longer imports the extension module. Keep canonical shared contracts in `src/shared/types.ts`; remove or de-export internal unused symbols only after verifying there are no references.

**Tech Stack:** TypeScript, Node.js test runner, Fallow, Pi extension APIs.

---

### Task 1: Break the child-runner extension cycle

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/execution/subagent-executor.ts`
- Modify: `src/execution/child-runner.ts`
- Modify: `src/extension/index.ts`

- [ ] Add an optional `lifecycleExtensionEntry?: string` field to the shared runner/executor option types in `src/shared/types.ts` or executor dependency interfaces.
- [ ] Update `src/extension/index.ts` to compute the entry path with `fileURLToPath(import.meta.url)` and pass it into `createSubagentExecutor` dependencies.
- [ ] Update `src/execution/subagent-executor.ts` to pass `lifecycleExtensionEntry` into every `runPreparedChild` call.
- [ ] Update `src/execution/child-runner.ts` to remove `fileURLToPath`/`SELF_EXTENSION_ENTRY` import logic and use `options.lifecycleExtensionEntry` inside `includeLifecycleExtension`.
- [ ] Run `npm run typecheck`; expected: no TypeScript errors.

### Task 2: Consolidate duplicate exported types

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/execution/subagent-executor.ts`
- Modify: `src/extension/index.ts`

- [ ] Move or confirm `SubagentParamsLike` in `src/shared/types.ts` is the canonical exported type.
- [ ] Remove the duplicate exported `SubagentParamsLike` interface from `src/execution/subagent-executor.ts` and import the shared type instead.
- [ ] Update imports in `src/extension/index.ts` and any tests if needed.
- [ ] Run `npm run typecheck`; expected: no TypeScript errors.

### Task 3: Remove true dead agent helper code

**Files:**
- Modify/Delete: `src/agents/agent-selection.ts`
- Modify: `src/agents/agents.ts` if the helper is inlined or adopted

- [ ] Verify `mergeAgentsForScope` has no references.
- [ ] Delete `src/agents/agent-selection.ts` if unused, or integrate it into `discoverAgents` if it reduces duplication without adding public API.
- [ ] Run `npm run typecheck`; expected: no TypeScript errors.

### Task 4: Prune/de-export unused exports and class members

**Files:**
- Modify files reported by Fallow, including likely `src/agents/agents.ts`, `src/shared/skills.ts`, `src/shared/formatters.ts`, `src/integrations/plannotator.ts`, `src/ui/sp-settings.ts`, and `src/ui/subagents-status.ts`.

- [ ] Run `npx fallow --format json` or `npx fallow` to get the current exact unused export list.
- [ ] For each unused value/type export that is only internal, either remove `export` or remove the symbol if unused in its own file.
- [ ] Remove unused `invalidate` class members if no external caller exists.
- [ ] Run `npm run typecheck`; expected: no TypeScript errors.

### Task 5: Configure legitimate dynamic test asset

**Files:**
- Create/Modify: Fallow config file supported by this project/tooling
- Keep: `test/support/mock-pi-script.mjs`

- [ ] Add a Fallow configuration entry that treats `test/support/mock-pi-script.mjs` as an entrypoint or suppresses that single false-positive unused-file finding.
- [ ] Do not delete `mock-pi-script.mjs`; `test/support/mock-pi.ts` launches it dynamically.

### Task 6: Final verification

**Files:**
- No source edits unless verification exposes issues.

- [ ] Run `npx fallow`; expected: exit 0.
- [ ] Run `npm run typecheck`; expected: exit 0.
- [ ] Run relevant tests: `npm run test:unit`, then broader tests if needed.
- [ ] Summarize remaining intentionally ignored findings, if any.
