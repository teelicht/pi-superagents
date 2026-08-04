# Superpowers v6.2 Compatibility — Design Spec

## Context

Pi Superagents currently repeats parts of upstream Superpowers' subagent-driven-development
(SDD) protocol in its root prompt and reviewer role. Superpowers v6.2 made the SDD workspace
plan-scoped, changed the `review-package` arguments, introduced scoped re-reviews, and moved
workspace cleanup to the end of a clean final branch review.

The duplicated Pi contract still describes the pre-v6.2 command signature, flat workspace,
per-task cleanup, and ordinary full reviews for every fix round. Those instructions can override
or conflict with the installed upstream skill.

## Decision

Require Superpowers v6.2 or newer and make its installed skills the sole authority for:

- SDD script names and arguments;
- workspace and ledger paths;
- task handoff files;
- initial review and scoped re-review behavior;
- retry limits and adjudication; and
- final plan-workspace cleanup.

Pi Superagents will retain only the Pi-specific adapter behavior that upstream cannot express:

- dispatch implementers through `sp-implementer`;
- dispatch initial task reviews, scoped re-reviews, and final branch reviews through `sp-review`;
- resume the original implementer through `resumeSession`; and
- use local review-scope markers so the bounded reviewer selects the correct mode.

Do not add runtime version detection or support for pre-v6.2 SDD contracts.

## Root Prompt Contract

Replace the duplicated file-handoff instructions in `src/superpowers/root-prompt.ts` with a short
Pi adapter contract. It must state that the selected upstream `subagent-driven-development` skill
is authoritative and that controllers must not reconstruct script invocations, workspace paths,
ledger rules, review loops, or cleanup rules from the adapter.

The adapter maps upstream review dispatches to these local markers:

| Upstream operation | Pi agent | Required local marker |
| --- | --- | --- |
| Initial task review | `sp-review` | `Review scope: task` |
| Scoped fix re-review | `sp-review` | `Review scope: re-review` |
| Final whole-branch review | `sp-review` | `Review scope: branch` |

The upstream reviewer template supplied by the controller remains authoritative for the review's
inputs, boundaries, and output format. The marker only selects the bounded Pi role mode.

For fix rounds, the adapter tells the controller to pass the previous `sp-implementer` session file
through `resumeSession` whenever upstream requests resuming the original implementer. Existing
session validation and synchronous execution behavior remain unchanged.

## Cleanup Lifecycle

Cleanup stays controller-owned and upstream-defined. Pi Superagents must not compute the workspace
path, delete individual task files, or preserve a ledger past the point upstream specifies.

The Pi adapter adds one compatibility invariant without copying cleanup mechanics: before invoking
`finishing-a-development-branch`, the controller must complete the selected upstream SDD skill's
final cleanup step after the final branch review is clean. If the upstream workflow has not reached
that step, the controller continues the upstream workflow rather than inventing cleanup commands.

This keeps cleanup enforceable in the root contract while allowing upstream to change the exact
workspace layout and deletion command later.

## Reviewer Role

Update `agents/sp-review.md` to accept exactly three scopes: `task`, `re-review`, and `branch`.

- `task` keeps the existing combined specification and code-quality review.
- `re-review` follows the upstream scoped re-review template included in the dispatch. It verifies
  prior findings and the fix diff only, and returns the format required by that template instead of
  restarting the full task review.
- `branch` keeps the existing integrated-branch review.

Missing or unknown scope markers continue to return `NEEDS_CONTEXT`. The role remains read-only and
cannot invoke subagents.

## Tests

Update the smallest existing checks that encode the compatibility boundary:

- `test/unit/root-prompt.test.ts`
  - assert the adapter declares upstream SDD authoritative;
  - assert all three local review markers and `resumeSession` mapping are present;
  - assert final upstream cleanup is required before branch finishing; and
  - assert the prompt no longer contains the old `review-package BASE HEAD`, flat workspace,
    per-task `rm -f`, or persistent-ledger instructions.
- `test/unit/agent-prompts.test.ts`
  - assert `sp-review` accepts scoped re-review and delegates its contract to the supplied upstream
    template while preserving existing task and branch behavior.
- `test/integration/parallel-sdd-execution.test.ts`
  - replace the old flat ledger fixture with a plan-scoped workspace and a plan-identifying first
    line; keep the existing assertion that the controller-owned ledger survives task integration.

No test will copy or execute upstream scripts. The compatibility tests guard only Pi's adapter and
ensure it does not reintroduce upstream implementation details.

## Documentation

Update active user documentation to state the v6.2+ requirement and upstream-owned SDD lifecycle:

- `README.md`;
- `docs/configuration.md`;
- `docs/worktrees.md`;
- `docs/parameters.md`; and
- `docs/skills.md`.

Add an unreleased changelog entry. Historical specs and plans remain unchanged because they record
the design in effect when they were written.

## Acceptance Criteria

1. Generated Superpowers prompts contain no pre-v6.2 script signature, flat workspace, or per-task
   cleanup instructions.
2. Initial task review, scoped re-review, and final branch review all route through `sp-review` with
   an unambiguous local scope marker.
3. Fix rounds can resume the original `sp-implementer` through the existing `resumeSession` input.
4. The root contract requires completion of upstream's final SDD cleanup before branch finishing.
5. Active documentation requires Superpowers v6.2+ and describes upstream as the SDD lifecycle
   authority.
6. Unit, integration, typecheck, and formatting checks pass.
