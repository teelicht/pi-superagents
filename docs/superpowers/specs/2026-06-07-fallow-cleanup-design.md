# Fallow Cleanup Design

## Goal

Make `npx fallow` pass for the current codebase by addressing high-confidence maintainability findings while avoiding broad unrelated refactors.

## Scope

The cleanup targets the Fallow failure categories from the latest run: circular dependency, dead files/exports, duplicate exports, and false-positive dynamic test assets. Test duplication and large-function refactors are out of scope unless required to clear the failing Fallow gate.

## Approach

Use a targeted cleanup strategy:

1. Break the `child-runner.ts → extension/index.ts → subagent-executor.ts → child-runner.ts` cycle by moving extension-entry knowledge out of the child runner. The extension registration layer already knows its entry directory, so it should pass a concrete lifecycle extension entry path through executor dependencies/options.
2. Remove or de-export internal unused symbols when they are not part of the extension runtime contract.
3. Consolidate duplicate exported types so shared contracts live in `src/shared/types.ts` and implementation modules import them.
4. Treat `test/support/mock-pi-script.mjs` as a legitimate dynamically executed test asset, not dead code. Configure Fallow rather than deleting the script.
5. Re-run Fallow, typecheck, and relevant tests after changes.

## Files and Responsibilities

- `src/extension/index.ts`: owns extension registration and can derive the current extension entry file path.
- `src/execution/subagent-executor.ts`: passes executor dependency data to child launches.
- `src/execution/child-runner.ts`: launches child processes without importing the extension module.
- `src/shared/types.ts`: canonical shared type definitions.
- `src/agents/agents.ts` and `src/agents/agent-selection.ts`: agent discovery and any still-needed merge helpers.
- Fallow configuration: documents dynamic test asset exceptions.

## Testing

Verification requires:

- `npx fallow` exits 0 or only reports accepted non-failing findings.
- `npm run typecheck` passes.
- Relevant unit/integration/e2e tests pass, with emphasis on subagent execution and mock Pi support.

## Risks

Unused exports may be relied on by downstream consumers despite not being referenced internally. Because this package is primarily a Pi extension and does not document those internals as public API, remove/de-export only high-confidence internal symbols and prefer shared type consolidation over incompatible renames.
