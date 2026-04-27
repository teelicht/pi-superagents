# Session Modes, Lineage-Only Subagents, and Packet-Backed Handoff

**Date:** 2026-04-27
**Status:** Draft

## Goal

Align `pi-superagents` subagent launching with the intended Superpowers orchestration model:

- bounded child roles should not inherit the parent conversation by default.
- the parent orchestrator should author a scoped work packet for each child run.
- child sessions should still participate in Pi session lineage so `/tree` and related parent/child tracking continue to work.
- packet artifacts must be created and cleaned up by runtime lifecycle code, never by LLM compliance.

This design replaces the current practical default of session forking for Superpowers roles with a session-mode model that distinguishes linked lineage from inherited context.

## Problem

Today, `pi-superagents` models child context primarily as `fresh` or `fork`. In practice, `fork` clones the parent session branch into a child session and launches the child with that inherited branch state. That is technically functional, but it conflicts with the `subagent-driven-development` skill contract, which requires isolated child context curated by the parent.

The result is a mismatch:

- role identity lives in agent files.
- execution policy partly lives in orchestrator code.
- run-specific instructions are mixed into prompt text.
- bounded roles can receive far more session history than needed.

This increases token cost, makes child behavior less predictable, and weakens the orchestrator's control over scope.

## Design Summary

Adopt the same session-mode vocabulary used by `pi-interactive-subagents`:

- `standalone`
- `lineage-only`
- `fork`

Use it in `pi-superagents` as follows:

- agent frontmatter answers: "How should this role launch?"
- agent definition body and system prompt answer: "Who is this role?"
- packet artifact answers: "What exactly should this run do?"

Superpowers bounded roles default to `lineage-only`. `fork` remains available as an explicit override for workflows that truly need inherited conversation context.

## Session Modes

### `standalone`

The child launches without a parent session link and without copied turns.

Use this mode when the child should behave as an independent session with no parent/child lineage relationship.

### `lineage-only`

The child launches with a persisted session header that points to the parent session through `parentSession`, but no turns are copied into the child session.

Properties:

- `/tree` can still show the parent/child relationship.
- the child inherits no conversational history.
- the child receives its work through an artifact-backed packet.

This is the default for Superpowers bounded execution roles.

### `fork`

The child launches with parent lineage and copied session context, following current fork semantics.

Properties:

- the child inherits prior branch context.
- the child may receive the task directly rather than through an artifact.
- this mode is intentionally exceptional for Superpowers bounded roles.

## Configuration Surface

### Agent Frontmatter

Add `session-mode` to agent frontmatter with allowed values:

- `standalone`
- `lineage-only`
- `fork`

This becomes the primary defaulting mechanism for child session behavior.

Example:

```md
---
name: sp-implementer
description: Superpowers-native implementer for one bounded plan task
model: cheap
tools: read, grep, find, ls, bash, write
maxSubagentDepth: 0
session-mode: lineage-only
---
```

### Runtime Override Precedence

Resolve effective session mode with this precedence:

1. explicit launch override
2. agent frontmatter `session-mode`
3. system default

For general `subagent` use, the system default is `standalone`.

For Superpowers bounded role dispatch, the orchestrator should explicitly request `lineage-only` unless a run intentionally opts into `fork`.

### Compatibility

Existing `context: "fresh" | "fork"` inputs should remain temporarily supported as a compatibility layer.

Mapping:

- `fresh` -> `standalone`
- `fork` -> `fork`

This compatibility mapping is transitional. New behavior and documentation should standardize on `session-mode`.

## Superpowers Role Defaults

Default bounded Superpowers roles to `lineage-only`:

- `sp-recon`
- `sp-research`
- `sp-implementer`
- `sp-spec-review`
- `sp-code-review`
- `sp-debug`

Rationale:

- these roles are bounded specialists, not continuation agents.
- they should receive only curated task-relevant information.
- lineage remains useful for session graph visibility and debugging.

`fork` may still be used deliberately for unusual cases where inherited conversation context is the core requirement, but it should no longer be the normal path for Superpowers role execution.

## Handoff Model

### Direct vs Artifact Delivery

Task delivery should be mode-dependent:

- `fork` -> direct task delivery is allowed
- `lineage-only` -> artifact-backed packet delivery
- `standalone` -> artifact-backed packet delivery

This follows the same broad model as `pi-interactive-subagents`, where non-inheriting modes rely on an artifact instead of direct conversational continuation.

### Packet Responsibility

The parent orchestrator authors a packet as a scoped work order. The packet is not a durable workflow document and is not a repo-root artifact. It is a run-local execution input generated by runtime code.

The orchestrator is responsible for:

- selecting the right source material
- trimming it to task-relevant scope
- rendering it into a child-readable Markdown packet
- passing the packet to the child launch

The child is responsible only for executing the bounded task it receives.

## Packet Storage

Store packets under the session-scoped subagent artifact directory in a dedicated packets folder.

Recommended location:

```text
<session-artifacts-dir>/packets/<runId>_<index>_<agent>_packet.md
```

Recommended default filename pattern:

- `<runId>_<index>_<agent>_packet.md`

Where:

- `runId` identifies one parent dispatch run
- `index` is the child ordinal within that run
- `agent` is a sanitized agent name

Example:

```text
subagent-artifacts/packets/a1b2c3d4_0_sp-implementer_packet.md
subagent-artifacts/packets/a1b2c3d4_1_sp-spec-review_packet.md
```

This avoids collisions during parallel launches and keeps packet provenance inspectable without relying on timestamps alone.

## Packet Shape

### Implementer Packet

Implementer packets should include:

- task id and task title
- exact plan task text
- implementer mode: `tdd` or `direct`
- relevant spec excerpt
- acceptance criteria
- constraints
- explicit non-goals
- suggested starting files or paths
- required verification
- expected completion format and allowed status values

The implementer packet should be written so the child can start work without browsing unrelated plan or spec sections.

### Reviewer Packets

Reviewer packets should include:

- original task text
- acceptance criteria
- changed files and diff summary
- verification evidence
- implementer final summary
- reviewer-specific questions

Reviewer packet variants:

- spec review packet focuses on requested scope and acceptance criteria compliance
- code review packet focuses on correctness, regressions, maintainability, and risk

## Packet Rendering Rules

Packet content should be structured Markdown with stable headings so both humans and tests can inspect it.

Suggested top-level sections:

- `Task`
- `Scope`
- `Acceptance Criteria`
- `Constraints`
- `Relevant Context`
- `Verification`
- `Expected Output`

The packet should be deterministic for the same inputs apart from filename and any explicit runtime identifiers.

## Lifecycle and Cleanup

Packet cleanup is a runtime responsibility and must not depend on the child model following instructions.

### Runtime Tracking

The launch/runtime state for a running child should track:

- `packetFile`
- `sessionMode`
- `taskDelivery`

This makes packet lifecycle part of the same runtime object that already tracks child session and status information.

### Cleanup Rules

The runtime must delete packet files in the general child finalization path for:

- successful completion
- child failure
- parent-side abort
- launch failure after packet creation
- watch/poll failure

Interrupting a child turn does not itself trigger cleanup if the child session remains alive. Cleanup occurs only when the runtime considers the child run finalized.

### Startup Backstop

Add stale packet cleanup as a backstop on extension startup or session startup:

- scan the managed packet artifact directory
- remove orphaned packet files older than the configured artifact retention threshold

This protects against crashes or forced process termination leaving artifacts behind.

## Result Visibility

Packet paths are primarily internal runtime details.

Default behavior:

- do not surface packet paths in normal user-facing result summaries

Debug behavior:

- packet paths may be included in detailed result metadata or debug tooling when artifact inspection is needed

This keeps normal interaction clean while preserving diagnosability.

## Execution Flow

For `lineage-only` Superpowers dispatch:

1. parent resolves role and effective `session-mode`
2. parent creates a linked child session with no copied turns
3. parent renders a packet artifact under managed packet storage
4. parent launches the child against that packet artifact
5. child executes with role identity from frontmatter/system prompt and run-specific instructions from the packet
6. runtime captures child completion
7. runtime deletes the packet artifact in finalization
8. runtime returns child results to the parent

This preserves lineage without leaking branch history into bounded child execution.

## Error Handling

If packet generation fails:

- do not launch the child
- return a tool error to the parent
- delete any partially written packet artifact

If session seeding fails:

- do not launch the child
- return a tool error to the parent

If cleanup fails:

- do not silently crash the extension
- log or surface the cleanup failure in diagnostics
- continue normal result delivery
- rely on startup stale cleanup as the backstop

## Testing

Add or update tests for:

- frontmatter parsing of `session-mode`
- effective session-mode precedence
- launch behavior mapping for `standalone`, `lineage-only`, and `fork`
- lineage-only child session seeding with `parentSession` and no copied turns
- fork seeding retaining inherited context behavior
- packet filename generation using `<runId>_<index>_<agent>_packet.md`
- parallel launches producing distinct packet paths
- implementer packet rendering shape
- reviewer packet rendering shape
- packet deletion on success
- packet deletion on child failure
- packet deletion on launch failure after packet creation
- startup cleanup removing stale packet artifacts
- compatibility mapping from legacy `context` values

## Non-Goals

This design does not:

- redesign the full Superpowers workflow loop
- change the meaning of role identity prompts
- require repo-root packet files
- rely on the LLM to delete artifacts
- remove `fork` as an advanced option

## Recommendation

Adopt `session-mode` as the primary launch policy abstraction, default Superpowers bounded roles to `lineage-only`, and move run-specific handoff into managed packet artifacts with strict runtime cleanup.

This produces the intended separation of concerns:

- frontmatter decides launch inheritance behavior
- agent definition decides role identity
- packet artifact decides run-specific work scope

That separation is a better match for Superpowers orchestration than the current fork-heavy model.
