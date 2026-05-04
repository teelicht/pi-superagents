# Subagent Async Result Delivery and Lifecycle Design

## Purpose

Bring selected runtime patterns from `/Users/thomas/Documents/Dev/pi-subagents_edxeth` into `pi-superagents` so Superpowers role agents can run asynchronously when their frontmatter opts in, while preserving safe synchronous behavior for implementation-critical agents.

This design covers three related improvements:

1. explicit result ownership with `subagent_wait`, `subagent_join`, and `subagent_detach`
2. async result delivery with a delegation ownership rule
3. child lifecycle signals with `caller_ping`, `subagent_done`, `.exit` sidecars, and process-close fallback

The implementation should stay close to the edxeth runtime protocol where practical, but must not copy edxeth UI, mux, pane, widget, or tab-title behavior.

## Goals

- Add `async: true | false` as the agent frontmatter setting for default subagent launch policy.
- Let async-capable Superpowers role agents return immediately and deliver results later.
- Preserve sync/blocking execution for agents whose results are required before the parent can safely continue.
- Add explicit result ownership so each child result is delivered at most once.
- Add wait/join/detach sync gates for async launches.
- Add child lifecycle signals that distinguish intentional completion, help requests, and fallback process exits.
- Reuse or closely adapt non-UI code and semantics from `pi-subagents_edxeth` where package boundaries allow.
- Keep existing `pi-superagents` worktree, session mode, artifact, progress, and Superpowers role behavior intact.

## Non-goals

- Do not copy edxeth UI elements, widgets, mux panes, tab-title tools, or interactive subagent surfaces.
- Do not replace the existing `subagent` tool with edxeth's full tool surface.
- Do not make every agent async by default.
- Do not allow `async: true` call-time options to weaken an agent that explicitly requires sync.
- Do not remove current synchronous single/parallel execution support.

## Current State

`pi-superagents` currently executes subagents synchronously through `src/execution/execution.ts` and orchestrates parallel calls in `src/execution/subagent-executor.ts`.

The important current behavior is:

- `runSync()` spawns a child Pi process and resolves when the process closes.
- `runParallelPath()` calls `runForegroundParallelTasks()`, waits for all children, aggregates results, and returns one response.
- progress and artifacts are tied to the foreground execution path.
- process close is the primary child lifecycle signal.

This is reliable for blocking execution but makes long-running research/review agents less useful because the parent turn cannot continue or yield cleanly until all delegated work finishes.

## Reference Behavior from edxeth

The edxeth implementation provides useful protocol-level behavior:

- frontmatter `async: true | false`
- legacy `blocking: true` as an alias for sync behavior
- result delivery states: `detached`, `awaited`, `joined`
- completed delivery markers: `steer`, `wait`, `join`
- `subagent_wait`, `subagent_join`, and `subagent_detach`
- async completion delivery through a parent steer message
- `caller_ping`, `subagent_done`, `.exit` sidecar files, and auto-exit

The implementation should port or adapt these runtime semantics closely, especially from:

- `/Users/thomas/Documents/Dev/pi-subagents_edxeth/src/subagents/sync.ts`
- `/Users/thomas/Documents/Dev/pi-subagents_edxeth/src/subagents/runtime-types.ts`
- `/Users/thomas/Documents/Dev/pi-subagents_edxeth/src/subagents/subagent-done.ts`
- `/Users/thomas/Documents/Dev/pi-subagents_edxeth/src/subagents/auto-exit.ts`

The implementation should avoid edxeth-specific UI/mux files except as conceptual references for lifecycle polling.

## Frontmatter Launch Policy

Add an optional `async` frontmatter field to `AgentConfig` parsing in `src/agents/agents.ts`:

```yaml
async: true
```

or:

```yaml
async: false
```

Meaning:

- `async: true` — launch the child, return a started result immediately, and deliver the final result later.
- `async: false` — launch the child and wait for its result before returning.
- missing `async` — preserve current synchronous behavior unless the built-in agent file explicitly opts in.

Recommended built-in role defaults:

```yaml
# advisory / investigative agents
sp-recon: async: true
sp-research: async: true
sp-code-review: async: true
sp-spec-review: async: true

# execution-critical agents
sp-implementer: async: false
sp-debug: async: false
```

Entrypoint agents such as `sp-brainstorm`, `sp-plan`, and `sp-implement` should remain outside the delegated role-agent async policy unless they become launchable role agents later.

### Effective Policy Rule

Sync is the conservative override:

```txt
agent async:false wins
call async:false wins
otherwise async only when the agent/default policy says async:true
```

If call-time `async` is added to the tool schema, `async: true` must not override an agent whose frontmatter says `async: false`.

The first implementation may omit call-time `async` if unnecessary; frontmatter is the required control surface.

## Result Delivery and Ownership

Introduce a result delivery module that owns running/completed child state independently from process spawning.

Suggested module:

```txt
src/execution/result-delivery.ts
```

Suggested core states should mirror edxeth:

```ts
type DeliveryState = "detached" | "awaited" | "joined";
type CompletedDelivery = "steer" | "wait" | "join";
```

The module should track:

- running subagent id
- agent name and task
- session mode
- async/blocking policy
- progress and artifacts
- completion promise
- completed result cache
- current result owner, if any
- final delivery path, if already delivered

### Started Async Result

An async launch should return a tool result similar to:

```txt
Sub-agent "sp-research" launched async with id <id>. Results will be delivered automatically when it finishes. Use this id with subagent_wait/subagent_join when you need an explicit sync gate.
```

The result details should include enough structured data for renderers and tests:

```ts
{
  id: string;
  agent: string;
  status: "started";
  async: true;
  deliveryState: "detached";
  sessionFile?: string;
}
```

### `subagent_wait`

Add a tool that waits for one running or completed child by id.

Behavior:

- If the result is completed and undelivered, return it immediately and mark `deliveredTo: "wait"`.
- If the child is running and unowned, claim ownership as `awaited` and wait for completion.
- If the result is already delivered, return an `already_delivered` error.
- If another wait/join owns it, return `already_owned`.
- If interrupted or timed out, release ownership back to `detached` unless the result was delivered.

A timeout option can be added in the initial implementation or staged. If included, match edxeth names where possible:

```ts
onTimeout?: "error" | "return_pending" | "detach" | "return";
```

### `subagent_join`

Add a tool that waits for a fixed set of child ids.

Behavior:

- Reject empty or duplicate id lists.
- Claim every pending child before waiting.
- Return a grouped result once all children complete.
- Mark delivered children as `deliveredTo: "join"`.
- On interruption or timeout, release pending ownership and prevent duplicate delivery.

A timeout option can be added in the initial implementation or staged. If included, match edxeth names where possible:

```ts
onTimeout?: "error" | "return_partial" | "detach" | "return";
```

### `subagent_detach`

Add a tool that releases explicit wait/join ownership and returns a child to detached async behavior.

Behavior:

- Works for running or completed-but-undelivered results currently owned by wait/join.
- Returns `not_owned` when the child is already detached or delivered.
- For completed detached results, normal async delivery may proceed.

### Current Sync Behavior as Join-All

Represent today's parallel behavior as a policy choice:

```txt
launch children -> join all -> aggregate outputs -> return
```

This keeps the new delivery model compatible with current single and parallel sync execution.

## Async Delivery Policy

Async results should be delivered back to the parent session when supported by the Pi extension API. Use an edxeth-like steer delivery message if available in this extension context.

Delivery must follow one ownership rule:

> After launching async subagents, the parent may continue only with explicitly non-overlapping parent-owned work. It must not redo delegated work. If no safe independent work is clear, it should yield and let async results arrive.

Update the `subagent` tool description or prompt snippet to include this rule once async launches are supported.

### Same-Turn Completion

If a child finishes while the parent is still unwinding the launch tool batch, avoid provoking an immediate autonomous continuation that causes duplicate reasoning. Use the closest available equivalent to edxeth's deferred delivery behavior:

```txt
same-turn async completion -> queue/deliver on next turn when possible
```

If the current Pi API does not support this exact delivery mode, document the limitation and choose the safest available behavior that prevents duplicate delivery.

## Child Lifecycle Protocol

Add a small child-side protocol so completion is semantic instead of inferred only from process close.

### Child Extension

Add or adapt a child-only extension that provides:

- `subagent_done`
- `caller_ping`
- optional auto-exit on normal agent completion

The implementation can be adapted from edxeth `subagent-done.ts`, but must omit edxeth widget and UI behavior.

### Environment

Parent-launched children should receive environment values such as:

```txt
PI_SUBAGENT_SESSION=<child session file>
PI_SUBAGENT_NAME=<display name or agent name>
PI_SUBAGENT_AGENT=<agent name>
PI_SUBAGENT_AUTO_EXIT=1|0
```

The exact set should be minimized to what the protocol requires.

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
  "message": "I need clarification on the target API boundary.",
  "outputTokens": 1234
}
```

The parent consumes and removes this file once observed.

### Parent Interpretation

Parent execution should distinguish:

- `done` — intentional child completion
- `ping` — child needs parent help
- process close without sidecar — fallback completion/failure path
- abort/kill/timeout — interrupted or failed execution

Process close remains necessary, but it should no longer be the only lifecycle signal.

## Data Flow

### Async Launch

```txt
parent calls subagent
  -> resolve agent and async frontmatter
  -> create child id/session/artifacts/progress
  -> register running child in result delivery store
  -> spawn child without awaiting final result
  -> return started result with id
  -> child completes or pings
  -> lifecycle/result code caches completed result
  -> detached result is delivered asynchronously unless wait/join owns it
```

### Sync Launch

```txt
parent calls subagent
  -> resolve agent and async frontmatter
  -> spawn/register child
  -> wait/join immediately
  -> return normal result
```

### Parallel Mixed Launch

For parallel calls, each task uses its own agent's effective `async` policy.

Rules:

- all independent children should be launched before waiting where possible.
- sync children are joined before the tool returns.
- async children return started details and continue in the background.
- final tool output should clearly distinguish completed sync results from started async results.

## Error Handling

- Unknown child id returns `not_found`.
- Already delivered result returns `already_delivered`.
- A result owned by another wait/join returns `already_owned`.
- Timeout/interruption releases ownership unless delivery completed.
- Child process errors continue to populate `SingleResult.error` and non-zero `exitCode`.
- Ping results should be surfaced as a parent-visible help request rather than as ordinary success.
- If async delivery cannot be sent, completed results must remain cached and retrievable by `subagent_wait` or `subagent_join`.

## Testing

Add or update tests for:

- parsing `async: true` and `async: false` from agent frontmatter
- unknown frontmatter compatibility remains intact
- built-in async defaults for selected role agents
- `async: false` agents force sync behavior
- call-time `async: false`, if added, forces sync
- call-time `async: true`, if added, does not weaken `async: false` agents
- single async launch returns started result before child completion
- parallel mixed async/sync execution launches all eligible children and waits only where required
- `subagent_wait` returns one completed result and prevents duplicate delivery
- `subagent_join` returns grouped results and prevents duplicate delivery
- `subagent_detach` releases wait/join ownership
- completed detached result can be delivered asynchronously
- completed delivered result cannot be waited/joined again
- `.exit` done sidecar is consumed and mapped to intentional completion
- `.exit` ping sidecar is consumed and mapped to a parent help request
- process close remains a fallback when no `.exit` sidecar exists
- artifacts and progress still work for sync children
- async children retain enough metadata for later result retrieval

## Documentation

Update user-facing documentation during implementation:

- `README.md`
- `docs/configuration.md`
- `docs/worktrees.md`
- `docs/parameters.md`
- `docs/skills.md`

Docs should explain:

- which built-in Superpowers agents run async by default
- how to set `async: true | false` in custom agent frontmatter
- when to use async versus sync
- how `subagent_wait`, `subagent_join`, and `subagent_detach` work
- how `caller_ping` and `subagent_done` affect child lifecycle

## Migration and Compatibility

- Existing custom agents without `async` keep current synchronous behavior unless a later release intentionally changes the default.
- Built-in agents may opt into async by adding explicit frontmatter.
- Existing sync result shapes should remain supported for single and parallel calls.
- New async result details are additive.
- If legacy `blocking` support is added for edxeth parity, document `async` as preferred and `blocking` as compatibility-only.

## Risks

- Async delivery can cause parent agents to duplicate delegated work unless the prompt-level ownership rule is clear.
- Result ownership bugs can cause duplicate delivery or stranded completed results.
- Background execution may complicate artifact cleanup and worktree cleanup; async children must not lose resources they still need.
- Child lifecycle sidecars can become stale if not consumed carefully.
- Pi extension API differences may prevent exact edxeth steer semantics; implementation must verify available APIs before porting delivery code.

## Open Implementation Notes

- Prefer adapting edxeth protocol modules over reimplementing behavior from scratch.
- Keep UI concerns in existing `pi-superagents` renderers only; do not port edxeth UI.
- Split process spawning from result delivery so future lifecycle changes do not bloat `src/execution/execution.ts` or `src/execution/subagent-executor.ts`.
- Keep every new source file TypeScript and include file/function documentation headers per project rules.
