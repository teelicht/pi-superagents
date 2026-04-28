# Refactor `subagent-executor.ts` — Task Tracker

## Phase 1: Dead Code & Backwards Compatibility Removal

- [x] `subagent-executor.ts` — Remove `context` from `SubagentParamsLike`
- [x] `subagent-executor.ts` — Delete `_buildRequestedModeError` (dead function)
- [x] `subagent-executor.ts` — Delete `_cleanTask` (dead variable, line 743)
- [x] `subagent-executor.ts` — Delete commented `// import * as fs` (line 11)
- [x] `subagent-executor.ts` — Remove `context` from all `resolveRequestedSessionMode` call sites
- [x] `subagent-executor.ts` — Simplify `withSessionModeDetails` — stop writing `context: "fork"`
- [x] `subagent-executor.ts` — Clean `ExecutorDeps`: remove `pi`, `expandTilde`, `tempArtifactsDir`, `config?`
- [x] `session-mode.ts` — Remove `context` from `resolveRequestedSessionMode`
- [x] `types.ts` — Delete `context` from `Details`, delete `LegacyExecutionContext`
- [x] `subagent-result-lines.ts` — Remove `details.context` fallback (lines 61, 172)
- [x] `fork-context-execution.test.ts` — Migrate tests from `context` to `sessionMode`
- [x] `fork-context.ts` — Delete obsolete legacy context resolver and its unit test
- [x] `subagent-executor.ts` — Keep single/parallel orchestration local; share child launches through `runChild` instead of creating `executor-single.ts` / `executor-parallel.ts`
- [x] `extension/index.ts` — Remove dead deps from `createSubagentExecutor` call
- [x] Run `npm run qa` — must pass

## Phase 2: Consolidate Executor (v0.7.0)

- [x] Extract `executor-validation.ts` (session-mode decorators + validation helpers)
- [x] Move parallel worktree helpers into `worktree.ts`
- [x] Consolidate all execution paths into `subagent-executor.ts` — one file, no over-fragmentation
- [x] Removed `executor-parallel.ts` and `executor-single.ts` (over-extraction)
- [x] Run `npm run qa` — must pass
- [x] Update CHANGELOG.md for v0.7.0
