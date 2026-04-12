# TUI Enhancements for pi-superagents

## 1. Overview
This specification details the implementation plan for porting the advanced terminal user interface (TUI) components from `pi-subagents` into the `pi-superagents` project. This includes transitioning from a basic text layout to a rich, bordered, interactive list with active state tracking.

## 2. Architecture & Data Model

### 2.1 Extending `RunEntry`
The data schema in `src/execution/run-history.ts` will be updated to accommodate richer detail pane information, mimicking the metrics available in `pi-subagents`.

**New Fields:**
- `model?: string` (The LLM used for the run)
- `tokens?: { total: number }` (Total tokens consumed)
- `steps?: Array<{ index: number, agent: string, status: string, durationMs?: number, tokens?: { total: number }, error?: string }>` (Metrics for individual task steps)

### 2.2 Active Run Tracking
Currently, runs are only appended to global history upon completion. This will be changed to support an "Active" vs "Recent" split.

**Updates to `globalRunHistory`:**
- A new `activeRuns` collection (e.g., `Map<string, RunEntry>`) will be maintained.
- Add method `startRun(id: string, partialEntry: Partial<RunEntry>)` to register a running task.
- Add method `updateRun(id: string, updates: Partial<RunEntry>)` to update progress (e.g., adding steps).
- Add method `finishRun(id: string, finalStatus: 'ok' | 'failed', error?: string)` to move the task from `activeRuns` to `recentRuns`.

## 3. UI Components

### 3.1 New `render-helpers.ts`
Create `src/ui/render-helpers.ts` to expose the layout primitives used in `pi-subagents`:
- `row(text, width, theme)`
- `pad(text, length, char)`
- `renderHeader(title, width, theme)`
- `renderFooter(text, width, theme)`
- `formatScrollInfo(above, below)`

These functions will handle string-array construction and respect the `Math.min(width, MAX_WIDTH)` constraints.

### 3.2 Refactoring `superpowers-status.ts`
The existing `SuperpowersStatusComponent` will be stripped of its `Container`/`Text` inheritance structure and converted to implement the raw `Component` interface, matching `SubagentsStatusComponent`.

**Changes:**
- **Rendering:** Return `string[]` arrays directly via `this.render(width)`.
- **Keyboard Navigation:** Implement `up`/`down` handlers to modify a `cursor` index and `scrollOffset` variable.
- **Refresh Loop:** Implement an internal `setInterval` (e.g., 2000ms) to call `tui.requestRender()` so that active durations tick up in real-time. Ensure `clearInterval` is called inside `dispose()`.
- **Tabs (`tab` key):** Maintain the `activePane` ('settings' | 'runs') state, but render the tabs within the bordered layout.
- **Settings Pane:** Rebuild the settings boolean toggles using the new `row()` primitive.
- **Runs Pane:**
  - Render an "Active" section mapped from `globalRunHistory.activeRuns`.
  - Render a "Recent" section mapped from `globalRunHistory.getRecent()`.
  - The bottom half of the pane will display the selected run's newly added `steps`, `model`, and `tokens` data.

## 4. Integration
Update the call sites in `execution.ts` and `pi-spawn.ts` that execute superpower tasks. Instead of pushing to the run history only when the task completes, they must call `startRun()` at the onset, optionally `updateRun()` during execution, and `finishRun()` upon resolution or failure.
