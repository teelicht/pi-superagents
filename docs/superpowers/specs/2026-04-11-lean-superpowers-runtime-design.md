# Lean Superpowers Runtime Design

Date: 2026-04-11

## Goal

Radically trim `pi-superagents` into a self-contained Superpowers-first Pi extension.

The package should no longer present itself as a fork or general replacement for `pi-subagents`. It should provide one focused product:

- a `/superpowers` workflow entrypoint
- a status and settings TUI
- Superpowers-aware subagent execution as an internal runtime detail
- model-tier selection through the individual `sp-*` role agent frontmatter
- per-run controls for TDD and subagent delegation
- custom user-defined Superpowers slash commands that map to workflow option presets

No backwards compatibility with the current generic `pi-subagents`-style surface is required.

## Non-Goals

This redesign should not replicate `pi-subagents` or `pi-prompt-template-model`.

Remove or hide the following public product areas:

- generic `/run`
- generic `/chain`
- generic `/parallel`
- generic `/agents`
- generic chain-file authoring as a user-facing feature
- generic agent CRUD and management actions
- prompt-template bridge support
- broad MCP/frontmatter documentation beyond what Superpowers roles need
- session sharing as a documented feature
- generic async-subagent framework branding
- fork lineage messaging in README, changelog, package metadata, and docs

Internal code may keep small pieces of the current execution substrate when they directly support the lean Superpowers runtime, but retained code must serve the new product boundary.

## Product Boundary

The public user interface should be:

```text
/superpowers <task>
/superpowers <workflow-token...> <task>
/superpowers-status
```

The implementation may also register user-defined custom Superpowers commands from config, for example:

```text
/superpowers-lean <task>
/superpowers-direct <task>
/superpowers-inline-tdd <task>
```

Every public command must resolve into the same Superpowers run contract. There should not be separate generic subagent, chain, or prompt-template execution products.

## Architecture

Use the Pi mono subagent example as the conceptual runtime baseline:

- spawn child Pi agents
- stream output
- handle aborts
- render useful progress
- support simple single and parallel child execution
- keep the extension self-contained

The existing codebase can be streamlined in place instead of starting a new repository. This preserves useful implementation work:

- Pi process spawning
- result rendering
- async/recent-run status concepts where still needed
- config loading and fail-closed diagnostics
- skill resolution and injection
- Superpowers role policy
- Superpowers role agents
- model-tier resolution
- test harness coverage

The redesigned architecture should have four layers:

1. **Command Layer**
   Registers `/superpowers`, `/superpowers-status`, and configured custom Superpowers commands.

2. **Workflow Resolver**
   Combines global config, command presets, and inline workflow tokens into a single resolved run profile.

3. **Superpowers Controller Prompt**
   Bootstraps the root session through `using-superpowers`, tells the root model how TDD and subagent delegation are configured, and avoids hardcoding a recon-first workflow.

4. **Subagent Runtime**
   Provides the minimal child-agent execution needed by Superpowers skills and role agents. Generic user-facing chain and agent-management behavior should not leak through this layer.

## Command Profiles

Custom slash commands should be supported through a narrow config shape:

```json
{
  "superagents": {
    "useSubagents": true,
    "useTestDrivenDevelopment": true,
    "commands": {
      "superpowers-lean": {
        "description": "Run Superpowers inline without TDD",
        "useSubagents": false,
        "useTestDrivenDevelopment": false
      },
      "superpowers-direct": {
        "description": "Run Superpowers with subagents but without TDD",
        "useSubagents": true,
        "useTestDrivenDevelopment": false
      },
      "superpowers-inline-tdd": {
        "description": "Run Superpowers with TDD but no subagents",
        "useSubagents": false,
        "useTestDrivenDevelopment": true
      }
    }
  }
}
```

Command profile rules:

- command names must be safe slash-command slugs
- command names should be limited to `superpowers-*` or `sp-*`
- profiles may set only known Superpowers workflow fields
- profiles may include a short description
- profiles must not inject arbitrary prompt text
- profiles must not define arbitrary chains, agents, tools, or model-switching prompt templates
- command registration happens at extension startup; adding or renaming a command requires a Pi reload unless Pi later provides safe dynamic command replacement

This intentionally borrows the useful custom-command idea from prompt-template systems without importing their general-purpose complexity.

## Inline Workflow Tokens

`/superpowers` and all custom Superpowers commands should accept the same leading workflow tokens.

Recommended tokens:

| Token | Effect |
|-------|--------|
| `tdd` | Set `useTestDrivenDevelopment: true` |
| `direct` | Set `useTestDrivenDevelopment: false` |
| `subagents` | Set `useSubagents: true` |
| `no-subagents` | Set `useSubagents: false` |
| `inline` | Alias for `no-subagents` |
| `full` | Set both `useTestDrivenDevelopment: true` and `useSubagents: true` |
| `lean` | Set both `useTestDrivenDevelopment: false` and `useSubagents: false` |

Examples:

```text
/superpowers fix auth
/superpowers direct fix auth
/superpowers no-subagents fix auth
/superpowers direct no-subagents fix auth
/superpowers full fix auth
/superpowers-lean tdd fix auth
```

Precedence:

```text
inline workflow tokens > custom command profile > global config defaults
```

The parser should consume recognized workflow tokens from the start of the argument string until the first non-token word. The remaining text is the user task.

If the user provides only workflow tokens and no task, show a usage error.

## Configuration

Keep configuration narrow and Superpowers-specific:

```json
{
  "superagents": {
    "useSubagents": true,
    "useTestDrivenDevelopment": true,
    "commands": {},
    "worktrees": {
      "enabled": false,
      "root": null,
      "setupHook": null,
      "setupHookTimeoutMs": 30000
    },
    "modelTiers": {
      "cheap": {
        "model": "opencode-go/minimax-m2.7"
      },
      "balanced": {
        "model": "opencode-go/glm-5.1"
      },
      "max": {
        "model": "openai/gpt-5.4"
      }
    }
  }
}
```

Required config behavior:

- empty user config inherits bundled defaults
- invalid config fails closed with visible diagnostics
- unknown keys fail closed
- `useSubagents` is boolean
- `useTestDrivenDevelopment` is boolean
- custom command profile fields are validated strictly
- `worktrees` preserves the existing Superpowers worktree behavior for parallel delegated work
- role agent model choices are not configured here; they live in the individual `agents/sp-*.md` frontmatter and may point to configured model-tier names
- old generic keys from the current broad product should be removed instead of kept for compatibility

`defaultImplementerMode` should not survive this redesign. TDD is represented by `useTestDrivenDevelopment`.

## Status And Settings TUI

Replace the generic Agents Manager with a narrow Superpowers status/settings TUI.

The TUI should support:

- viewing active and recent Superpowers runs
- viewing config diagnostics
- viewing effective global defaults
- toggling `useSubagents`
- toggling `useTestDrivenDevelopment`
- viewing configured custom Superpowers commands
- viewing the configured model tiers used by `sp-*` role agents
- viewing Superpowers worktree defaults
- opening the user config file path or writing safe JSON updates if the current config can be edited without losing comments or unknown formatting

The TUI should not support:

- generic agent creation
- generic chain creation
- arbitrary prompt template editing
- broad frontmatter editing
- generic `/run` launch flows

JSON remains the source of truth. The TUI is a focused editor and inspector, not a second configuration system.

## Superpowers Bootstrap

`/superpowers` must bootstrap `using-superpowers` for the root session.

Preferred behavior:

1. Use a native Pi root skill activation mechanism if one exists.
2. Otherwise resolve the installed `using-superpowers` skill at runtime and include its current contents in the root prompt.
3. Do not copy static skill text into source code.

The generated prompt must:

- identify the run as a Superpowers session
- require the model to follow `using-superpowers` before substantive work or clarifying questions
- state the resolved `useSubagents` value
- state the resolved `useTestDrivenDevelopment` value
- strongly direct subagent use when `useSubagents` is true and selected skills call for delegation
- explicitly forbid `subagent` and `subagent_status` when `useSubagents` is false
- avoid mandatory `sp-recon` or any fixed recon-first workflow
- tell the model to use `sp-recon` only when the active skill flow or task shape calls for bounded reconnaissance

This keeps Superpowers skills authoritative for workflow selection and keeps the extension compatible with future Superpowers skill updates.

## Role Agents

Keep Superpowers role agents as built-ins:

- `sp-recon`
- `sp-research`
- `sp-implementer`
- `sp-spec-review`
- `sp-code-review`
- `sp-debug`

The generic `delegate` agent should be removed unless the implementation needs it as an internal fallback. If retained internally, it should not be documented as a user-facing generic agent.

Bounded `sp-*` roles should remain non-orchestrating. They should not be able to call subagents. The root Superpowers session owns delegation decisions.

## Runtime Simplification

Keep only runtime behavior needed by Superpowers:

- single child-role execution
- parallel child-role execution when root skills call for independent delegated work
- bounded role-agent model resolution from individual `sp-*` agent frontmatter and configured model tiers
- skill injection into child roles
- Superpowers worktree isolation for parallel delegated work
- progress and final result rendering
- cancellation
- recent-run status

Remove or demote:

- reusable generic chain files
- generic chain clarification TUI
- generic agent manager TUI
- generic agent CRUD tool actions
- generic `/run`, `/chain`, and `/parallel` commands
- prompt-template bridge event protocol
- generic `agentScope` user/project/both behavior unless Superpowers role override support needs a small project-local role override path
- generic session sharing
- generic output/read/progress chain artifact conventions that are not used by Superpowers role packets

Worktree isolation should remain supported for Superpowers parallel delegated work. It should be documented as a Superpowers safety option, not as a general worktree framework for arbitrary `/parallel` usage.

## Package Identity

Remove fork-oriented language.

Required documentation and metadata changes:

- README should describe a self-contained Superpowers subagent runner for Pi.
- CHANGELOG should stop advertising pi-subagents compatibility as a product goal.
- Package repository/homepage/bugs metadata should point to the actual project identity.
- Docs should remove "fork of pi-subagents" framing.
- Built-in feature lists should not mention removed generic features.

Historical changelog entries may remain for provenance, but the next release entry should clearly state that the package has been narrowed into a bespoke Superpowers runtime and no longer preserves generic pi-subagents compatibility.

## Files Likely To Remove

Removal candidates:

- `src/agents/agent-manager*.ts`
- `src/agents/agent-management.ts`
- `src/agents/agent-templates.ts`
- generic chain serialization and chain TUI files if no longer used internally
- `src/slash/prompt-template-bridge.ts`
- `src/slash/slash-bridge.ts` if `/superpowers` no longer needs generic slash-to-tool bridging
- `src/ui/chain-clarify.ts`
- generic agent and chain docs
- generic parameter reference sections
- generic prompt-template bridge tests
- generic agent-manager tests, if any

Retention should be justified by the new architecture, not by inertia.

## Files Likely To Keep And Simplify

Retention candidates:

- `src/extension/index.ts`, but renamed or rewritten around Superpowers runtime registration
- `src/slash/slash-commands.ts`, simplified to Superpowers command registration
- `src/execution/pi-spawn.ts`
- `src/execution/pi-args.ts`
- minimal child execution helpers from `src/execution/execution.ts`
- minimal parallel helpers from `src/execution/parallel-utils.ts`
- `src/execution/config-validation.ts`, simplified to the new config shape
- `src/execution/superpowers-policy.ts`
- `src/execution/superpowers-packets.ts` if packet files remain useful
- `src/shared/skills.ts`
- `src/shared/types.ts`
- `src/shared/schemas.ts`, narrowed to Superpowers runtime/status tool contracts
- rendering/status components that directly support Superpowers runs
- `agents/sp-*.md`

## Testing

Add or update tests for:

- only `/superpowers` and status commands are registered by default
- configured custom Superpowers commands are registered from config
- invalid custom command names fail closed
- custom command fields are strictly validated
- inline tokens override command profile values
- command profile values override global defaults
- global defaults apply when no preset or inline token is present
- `lean`, `full`, `direct`, `tdd`, `subagents`, `no-subagents`, and `inline` parse correctly
- `defaultImplementerMode` is rejected
- generic `/run`, `/chain`, `/parallel`, and `/agents` behavior is removed from the public command surface
- `/superpowers` prompt bootstraps `using-superpowers`
- `/superpowers` prompt does not require `sp-recon` first
- `useSubagents: true` strongly directs use of the `subagent` tool when selected skills call for delegation
- `useSubagents: false` forbids `subagent` and `subagent_status`
- `sp-*` agent frontmatter model values resolve through configured model tiers
- Superpowers worktree defaults still apply to parallel delegated work
- status/settings TUI displays effective defaults and diagnostics

Delete tests that only protect removed generic behavior.

## Release Notes

The next release should be breaking.

Suggested changelog themes:

- **Breaking: Superpowers-only runtime** — removed generic `/run`, `/chain`, `/parallel`, `/agents`, generic chain files, prompt-template bridge support, and generic agent management.
- **Self-contained identity** — removed fork-oriented product framing and pi-subagents compatibility promises.
- **Custom Superpowers commands** — added config-defined slash command presets for workflow options.
- **Per-run workflow tokens** — added inline controls for TDD and subagent delegation.
- **Focused settings TUI** — replaced generic agent management with Superpowers status and settings.
- **Superpowers worktrees** — preserved worktree isolation for parallel delegated Superpowers work.
- **Skill bootstrap** — `/superpowers` starts from `using-superpowers` instead of a fixed recon-first flow.

## Risks

- The deletion surface is large. The implementation should remove public features first, then prune internals once tests make the new boundary clear.
- Custom command registration may require Pi reloads after config edits.
- Root-session skill bootstrap may still depend on prompt injection if Pi lacks native root skill activation.
- Removing generic commands may surprise existing users, but no backwards compatibility is required for this redesign.
- Keeping too much generic chain/runtime code would undermine the goal. Each retained module needs a concrete Superpowers use case.

## Decisions

Resolved:

- Streamline this repository in place rather than creating a new repository.
- Do not depend on `pi-subagents` or `pi-prompt-template-model`.
- Remove fork identity and backwards-compatibility promises.
- Keep only `/superpowers`, status/settings, and configured custom Superpowers commands as public UX.
- Support both global config and per-run overrides for TDD and subagent delegation.
- Use `/superpowers-status` as the first-pass status/settings command. Do not add `/superpowers status` in the first lean pass.
- Preserve Superpowers worktree isolation for parallel delegated work and keep the existing `superagents.worktrees` config shape.
- Do not support project-local `sp-*` role prompt overrides in the first lean pass.
- Limit custom command presets to workflow booleans and descriptions in the first lean pass. Role agent model choices stay in individual `agents/sp-*.md` frontmatter, not in config.
