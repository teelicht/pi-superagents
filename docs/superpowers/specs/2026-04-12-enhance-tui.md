# Port pi-subagents TUI Setup to pi-superagents

The `pi-subagents` repository has a sophisticated TUI status overlay (`SubagentsStatusComponent`) that handles bordered box rendering, keyboard selection with scrollable lists, auto-refresh intervals, and multi-pane expanded detail views for run items. Currently, the local `pi-superagents` UI (`SuperpowersStatusComponent`) relies on basic text dumps extending `Container`.

This plan proposes an implementation to modernize the `pi-superagents` UI to match the visual footprint of `pi-subagents` by porting their TUI layout patterns and styling.

## User Review Required

> [!IMPORTANT]
> The current `SuperpowersStatusComponent` uses static, object-oriented `Container` children (`this.addChild(new Text(...))`). The proposed plan reconstructs the component using direct array-of-strings `render(width)` methodology to easily support flexible bordering and background active selection states, matching `pi-subagents`. Is this acceptable? 
>
> In addition, to make the Run details pane as rich as `pi-subagents`, we would ideally add model usage/token tracking or step metrics to `RunEntry` inside `run-history.ts`. Currently `RunEntry` only tracks `duration`, `status`, `task`, and `exit`. Do you want to expand `RunEntry` properties in this scope as well?

## Proposed Changes

---

### UI Core

#### [NEW] `src/ui/render-helpers.ts`
Port the TUI primitives native to `pi-subagents` for layout bounding and padding calculation:
- Extracted constants and style helpers: `row()`, `pad()`, `renderHeader()`, `renderFooter()`, `formatScrollInfo()`.
- Expose the same width-aware coloring extensions via `Theme`.
- Provides flexible framing that respects the terminal `Math.min(width, MAX_WIDTH)` viewport logic.

#### [MODIFY] `src/ui/superpowers-status.ts`
Refactor the component to adopt a rich, interactive TUI state machine:
- Drop the `Container` inheritance and implement `Component` interface explicitly (or retain `Container` and assemble `Text` child using the bounded string arrays).
- **Navigation**: Build dynamic `cursor` and `scrollOffset` properties for scrolling the list of Runs.
- **Tabs**: Adopt the bordered pane format, showing `Settings` and `Runs` at the top bound via `renderHeader`.
- **Selected Pane**: Split the runs rendering. Map `globalRunHistory.getRecent` items into selectable rows and render details parameters for the matching selection at the bottom of the window using the bounded `row()` primitive.
- **Auto-Refresh**: Implement `setInterval(() => this.tui.requestRender(), 2000)` locally within the UI container and track `dispose()` to cleanup timers to continuously present real-time duration outputs when agents are running.

### History (Optional extension to facilitate richness)

#### [MODIFY] `src/execution/run-history.ts`
(If extending `RunEntry` is approved): 
- Inject optional metadata `model`, `tokens`, and generic step breakdowns into the written history logs.
- Prevents missing values inside the rich "Selected Run Data" port.

## Open Questions

> [!WARNING]
> The `pi-subagents` app features an `active` vs `recent` async tracker for tasks that take place in the background. Since `pi-superagents` operates synchronous powers and global history, should we differentiate "in-progress" runs vs "finished" inside the history schema, or keep it strictly past runs?

## Verification Plan

### Automated Tests
- Type checking with `tsc` to verify that ported `render-helpers` match existing `@mariozechner/pi-tui` and `@mariozechner/pi-coding-agent` definitions exactly.
- Assure that `jest` unit tests covering config bindings (boolean settings toggled with `s`/`t`) remain green.

### Manual Verification
- Render the `pi-superagents` app locally and invoke the superpower status page via TUI.
- Verify that `up` and `down` arrow navigation cycles selections through the runs list without layout breaks.
- Ensure that switching tabs (`Tab`) dynamically swaps the inner body elements without losing the bordered frame.
- Enable settings toggles with shortcuts (e.g. `s`, `t`, `w`) to test state reactivity.
