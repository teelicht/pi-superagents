# Compact Inline Subagent Visuals

**Date:** 2026-04-21
**Status:** Draft

## Goal

Improve the visual presentation of Superpowers subagent runs without changing the current synchronous execution model.

The current inline `subagent` result rendering shows useful live detail, but it is too verbose for the normal conversation flow. This design replaces the default view with a compact, widget-like summary that expands in place when the user selects/clicks the result using Pi's existing expanded tool-result interaction.

This is also a UI simplification pass. The implementation should reduce the number of competing visual treatments for subagents and make `src/ui/render.ts` easier to understand, not add another rendering layer on top of the existing verbose output.

This is Phase 1. A later Phase 2 may spawn `/sp-implement` itself as an asynchronous orchestrator in a separate multiplexer window, but that architecture is explicitly out of scope here.

## Background

`pi-superagents` currently owns a Superpowers-specific `subagent` tool. It shells out to child Pi processes in `src/execution/execution.ts`, reconstructs progress from JSON events, and renders results through `src/ui/render.ts`.

The separate `pi-subagents` project at `/Users/thomas/Documents/Dev/pi-subagents` shows a cleaner visual pattern: a compact list of agents, status icons, current activity, and details only when requested. That interaction is worth borrowing, but its async agent manager and session ownership model should not be ported into this phase.

The `pi-interactive-subagents` project points toward a future mux-based workflow where an orchestrator and its children can run independently. That is a good Phase 2 direction, but introducing it now would conflict with this repository's current `subagent` tool and with how Superpowers workflows block while delegated work completes.

The current `pi-superagents` UI has two sources of complexity that this feature should address:

- `src/ui/render.ts` mixes summary, live progress, full task previews, recent tools, Markdown output, skills, sessions, artifacts, and error display in one nested renderer.
- The same status facts appear in multiple visual forms: inline result blocks, `/subagents-status`, and run-history details.

The desired end state is not more UI. It is one compact inline summary, one expanded inline detail view, and the existing `/subagents-status` overlay for operational history.

## Scope

### In Scope

- Replace the default inline `subagent` result view with a compact summary.
- Use Pi's existing expanded/collapsed result rendering state for in-place detail expansion.
- Keep `/subagents-status` as the deeper active/recent run inspection overlay.
- Reuse the existing `Details`, `SingleResult`, `AgentProgress`, and `RunEntry` data where practical.
- Simplify `src/ui/render.ts` by replacing the current nested single/parallel renderer with a small collapsed/expanded rendering pipeline.
- Remove redundant default-inline detail: task blocks, tool-call lists, Markdown output, skills, session, and artifact paths should move behind expansion unless they are needed to signal an error.
- Preserve live progress updates during running single and parallel subagent calls.
- Update user-facing docs after implementation.

### Out Of Scope

- Spawning `/sp-implement` as an async orchestrator.
- Opening cmux, tmux, zellij, WezTerm, or other multiplexer panes.
- Depending on `pi-interactive-subagents`.
- Registering additional subagent tools or commands.
- Changing the execution model in `src/execution/execution.ts`.
- Replacing `/subagents-status`.
- Adding speculative interfaces for Phase 2.
- Adding a persistent above-editor widget through `ctx.ui.setWidget`; this phase uses the existing inline tool-result surface.

## User Experience

### Collapsed Running View

While a single subagent is running, the tool result should render as a compact two-line block:

```text
Subagent  running
- sp-recon  Inspect auth flow  3 tools  12.3s
  -> reading src/auth/session.ts
```

While multiple subagents are running in parallel:

```text
Subagents  1/2 complete
- running  sp-recon         Inspect auth flow     3 tools  12.3s
- pending  sp-code-review   Review auth changes
```

If a child process has current activity, show one short activity line under that row:

```text
  -> read src/auth/session.ts
```

The collapsed view should not show recent output, full task prompts, skills lists, artifact paths, or Markdown output.

### Expanded Running View

When the user expands the result in Pi, the same tool result should render details in place:

```text
Subagents  1/2 complete
- running  sp-recon         Inspect auth flow     3 tools  12.3s
  current: read src/auth/session.ts
  recent:  rg "token", read middleware.ts
  output:  Auth is split across middleware...
- pending  sp-code-review   Review auth changes
```

Expanded running details should include:

- current tool and argument preview
- recent tools, capped to the last three
- recent output, capped to the last five non-empty lines
- skills warning when present
- context badge when the run uses fork context

### Collapsed Completed View

After completion, successful runs should collapse to a compact summary:

```text
Subagents  2/2 complete  ok  17 tools  41.2s
```

Failed or partially failed runs should be equally compact but visually obvious:

```text
Subagents  1/2 complete  error  12 tools  28.4s
```

The collapsed completed view may show one short error label for failures, but not full output.

### Expanded Completed View

Expanded completed details should include each subagent row with:

- final status
- model, when available
- tool count and duration
- task preview
- skills and skills warnings
- final output preview
- artifact/output path when available
- session path when available
- error text when present

The final output preview must stay bounded. Full output remains available through existing artifacts and the expanded Markdown result behavior when appropriate.

## Architecture

### Rendering Boundary

Keep rendering changes centered in `src/ui/render.ts`, with at most one small helper module if it clearly reduces file complexity.

Do not create a new execution manager or live agent registry. The data already reaches `renderSubagentResult()` through `AgentToolResult<Details>` and should remain the rendering input.

Replace the current renderer shape with a simpler pipeline:

1. Normalize `Details` into display rows using existing result/progress data.
2. Render a short header summary.
3. Render collapsed rows when `options.expanded` is false.
4. Render detailed rows when `options.expanded` is true.

Recommended helpers:

- `summarizeDetails(details)` for total status, counts, tools, and duration.
- `formatSubagentRow(result, progress)` for one compact row.
- `formatActivity(progress)` for current-tool/recent-tool text.
- `renderCollapsedSubagentResult(...)`
- `renderExpandedSubagentResult(...)`

The helpers should operate on existing `Details`, `SingleResult`, and `AgentProgress` shapes. Avoid adding a parallel display state type unless the implementation becomes meaningfully clearer.

The implementation should delete or substantially shrink old branches that render the verbose default view. Do not keep the old renderer under a new name or behind a flag.

### Visual Ownership

Inline result rendering and `/subagents-status` should have distinct jobs:

- Inline collapsed view: conversation-friendly progress and final outcome.
- Inline expanded view: details for the current tool result.
- `/subagents-status`: active/recent run monitor and historical inspection.

Avoid duplicating the `/subagents-status` panel inside the inline expansion. The expanded inline view should be a concise detail disclosure, not a second overlay.

The `pi-subagents` idea to borrow is the compact tree/list presentation and activity wording, not its persistent widget lifecycle, session manager, background notifications, or agent registry.

### Data Flow

Execution remains unchanged:

1. `src/execution/execution.ts` spawns child Pi processes and updates `AgentProgress`.
2. `src/execution/subagent-executor.ts` merges progress for parallel tasks into `Details`.
3. Pi calls `renderSubagentResult(result, options, theme)`.
4. `renderSubagentResult()` chooses collapsed or expanded rendering based on `options.expanded`.

The only expected behavior change is the shape of the rendered component.

For parallel partial updates, `src/execution/subagent-executor.ts` may populate `Details.progress` with existing `AgentProgress` entries for tasks that have not started yet, using `status: "pending"`. This is a display-data completion, not a new queue or execution model.

### `/subagents-status`

`/subagents-status` remains the separate operational monitor for active and recent runs. This design does not remove or replace it.

Keeping `/subagents-status` is intentional. Even if Phase 1 makes inline results much quieter, the status overlay may become the natural inspection surface for a later async orchestrator/multiplexer workflow in Phase 2.

If the inline rendering helper needs formatting logic that the overlay also uses, extract that logic only when it removes real duplication. Do not tie the overlay lifecycle to inline result rendering.

The overlay should not gain new responsibilities in this phase. Any improvements to `src/ui/subagents-status.ts` should be limited to consuming shared formatting helpers if that removes obvious duplication.

## Error Handling

- Unknown-agent validation and execution errors continue to return text results as they do today.
- Failed child runs render a compact error row in collapsed mode and detailed error text in expanded mode.
- Missing progress data should degrade to stable completed rows using `progressSummary` or `usage` data.
- Missing model, skills, session, or artifact fields should simply omit those fields.
- Empty successful output should keep the existing warning signal, but the warning should be compact in collapsed mode.
- Truncation and artifact behavior remain unchanged.

## Testing

### Unit Tests

Add or update tests for `src/ui/render.ts` covering:

- single running collapsed render
- single running expanded render
- parallel running collapsed render
- parallel running expanded render
- completed success collapsed render
- completed failure collapsed render
- expanded completed render with skills warning, artifact path, and error text
- width-safe truncation for long task/tool/output previews
- collapsed output does not include Markdown result body, full task prompt, session path, or artifact path
- expanded output includes those details only when available

### Integration Tests

Update existing execution/render integration coverage only where current assertions depend on old verbose inline output.

The execution tests should not need new child-process behavior because this feature is rendering-only.

### Quality Gates

Run:

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
```

## Documentation

After implementation, update current user documentation:

- `README.md`
- `docs/configuration.md`
- `docs/worktrees.md`
- `docs/parameters.md`
- `docs/skills.md`

The docs should explain that inline subagent results are compact by default and can be expanded in Pi for details. They should not mention mux windows or async orchestrator spawning as current behavior.

## Phase 2 Direction

Phase 2 may explore an async orchestration model:

- `/sp-implement` starts a master/orchestrator agent asynchronously.
- The orchestrator runs in a separate mux window.
- Child subagents spawned by that orchestrator can be inspected in their own panes.
- Integration with `pi-interactive-subagents` or a similar extension can be considered then.

No Phase 2 code or abstraction should be introduced in Phase 1. The only Phase 1 responsibility is to keep the inline rendering data straightforward enough that a later async design can make a fresh decision.

## Non-Goals

- This is not a new subagent runtime.
- This is not a background execution feature.
- This is not a replacement for Superpowers workflow skills.
- This is not an integration with `pi-interactive-subagents`.
- This is not a redesign of settings or configuration.
