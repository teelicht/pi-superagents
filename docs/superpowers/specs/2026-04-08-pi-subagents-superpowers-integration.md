# Pi-Subagents + Superpowers Integration

Date: 2026-04-08

## Goal

Add an explicit Superpowers workflow entrypoint to `pi-subagents` so I can opt into the stricter Superpowers loop when I want it, while leaving the baseline `pi` harness plus generic `pi-subagents` delegation behavior unchanged when I do not.

This integration must:

- preserve the baseline `pi` harness plus generic `pi-subagents` extension behavior when the command is not used
- activate Superpowers workflow only through an explicit command
- allow project-specific domain skills per role
- support both TDD and non-TDD implementation styles inside the Superpowers workflow

## Core Recommendation

Treat:

- `pi` as the base coding harness
- `pi-subagents` as the generic delegation extension layer
- an explicit Superpowers command as the opt-in workflow layer built on top of that extension stack

The key simplification is:

- no ambient global Superpowers mode
- no need to force every task through the full loop
- no need to redefine either `pi` or the generic delegation features already provided by `pi-subagents`

If I do not invoke the Superpowers command, I should just be using `pi` with the generic `pi-subagents` features that already exist today.

## Activation Model

### Without the Superpowers command

When I use `pi` normally and do not invoke the command:

- the baseline `pi` harness remains unchanged
- the existing generic `pi-subagents` delegation behavior remains unchanged
- existing generic agents, chains, and parallel execution continue to work
- I can still call individual skills or agents myself

This path is preferred for:

- small changes
- quick edits
- one-off exploration
- ad-hoc debugging
- any task where the full Superpowers loop would be overkill

### Superpowers command mode

When I invoke the explicit Superpowers command, the run switches into a Superpowers-native controller flow.

Conceptually:

- command activates the workflow
- root session becomes the Superpowers controller for that run
- role policy, model tiers, skill overlays, packet conventions, and review rules are applied only for that run

This path is preferred for:

- multi-step implementation
- risky or ambiguous changes
- work that benefits from plan-task decomposition
- cases where I want the full review and verification discipline

### Individual skills remain callable

Even with this design, I must still be able to:

- call specific Superpowers skills manually
- call specific `pi-subagents` agents manually
- use domain skills directly when I do not want the full Superpowers command

The command adds an explicit workflow path. It must not become the only way to use skills.

## Command Contract

The integration should add one explicit command, for example:

- `/superpowers`

The exact name can be refined during implementation, but the behavior should be:

- opt into Superpowers-native orchestration for this run
- keep `pi` plus the generic `pi-subagents` extension behavior unchanged otherwise

### Command responsibilities

The command should:

- activate Superpowers workflow policy for the run
- choose the execution style for the implementer role
- apply project-level role overlays
- preserve root-session workflow authority

### Suggested command options

Minimum:

- implementation mode:
  - `tdd`
  - `direct`

Optional:

- per-run domain skill additions
- explicit model-tier overrides
- explicit worktree preference

The exact CLI syntax can be decided later. The important design choice is that the command is the activation boundary.

## Workflow With The Command

When the Superpowers command is invoked:

1. the root session owns the workflow
2. the durable spec and plan stay in Superpowers locations
3. the root session extracts plan tasks and scene-setting context
4. child agents execute bounded roles
5. the root session evaluates review feedback
6. the root session verifies completion before marking a task done

The root session remains the only agent responsible for:

- user interaction
- invoking `using-superpowers`
- invoking `brainstorming`
- invoking `writing-plans`
- choosing execution strategy
- deciding whether feedback is accepted
- invoking `verification-before-completion`
- invoking `finishing-a-development-branch`
- making final completion claims

## TDD vs Non-TDD

The Superpowers command should not create two entirely different workflows. The workflow stays the same. Only the implementer loop changes.

## Superpowers + TDD

This is the default and recommended path.

Flow:

1. root extracts one bounded task
2. implementer works test-first
3. implementer runs targeted verification
4. spec review checks requested scope
5. code review checks quality and risk
6. root verifies before marking complete

This mode should attach:

- `test-driven-development`

to the implementer role by default.

Use this for:

- feature behavior changes
- bug fixes
- refactors with regression risk
- tasks where test-first discipline clearly helps

## Superpowers + direct implementation

This is the lighter implementer mode inside the same workflow.

Flow:

1. root extracts one bounded task
2. implementer may code first
3. implementer runs targeted verification after the change
4. spec review checks requested scope
5. code review checks quality and risk
6. root verifies before marking complete

This mode should:

- not force `test-driven-development`
- still require verification and review

Use this for:

- config changes
- script or tooling edits
- mechanical refactors
- glue code
- tasks where test-first adds more friction than value

## Important simplification

TDD vs non-TDD is an implementer-mode choice, not a whole separate workflow profile.

That keeps the design simple:

- command decides whether we use the Superpowers loop
- implementer mode decides whether the implementer uses TDD

## Durable vs Temporary Artifacts

The command-based workflow should keep Superpowers durable artifacts intact.

### Durable artifacts

- spec: `docs/superpowers/specs/...`
- implementation plan: `docs/superpowers/plans/...`
- root-owned progress tracking
- final verification and synthesis

### Temporary run-local artifacts

Optional execution packets are still useful, but they are not workflow documents:

- `task-brief.md`
- `implementer-report.md`
- `spec-review.md`
- `code-review.md`
- `debug-brief.md`
- `research-brief.md`

Rules:

- do not treat `context.md` as a canonical Superpowers artifact
- do not create a parallel canonical `plan.md`
- do not use `progress.md` as a second progress system
- keep run-local packets disposable

## Progress Tracking

In the Superpowers command flow:

- progress stays root-owned
- task completion is decided by the root session
- plan-task state lives in root-session task tracking and execution state
- child reports are evidence, not the canonical source of progress

Recommended child statuses:

- `DONE`
- `DONE_WITH_CONCERNS`
- `NEEDS_CONTEXT`
- `BLOCKED`

## Canonical Superpowers Task Loop

For each extracted plan task:

1. root prepares the task packet
2. root dispatches `sp-implementer`
3. root dispatches `sp-spec-review`
4. if spec review passes, root dispatches `sp-code-review`
5. root evaluates review feedback using the same discipline as `receiving-code-review`
6. if accepted issues remain, the task returns to the implementer
7. root only marks the task complete after the loop passes and fresh verification evidence exists

This loop only applies when the Superpowers command is invoked.

## Agent Taxonomy

Define agents by bounded execution role.

### `sp-recon`

Purpose:

- search the repo
- inspect relevant files
- produce a compact packet for the root session

### `sp-research`

Purpose:

- gather external references
- produce a compact brief for the root session

### `sp-implementer`

Purpose:

- execute one bounded task from the approved plan
- report one of the allowed child statuses

Modes:

- `tdd`
- `direct`

### `sp-spec-review`

Purpose:

- verify the implementation matches the requested task exactly

Rules:

- read-only
- no code edits

### `sp-code-review`

Purpose:

- review correctness, regressions, maintainability, and risk

Rules:

- read-only
- no code edits
- only runs after spec review passes

### `sp-debug`

Purpose:

- investigate ambiguous failures
- return diagnosis and next actions

## Skill Governance

The workflow core must stay stable while project/domain skills remain extensible.

### Workflow skills stay authoritative

Workflow authority remains with Superpowers skills such as:

- `using-superpowers`
- `brainstorming`
- `writing-plans`
- `requesting-code-review`
- `receiving-code-review`
- `subagent-driven-development`
- `executing-plans`
- `verification-before-completion`
- `using-git-worktrees`
- `dispatching-parallel-agents`
- `finishing-a-development-branch`

These are not replaced by domain skills.

### Domain-skill overlays are required

The integration must make it easy to add domain-specific skills per project and per role.

This is a hard requirement.

Required properties:

- project/domain skills can be registered without changing the workflow core
- overlays can differ per role
- overlays can differ between planning, implementation, spec review, code review, and debugging
- overlays only apply when the Superpowers command is active
- unknown overlay skills fail clearly

The intended model is:

- fixed workflow core
- pluggable role-based domain overlays

Not:

- one global skill list forced on every task
- project-specific forks of the workflow engine
- silent ambient behavior changes in normal mode

## Role-Based Skill Overlay Model

Skill resolution should conceptually happen in layers:

1. check whether the Superpowers command is active
2. choose the workflow role
3. choose the implementer mode if the role is `sp-implementer`
4. resolve workflow-core skills for that role
5. add project/domain overlays for that role
6. filter anything incompatible with that role
7. inject the final skill set

### Root-session overlays

When the command is active, the root session may load planning-safe and review-safe domain skills during:

- spec design
- implementation planning
- review adjudication
- final verification

Examples:

- React Native project:
  - root planning may add `vercel-react-native-skills`
  - root review adjudication may add `vercel-react-native-skills`
- Postgres-heavy backend project:
  - root planning may add `supabase-postgres-best-practices`

### Child-role overlays

Examples of valid overlays:

- `sp-implementer`
  - `vercel-react-native-skills`
  - `react-native-best-practices`
  - `supabase-postgres-best-practices`
- `sp-spec-review`
  - `vercel-react-native-skills`
  - `supabase-postgres-best-practices`
- `sp-code-review`
  - `vercel-react-native-skills`
  - `react-native-best-practices`
  - `supabase-postgres-best-practices`
- `sp-debug`
  - `systematic-debugging`
  - compatible debugging-safe domain skills

### React Native example

For a React Native app, the command should be able to activate overlays equivalent to:

- root planning:
  - `vercel-react-native-skills`
- `sp-implementer`:
  - `vercel-react-native-skills`
- `sp-spec-review`:
  - `vercel-react-native-skills`
- `sp-code-review`:
  - `vercel-react-native-skills`
- `sp-debug`:
  - `vercel-react-native-skills`

This must be considered a normal supported case.

## Model Routing

Do not change model behavior globally.

Instead:

- keep the baseline `pi` harness and generic `pi-subagents` model behavior unchanged
- only apply Superpowers role/tier routing when the command is active

Recommended tiers:

- `cheap`
- `standard`
- `strong`
- `max`

Recommended role defaults when the command is active:

- root session: `max`
- `sp-recon`: `cheap`
- `sp-research`: `cheap` or `standard`
- `sp-implementer`: `cheap` by default, escalate when needed
- `sp-spec-review`: `strong`
- `sp-code-review`: `strong`
- `sp-debug`: `max`

The role/tier resolver may still read project config, but that config must not affect normal runs unless the command is active.

## Prompt Contracts

The command-based workflow should continue to use fresh-context packets.

### `sp-implementer`

Include:

- task title
- full task text copied from the durable plan
- task-local architectural context
- relevant files and paths
- dependencies on earlier tasks
- acceptance criteria
- stop/escalation rules
- implementer mode: `tdd` or `direct`

Do not make the implementer read the full plan by default.

### `sp-spec-review`

Include:

- full task text
- implementer status report
- changed files or diff

### `sp-code-review`

Include:

- task text or requirements excerpt
- changed files or diff
- base and head commit when available

### `sp-debug`

Include:

- symptom statement
- repro steps
- logs or failing test output
- narrowed suspect components
- prior attempts if relevant

## Worktrees

Worktree behavior should stay aligned with `using-git-worktrees`, but only for the explicit Superpowers command path.

Rules:

- the baseline `pi` harness plus generic `pi-subagents` behavior stays unchanged unless the command requests Superpowers workflow behavior
- Superpowers command may opt into worktree handling that is compatible with `using-git-worktrees`
- setup, ignore checks, baseline verification, and cleanup should follow the same story as Superpowers

Use worktrees in the command path only when:

- isolation is useful
- parallel work is truly independent
- the repo is clean

## Parallel Dispatch

Parallelism should follow `dispatching-parallel-agents` when the command is active.

Use parallel dispatch only when:

- tasks are genuinely independent
- they do not share state
- they do not edit overlapping files

Do not make parallel implementation the default.

The default Superpowers command path should still be one active implementer loop per task.

## Recommended Integration Pattern

### Pattern A: Explicit command first

Start with:

- one Superpowers command
- one canonical per-task loop
- one implementer-mode toggle: `tdd` vs `direct`
- role-based domain overlays

This is the recommended first iteration because it is simpler than trying to retrofit Superpowers semantics into every normal run.

### Pattern B: Built-in `sp-*` roles

Add:

- `sp-recon`
- `sp-research`
- `sp-implementer`
- `sp-spec-review`
- `sp-code-review`
- `sp-debug`
- `sp-task-loop`

These built-ins should primarily support the explicit command path.

### Pattern C: Keep generic agents intact

Do not remove or redefine generic built-ins as part of the first iteration.

Backward compatibility matters:

- normal users should still get the generic harness
- Superpowers users get the stricter workflow only when they ask for it

## Suggested First Iteration

1. Add an explicit Superpowers slash command.
2. Keep default `pi-subagents` behavior unchanged when that command is not used.
3. Add `sp-*` built-in roles and one canonical `sp-task-loop` chain.
4. Add a central policy layer that only activates for the command path.
5. Add implementer mode selection: `tdd` by default, `direct` optionally.
6. Add project-level role-based domain overlays that are only consulted for the command path.
7. Keep temporary packet artifacts disposable and root-owned progress canonical.
8. Keep worktree and branch-finish behavior compatible with Superpowers skills.

## Why This Is Better

This design keeps the system simpler:

- normal harness behavior remains normal
- the stricter workflow is explicit
- small changes do not pay the full process cost
- TDD remains a strong default without being mandatory everywhere
- domain skills remain project-extensible

That is a better fit for both `pi-subagents` and the way I actually want to work.
