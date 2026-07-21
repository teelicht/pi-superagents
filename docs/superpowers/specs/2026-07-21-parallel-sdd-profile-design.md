# Configurable Parallel SDD Profile — Design Spec

**Date:** 2026-07-21
**Status:** Approved for implementation planning
**Upstream reference:** Superpowers commit
[`d884ae04edebef577e82ff7c4e143debd0bbec99`](https://github.com/obra/superpowers/tree/d884ae04edebef577e82ff7c4e143debd0bbec99)

## Summary

Add a command-level `taskScheduling` option to `/sp-implement`. Sequential mode preserves
the current Superpowers subagent-driven development (SDD) flow. Parallel mode composes the
existing upstream `subagent-driven-development`, `dispatching-parallel-agents`, and
`using-git-worktrees` skills so dependency-ready implementation Tasks can run concurrently
without changing the plan format or reviewing individual Steps.

The extension will also consolidate `sp-spec-review` and `sp-code-review` into one
`sp-review` role, support persistent pre-isolated Task worktrees across implementation and
review calls, and add synchronous continuation of a prior child session so review fixes can
return to the original implementer.

No Superpowers skill is copied, forked, shadowed, or modified.

## Background

Superpowers plans contain reviewable **Tasks**, each composed of short **Steps**. Upstream
`writing-plans` defines a Task as the smallest independently testable unit worth a reviewer
gate; Steps are implementation actions such as writing a failing test, implementing, running
tests, and committing. Upstream SDD dispatches one implementer for the whole Task and reviews
after that Task, not after every Step.

The current pi-superagents runtime already provides the primitives needed for concurrent
work:

- synchronous parallel `subagent` dispatch with up to eight children;
- per-task `cwd` values passed to each spawned Pi process;
- distinct `lineage-only` child session files;
- automatic per-child Git worktrees for ordinary parallel calls; and
- per-worktree `.superpowers/sdd/` handoff artifacts.

Two runtime details prevent a complete parallel SDD review loop today:

1. Automatically created worktrees are ephemeral. The extension captures patches and removes
   the worktrees as soon as one parallel call returns, so a later reviewer or fix dispatch
   cannot reuse the same checkout.
2. Pi supports `--session <path>`, and pi-superagents retains the child session files, but the
   `subagent` API has no synchronous continuation input.

This design fills those gaps while leaving existing ephemeral parallel calls intact.

## Goals

1. Let users choose sequential or parallel SDD through command configuration.
2. Keep every plan Task, including all of its Steps, in one implementer run.
3. Run only dependency-ready, non-conflicting Tasks concurrently.
4. Isolate every parallel writer in a persistent Git worktree.
5. Review once per Task with one strong combined reviewer.
6. Resume the original cheap implementer session for review fixes.
7. Preserve upstream file handoff, TDD, blocker handling, progress-ledger, final-review, and
   branch-finishing behavior.
8. Preserve current sequential behavior by default.
9. Preserve existing `/sp-implement` branch, Plannotator, and `lineage-only` command policy.

## Non-Goals

- No new, copied, or adapted Superpowers skill.
- No new implementation command.
- No plan-format changes, explicit phase syntax, or changed Task sizes.
- No review between Steps.
- No dynamic risk scoring or optional per-Task review omission.
- No async, background, status, or general-purpose session-resume workflow.
- No native TypeScript plan parser or workflow engine.
- No parallel writers in one checkout.
- No compatibility aliases for removed reviewer agent names.
- Never modify upstream or installed skill files directly.

## User Configuration

### Command option

Add the following field to `SuperpowersCommandPreset`:

```ts
type TaskScheduling = "sequential" | "parallel";

interface SuperpowersCommandPreset {
  taskScheduling?: TaskScheduling;
  // existing fields unchanged
}
```

Example:

```json
{
  "superagents": {
    "commands": {
      "sp-implement": {
        "taskScheduling": "parallel",
        "worktrees": {
          "enabled": true
        }
      }
    }
  }
}
```

Use `"taskScheduling": "sequential"` to force the existing one-Task-at-a-time flow.

### Resolution and defaults

- `taskScheduling` is configuration-only; do not add `parallel` or `sequential` slash-command
  argument tokens.
- An omitted value resolves to `"sequential"`.
- The resolved value is carried by `ResolvedSuperpowersRunProfile` and rendered in the root
  workflow prompt.
- `/sp-settings` exposes a command-scoped sequential/parallel selector and writes the same
  field.
- The setting applies to implementation-plan Task scheduling only. Read-only parallel recon,
  research, and review remain available independently.
- Selecting parallel scheduling with worktrees enabled is explicit consent for the controller
  to create and clean the temporary Task worktrees; do not ask for separate worktree approval
  on every wave.
- Existing `useBranches`, `usePlannotator`, TDD, and lifecycle settings retain their current
  resolution and behavior.

### Validation

`taskScheduling: "parallel"` requires:

- `useSubagents` to resolve enabled; and
- `worktrees.enabled` to resolve enabled.

An explicit contradictory configuration, such as parallel scheduling with worktrees disabled,
must produce a clear `/sp-implement` preflight error. It must not launch concurrent writers or
silently pretend parallel mode is active.

If the configuration is valid but worktree creation fails at runtime, the controller reports
the concrete reason and safely executes the affected Tasks sequentially.

## Workflow Policy

### Sequential mode

Sequential mode keeps the existing upstream SDD contract:

1. Dispatch one whole Task to `sp-implementer`.
2. Review the Task with `sp-review`.
3. Resolve required findings.
4. Mark the Task complete and continue.
5. Run the final whole-branch `sp-review`.

The reviewer consolidation is global; otherwise scheduling remains unchanged.

### Parallel mode

The root prompt explicitly tells the controller to compose these installed upstream skills:

- `subagent-driven-development` for Task implementation, file handoff, review loops, and the
  final branch gate;
- `dispatching-parallel-agents` for concurrent independent work; and
- `using-git-worktrees` for safe isolated writable checkouts.

The controller remains the scheduler. It reads the plan, builds a conservative ready set, and
uses the existing `subagent` `tasks` array. No plan parser is added to the extension.

### Task boundaries

- A `### Task N` section is the implementation and intermediate-review unit.
- The Task brief contains all Steps under that Task.
- One implementer executes all Steps, tests, commits, and self-reviews before external review.
- The controller must never dispatch or review individual Steps as independent SDD work.

### Ready-set rules

A Task may join the current parallel wave only when:

- every Task it consumes or otherwise depends on is already integrated;
- its declared files do not overlap another Task in the wave;
- it does not share generated files, lockfiles, migrations, mutable fixtures, or other known
  write targets with another Task in the wave; and
- the controller can explain why the Tasks are independent.

Ambiguity means sequential execution. A ready wave is capped at the existing
`MAX_PARALLEL` value of eight. Fewer than two ready Tasks use the normal single dispatch path.

## Persistent Task Worktrees

### Why they are required

Parallel execution itself does not require worktrees for read-only agents. Parallel SDD
implementation does: implementers edit files, run potentially stateful tools, stage changes,
and commit. Distinct worktrees prevent file, index, and `HEAD` races.

### Ownership model

Parallel SDD uses **controller-owned persistent worktrees**, not the extension's existing
ephemeral automatic worktrees:

1. Verify the parent workflow checkout is clean.
2. Create one temporary branch and worktree from the current parent `HEAD` for each Task in the
   ready wave, using the configured worktree root and existing worktree guidance.
3. Pass each absolute worktree path as that Task's `cwd`.
4. Reuse the same path for implementation, review, fix, and re-review calls.
5. After approval and integration, remove the Task worktree and temporary branch.

### Pre-isolated `cwd` recognition

Today, enabled automatic isolation rejects task-level `cwd` values that differ from the shared
parallel `cwd`. Change that behavior only for a fully pre-isolated parallel group.

The extension may bypass automatic worktree creation when every task has an explicit, distinct
`cwd` and each path:

- exists and is a Git worktree;
- resolves to the same common Git directory as the parent checkout;
- is not the parent checkout or another Task's path; and
- is based on the expected wave base commit before implementation starts.

Mixed, duplicate, non-worktree, unrelated-repository, or stale-base paths fail validation.
Ordinary parallel calls without validated pre-isolated paths retain the existing automatic
ephemeral-worktree behavior and cleanup.

### SDD artifacts

The existing upstream scripts remain authoritative:

- `scripts/task-brief PLAN N` writes the whole Task brief;
- the implementer writes `task-<N>-report.md`;
- `scripts/review-package BASE HEAD` writes the review package; and
- `.superpowers/sdd/progress.md` remains the controller-owned persistent ledger.

Because `scripts/sdd-workspace` resolves the current Git worktree root, each Task worktree gets
an isolated scratch directory. After a Task is approved and integrated, the controller updates
the parent workflow ledger, cleans the Task's transient handoff files, and removes the worktree.
The parent `progress.md` is never deleted by Task cleanup.

## Synchronous Child Continuation

### API

Add an optional `resumeSession` input to single and per-task `subagent` requests. It accepts a
session file returned by a previous pi-superagents `sp-implementer` result.

This is deliberately narrow:

- execution remains synchronous and blocking;
- no status, polling, cancellation, or background API is added;
- continuation adds one new user turn to the prior child session; and
- continuation is limited to `sp-implementer` fix dispatches and runs with the same model policy
  and worktree `cwd`.

### Validation

Before launching a continuation, the extension verifies that:

- the session belongs to the current parent-session lineage;
- it was created by pi-superagents;
- both the original and requested role are `sp-implementer`;
- the original worktree still exists and matches the requested `cwd`;
- no process is currently using that child session; and
- the session mode is `lineage-only`.

Arbitrary paths, sibling-session files, role changes, missing worktrees, and concurrent reuse are
rejected. After validation, the existing Pi argument builder supplies the same file through
`--session`.

### Fix use

Critical and Important Task-review findings are sent to the original `sp-implementer` using
that Task's `resumeSession` and retained worktree. The implementer applies the fix, runs the
covering tests, commits, and updates its report. The controller then generates a fresh review
package and dispatches a fresh `sp-review`.

Minor findings are recorded in the parent progress ledger for final-review triage unless the
reviewer identifies a concrete reason they block Task integration.

## Unified Reviewer

### Agent consolidation

Delete:

- `agents/sp-spec-review.md`
- `agents/sp-code-review.md`

Add only:

- `agents/sp-review.md`

There are no compatibility aliases. Requests or user configuration referencing either removed
name fail as unknown-agent input after the change.

### Role contract

`sp-review` has:

- model tier `max`;
- `session-mode: lineage-only`;
- `maxSubagentDepth: 0`;
- read-only tools and instructions; and
- no ability to invoke subagents.

Every dispatch states `Review scope: task` or `Review scope: branch`.

For **task scope**, the reviewer reads the Task brief, implementer report, global constraints,
and Task review package. One response returns both:

1. spec-compliance verdict; and
2. code-quality verdict with severity-ranked findings.

For **branch scope**, the reviewer reads the design/spec, implementation plan, full branch
review package, test evidence, and accumulated Minor findings. It checks cross-Task integration,
regressions, requirements coverage, and maintainability.

All root policy, execution-role inference, allowed-agent descriptions, tests, examples, and
documentation use `sp-review` exclusively.

### Model routing

- `sp-implementer` stays on the `cheap` tier.
- `sp-review` uses the `max` tier for Task and branch scopes.
- Brainstorming and planning remain root-session workflows and therefore use the user's
  root-selected model; this profile does not create delegated planning roles.

## End-to-End Parallel Wave

For each ready wave:

1. Record the parent wave-base commit.
2. Create one persistent Task worktree per ready Task.
3. Run `task-brief` for each Task in its worktree.
4. Dispatch cheap implementers in one parallel call, each with its Task worktree `cwd`.
5. Preserve each successful implementer's session file for possible continuation.
6. Generate each Task's review package from its recorded base through its current `HEAD`.
7. Dispatch `sp-review` in task scope for completed Tasks; reviews may run concurrently because
   they are read-only and use distinct worktrees.
8. Resume original implementers for Critical or Important fixes, then re-review with fresh
   packages until approved or blocked.
9. Cherry-pick approved Task commits into the parent workflow branch in Task-number order.
10. Update the parent progress ledger and plan checkboxes.
11. Clean transient Task artifacts, worktrees, and temporary branches.
12. Recompute the ready set from the new parent `HEAD`.

After all Tasks are integrated, run verification and one branch-scope `sp-review`, then invoke
the existing branch-finishing workflow.

## Integration and Failure Handling

### Integration order

Although Tasks in a wave are independent, integrate them in Task-number order for deterministic
history. Preserve each Task's internal commit order, including multiple commits created during
its fix loop.

### Cherry-pick conflicts

A conflict means the independence analysis was incomplete. The controller must:

1. abort the cherry-pick;
2. retain diagnostic information for the failed integration;
3. recreate or reset that Task worktree from the newly integrated parent `HEAD`; and
4. rerun the Task sequentially.

Do not invent a speculative conflict resolution that neither Task implementer reviewed.

### Partial wave failure

- Safe sibling Tasks may finish review and integration.
- A failed or blocked Task is not integrated.
- Dependent Tasks remain blocked even if sibling Tasks succeeded.
- `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, and `BLOCKED` retain the Task worktree and handoff
  artifacts until the controller resolves or reports the blocker.
- On cancellation, clean only worktrees known to contain no unintegrated work; otherwise report
  their paths for recovery.

### Sequential fallback

Runtime inability to create safe worktrees falls back to the sequential SDD loop with a visible
reason. Dependency ambiguity also serializes only the affected Tasks. Parallel configuration
never authorizes same-checkout concurrent writers.

## Implementation Areas

The implementation plan should map the exact files, but the expected surfaces are:

- command config types, parsing, validation, persistence, defaults, examples, and `/sp-settings`;
- `ResolvedSuperpowersRunProfile` and root-prompt policy rendering;
- parallel task `cwd` validation and pre-isolated-worktree detection;
- child-session continuation schema, validation, launch planning, and result metadata;
- execution-role union, policy routing, allowed-agent descriptions, and agent discovery tests;
- removal of both old reviewer agent files and addition of `sp-review`;
- integration and end-to-end tests; and
- all required user documentation.

## Testing Strategy

### Unit tests

- `taskScheduling` accepts only `sequential` or `parallel` and defaults to sequential.
- Command config and `/sp-settings` round-trip the selected value.
- Parallel scheduling plus disabled subagents or worktrees produces a clear preflight error.
- Sequential root prompts preserve one-Task-at-a-time scheduling.
- Parallel root prompts require whole-Task waves, upstream skill composition, persistent
  worktrees, one review per Task, and final branch review.
- Valid pre-isolated Task worktrees bypass automatic ephemeral worktree creation.
- Duplicate, mixed, stale, unrelated, or ordinary-directory Task `cwd` values are rejected.
- Continuation validates parent lineage, role, worktree, session mode, and active ownership.
- Continued launches reuse the same Pi `--session` file and `cwd`.
- Role inference recognizes only `sp-review`; removed reviewer names are unknown.
- `sp-review` frontmatter uses `max`, `lineage-only`, and depth zero.

### Integration tests

Create a temporary Git repository and exercise:

```text
parallel implement
  → parallel task review
  → resume original implementer for a required fix
  → re-review
  → deterministic cherry-pick
  → final branch review handoff
  → worktree cleanup
```

Assert that:

- implementers have distinct checkouts and session files;
- all Steps of a Task stay in one implementer dispatch;
- no review occurs before the Task implementation completes;
- the resumed fix sees its original session history and checkout;
- only approved commits reach the parent branch;
- Task artifacts do not leak across worktrees;
- the parent progress ledger survives cleanup; and
- a simulated conflict or setup failure does not create parallel writers in one checkout.

### Regression checks

Keep existing sequential SDD, generic parallel delegation, automatic ephemeral worktree,
lineage-only session, compaction durability, TUI rendering, and Plannotator tests green.

## Documentation

Update the required user documentation with the final implementation:

- `README.md`: describe config-selected sequential/parallel `/sp-implement` behavior and the
  single `sp-review` role.
- `docs/configuration.md`: document `taskScheduling`, validation, defaults, model routing, and
  reviewer removal.
- `docs/worktrees.md`: distinguish ordinary ephemeral parallel worktrees from persistent
  controller-owned SDD Task worktrees.
- `docs/parameters.md`: document synchronous `resumeSession` and per-task pre-isolated `cwd`
  constraints.
- `docs/skills.md`: explain composition of the three upstream skills, whole-Task dispatch, and
  the unified reviewer.

Also update `default-config.json`, `config.example.json`, and release notes/changelog when the
implementation is prepared for release.

## Acceptance Criteria

The design is implemented when:

1. Users can select sequential or parallel SDD only through command configuration.
2. Sequential remains the default and retains existing scheduling behavior.
3. Parallel mode never dispatches concurrent implementation writers without validated isolated
   worktrees.
4. A Task's Steps execute in one implementer session and receive one combined Task review.
5. Independent Tasks run concurrently in persistent worktrees and integrate deterministically.
6. Required fixes resume the original implementer session in the original worktree.
7. Only `sp-review` is exposed; both old reviewer files and runtime references are removed.
8. Task and final branch reviews use the `max` tier; implementation uses `cheap`.
9. Existing upstream skill files and plan format remain untouched.
10. The full focused and regression test suites pass, and required documentation is current.
