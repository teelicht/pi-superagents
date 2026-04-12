# Plannotator Event Bridge Design

## Goal

Add an optional Plannotator review bridge to `pi-superagents` without adopting Plannotator's planning runtime.

When enabled, Superpowers plan approval should open the Plannotator browser review UI, wait for the human decision, and feed rejection feedback back into the Superpowers planning loop. When disabled or unavailable, Superpowers should behave as it does today.

## Current State

`pi-superagents` already owns the Superpowers workflow, including skill-driven planning, implementation planning, test-driven development, and subagent delegation. Plannotator also owns a complete planning and execution state machine when its native Pi extension mode is activated.

Using Plannotator's native plan mode as the Superpowers planner would create overlapping control loops:

- Superpowers chooses skills and planning behavior through its own root prompt and workflow profile.
- Plannotator's native mode guides the agent into its own planning and executing phases.
- Both systems want to decide when planning ends and implementation begins.

Plannotator exposes a better integration point: the shared `plannotator:request` event channel. The published `@plannotator/pi-extension` package listens for `plan-review` requests and emits `plannotator:review-result` when the browser review is approved or rejected.

## Decision

Use an event-only bridge.

`pi-superagents` will not import Plannotator code, bundle Plannotator assets, install Plannotator automatically, or depend on Plannotator in `package.json`. It will only emit the documented shared event request when a Superpowers plan needs review and the user has explicitly enabled the integration.

The feature flag is a boolean:

```json
{
  "superagents": {
    "plannotator": {
      "enabled": false
    }
  }
}
```

The default remains disabled.

When `enabled` is true, it means:

- open the Plannotator browser review UI at the Superpowers plan approval point
- wait for the Plannotator review result
- treat approval as permission to continue
- treat rejection feedback as planning feedback that must be addressed before resubmitting

There will be no passive browser-only mode in the first version.

## User Experience

### Disabled

If `superagents.plannotator.enabled` is missing or false, users see no behavioral change. The existing Superpowers planning and approval flow remains authoritative.

### Enabled And Available

When a Superpowers plan is ready for review:

1. `pi-superagents` emits `plannotator:request` with `action: "plan-review"`.
2. Plannotator opens the browser review UI.
3. `pi-superagents` waits for `plannotator:review-result`.
4. If approved, Superpowers continues.
5. If rejected, Superpowers sends the feedback back into the planning loop and requires another review.

### Enabled But Unavailable

The integration should fail softly. If Plannotator is not installed, not ready, has no active UI context, errors during review startup, or does not respond before timeout, `pi-superagents` should notify the user and continue with the existing text-based Superpowers approval flow.

The flag should not turn a normal planning session into a hang or hard failure because another extension is missing.

## Installation Guidance

Users who want the browser review UI should install Plannotator separately:

```bash
pi install npm:@plannotator/pi-extension
```

`pi-superagents` documentation should clarify:

- Plannotator is optional.
- `pi-superagents` uses only Plannotator's shared event API.
- Users should not activate Plannotator's native `/plannotator` plan mode for the same Superpowers workflow.
- Installing Plannotator also registers Plannotator's own commands and shortcuts, but those are separate from this bridge.
- The currently published Plannotator Pi extension includes the browser assets and event listener. Standalone public web-component packages are not required for this integration.

## Architecture

Add a focused module:

```text
src/integrations/plannotator.ts
```

Responsibilities:

- define local TypeScript types for the minimal event contract
- create unique request IDs
- emit `plannotator:request`
- wait for the initial request response
- wait for the matching `plannotator:review-result`
- ignore stale result events for other review IDs
- enforce bounded timeouts
- return a small internal outcome type to the caller

The module should not import anything from `@plannotator/pi-extension`.

### Local Event Contract

The bridge only needs the minimal plan review surface:

```ts
type PlannotatorPlanReviewRequest = {
  requestId: string;
  action: "plan-review";
  payload: {
    planContent: string;
    planFilePath?: string;
    origin: "pi-superagents";
  };
  respond: (response: PlannotatorPlanReviewResponse) => void;
};

type PlannotatorPlanReviewResponse =
  | { status: "handled"; result: { status: "pending"; reviewId: string } }
  | { status: "unavailable"; error?: string }
  | { status: "error"; error: string };

type PlannotatorReviewResult = {
  reviewId: string;
  approved: boolean;
  feedback?: string;
  savedPath?: string;
  agentSwitch?: string;
  permissionMode?: string;
};
```

The bridge's public outcome should be independent of Plannotator's exact type names:

```ts
type PlanReviewOutcome =
  | { status: "approved" }
  | { status: "rejected"; feedback: string }
  | { status: "unavailable"; reason: string };
```

## Runtime Flow

1. Load config through the existing config validation path.
2. Resolve `superagents.plannotator.enabled`.
3. Include Plannotator plan-review instructions in the Superpowers root prompt only when the flag is enabled.
4. At the normal Superpowers plan approval point, call the bridge with the final plan content and optional plan file path.
5. If the bridge returns `approved`, continue.
6. If the bridge returns `rejected`, inject the feedback as normal plan-review feedback and require a revised plan.
7. If the bridge returns `unavailable`, show a concise warning and continue with the current text-based approval flow.

The bridge should be careful not to own the entire Superpowers state machine. It is a review transport, not a planner.

## Config Changes

Add a new settings group:

```ts
interface SuperpowersPlannotatorSettings {
  enabled?: boolean;
}

interface SuperpowersSettings {
  plannotator?: SuperpowersPlannotatorSettings;
}
```

Validation rules:

- `superagents.plannotator` must be an object when present.
- `superagents.plannotator.enabled` must be a boolean when present.
- unknown keys under `superagents.plannotator` are blocking config errors.

Default config:

```json
{
  "superagents": {
    "plannotator": {
      "enabled": false
    }
  }
}
```

The user-facing example config should include the same setting. The reference docs should explain the separate Plannotator installation step.

## Error Handling

The bridge should distinguish these cases:

| Case | Behavior |
| ---- | -------- |
| No response to `plannotator:request` | return unavailable after timeout |
| Response status `unavailable` | return unavailable with the provided reason |
| Response status `error` | return unavailable with a warning-level reason |
| Handled response without `reviewId` | return unavailable because the event contract was not satisfied |
| No matching review result | return unavailable after timeout |
| Review result approved | return approved |
| Review result rejected | return rejected with feedback |

The timeout values can be internal constants in the first version. A future config option can expose them if real usage shows a need.

Rejection without explicit feedback should still produce a usable message such as "Plan changes requested in Plannotator."

## Testing

Unit tests should cover config validation:

- accepts `superagents.plannotator.enabled: true`
- accepts `superagents.plannotator.enabled: false`
- rejects non-boolean `enabled`
- rejects unknown keys under `superagents.plannotator`

Unit tests should cover the bridge:

- emits the exact `plannotator:request` shape
- resolves approval from the matching `reviewId`
- resolves rejection feedback from the matching `reviewId`
- ignores stale `plannotator:review-result` events for other review IDs
- returns unavailable when the request is not handled
- returns unavailable when Plannotator reports unavailable or error
- returns unavailable when the review result times out

Integration-style extension tests should use a mocked `pi.events` bus, following the existing test style around config gating and Superpowers packet behavior.

## Non-Goals

This design does not:

- install Plannotator automatically
- import Plannotator types or helpers
- bundle Plannotator browser assets
- expose Plannotator code review, archive, annotate, or annotate-last actions
- add mode controls beyond the boolean flag
- replace the Superpowers brainstorming or planning workflow
- make Plannotator approval mandatory when the Plannotator extension is unavailable

## Implementation Constraint

The bridge must be invoked only from the Superpowers plan approval path. It must not run during exploratory brainstorming turns, normal clarification questions, implementation execution, code review, or subagent delegation.

The implementation plan should identify the exact call site by tracing the current Superpowers approval path and add the bridge there rather than adding a broad session-level listener that tries to infer plans from arbitrary assistant text.
