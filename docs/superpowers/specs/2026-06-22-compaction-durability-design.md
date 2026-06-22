# Compaction Durability for Superpowers Root Sessions — Design Spec

**Date:** 2026-06-22
**Status:** Draft (brainstorming output, pending plan)
**Related:** `docs/superpowers/superpowers_v6.md` (session-compaction section)

## Purpose

Make long autonomous Superpowers (SDD) runs survive pi session compaction. Today the
Superpowers root contract — bootstrap skill, entry skill, root lifecycle skills, and policy
blocks — is injected once as a hidden message at command-fire time via `before_agent_start`.
A mid-run compaction (auto at the context threshold, or overflow) can strip that contract
from context, leaving the model to continue the SDD workflow without the lifecycle-trigger
awareness it was armed with. Nothing re-arms it.

This spec defines an opt-in, reason-aware re-injection layer that uses pi's new
`session_before_compact` / `session_compact` event context (`reason`, `willRetry` — PR #5962)
to re-arm the contract after compaction, sized by compaction flow, without ever injecting into
sessions where the user has not opted in.

## Background and constraints

### The new pi feature (PR #5962)

`session_before_compact` and `session_compact` events now include:

- `reason`: `"manual"` (user ran `/compact`), `"threshold"` (auto-compaction at the context
  threshold), or `"overflow"` (prompt overflowed the context window).
- `willRetry`: `true` when `reason === "overflow"` and compaction succeeds, meaning pi will
  automatically retry the aborted turn; `false` otherwise.

These fields are additive read-only metadata on the event payloads. They change no event's
firing semantics and no return contract.

### The proven mechanism: the `context` event

The reference design is the official `obra/superpowers` extension, which re-injects its
bootstrap via the `context` event (fires before every LLM call with a deep copy of the
messages; the handler returns `{ messages: [...] }` to non-destructively insert). That
extension uses a boolean `injectBootstrap` flag toggled by `session_start` (set true),
`session_compact` (set true), and `agent_end` (set false), with an idempotency marker scan
and insertion after leading `compactionSummary` messages.

Two differences from this repo's requirements:

1. **obra is always-on.** It sets the flag `true` on every `session_start`. This repo requires
   opt-in: the Superpowers workflow must be explicitly activated by a `/sp-*` command or an
   intercepted `/skill:` command, and normal sessions must be unaffected.
2. **obra predates `reason`/`willRetry`.** It re-injects the same payload unconditionally. This
   repo can size the re-injection by compaction flow, which matters because this repo's root
   contract is materially larger than obra's single-skill bootstrap.

### This repo's current bootstrap path (kept, not replaced)

The initial bootstrap is sent via `before_agent_start` in `src/superpowers/prompt-dispatch.ts`:
a visible "Superpowers ▸ <task>" summary is sent through `pi.sendUserMessage`, and a
`before_agent_start` handler pairs it with a queued hidden custom-type message
(`customType: "superpowers-root-contract"`, `display: false`) carrying the full contract
produced by `buildSuperpowersRootPrompt(input)` in `src/superpowers/root-prompt.ts`.

This path is preserved unchanged in behavior. The compaction-durability layer adds a second
injection path (the `context` event) that shares content production with this one.

### Scope boundaries

- **In scope:** re-injection after compaction, opt-in gated, reason-sized, sharing content
  production with the existing initial-bootstrap path.
- **Out of scope (v1):** the `session_before_compact` Custom Summarization route (authoring a
  distilled reminder into the compaction summary itself). The `context` event's per-LLM-call
  re-insertion already provides durability across repeated compactions, so the custom-summary
  route is YAGNI for v1. It remains available as a v2 enhancement if the trimmed reminder
  proves insufficient on the `overflow` path.
- **Out of scope:** changing the initial bootstrap mechanism, the visible summary UX, or the
  existing `before_agent_start` pairing.

## Architecture

One new event handler (`context`), one extended event handler (`session_compact`), an opt-in
gate on `SubagentState`, and shared content builders. The `agent_end` and `session_start`
handlers gain one line each to manage the gate.

```
Command fire (/sp-* or intercepted /skill:)
  │  sets superpowersActive = true
  │  records rootLifecycleSkillNames
  │  existing before_agent_start injects initial contract (unchanged)
  ▼
agent_end
  │  sets superpowersActive = false  (consume after each turn)
  ▼
Compaction fires
  │  session_compact handler:
  │    if superpowersActive was true → re-set true, read reason/willRetry, set compactionSizing
  │    if superpowersActive was false → leave false (don't arm a non-opted-in session)
  ▼
context fires (next LLM call, incl. overflow auto-retry)
  │  if !superpowersActive → no-op
  │  if marker already present → no-op (idempotency)
  │  else build content per compactionSizing, insert after leading compactionSummary messages
  ▼
agent_end → superpowersActive = false  (consume)
```

### Sizing by reason

The re-injection is sized by the recorded `reason`. `willRetry` is read and recorded for
observability but does not change the sizing decision in v1 (see *Role of `willRetry`* below).

| `reason` | `compactionSizing` | Content | Rationale |
|---|---|---|---|
| `"threshold"` | `"full"` | `buildSuperpowersRootPrompt(input)` — the full root contract | Common autonomous-SDD case; headroom available after auto-compaction at the threshold. |
| `"overflow"` | `"trimmed"` | `buildCompactionReminder(skillNames)` — lifecycle-trigger names only, no full skill bodies | Context already overflowed once; a full contract risks re-overflow, especially on the auto-retry. |
| `"manual"` | `"pointer"` | `buildCompactionReminder(skillNames)` in minimal one-line form | User deliberately ran `/compact` to reclaim context; respect that intent with a minimal pointer that preserves trigger awareness. |

### Role of `willRetry`

`willRetry` tells the handler that an overflow auto-retry is coming (the next `context` fire
will be the retried turn). This is *why* the trimmed sizing matters for `overflow` — the
injection lands on the auto-retry where re-overflow is a real risk. However, the sizing
decision itself is driven by `reason`: trimmed is correct for `overflow` regardless of whether
a retry follows, because context was already overflowed. The design therefore reads `willRetry`
(honoring the feature) and records it in state, but does not branch sizing on it in v1. A
future enhancement could use `willRetry === false` on `overflow` to upgrade to full sizing
(the user is manually re-engaging after a dropped turn); that is deferred.

## Components

### 1. `SubagentState` additions (`src/shared/types.ts`)

```typescript
export interface SubagentState {
	baseCwd: string;
	currentSessionId: string | null;
	lastUiContext: ExtensionContext | null;
	configGate: ConfigGateState;
	// --- new ---
	/** Opt-in gate: true only after a Superpowers command has fired this session. */
	superpowersActive: boolean;
	/** Last compaction's sizing class, set by session_compact, read by context. */
	compactionSizing: "full" | "trimmed" | "pointer" | null;
	/** Root lifecycle skill names, for the trimmed/pointer reminder. */
	rootLifecycleSkillNames: string[];
}
```

Initialization in `registerSubagentExtension` extends to:
`superpowersActive: false, compactionSizing: null, rootLifecycleSkillNames: []`.

### 2. Opt-in trigger (command dispatch sites)

At the existing sites that call `buildSuperpowersRootPrompt` today — the slash-command path
in `src/slash/slash-commands.ts` and the intercepted-`/skill:` path in
`src/extension/index.ts` — set, at the same moment the visible summary is dispatched:

```typescript
state.superpowersActive = true;
state.compactionSizing = null;
state.rootLifecycleSkillNames = (profile.rootLifecycleSkills ?? []).map(s => s.name);
```

This is the entire opt-in surface. No `/sp-*` and no `/skill:` → the flag is never set true →
the `context` handler is a one-boolean-read early return on every LLM call, with zero
observable behavior. This matches the repo's existing register-always/gate-on-state philosophy
(already used by the `input` handler).

### 3. `session_compact` handler (new, in `src/extension/index.ts`)

```typescript
pi.on("session_compact", (event) => {
	// Only re-arm sessions that were opted in. Don't arm a non-opted-in session.
	if (!state.superpowersActive) return;
	// reason: "manual" | "threshold" | "overflow"
	// willRetry: boolean (overflow auto-retry signal; recorded, not sizing in v1)
	state.superpowersActive = true;
	state.compactionSizing =
		event.reason === "threshold" ? "full"
		: event.reason === "overflow" ? "trimmed"
		: "pointer"; // "manual"
});
```

Wrapped in try/catch: handler errors never break compaction (leave flag/sizing as-is).

### 4. `context` handler (new, in `src/extension/index.ts`)

```typescript
pi.on("context", (event) => {
	if (!state.superpowersActive) return;
	if (event.messages.some(messageContainsBootstrap)) return; // idempotency

	const sizing = state.compactionSizing ?? "full"; // default full if no compaction yet
	const content = sizing === "full"
		? buildSuperpowersRootPrompt(lastInput)        // shared with initial path
		: buildCompactionReminder(state.rootLifecycleSkillNames, sizing); // trimmed/pointer
	if (!content) return;

	const message = buildSuperpowersContractMessage(content); // shared message factory
	const insertAt = firstNonCompactionSummaryIndex(event.messages);
	return {
		messages: [
			...event.messages.slice(0, insertAt),
			message,
			...event.messages.slice(insertAt),
		],
	};
});
```

Wrapped in try/catch: handler errors never break the LLM call (no-op on error).

**Open verification task (implementation):** Confirm that a custom-type message
(`{ role: "custom", customType: "superpowers-root-contract", content, display: false }`)
returned from the `context` handler participates in LLM context the same way it does when
returned from `before_agent_start`. The session-format doc establishes that `CustomMessage`
participates in LLM context and that `context` returns a messages array of valid message
types, so this is expected to work. If it does not, fall back to a `role: "user"` message
(matching the obra pattern) in the `context` path only; content production stays shared via
`buildSuperpowersRootPrompt` / `buildCompactionReminder` either way.

### 5. `agent_end` and `session_start` handlers (one-line additions)

```typescript
pi.on("agent_end", () => { state.superpowersActive = false; }); // consume after each turn
pi.on("session_start", () => { state.superpowersActive = false; state.compactionSizing = null; });
// (session_start also keeps the existing resetSessionState call)
```

`session_start` → `false` is the single line that converts obra's always-on pattern into this
repo's opt-in pattern: a fresh session is not opted in until a Superpowers command fires.

### 6. Shared content builders

- **`buildSuperpowersRootPrompt(input)`** — existing, unchanged. Produces the full root
  contract. Called by both the initial `before_agent_start` path and the `context` full-sizing
  path. **This is the primary shared-code point** the design guarantees: the contract text is
  derived in exactly one place.

- **`buildCompactionReminder(skillNames, sizing)`** — new, in
  `src/superpowers/root-prompt.ts` (or a sibling). Produces the trimmed/pointer content. For
  `"trimmed"` (overflow):

  ```
  <EXTREMELY_IMPORTANT>
  superpowers:compaction-reminder

  You are mid-Superpowers-run. Context was compacted. Re-arm your workflow:
  - Before claiming work complete/fixed/passing: invoke `verification-before-completion`.
  - When acting on review feedback: invoke `receiving-code-review`.
  - When implementation is complete and verification passes: invoke `finishing-a-development-branch`.
  - Resume your current task using the kept context above.
  </EXTREMELY_IMPORTANT>
  ```

  For `"pointer"` (manual), a minimal one-line form:

  ```
  <EXTREMELY_IMPORTANT>
  superpowers:compaction-reminder

  Superpowers workflow still active. Invoke verification-before-completion / receiving-code-review / finishing-a-development-branch at their trigger points.
  </EXTREMELY_IMPORTANT>
  ```

  The skill names are drawn from `state.rootLifecycleSkillNames` (captured at command fire),
  not hardcoded, so the reminder tracks the entrypoint's actual lifecycle skills.

- **`buildSuperpowersContractMessage(content)`** — new shared message factory. Returns the
  hidden message object with `customType: SUPERPOWERS_CONTRACT_CUSTOM_TYPE`,
  `content`, `display: false`. Used by both `before_agent_start` (refactored to call it) and
  the `context` handler. This shares the injection shape across both paths, subject to the
  verification task above.

### 7. Helper functions (new, alongside the `context` handler)

- `messageContainsBootstrap(message)` — scans for the `superpowers:compaction-reminder` or
  `superpowers-root-contract` marker in a message's content. (The initial contract already
  carries `SUPERPOWERS_CONTRACT_CUSTOM_TYPE`; the reminder carries its own marker. Both are
  checked so a session that had the full contract and then compacts to a reminder doesn't
  double-inject.)
- `firstNonCompactionSummaryIndex(messages)` — walks past leading `role === "compactionSummary"`
  messages to find the insertion point (matches the obra pattern).

## Data flow

1. **Command fire:** `superpowersActive = true`, `rootLifecycleSkillNames` recorded,
   `compactionSizing = null`. Existing `before_agent_start` injects the initial full contract
   (unchanged).
2. **Turn runs:** `context` fires on each LLM call. `superpowersActive` is true,
   `compactionSizing` is null → defaults to `"full"` → would inject, but the marker scan finds
   the initial contract already present → no-op (idempotency). No duplicate injection during a
   normal turn.
3. **`agent_end`:** `superpowersActive = false`. Subsequent `context` fires (if any before the
   next turn) are no-ops.
4. **Compaction fires:** `session_compact` handler runs. If `superpowersActive` was true, it
   re-sets true and sets `compactionSizing` from `reason`. (If false, it leaves the flag false —
   a non-opted-in session stays unarmed.) The initial contract is now stripped from context by
   compaction.
5. **Next `context` fires** (on the next turn, or on the overflow auto-retry):
   `superpowersActive` is true, marker is absent (compaction stripped it) → build content per
   `compactionSizing` → insert after `compactionSummary` → return. The contract is re-armed.
6. **`agent_end`:** `superpowersActive = false`. Repeat from step 4 on the next compaction.

**Repeated compactions:** because `session_compact` re-sets the flag each time and `context`
re-inserts whenever the marker is absent, the contract survives any number of compactions. This
is the property that made the custom-summary route YAGNI for v1.

## Error handling

- **Skill content resolution failure** (`buildSuperpowersRootPrompt` returns empty or
  `buildCompactionReminder` has no skill names): `context` handler no-ops (no injection). Never
  breaks the LLM call.
- **`context` handler throws:** caught, no-op. Never breaks the LLM call.
- **`session_compact` handler throws:** caught, leave `superpowersActive`/`compactionSizing`
  as-is. Never breaks compaction.
- **Idempotency violation (double-injection):** prevented by the marker scan on every
  `context` fire. Even if `session_compact` fires twice without an intervening `context`, the
  first subsequent `context` inserts once and the second is a no-op.
- **Custom-type message not honored in `context` return:** fallback to `role: "user"` message
  in the `context` path (verification task above). Content production remains shared.

## Testing

### Unit tests

- `buildCompactionReminder(skillNames, "trimmed")` produces a reminder containing each skill
  name and the re-arm instruction.
- `buildCompactionReminder(skillNames, "pointer")` produces the minimal one-line form.
- Sizing decision: `reason → compactionSizing` mapping
  (`threshold→full`, `overflow→trimmed`, `manual→pointer`).
- `messageContainsBootstrap` detects both the `superpowers-root-contract` and
  `superpowers:compaction-reminder` markers.
- `firstNonCompactionSummaryIndex` returns 0 when no leading compaction summaries, and the
  correct index when N leading summaries are present.

### Integration tests (extension lifecycle)

- **Opt-in gate:** a session with no Superpowers command fired never injects on `context`
  (flag stays false). This is the core opt-in guarantee.
- **Threshold:** `session_compact` with `reason: "threshold"` → next `context` injects the
  full contract (content matches `buildSuperpowersRootPrompt`).
- **Overflow:** `session_compact` with `reason: "overflow"`, `willRetry: true` → next
  `context` injects the trimmed reminder.
- **Manual:** `session_compact` with `reason: "manual"` → next `context` injects the pointer.
- **Idempotency:** a `context` fire where the marker is already present → no-op (no second
  insertion).
- **Repeated compaction:** two `session_compact` events with an intervening `context` → the
  contract is re-inserted after each (survives repeated compaction).
- **`session_start` resets opt-in:** after `session_start`, `superpowersActive` is false even
  if it was true before (opt-in is not sticky across sessions).
- **`agent_end` consumes:** after `agent_end`, `superpowersActive` is false until the next
  `session_compact` re-arms.
- **Non-opted-in compaction:** `session_compact` when `superpowersActive` is false → flag stays
  false → no injection on subsequent `context`.

## Interaction with existing code

- **`src/superpowers/prompt-dispatch.ts`** — the `before_agent_start` handler is refactored to
  build its hidden message via the shared `buildSuperpowersContractMessage` factory. Behavior
  unchanged.
- **`src/superpowers/root-prompt.ts`** — gains `buildCompactionReminder` and
  `buildSuperpowersContractMessage` (or the factory lives in prompt-dispatch.ts alongside the
  existing custom-type constant). `buildSuperpowersRootPrompt` unchanged.
- **`src/extension/index.ts`** — gains the `session_compact`, `context`, and `agent_end`
  handlers and the `session_start` one-line addition; sets the opt-in flag at the intercepted
  `/skill:` dispatch site.
- **`src/slash/slash-commands.ts`** — sets the opt-in flag at the `/sp-*` dispatch site.
- **`src/shared/types.ts`** — `SubagentState` extended.

## User documentation

Per `AGENTS.md`, the following will be updated in the implementation plan (not this spec):

- `README.md` — note the compaction-durability behavior and that it is opt-in.
- `docs/skills.md` — note that lifecycle skills are re-armed after compaction.
- (No `docs/configuration.md`, `docs/worktrees.md`, or `docs/parameters.md` changes are
  expected; the feature has no new config keys in v1.)

## Open questions for implementation

1. **Custom-type message in `context` return** — verify it participates in LLM context as
   expected; fall back to `role: "user"` if not (see Components §4).
2. **`buildSuperpowersRootPrompt` input at compaction time** — the initial path has the full
   `SuperpowersRootPromptInput` (task, flags, resolved skill content) at command-fire time.
   The `context` full-sizing path needs enough of that input to rebuild the contract.
   Persist the input (or the minimal subset needed) in `SubagentState` at command fire, and
   re-resolve skill content at compaction time via the existing
   `resolveAvailableSkill`/`resolveSkills` (do not snapshot skill content — read at runtime,
   consistent with the existing command-prompt resolution path).
