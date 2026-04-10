# Contributing to pi-superagents

## Backwards Compatibility

- Don't build any backwards compatibility into the code.

## Language Standard (TypeScript Required)

- Use TypeScript for all application code.
- Do not add new plain JavaScript source files for backend, mobile, or shared packages.
- Prefer `.ts` / `.tsx` and shared typed contracts over untyped code.
- If JavaScript is unavoidable (for example, tool-specific config files), keep it minimal and document the reason in the relevant spec/plan artifact.

## Documentation Header Rules

Every source file and every non-trivial function must include documentation headers.

### File header (required)

Add a short header at the top of each file describing:

- module purpose
- key responsibilities
- important dependencies or side effects

### Function header (required)

Use doc comments (for example TSDoc/JSDoc) for each function:

- what it does
- inputs/outputs
- invariants or constraints
- notable errors/failure modes

Keep comments precise and maintained with code changes.

## Testing Requirements

These are required to satisfy the TypeScript-first and quality-gate requirements:

- TypeScript compiler/tooling: `typescript`, `tsx`, `@types/node`
- Linting: `eslint`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`
- Formatting: `prettier`, `eslint-config-prettier`
- Backend/shared testing: `vitest`, `@vitest/coverage-v8`, `supertest`

## Repository Structure

```
src/
├── agents/           # Agent definitions and frontmatter parsing
├── execution/        # Core run engine, worktree, async execution
├── extension/        # Pi extension registration and config
├── shared/           # Shared types, schemas, utilities
├── slash/            # Slash command handlers
└── ui/               # TUI components (manager, status overlay, clarify)
```

## Operational Internals

### Artifacts

Location: `{sessionDir}/subagent-artifacts/` or `<tmpdir>/pi-subagent-artifacts/`

Files per task:
- `{runId}_{agent}_input.md` — Task prompt
- `{runId}_{agent}_output.md` — Full output (untruncated)
- `{runId}_{agent}.jsonl` — Event stream (sync only)
- `{runId}_{agent}_meta.json` — Timing, usage, exit code

### Session Logs

Session files (JSONL) are stored under a per-run session directory. Precedence: explicit `sessionDir` > `config.defaultSessionDir` > parent-session-derived path.

When `context: "fork"` is used, each child run starts with `--session <branched-session-file>` from the parent's current leaf. This is a real session fork, not injected summary text.

### Nested Subagent Recursion Guard

By default nesting is limited to **2 levels**: `main session → subagent → sub-subagent`. Any deeper `subagent` calls return an error.

Configure the limit in three places:
1. `PI_SUBAGENT_MAX_DEPTH` environment variable (set before starting pi)
2. `config.maxSubagentDepth` in `config.json`
3. `maxSubagentDepth` in agent frontmatter (can only tighten, not relax)

```bash
export PI_SUBAGENT_MAX_DEPTH=3   # allow one more level
export PI_SUBAGENT_MAX_DEPTH=1   # only direct subagents
export PI_SUBAGENT_MAX_DEPTH=0   # disable subagent tool entirely
```

`PI_SUBAGENT_DEPTH` is internal — don't set it manually.

### Async Observability

Async runs write a dedicated observability folder:

```
<tmpdir>/pi-async-subagent-runs/<id>/
  status.json
  events.jsonl
  subagent-log-<id>.md
```

Events: `subagent:started`, `subagent:complete`

### Live Progress (sync mode)

During sync execution, the collapsed view shows real-time progress:

**Chains:** Header with tool count/token/duration, chain visualization (`✓scout → ●planner`), current tool, recent output.

**Parallel:** Per-task step cards showing status icon, agent name, model, tool count, duration.

Press **Ctrl+O** to expand full streaming view.