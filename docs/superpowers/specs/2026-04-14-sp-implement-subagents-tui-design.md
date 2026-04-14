# `/sp-implement`, Subagents Status, and Superpowers Settings

**Date:** 2026-04-14
**Status:** Draft

## Goal

Replace the old public `/superpowers` and `/superpowers-status` command surface with clearer commands:

- `/sp-implement` for starting implementation-oriented Superpowers workflow runs.
- `/subagents-status` for monitoring active and recent subagent runs.
- `/sp-settings` for viewing and changing Superpowers/subagent workflow settings.

The old `/superpowers` and `/superpowers-status` commands must be completely removed with no compatibility aliases. The status overlay file must be renamed from `src/ui/superpowers-status.ts` to `src/ui/subagents-status.ts`.

## Rationale

`/superpowers` is too broad for the implementation entrypoint. `/sp-implement` better describes the intended action while preserving the existing `sp-*` command naming convention.

`/superpowers-status` is misleading because the overlay is primarily about subagent execution state and runtime configuration, not the Superpowers skills themselves. Splitting the current tabbed overlay into two screens keeps each TUI focused:

- status is operational and should be quick to open while work is running.
- settings are administrative and can remain a separate command.

## Scope

### In scope

- Hard-remove `/superpowers` and `/superpowers-status`.
- Add `/sp-implement`, `/subagents-status`, and `/sp-settings`.
- Register a direct keyboard shortcut for subagent status.
- Rename `src/ui/superpowers-status.ts` to `src/ui/subagents-status.ts`.
- Rename `SuperpowersStatusComponent` to `SubagentsStatusComponent`.
- Create a separate settings component for `/sp-settings`.
- Add shared framed-panel rendering so both overlays have a green border and distinct background.
- Improve run selection and selected-run step details.
- Update tests and current user-facing docs.

### Out of scope

- Renaming internal `superpowers/*` modules.
- Renaming `workflow: "superpowers"`.
- Renaming Plannotator tool contracts such as `superpowers_plan_review` and `superpowers_spec_review`.
- Migrating existing config keys under `superagents`.
- Editing historical specs and plans, except where a current implementation plan explicitly references this new work.

## Public Commands

### `/sp-implement`

`/sp-implement` replaces `/superpowers` as the primary implementation workflow command.

Usage:

```text
/sp-implement [lean|full|tdd|direct|subagents|no-subagents] <task> [--fork]
```

Behavior remains equivalent to the current `/superpowers` implementation command: it parses the same mode tokens, resolves the same run profile, builds the same Superpowers root prompt, and sends the same hidden prompt contract. Only the public command name, command description, usage text, docs, and tests change.

`/superpowers` is not registered.

### `/subagents-status`

`/subagents-status` opens the run-monitor overlay. It shows active and recent subagent runs only. It does not expose settings toggles.

The extension also registers `ctrl+alt+s` as a shortcut for this overlay. On macOS this corresponds to `Ctrl+Option+S`. The slash command remains the reliable fallback for terminals that do not pass Option/Alt key combinations cleanly.

### `/sp-settings`

`/sp-settings` opens the settings overlay. It shows current workflow settings and allows safe toggles for supported boolean settings.

No global shortcut is required for settings in this version. Settings are less frequent and state-changing, so command-only access is sufficient.

## Components

### `src/ui/subagents-status.ts`

This file replaces `src/ui/superpowers-status.ts`.

It exports `SubagentsStatusComponent`, a focused run monitor that implements Pi's `Component` interface. Responsibilities:

- render a green framed status panel titled `Subagents Status`.
- auto-refresh every two seconds.
- display active runs before recent runs.
- support `up` and `down` selection in the runs list.
- keep selection stable across refreshes when the selected run remains present.
- render selected-run details, including step-level details when present.
- close on `q`, `escape`, or `ctrl+c`.
- clear its refresh timer in `dispose()`.

The component must not write config.

### Settings component

Add `src/ui/sp-settings.ts`, exporting `SuperpowersSettingsComponent`.

Responsibilities:

- render a green framed settings panel titled `Superpowers Settings`.
- display config gate status and diagnostics message.
- display `useSubagents`, `useTestDrivenDevelopment`, `worktrees.enabled`, `worktrees.root`, custom command presets, and model tiers.
- keep the current local toggle keys: `s` for `useSubagents`, `t` for `useTestDrivenDevelopment`, and `w` for worktrees.
- show config write feedback after toggles.
- close on `q`, `escape`, or `ctrl+c`.

This component owns the config-writing behavior that currently lives in `SuperpowersStatusComponent`.

### Shared framed rendering

Add shared TUI rendering helpers, either in `src/ui/render-helpers.ts` or a new small helper module.

The helper should provide a function similar to:

```ts
renderFramedPanel(title: string, bodyLines: string[], width: number, theme: Theme, footer?: string): string[]
```

Requirements:

- Use a strong green border based on `theme.fg("success", ...)`.
- Apply a distinct background to every panel row using `theme.bg("toolSuccessBg", ...)`.
- Pad and truncate content safely with `truncateToWidth(..., pad: true)` or an equivalent ANSI-safe strategy.
- Render a top border, title row, content rows, optional footer/help row, and bottom border.
- Keep frame width stable across settings changes and run updates.

The implementation should stay within the current theme API. It should not hard-code raw ANSI color escape sequences.

## Run Monitor Details

The runs pane should use a stable selection model that cannot select section headers and cannot become negative.

Recommended model:

- Build display rows from active and recent runs.
- Keep `cursor` as an index into run rows only, not mixed section/run rows.
- Derive the selected run from the run-row list.
- Clamp cursor to `0` when no runs exist.
- Show "No runs recorded." when both active and recent lists are empty.

Selected-run details should include:

- agent.
- status.
- task preview.
- model when available.
- total tokens when available.
- duration.
- each step's index, agent, status, duration, tokens, and error message when present.

Use existing local types from `src/execution/run-history.ts` and existing formatters from `src/shared/formatters.ts`.

## Slash Command Registration

`src/slash/slash-commands.ts` should register:

- `sp-implement`.
- `sp-brainstorm`.
- custom configured commands from `config.superagents.commands`.
- `subagents-status`.
- `sp-settings`.

It should not register:

- `superpowers`.
- `superpowers-status`.

The status command and shortcut should call the same small function so command and keyboard paths cannot diverge. That helper should check `ctx.hasUI` before opening the overlay.

## Docs

Update current user-facing docs:

- `README.md`
- `docs/guides/superpowers.md`

Docs should show `/sp-implement`, `/subagents-status`, and `/sp-settings`. They should not document `/superpowers` or `/superpowers-status` as current commands.

Historical specs and plans should remain unchanged unless an implementation plan for this task needs to quote them.

## Error Handling

- If `ctx.hasUI` is false, `/subagents-status`, the status shortcut, and `/sp-settings` return cleanly without throwing.
- If the settings overlay cannot find `state.configGate.configPath`, toggles show the existing user-facing error message and do not throw.
- If reading or writing config fails, the settings overlay displays the error string in its write-feedback area.
- If run history contains malformed JSON, existing history-loading behavior continues to ignore malformed entries.
- If a terminal does not pass `ctrl+alt+s`, the slash command remains available.

## Testing

### Integration tests

Update `test/integration/slash-commands.test.ts` to assert:

- `sp-implement` is registered.
- `superpowers` is not registered.
- `subagents-status` is registered.
- `superpowers-status` is not registered.
- `sp-settings` is registered.
- `/sp-implement` sends the same root-session prompt behavior previously tested for `/superpowers`.
- `/sp-implement` usage errors mention `/sp-implement`.
- `/subagents-status` opens the status overlay when UI is available.
- `/subagents-status` returns cleanly when UI is unavailable.
- `/sp-settings` opens the settings overlay when UI is available.
- `/sp-settings` returns cleanly when UI is unavailable.
- The status shortcut is registered with `ctrl+alt+s` and opens the same overlay helper.

Test mocks must satisfy the current `Theme` surface used by components, including at least `fg`, `bg`, and `bold` when needed.

### Unit tests

Rename and update the current status unit tests:

- from `test/unit/superpowers-status.test.ts`
- to `test/unit/subagents-status.test.ts`

Add or update tests for:

- `SubagentsStatusComponent.render()` returns framed lines.
- `SubagentsStatusComponent.dispose()` clears the timer and is safe to call multiple times.
- empty runs do not allow cursor to become negative.
- selected-run details include step-level status, duration, token, and error details.
- `SuperpowersSettingsComponent.render()` shows settings and framed lines.
- settings toggles write through `updateSuperpowersConfigText`.
- shared frame helper pads rows to stable width and applies border/background styling through theme functions.

### Quality gates

Run:

```bash
npm run typecheck
npm run lint
node --experimental-strip-types --test test/unit/subagents-status.test.ts
node --experimental-strip-types --test test/unit/sp-settings.test.ts
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/slash-commands.test.ts
```

## Migration Notes

This is a breaking command rename. Because the requested behavior is to remove old commands completely, no deprecation alias or warning command is added.

Internal Superpowers naming remains where it describes the skill workflow, policy, or Plannotator contracts. Public command names and the status UI should use the new names.
