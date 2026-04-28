# Refactoring `subagent-executor.ts` — Review & Revised Plan

## Review of Original Plan

I audited the original plan against the actual code. Here are the inconsistencies and missed opportunities I found.

### Inconsistency 1: `ExecutorDeps` has dead fields

The plan proposes extracting runners but doesn't mention that `ExecutorDeps` itself carries dead weight:

| Field | Used? | Notes |
|---|---|---|
| `pi` | **No** | Never accessed anywhere in the executor (`deps.pi` has zero hits) |
| `expandTilde` | **No** | Declared in the interface, never called |
| `tempArtifactsDir` | **No** | Declared, never read |
| `config?` | Legacy only | Always superseded by `getConfig()` — the `deps.getConfig?.() ?? deps.config!` pattern on lines 538, 713, 840 is pure compat |

These should be removed outright, not just extracted.

### Inconsistency 2: `_buildRequestedModeError` is dead code

The function on line 237 is prefixed with `_` and has **zero call sites** anywhere in the codebase. The plan lists it for extraction to `executor-validation.ts` — it should simply be deleted.

### Inconsistency 3: `_cleanTask` is dead code

Line 743: `const _cleanTask = task;` — assigned but never read. Dead variable, should be deleted.

### Inconsistency 4: Commented-out import

Line 11: `// import * as fs from "node:fs";` — dead commented code, should be deleted.

### Inconsistency 5: Plan underestimates the `context` removal surface

The plan mentions removing `context` from `SubagentParamsLike`, `Details`, and `session-mode.ts`, but misses:

- [subagent-result-lines.ts:61](file:///Users/thomas/Documents/Dev/pi-superagents/src/ui/subagent-result-lines.ts#L61) and [line 172](file:///Users/thomas/Documents/Dev/pi-superagents/src/ui/subagent-result-lines.ts#L172) — UI renderer reads `details.context === "fork"` as a fallback for the `[fork]` badge
- [types.ts:51](file:///Users/thomas/Documents/Dev/pi-superagents/src/shared/types.ts#L51) — `LegacyExecutionContext` type is exported but has **zero imports** anywhere. Pure dead code.
- [fork-context-execution.test.ts](file:///Users/thomas/Documents/Dev/pi-superagents/test/integration/fork-context-execution.test.ts) — **5 test cases** pass `context: "fork"` or `context: "fresh"` in params and assert on `result.details?.context`. These will all need migration to `sessionMode`.

### Inconsistency 6: Plan says extraction will reduce to ~150 lines — that's optimistic

After extraction of runners (~380 lines), validation (~60 lines), worktree helpers (~60 lines), and session decorators (~50 lines), the remaining `createSubagentExecutor` + types + imports is closer to **~250 lines**, not 150.

---

## Missed Simplification: Single vs Parallel Share ~80% of Their Logic

The plan proposes splitting single and parallel into separate files but doesn't address the **duplicated patterns** between them. Both runners independently:

1. Resolve config via `deps.getConfig?.() ?? deps.config!`
2. Resolve `agentConfig`, `sessionMode`, `modelOverride`, `skillOverride`, `maxSubagentDepth`
3. Call `buildSuperpowersPacketPlan` → `resolveStepBehavior` → `injectSuperpowersPacketInstructions`
4. Call `prepareLaunch` to set up session files and packet artifacts
5. Call `runSync` with a nearly identical options bag
6. Collect `progress` and `artifactPaths` from results
7. Wrap results with session mode metadata

The single runner is really just "parallel with `tasks.length === 1` and no worktree". Rather than splitting into two files that both duplicate this pipeline, a cleaner approach would be to **unify the execution pipeline** and have the single path be a thin adapter:

```typescript
// Single path becomes:
async function runSinglePath(data, deps) {
  const syntheticTasks = [{ agent: params.agent!, task: params.task! }];
  const result = await runTasks(syntheticTasks, data, deps);
  return formatSingleResult(result);
}
```

This would eliminate ~100 lines of duplicated resolution logic in `runSinglePath`.

> [!IMPORTANT]
> **Decision needed:** Do you want to unify single/parallel into a shared pipeline, or keep them as separate files? Unifying is cleaner but changes the internal architecture more aggressively.

### Decision: Keep orchestration in `subagent-executor.ts`

The current implementation keeps single and parallel execution in `subagent-executor.ts` and shares the common child-launch pipeline through `runChild`. This satisfies the simplification goal without creating `executor-single.ts` and `executor-parallel.ts`. The file remains larger than the original extraction target, but the remaining structure keeps mode-specific aggregation close to the executor entrypoint and avoids splitting tightly coupled orchestration across several small files.

---

## Revised Plan

### Phase 1: Remove Dead Code & Backwards Compatibility

No new files. Pure deletion.

#### [MODIFY] [subagent-executor.ts](file:///Users/thomas/Documents/Dev/pi-superagents/src/execution/subagent-executor.ts)
- Delete `context` from `SubagentParamsLike`
- Delete `_buildRequestedModeError` (dead, zero callers)
- Delete `_cleanTask` assignment (line 743)
- Delete commented `// import * as fs` (line 11)
- Remove `context` from all `resolveRequestedSessionMode` call sites
- Simplify `withSessionModeDetails` — stop writing `context: "fork"` into results
- Clean `ExecutorDeps`: remove `pi`, `expandTilde`, `tempArtifactsDir`, `config?`

#### [MODIFY] [session-mode.ts](file:///Users/thomas/Documents/Dev/pi-superagents/src/execution/session-mode.ts)
- Remove `context` parameter from `resolveRequestedSessionMode`
- Delete the two fallback lines (`if (input.context === "fork")` / `"fresh"`)

#### [MODIFY] [types.ts](file:///Users/thomas/Documents/Dev/pi-superagents/src/shared/types.ts)
- Delete `context?: "fresh" | "fork"` from `Details`
- Delete `LegacyExecutionContext` type (zero imports)

#### [MODIFY] [subagent-result-lines.ts](file:///Users/thomas/Documents/Dev/pi-superagents/src/ui/subagent-result-lines.ts)
- Remove `details.context === "fork"` fallback from lines 61 and 172 — rely solely on `details.sessionMode`

#### [MODIFY] [fork-context-execution.test.ts](file:///Users/thomas/Documents/Dev/pi-superagents/test/integration/fork-context-execution.test.ts)
- Migrate all 5 tests from `context: "fork"` / `context: "fresh"` to `sessionMode: "fork"` / `sessionMode: "standalone"`
- Remove assertions on `result.details?.context`

#### [MODIFY] [index.ts](file:///Users/thomas/Documents/Dev/pi-superagents/src/extension/index.ts)
- Remove `expandTilde` from `createSubagentExecutor` call (line 208)
- `pi` is already not passed (events is, but via a different path) — verify and clean

---

### Phase 2: Extract Modules

#### [NEW] [executor-validation.ts](file:///Users/thomas/Documents/Dev/pi-superagents/src/execution/executor-validation.ts)
- `validateExecutionInput`, `getRequestedModeLabel`, `toExecutionErrorResult`, `buildParallelModeError`
- Session-mode result decorators: `withSessionModeDetails`, `withSingleResultSessionMode`, `withProgressResultSessionMode`, `resolveAgentSessionMode`, `resolveDetailsSessionMode`

#### [MODIFY] [worktree.ts](file:///Users/thomas/Documents/Dev/pi-superagents/src/execution/worktree.ts)
- Move `createParallelWorktreeSetup`, `buildParallelWorktreeTaskCwdError`, `resolveParallelTaskCwd`, `resolveParallelTaskRuntimeCwd`, `buildParallelWorktreeSuffix`

#### [KEEP] [subagent-executor.ts](file:///Users/thomas/Documents/Dev/pi-superagents/src/execution/subagent-executor.ts)
- Keep `runParallelPath`, `runForegroundParallelTasks`, `runSinglePath`, `prepareLaunch`, and `PreparedLaunch` local to the executor.
- Share child launch and cleanup behavior through the existing `runChild` helper.
- Treat the absence of `executor-single.ts` and `executor-parallel.ts` as the accepted architecture, not a remaining gap.

#### [DELETE] [fork-context.ts](file:///Users/thomas/Documents/Dev/pi-superagents/src/execution/fork-context.ts)
- Remove the legacy `fresh` / `fork` helper and its unit test; active launch behavior now lives in `session-mode.ts`.

---

## Open Questions

> [!IMPORTANT]
> 1. **Unify single/parallel?** Resolved: keep the two mode-specific paths local and share the child-launch pipeline through `runChild`.
> 2. **Phase 1 first?** Resolved: dead code and compatibility cleanup landed before further extraction cleanup.

## Verification Plan

### Automated Tests
- `npm run test` — all tests must pass after each phase
- Specifically watch `fork-context-execution.test.ts` after migrating from `context` to `sessionMode`

### Manual Verification
- Run a single `sp-implement` command and verify session metadata in output
- Run a parallel workflow and verify worktree diffs still render
