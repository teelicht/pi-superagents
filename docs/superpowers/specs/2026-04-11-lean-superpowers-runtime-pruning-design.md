# Lean Superpowers Runtime Pruning Design

Date: 2026-04-11

## Goal

Complete the radical simplification of the `pi-superagents` runtime by removing all remaining generic code, dead modules, and legacy features identified in the previous design phases. This final pass ensures the package is truly a self-contained, Superpowers-first product.

## Product Boundary

- **Public UX**: `/superpowers`, `/superpowers-status`, and custom configured `superpowers-*` commands.
- **Tool Contract**: The `subagent` tool is restricted to Superpowers-relevant parameters. Generic parameters like `async` and `sessionDir` are removed.
- **TUI**: A two-pane Status and Settings overlay replacing the generic Agents Manager.

## Architecture

### 1. Narrowed Tool Contract (`subagent` tool)

The `subagent` tool schema is pruned to minimize surface area:

| Parameter | Status | Reason |
|-----------|--------|--------|
| `agent` | Retained | Required for role-agent selection. |
| `task` | Retained | Required for single delegation. |
| `tasks` | Retained | Required for parallel delegation. |
| `workflow` | Retained | Must be `"superpowers"`. |
| `useTestDrivenDevelopment` | Retained | Controls implementer behavior. |
| `context` | Retained | Controls `"fresh"` vs `"fork"`. |
| `cwd` | Retained | Allows directory-scoped delegation. |
| `skill` | Retained | Allows explicit skill injection. |
| `model` | Retained | Allows role-specific model/tier overrides. |
| `artifacts` | Retained | Allows the model to suppress debug logging. |
| `includeProgress` | Retained | Allows the model to request detailed metadata. |
| `async` | **Removed** | Runtime handles background execution based on root command flags. |
| `sessionDir` | **Removed** | Runtime handles unique session directory generation automatically. |
| `clarify` | **Removed** | Generic chain clarification is no longer supported. |
| `agentScope` | **Removed** | Generic discovery policy is simplified. |

### 2. Two-Pane Status TUI (`SuperpowersStatusComponent`)

The `/superpowers-status` overlay is enhanced with a two-pane view:

- **Pane 1: Settings**:
    - Toggles for `useSubagents` and `useTestDrivenDevelopment`.
    - Visualization of configured `modelTiers` and custom `commands`.
    - Config diagnostics and gate status.
- **Pane 2: Runs**:
    - Scrollable list of recent Superpowers runs.
    - Fields: Role, Task (truncated), Status (ok/fail), Duration, Artifact Link.
- **Navigation**: `Tab` or `S`/`R` keys to toggle between Settings and Runs.

### 3. Narrowed Agent Discovery

The discovery logic in `src/agents/agents.ts` is pruned:
- **Prioritize Overrides**: Allow users to override built-in roles (e.g., `sp-implementer`) by placing a file in `.agents/` or `~/.agents/`.
- **Implicit Informational Listing**: The TUI will list other agents found in these directories for user reference, but the `subagent` tool schema only accepts `sp-*` role names.

### 4. Codebase Pruning (Removal Candidates)

The following modules and features are slated for removal:

- **Dead Logic**: `src/slash/slash-live-state.ts`, `src/ui/subagents-status.ts`.
- **Generic Runtime**: All sequential "chain" execution logic in `subagent-executor.ts` and `subagent-runner.ts`.
- **Branding/Gist**: `exportSessionHtml` and `createShareLink` (Gist sharing) logic.
- **Fallbacks**: Any logic in `superpowers-policy.ts` supporting non-Superpowers workflows.

## Design Decisions

- **Keep `artifacts`**: Models should still be able to control whether debug logs are written for specific tasks.
- **Remove `async` from tool**: The decision to run a workflow in the background is a root-session decision, not a tool-level delegation decision.
- **Two-Pane TUI**: Provides a clean way to separate configuration from activity monitoring without cluttering the screen.
- **Informational Custom Agents**: We will still find and show custom agents in the TUI (so users can see their own custom roles), but the `subagent` tool schema will enforce the `sp-*` role name pattern for safety and clarity.

## Implementation Steps

1.  **Narrow Types & Schemas**: Prune `SubagentParams`, `Details`, and `AsyncStatus` in `src/shared/types.ts` and `src/shared/schemas.ts`.
2.  **Prune Subagent Executor**: Remove `chain` branches and legacy parameter normalization.
3.  **Prune Subagent Runner**: Strip chain-step loops and HTML/Gist sharing logic.
4.  **Refactor Status TUI**: Implement the two-pane view and "Runs" list.
5.  **Clean up Rendering**: Strip chain-specific rendering from `src/ui/render.ts`.
6.  **Final Pruning**: Delete dead modules and update documentation.
