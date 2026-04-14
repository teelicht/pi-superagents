# Inline Subagent Output: Eliminate Packet File Artifacts

> Spec date: 2026-04-14
> Status: DRAFT

## Problem

Subagent roles currently write output to `.md` files on disk (`implementer-report.md`, `code-review.md`, `spec-review.md`, `debug-brief.md`). This was originally designed for a chain-handoff model where one agent reads the previous agent's file. But in practice:

1. **Tool/prompt conflict.** Three "read-only" agents (`sp-code-review`, `sp-spec-review`, `sp-debug`) carry the `write` tool solely to produce these output files, contradicting their system prompts which say "do not edit files."

2. **Artifacts left on disk.** Real runs leave orphaned files in the project root — the audit found `code-review.md`, `debug-brief.md`, `implementer-report.md`, and `spec-review.md` sitting in the repo root from previous runs.

3. **Redundant data path.** The JSONL stream from the child PI process already delivers the complete assistant text via `message_end` events. The extension extracts this text with `getFinalOutput()` as the `fallbackOutput`, but `resolveSingleOutput()` then reads the file back from disk and **replaces** the JSONL text with the file contents. The file write → file read is a round-trip that serves no purpose for single-shot delegation.

4. **Hardcoded fallback inconsistency.** `NON_DELEGATING_ROLE_TOOLS` omits `write` for the review/debug agents, but their frontmatter includes it. If frontmatter were ever missing, the fallback would break output-file generation.

## Design

### Principle: JSONL stream is the primary output path

The child PI process streams structured JSON events to stdout. The `message_end` event contains the full `AssistantMessage` with all text content. The extension already parses this stream and extracts the final assistant text via `getFinalOutput()`. **This is the authoritative output.** File writes by the agent are an unnecessary side channel.

### Changes

#### 1. Remove output-file injection from task prompts

**File: `src/execution/superpowers-packets.ts`**

- `buildSuperpowersPacketPlan()` — set `output: false` for **all** roles. Remove the `implementer-report.md`, `spec-review.md`, `code-review.md`, and `debug-brief.md` output assignments.
- Keep the `reads` arrays unchanged for now. When chain-handoff is properly designed in the future, reads will be rewritten at the orchestration layer (see Future Work).
- `injectSuperpowersPacketInstructions()` — remove the `[Write to: ...]` injection branch entirely. Only the `[Read from: ...]` branch remains.

**File: `src/execution/single-output.ts`**

- `injectSingleOutputInstruction()` — remove entirely. No more "Write your findings to: ..." instructions.
- `resolveSingleOutputPath()` — remove. Output paths no longer come from packet plans.
- `captureSingleOutputSnapshot()` — remove. No pre/post file snapshot comparison needed.
- `persistSingleOutput()` — remove. No file writes from the extension side.
- `resolveSingleOutput()` — remove. No file readback needed.
- `finalizeSingleOutput()` — simplify to just return `{ displayOutput }`. No file path operations.
- The file may become empty or be deleted entirely; any remaining utilities should be moved to a more appropriate module.

#### 2. Simplify `resolveStepBehavior` and execution paths

**File: `src/execution/settings.ts`**

- Remove `output` and `defaultReads` from `ResolvedStepBehavior` and `StepOverrides`. These fields only existed to support the packet-file mechanism. The `reads` field stays — it's still useful for future orchestration.

**File: `src/execution/subagent-executor.ts`**

- Remove all `outputPath` / `single-output` logic from both `runSinglePath` and `runParallelPath`:
  - Remove `resolveSingleOutputPath` call
  - Remove `injectSingleOutputInstruction` call
  - Remove `outputPath` from `RunSyncOptions`
  - Remove the `resolveSingleOutput` / `captureSingleOutputSnapshot` calls in execution
  - Remove `savedOutputPath` / `outputSaveError` from `SingleResult`
  - Remove `finalizeSingleOutput` call — use the JSONL-extracted output directly

**File: `src/execution/execution.ts`**

- Remove `outputPath` / `outputSnapshot` from `RunSyncOptions`
- Remove the `resolveSingleOutput` / `persistSingleOutput` / `captureSingleOutputSnapshot` calls
- Use `getFinalOutput(result.messages)` as the sole output source
- Remove the `savedOutputPath` / `outputSaveError` fields from the result
- Keep artifact writing — artifacts are a separate concern (debugging/observability) and don't interfere with the agent's tool access.

#### 3. Remove `write` from read-only agent frontmatter and hardcoded fallback

**Files: `agents/sp-code-review.md`, `agents/sp-spec-review.md`, `agents/sp-debug.md`**

- Remove `write` from each agent's `tools:` frontmatter:
  - `sp-code-review.md`: `tools: read, grep, find, ls` (was `read, grep, find, ls, write`)
  - `sp-spec-review.md`: `tools: read, grep, find, ls` (was `read, grep, find, ls, write`)
  - `sp-debug.md`: `tools: read, grep, find, ls, bash` (was `read, grep, find, ls, bash, write`)

**File: `src/execution/superpowers-policy.ts`**

- Update `NON_DELEGATING_ROLE_TOOLS` to match:
  - `"sp-code-review"`: `["read", "grep", "find", "ls"]`
  - `"sp-spec-review"`: `["read", "grep", "find", "ls"]`
  - `"sp-debug"`: `["read", "grep", "find", "ls", "bash"]`

**`sp-implementer` keeps `write`** — it legitimately modifies source files.

#### 4. Update agent system prompts

**File: `agents/sp-debug.md`**

- Remove "Treat `debug-brief.md` as an in-place working document" — the debug brief concept is replaced by inline task context.

**No changes needed** for `sp-code-review.md` and `sp-spec-review.md` — they already correctly say "this is a read-only role. Do not edit files."

#### 5. Clean up UI rendering

**File: `src/ui/render.ts`**

- `extractOutputTarget()` — remove. No more `[Write to: ...]` or "Write your findings to:" patterns to extract from task text.
- `hasEmptyTextOutputWithoutOutputTarget()` — simplify to just check `!output.trim()`. The "without output target" distinction no longer exists.

#### 6. Clean up `SingleResult` and `Details` types

**File: `src/shared/types.ts`**

- Remove `savedOutputPath` and `outputSaveError` from `SingleResult`.
- Keep `outputPath` in `ArtifactPaths` — artifact output files are separate from packet output files.

#### 7. Remove stale packet filenames from `buildSuperpowersPacketPlan`

**File: `src/execution/superpowers-packets.ts`**

After changes, `buildSuperpowersPacketPlan` returns reads (for future chain support) but always `output: false`:

```typescript
export function buildSuperpowersPacketPlan(role: ExecutionRole): SuperpowersPacketPlan {
  switch (role) {
    case "sp-implementer":
      return { reads: ["task-brief.md"], output: false, progress: false };
    case "sp-spec-review":
      return { reads: ["task-brief.md", "implementer-report.md"], output: false, progress: false };
    case "sp-code-review":
      return { reads: ["task-brief.md", "spec-review.md"], output: false, progress: false };
    case "sp-debug":
      return { reads: ["debug-brief.md"], output: false, progress: false };
    default:
      return { reads: [], output: false, progress: false };
  }
}
```

This keeps the `reads` metadata for now (it's inert since no one writes those files) and documents the intended chain inputs. A future chain-orchestration layer will use `reads` to inject context from previous agent outputs.

#### 8. Remove `output` and `defaultReads` from `AgentConfig` and `KNOWN_FIELDS`

**File: `src/agents/agents.ts`**

- Remove `output`, `defaultReads`, `defaultProgress`, `interactive` from `AgentConfig`.
- Remove `output`, `defaultReads`, `defaultProgress`, `interactive` from `KNOWN_FIELDS`.
- Remove their parsing in `loadAgentsFromDir`.

These fields are no longer consumed by the execution path (the only consumer was `resolveStepBehavior`, which we're simplifying).

#### 9. Update tests

**File: `test/integration/superpowers-packets.test.ts`**

- Update `buildSuperpowersPacketPlan` assertions: all roles now return `output: false`.
- Remove `injectSuperpowersPacketInstructions` tests that assert `[Write to: ...]` injection.
- Remove `injectSingleOutputInstruction` tests.
- Update single-execution and parallel-execution tests that assert `savedOutputPath` or `outputPath` in results.
- Update `resolveStepBehavior` tests that assert `output` or `defaultReads` precedence.

**File: `test/integration/single-execution.test.ts`**

- Remove assertions about output file creation or `outputPath` in results.

#### 10. Delete stale output files from repo

- Delete `code-review.md`, `debug-brief.md`, `implementer-report.md`, `spec-review.md` from the project root.
- Add these filenames to `.gitignore` to prevent future accidental commits.

### Files Changed Summary

| File | Change |
|------|--------|
| `agents/sp-code-review.md` | Remove `write` from tools |
| `agents/sp-spec-review.md` | Remove `write` from tools |
| `agents/sp-debug.md` | Remove `write` from tools; update system prompt |
| `src/execution/superpowers-packets.ts` | Set `output: false` for all roles; remove write-injection branch |
| `src/execution/superpowers-policy.ts` | Remove `write` from fallback tool lists for review/debug agents |
| `src/execution/single-output.ts` | Delete file (or gut to empty) |
| `src/execution/settings.ts` | Remove `output`, `defaultReads`, `defaultProgress` from interfaces |
| `src/execution/subagent-executor.ts` | Remove all outputPath / single-output logic |
| `src/execution/execution.ts` | Remove outputPath from options; use JSONL output directly |
| `src/agents/agents.ts` | Remove `output`, `defaultReads`, `defaultProgress`, `interactive` from config |
| `src/ui/render.ts` | Remove `extractOutputTarget`; simplify `hasEmptyTextOutputWithoutOutputTarget` |
| `src/shared/types.ts` | Remove `savedOutputPath`, `outputSaveError` from `SingleResult` |
| `test/integration/superpowers-packets.test.ts` | Update assertions for `output: false`; remove write-injection tests |
| `test/integration/single-execution.test.ts` | Remove outputPath assertions |
| `.gitignore` | Add `implementer-report.md`, `spec-review.md`, `code-review.md`, `debug-brief.md` |
| Root `*.md` output files | Delete `code-review.md`, `debug-brief.md`, `implementer-report.md`, `spec-review.md` |

### What We Keep

- **`reads` in packet plans.** The `reads` metadata documents which files a role *would* need in a chain. The orchestration layer can use this to inject context from previous inline outputs. No agent writes these files; the extension writes them between runs if chain-handoff is implemented.
- **Artifacts.** The artifact system (`getArtifactPaths`, `writeArtifact`, `writeMetadata`) remains unchanged. Artifacts are for debugging/observability and are written by the extension, not by the agent.
- **`sp-implementer` retains `write`.** This agent legitimately modifies source files.

## Future Work

### Chain orchestration (not in this spec)

When subagents are run in a sequence (implementer → spec-review → code-review), each needs the previous agent's output. The extension orchestrator should:

1. Capture the JSONL-stream text output from agent N
2. Write it to a temporary file matching agent N+1's expected read path (e.g., write implementer output to `implementer-report.md`)
3. Include `[Read from: implementer-report.md]` in agent N+1's task prompt
4. Clean up temporary files after the chain completes

This keeps the file-based handoff for chains but makes the extension the filesystem intermediary — agents never need `write` to produce their own output.

### Structured output sections

Instead of "Write your findings to: X.md", the task prompt can request "End your response with a `## Findings` section" and the extension can parse that section from the inline text. This is optional and doesn't need to be implemented now.

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Agents that relied on writing files now fail | Only `sp-code-review`, `sp-spec-review`, `sp-debug` lose `write`. These agents' system prompts already say "do not edit files." The `sp-implementer` keeps `write`. |
| Task prompts still reference output filenames | `buildSuperpowersPacketPlan` and `injectSuperpowersPacketInstructions` are updated to no longer inject `[Write to: ...]` or "Write your findings to: ..." instructions. The `[Read from: ...]` injection remains but is inert (no one writes those files until chain orchestration is built). |
| Tests assert output file creation | Test updates are part of this spec. All output-file assertions are removed. |
| `resolveSingleOutput` was used for truncation recovery | Artifacts handle truncation. If the output is too large, the artifact system writes it to disk. The `maxOutput` + artifact path mechanism already covers this case. |

## Verification

1. All agents produce their output via the JSONL stream — no `.md` files created in the working directory
2. `sp-code-review`, `sp-spec-review`, `sp-debug` no longer have `write` in their tool lists
3. `sp-implementer` still has `write`
4. All existing tests pass with updated assertions
5. Running `sp-code-review`, `sp-spec-review`, or `sp-debug` via the subagent tool produces inline text output without writing files
6. Running `sp-implementer` still works and can write source files
7. No `[Write to: ...]` or "Write your findings to: ..." instructions appear in any agent's task prompt
8. The `NON_DELEGATING_ROLE_TOOLS` fallback matches the frontmatter tool lists