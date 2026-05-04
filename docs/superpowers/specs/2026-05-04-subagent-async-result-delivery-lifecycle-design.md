# Subagent Result Ownership and Lifecycle Design

## Purpose

Improve subagent coordination in `pi-superagents` by separating execution planning, child process execution, result ownership, and lifecycle interpretation.

The goal is structural depth, not an async-first product surface. Current synchronous single and parallel execution remains the compatibility baseline. The design introduces the internal capabilities needed for future side-channel coordination, but does not expose `async: true | false` in agent frontmatter, tool parameters, or ordinary user prompts.

Selected runtime ideas from `/Users/thomas/Documents/Dev/pi-subagents_edxeth` remain useful as protocol references:

1. explicit result ownership with wait/join/detach semantics
2. child lifecycle signals with `caller_ping`, `subagent_done`, `.exit` sidecars, and process-close fallback
3. completion delivery states that prevent duplicate result delivery

This spec adapts those structural patterns without copying edxeth UI, mux, pane, widget, or tab-title behavior.

## Product Principle

Ordinary users should not have to decide whether a subagent is async or sync.

Users ask for delegation in natural language. Superpowers workflows should remain conservative: implementation, debugging, review-response, plan execution, and code-review loops usually need the child result before selecting the next step. Those workflows continue to behave synchronously.

This spec therefore removes user-facing and author-facing async controls from the initial design:

- no `async: true | false` agent frontmatter
- no `blocking` compatibility field
- no call-time `async` parameter
- no built-in async role defaults

The runtime may later use the deeper seams from this design to support safe side-channel work, but that future capability should be implemented behind explicit runtime policy, not through user-facing async switches.

## Goals

- Keep current synchronous single and parallel execution behavior as the baseline.
- Add an execution-planning seam that resolves child run shape before launch.
- Add explicit result ownership so each child result is delivered at most once.
- Add wait/join/detach ownership semantics as internal capabilities and future tool seams.
- Add child lifecycle signals that distinguish intentional completion, help requests, and fallback process exits.
- Split process spawning/event parsing from result delivery ownership.
- Improve testability by making execution planning, result delivery, child running, and lifecycle interpretation independently testable.
- Keep existing worktree, session mode, artifact, progress, and Superpowers role behavior intact.
- Reuse or closely adapt non-UI protocol semantics from `pi-subagents_edxeth` where package boundaries allow.

## Non-goals

- Do not make subagent execution async by default.
- Do not expose `async: true | false` in frontmatter.
- Do not add call-time async options.
- Do not add `blocking` as a compatibility alias.
- Do not require normal users or custom agent authors to choose async versus sync.
- Do not make `sp-implement` or the normal implementation loop side-channel/background work.
- Do not replace the existing `subagent` tool with edxeth's full tool surface.
- Do not copy edxeth UI elements, widgets, mux panes, tab-title tools, or interactive subagent surfaces.
- Do not remove current synchronous single/parallel execution support.

## Current State

`pi-superagents` currently executes subagents synchronously through `src/execution/execution.ts` and orchestrates single/parallel calls in `src/execution/subagent-executor.ts`.

Important current behavior:

- `runSync()` resolves model/tools/skills, builds Pi args, spawns a child Pi process, parses JSONL events, updates progress, writes artifacts, updates run history, detects errors, and resolves when the process closes.
- `runSinglePath()` resolves per-child behavior, runs one child, and formats a single result.
- `runParallelPath()` resolves per-task behavior, optionally creates worktrees, waits for all foreground children, aggregates outputs, and returns one response.
- progress and artifacts are tied to the foreground execution path.
- process close is the primary child lifecycle signal.

This works for current Superpowers behavior, but three architectural frictions make lifecycle improvements risky if implemented in place:

1. `subagent-executor.ts` mixes request validation, child planning, launch preparation, session handling, worktree handling, progress aggregation, and response formatting.
2. `runSync()` mixes child process execution with policy resolution, event reduction, progress mutation, artifact writing, run-history updates, truncation, and error detection.
3. Superpowers runtime policy is spread across config validation, config accessors, command settings, role policy, config writing, and UI settings.

The design below addresses these structural seams before adding broader lifecycle capabilities.

## Reference Behavior from edxeth

The edxeth implementation provides useful protocol-level behavior:

- result delivery states: `detached`, `awaited`, `joined`
- completed delivery markers: `steer`, `wait`, `join`
- `subagent_wait`, `subagent_join`, and `subagent_detach`
- completion delivery through parent-visible messages where supported
- `caller_ping`, `subagent_done`, `.exit` sidecar files, and auto-exit

The implementation should port or adapt structural semantics from:

- `/Users/thomas/Documents/Dev/pi-subagents_edxeth/src/subagents/sync.ts`
- `/Users/thomas/Documents/Dev/pi-subagents_edxeth/src/subagents/runtime-types.ts`
- `/Users/thomas/Documents/Dev/pi-subagents_edxeth/src/subagents/subagent-done.ts`
- `/Users/thomas/Documents/Dev/pi-subagents_edxeth/src/subagents/auto-exit.ts`

The implementation must not port edxeth-specific UI/mux behavior.

## Architecture Overview

Introduce deeper modules around four concepts:

```txt
raw tool params
  -> execution-planner
  -> child-runner
  -> result-delivery
  -> response aggregation/rendering

child-runner
  -> lifecycle-signals
```

Suggested modules:

```txt
src/execution/execution-planner.ts
src/execution/child-runner.ts
src/execution/result-delivery.ts
src/execution/lifecycle-signals.ts
```

Existing modules remain useful but should become narrower:

```txt
src/execution/subagent-executor.ts      // orchestration facade
src/execution/execution.ts              // compatibility wrapper or gradual extraction source
src/execution/session-mode.ts           // session file resolution and seeding
src/execution/worktree.ts               // worktree lifecycle and cwd mapping
src/execution/superpowers-policy.ts     // role/model/tool/skill/runtime policy
src/execution/superagents-config.ts     // config accessors until config policy is consolidated
```

## Execution Planning

Add an execution-planning module that turns validated tool params into resolved child plans before any child process launches.

The planner should own decisions currently scattered between `runSinglePath()`, `runParallelPath()`, `runForegroundParallelTasks()`, and `prepareLaunch()`:

- agent config lookup
- effective workflow
- effective session mode
- task delivery mode
- task text after Superpowers packet instruction injection
- task file/packet requirement
- runtime cwd and task cwd
- model override
- skill override and planned effective skills
- max subagent depth
- artifact eligibility
- progress seed metadata
- worktree assignment for parallel tasks
- conservative launch/wait behavior for current sync baseline

The initial planner should produce plans that preserve current behavior:

```txt
single call    -> one child plan, join before returning
parallel call  -> N child plans, launch foreground pool, join all before returning
```

The planner should not expose or consume async frontmatter. If future side-channel behavior is added, it should extend the planner's internal launch policy without changing ordinary user-facing params.

### Planning Benefits

- `subagent-executor.ts` becomes a smaller orchestration facade.
- single and parallel paths share one child planning path.
- tests can assert planning outcomes without spawning child processes.
- future lifecycle behavior attaches to plans instead of being threaded through large parameter bags.

## Child Launch Preparation

Move launch preparation out of `subagent-executor.ts` and behind the planning/runner seam.

Launch preparation includes:

- fork task wrapping
- non-fork packet content creation
- packet artifact path selection
- packet cleanup responsibility
- child session file resolution
- task delivery metadata

Current invariants must remain:

- fork launches receive direct task text and never create packet files
- non-fork launches receive a scoped packet artifact
- temporary packet files are removed after the child no longer needs them
- lineage-only session files continue to link to the parent without copying turns

This can be part of `execution-planner.ts` or a small internal helper used by it. The key requirement is that callers consume a prepared child plan rather than rebuilding launch rules.

## Child Runner

Extract a child-runner module from `runSync()`.

The child runner should own process-level execution:

- build final Pi process args from a prepared child plan
- spawn the child process
- parse structured JSONL events
- reduce events into messages, usage, progress, and recent output
- handle abort/kill behavior
- capture stderr and spawn errors
- close JSONL writers and temporary process resources
- return a completed `SingleResult`-compatible result

The child runner should not own result delivery state. It produces a result; `result-delivery.ts` owns who can receive it.

The child runner should also not be the long-term home for all policy resolution. Model/tool/skill/session/worktree decisions should arrive through the child plan.

### Child Runner Benefits

- process execution can be tested with stubbed spawn/event streams
- progress event reduction can be tested without real Pi children
- artifact flushing and abort behavior become localized
- result delivery ownership does not bloat `runSync()`

## Result Delivery and Ownership

Introduce a result delivery module that owns running/completed child state independently from process spawning.

Suggested module:

```txt
src/execution/result-delivery.ts
```

Core states should mirror edxeth semantics where useful:

```ts
type DeliveryState = "detached" | "awaited" | "joined";
type CompletedDelivery = "steer" | "wait" | "join";
```

The module should track:

- child id
- agent name and task
- session mode
- child plan metadata needed for result retrieval
- progress and artifacts
- completion promise
- completed result cache
- current result owner, if any
- final delivery path, if already delivered

### Current Sync Mapping

The current behavior should be represented through result ownership instead of special-cased blocking logic:

```txt
single sync:
  plan child -> register child -> run child -> join one -> return result

parallel sync:
  plan children -> register children -> run children -> join all -> aggregate results
```

This preserves existing user-visible behavior while giving the runtime explicit duplicate-delivery prevention.

### Ownership Operations

The module should support these operations even if public tools are staged later:

- wait for one child id
- join a fixed set of child ids
- detach/release ownership before delivery
- mark completed result delivered once
- reject duplicate result delivery
- report already-owned and already-delivered states

Suggested behavior:

#### Wait

- If the result is completed and undelivered, return it immediately and mark `deliveredTo: "wait"`.
- If the child is running and unowned, claim ownership as `awaited` and wait for completion.
- If the result is already delivered, return an `already_delivered` error.
- If another wait/join owns it, return `already_owned`.
- If interrupted or timed out, release ownership back to `detached` unless delivery completed.

#### Join

- Reject empty or duplicate id lists.
- Claim every pending child before waiting.
- Return a grouped result once all children complete.
- Mark delivered children as `deliveredTo: "join"`.
- On interruption or timeout, release pending ownership and prevent duplicate delivery.

#### Detach

- Release explicit wait/join ownership and return a child to detached ownership.
- Work for running or completed-but-undelivered results currently owned by wait/join.
- Return `not_owned` when the child is already detached or delivered.

## Public Wait/Join/Detach Tools

Public `subagent_wait`, `subagent_join`, and `subagent_detach` tools may be implemented once the ownership module exists, but they are not required to expose async launch controls.

Their initial value is precise result ownership and retrieval, not broad background execution. They should operate only on child ids that the runtime has registered. If no side-channel launch path exists yet, tests can still exercise these tools through controlled runtime records or synchronous join behavior.

Errors should be stable and testable:

- `not_found`
- `already_delivered`
- `already_owned`
- `not_owned`
- `duplicate_id`
- `empty_id_list`
- timeout/interrupted ownership release

## Child Lifecycle Protocol

Add a small child-side protocol so completion is semantic instead of inferred only from process close.

### Child Extension

Add or adapt a child-only extension that provides:

- `subagent_done`
- `caller_ping`
- optional auto-exit on normal agent completion

The implementation can be adapted from edxeth `subagent-done.ts`, but must omit edxeth widget and UI behavior.

### Environment

Parent-launched children should receive minimized environment values required by the lifecycle protocol, such as:

```txt
PI_SUBAGENT_SESSION=<child session file>
PI_SUBAGENT_NAME=<display name or agent name>
PI_SUBAGENT_AGENT=<agent name>
PI_SUBAGENT_AUTO_EXIT=1|0
```

Exact names may be adjusted during implementation if Pi runtime constraints require it, but they should be documented and tested.

### `.exit` Sidecar

When a child intentionally completes, it writes:

```txt
<sessionFile>.exit
```

with:

```json
{ "type": "done", "outputTokens": 1234 }
```

When a child needs parent help, `caller_ping` writes:

```json
{
  "type": "ping",
  "name": "sp-research",
  "message": "I need clarification on the target module.",
  "outputTokens": 1234
}
```

The parent consumes and removes this file once observed.

### Parent Interpretation

Add a lifecycle-signal module:

```txt
src/execution/lifecycle-signals.ts
```

It should distinguish:

- `done` — intentional child completion
- `ping` — child needs parent help
- process close without sidecar — fallback completion/failure path
- abort/kill/timeout — interrupted or failed execution
- malformed/stale sidecar — ignored or surfaced as a controlled diagnostic

Process close remains necessary, but should no longer be the only lifecycle signal.

## Superpowers Policy and Config Impact

The spec removes async policy from frontmatter and call params, but it still benefits from consolidating Superpowers policy.

High-value policy work:

- keep role model/tool/skill resolution in `superpowers-policy.ts`
- keep launch behavior conservative for all Superpowers roles in this spec
- ensure future launch-policy decisions go through one runtime policy function rather than executor branches
- avoid adding config keys for async/side-channel behavior in this spec
- update docs to state that async controls are intentionally not user-facing

A broader config-policy consolidation can happen separately, but this design should avoid making the current config scattering worse.

## Worktree Lifecycle Impact

Current sync worktree behavior must remain unchanged:

- worktree setup happens before parallel child launch
- task cwd mapping remains per child
- cleanup happens after joined foreground children complete
- worktree suffix/reporting still appears in parallel output

Future side-channel execution would complicate cleanup because a child may outlive the foreground tool call. This spec should not implement that behavior until worktree lifecycle ownership is deepened enough to keep resources alive safely.

Initial rule:

```txt
worktree-backed children are joined before cleanup
```

## Data Flow

### Default Single Launch

```txt
parent calls subagent
  -> validate params
  -> plan one child
  -> register child in result delivery store
  -> run child through child runner
  -> join child result
  -> return normal single result
```

### Default Parallel Launch

```txt
parent calls subagent with several tasks
  -> validate params
  -> create worktree setup if requested
  -> plan all children
  -> register children in result delivery store
  -> run foreground child pool
  -> join all child results
  -> aggregate outputs
  -> cleanup worktrees
  -> return normal parallel result
```

### Child Done Signal

```txt
child calls subagent_done
  -> child extension writes <sessionFile>.exit
  -> parent lifecycle-signal module consumes sidecar
  -> child runner/result delivery record marks intentional completion metadata
  -> process close still finalizes result if needed
```

### Child Ping Signal

```txt
child calls caller_ping
  -> child extension writes ping sidecar
  -> parent lifecycle-signal module consumes sidecar
  -> result delivery record marks parent-help-needed state
  -> parent-visible response surfaces ping as a help request
```

## Error Handling

- Unknown child id returns `not_found`.
- Already delivered result returns `already_delivered`.
- A result owned by another wait/join returns `already_owned`.
- Duplicate join ids return `duplicate_id`.
- Empty join lists return `empty_id_list`.
- Detach on detached or delivered records returns `not_owned`.
- Timeout/interruption releases ownership unless delivery completed.
- Child process errors continue to populate `SingleResult.error` and non-zero `exitCode`.
- Ping results should be surfaced as a parent-visible help request rather than ordinary success.
- Malformed sidecars should not crash parent execution.
- Process close remains a fallback when no `.exit` sidecar exists.

## Testing

Add or update tests for:

### Execution Planning

- single params produce one conservative join-before-return child plan
- parallel params produce ordered child plans
- session mode resolution is preserved
- packet task delivery is preserved for non-fork sessions
- fork task wrapping is preserved
- skill/model/max-depth/workflow behavior is preserved
- worktree task cwd mapping is represented in plans
- no `async` or `blocking` frontmatter is parsed or required

### Child Runner

- JSONL message events reduce into messages and usage
- tool start/end events update progress
- stderr becomes result error on non-zero exit
- abort sends SIGTERM and then SIGKILL fallback
- JSONL writer closes on success and failure
- temp resources are cleaned up
- final output/truncation behavior matches current `runSync()` behavior

### Result Delivery

- current single sync behavior maps to register/run/join one
- current parallel sync behavior maps to register/run/join all
- wait returns one completed result and prevents duplicate delivery
- join returns grouped results and prevents duplicate delivery
- detach releases wait/join ownership
- completed detached result can be delivered later only once
- completed delivered result cannot be waited/joined again
- ownership releases correctly on interruption/timeout
- stable errors for `not_found`, `already_delivered`, `already_owned`, `not_owned`, duplicate ids, and empty id lists

### Lifecycle Signals

- `.exit` done sidecar is consumed and mapped to intentional completion
- `.exit` ping sidecar is consumed and mapped to a parent help request
- malformed sidecar is handled without crashing
- stale/missing sidecar falls back to process-close behavior
- process close remains a fallback when no `.exit` sidecar exists

### Regression Coverage

- existing synchronous single execution still passes
- existing synchronous parallel execution still passes
- artifacts and progress still work for sync children
- worktree setup/cleanup remains joined-foreground behavior
- Superpowers roles remain conservative and synchronous in user-visible behavior

## Documentation

Update user-facing documentation during implementation:

- `README.md`
- `docs/configuration.md`
- `docs/worktrees.md`
- `docs/parameters.md`
- `docs/skills.md`

Docs should explain:

- normal users do not choose async versus sync
- this design adds internal result ownership and lifecycle capabilities
- current Superpowers workflows remain synchronous by default
- `subagent_wait`, `subagent_join`, and `subagent_detach`, if exposed, are result ownership tools rather than async launch switches
- `caller_ping` and `subagent_done` improve child lifecycle semantics
- there is intentionally no `async` frontmatter or config key in this spec

## Migration and Compatibility

- Existing custom agents keep current synchronous behavior.
- Existing frontmatter remains valid without adding async fields.
- Existing sync result shapes remain supported for single and parallel calls.
- New result delivery metadata is additive.
- Current worktree/session/artifact/progress behavior remains compatible.
- No migration is needed for ordinary users or custom agent authors.

## Risks

- Implementing lifecycle signals without first adding execution planning may make `subagent-executor.ts` harder to maintain.
- Adding result ownership inside `runSync()` would bloat an already wide module.
- Public wait/join/detach tools can confuse users if documented as async controls rather than ownership/retrieval controls.
- Result ownership bugs can cause duplicate delivery or stranded completed results.
- Background execution, if added later, may complicate artifact cleanup and worktree cleanup; this spec intentionally avoids that behavior.
- Child lifecycle sidecars can become stale if not consumed carefully.
- Pi extension API differences may prevent exact edxeth steer semantics; implementation must verify available APIs before porting delivery code.

## Implementation Staging

1. **Execution planning seam**
   - Add child plan generation and route current single/parallel sync execution through it.
   - Preserve behavior first.

2. **Result delivery store for sync behavior**
   - Register child records and use join semantics for current single/parallel results.
   - Prove duplicate-delivery prevention in tests.

3. **Child runner extraction**
   - Extract process spawning/event parsing/progress reduction from `runSync()`.
   - Keep `runSync()` as a compatibility wrapper if useful during migration.

4. **Lifecycle signal module and child extension**
   - Add `subagent_done`, `caller_ping`, sidecar parsing, and process-close fallback.

5. **Optional public ownership tools**
   - Add `subagent_wait`, `subagent_join`, and `subagent_detach` only after the ownership module is stable.
   - Do not add async launch controls.

6. **Policy/config cleanup where touched**
   - Keep launch behavior conservative.
   - Avoid new config keys.
   - Route any future launch-policy decisions through one policy seam.

## Open Implementation Notes

- Prefer adapting edxeth protocol modules over reimplementing behavior from scratch, but only for non-UI semantics.
- Keep UI concerns in existing `pi-superagents` renderers only; do not port edxeth UI.
- Split process spawning from result delivery so lifecycle changes do not bloat `src/execution/execution.ts` or `src/execution/subagent-executor.ts`.
- Treat current sync behavior as the compatibility baseline and test it first.
- Keep every new source file TypeScript and include file/function documentation headers per project rules.
