# Config-Driven Skill Entry Architecture Design

Date: 2026-04-13

## Goal

Revise the proposed middleware architecture so Superpowers workflow policy applies to selected root skills without relying on brittle "active skill" inference.

The design must let users:

- steer Superpowers behavior through config and command profiles, including TDD, subagents, branches, worktrees, Plannotator, and model policy
- add non-Superpowers domain skills, such as `react-native-best-practices`, to Superpowers root skill flows like `brainstorming` and `writing-plans`
- use a Plannotator browser gateway for `brainstorming` after the saved spec is written
- keep plain Pi skill invocation available unless the user explicitly opts a skill into interception

## Current State

`/superpowers` is currently the authoritative Superpowers entrypoint. It resolves command/profile settings, builds a root prompt through `src/superpowers/root-prompt.ts`, and bootstraps the root session through the installed `using-superpowers` skill.

That path works for explicit `/superpowers` runs, but it does not help when a user directly invokes a skill such as:

```text
/skill:brainstorming design the middleware flow
```

Direct Pi skill invocation bypasses the `pi-superagents` root profile, so Superpowers config cannot influence TDD policy, delegation policy, worktree policy, branch policy, skill overlays, or Plannotator review gates.

The first draft proposed a pervasive session middleware that watches `session_start` and "message" events, detects the active skill, and injects behavior. That shape is not correct enough for implementation:

- `session_start` fires before a user invokes a skill.
- Pi exposes `input`, `before_agent_start`, `context`, tool, turn, and message lifecycle hooks, but not a reliable generic pre-LLM `message` hook with active-skill state.
- After Pi expands a skill into prompt text, there is no clean runtime field that says "the active skill is brainstorming."
- Model and tool changes can persist beyond one turn unless the extension scopes them deliberately.

## Decision

Use a **hybrid explicit command plus opt-in skill interception** architecture.

The canonical Superpowers controller remains explicit and profile-driven. New entry adapters feed selected root skills into that controller:

1. Add an explicit `/sp-brainstorm <task>` command.
2. Add opt-in interception for direct Pi skill commands such as `/skill:brainstorming <task>`.
3. Use Pi's `input` hook only for pre-expansion skill command interception.
4. Use `before_agent_start` or root prompt construction for hidden Superpowers profile context.
5. Do not infer an "active skill" from later session messages.

This preserves the predictable `/superpowers` path, gives users a clear command for Superpowers-backed brainstorming, and allows direct skill users to opt into the same behavior.

## Non-Goals

This design does not:

- make every Pi skill invocation pass through Superpowers by default
- replace native Pi skill loading globally
- infer active skills from assistant messages or expanded prompt text
- turn `/superpowers` into a thin macro that only triggers a skill
- add Plannotator `annotate` or `code-review` actions
- change `sp-*` role-agent frontmatter into a user preference system
- implement a generic model-switching middleware for every skill

## Architecture

The runtime should be organized around three small concepts.

### Workflow Profile

The workflow profile is the resolved Superpowers run contract. It combines:

- global `superagents` defaults
- configured custom command presets
- inline workflow tokens where supported
- entry-skill metadata for skill-specific flows
- skill overlays for the selected root skill
- Plannotator gate policy
- branch, worktree, subagent, and TDD policy

`/superpowers`, `/sp-brainstorm`, and intercepted `/skill:brainstorming` invocations should all resolve into this same profile type.

### Skill Entry Adapters

Skill entry adapters are thin input layers that start a Superpowers root flow for a selected root skill.

The first adapters are:

- `/sp-brainstorm <task>` for explicit brainstorming
- opt-in `/skill:brainstorming <task>` interception through Pi's `input` event

Both adapters should produce the same root-session prompt. The only difference is source metadata, which is useful for diagnostics and tests.

### Root Prompt Contract

The root prompt remains the place where the model receives the complete Superpowers contract.

For skill-entry flows, it must include:

- the resolved profile metadata
- the installed `using-superpowers` skill contents
- the selected entry skill name, path, and contents
- any resolved overlay skill names, paths, and contents
- the delegation, TDD, branch, worktree, and Plannotator contracts
- the user's original task

The prompt should say that the selected entry skill is the starting Superpowers skill for this run. It must not hardcode a recon-first workflow.

## Configuration Design

Keep workflow policy and skill composition separate.

### Workflow Policy

The existing Superpowers root policy remains under `superagents`:

```json
{
  "superagents": {
    "useBranches": false,
    "useSubagents": true,
    "useTestDrivenDevelopment": true,
    "usePlannotator": false,
    "worktrees": {
      "enabled": false,
      "root": null
    }
  }
}
```

`useBranches`, `useSubagents`, `useTestDrivenDevelopment`, `usePlannotator`, and `worktrees` remain independent workflow policies.

### Skill Overlays

Add a central `skillOverlays` map:

```json
{
  "superagents": {
    "skillOverlays": {
      "brainstorming": ["react-native-best-practices"],
      "writing-plans": ["react-native-best-practices"]
    }
  }
}
```

Skill overlays are additive. They do not replace the entry skill or `using-superpowers`.

Central config is the right place for overlays because they express user or project workflow preferences:

- "When brainstorming React Native work, also load React Native guidance."
- "When writing plans for database work, also load Postgres guidance."

Role-agent files remain the right place for role defaults:

- role identity
- model tier
- tool allowlist
- non-orchestrating role behavior
- role-specific built-in skills if needed

### Skill Command Interception

Add an opt-in list:

```json
{
  "superagents": {
    "interceptSkillCommands": ["brainstorming"]
  }
}
```

Only listed skill commands are intercepted. All other `/skill:<name>` invocations remain native Pi behavior.

The initial supported interception target is `brainstorming`. The config shape may allow any discovered skill name, but the implementation should reject unsupported entry skills unless it has an explicit adapter contract for them.

## Command Design

### `/sp-brainstorm`

Register:

```text
/sp-brainstorm <task>
```

Behavior:

1. Validate config.
2. Resolve the normal Superpowers profile.
3. Set `entrySkill` to `brainstorming`.
4. Resolve `using-superpowers`, `brainstorming`, and `skillOverlays.brainstorming`.
5. Build and send the Superpowers root prompt.
6. Apply the brainstorming saved-spec Plannotator contract when enabled.

This command should be the recommended user-facing entrypoint for Superpowers-backed brainstorming.

### `/superpowers`

Keep `/superpowers` as the general Superpowers controller.

Do not reduce it to a macro. It still owns workflow-profile resolution, prompt construction, skill bootstrap, and config contracts.

### Direct Skill Interception

When `interceptSkillCommands` includes `brainstorming`, the extension should handle raw input like:

```text
/skill:brainstorming design the middleware flow
```

Pi's `input` event fires before native skill command expansion. The handler should:

1. Parse the raw input.
2. Detect `/skill:brainstorming` only when configured.
3. Build the same profile and prompt used by `/sp-brainstorm`.
4. Mark the input handled so native skill expansion does not also run.

If parsing fails, config is invalid, the skill is unsupported, or the command is not opted in, the input should be left alone so Pi handles it normally.

## Plannotator Design

Use Plannotator as a gateway after the saved brainstorming spec is written.

When `/sp-brainstorm` or intercepted `/skill:brainstorming` runs with `usePlannotator` enabled:

1. The root agent follows the normal `brainstorming` workflow in chat.
2. The agent asks clarifying questions, proposes approaches, and presents design sections normally.
3. After user approval, the agent writes the spec file.
4. Before transitioning to `writing-plans`, the agent calls a Superpowers Plannotator spec-review tool with the saved spec content and path.
5. If Plannotator approves, the workflow may proceed to `writing-plans`.
6. If Plannotator rejects, the feedback is treated as spec-review feedback. The agent revises the spec, saves it, and resubmits.
7. If Plannotator is unavailable, the workflow falls back to the normal text-based review gate with a concise warning.

This is separate from the existing implementation-plan review bridge. The two gates are:

- **brainstorming spec review:** after saved spec, before `writing-plans`
- **implementation plan review:** after saved plan, before implementation

The Plannotator contract must not ask for browser review of each brainstorming design section. That would add too much friction and conflict with the skill's conversational flow.

## Model Policy

Child role model tiering should stay in role-agent frontmatter plus `superagents.modelTiers`.

For root skill-entry flows, root model policy may be added later as an optional profile field, but it must be scoped carefully. If the extension changes the active root model through `pi.setModel()`, it must avoid accidentally leaving the session on an unintended model after a one-off skill flow.

This spec does not require root model switching in the first implementation.

## Module Design

Prefer focused modules over a large middleware object.

| File | Responsibility |
| ---- | -------------- |
| `src/shared/types.ts` | Add typed config fields for `skillOverlays` and `interceptSkillCommands`; extend the resolved profile with entry-skill metadata. |
| `src/execution/config-validation.ts` | Strictly validate overlay maps and interception lists; reject unknown keys and unsupported entry-skill targets. |
| `src/shared/skills.ts` | Reuse existing skill discovery and resolution for entry skills and overlays. |
| `src/superpowers/workflow-profile.ts` | Resolve entry skill, source metadata, workflow policy, and overlay names into a profile. |
| `src/superpowers/root-prompt.ts` | Render entry-skill contents, overlay skill contents, and the brainstorming Plannotator saved-spec contract. |
| `src/superpowers/skill-entry.ts` | Parse `/skill:<name>` input and build wrapped Superpowers prompts for supported intercepted skills. |
| `src/slash/slash-commands.ts` | Register `/sp-brainstorm` and dispatch it through the shared skill-entry prompt path. |
| `src/extension/index.ts` | Register the `input` hook and Plannotator review tool while keeping lifecycle state management thin. |

## Error Handling

Config validation should fail closed for:

- `skillOverlays` that is not an object
- overlay values that are not string arrays
- overlay skill names that are empty strings
- intercepted skill entries that are empty strings
- unsupported interception target skills
- unknown config keys

Skill resolution should fail the Superpowers-wrapped entry flow clearly when:

- `using-superpowers` cannot be resolved
- the entry skill cannot be resolved
- a configured overlay skill cannot be resolved

For direct skill interception, unsupported or non-opted-in skill commands should not error. They should pass through to native Pi behavior.

Plannotator failures should fail softly and fall back to text-based approval.

## Testing

Add or update tests for:

- `/sp-brainstorm` registers and sends a Superpowers prompt with `entrySkill: brainstorming`
- `/sp-brainstorm` applies global Superpowers policy
- `/sp-brainstorm` applies `skillOverlays.brainstorming`
- opted-in `/skill:brainstorming <task>` is intercepted before native expansion
- non-opted-in `/skill:brainstorming <task>` is left alone
- unrelated `/skill:<name>` invocations are left alone
- invalid overlay config fails closed
- unknown overlay skill names fail closed
- unsupported interception targets fail closed
- root prompt includes entry skill content and overlay skill content
- root prompt does not hardcode a recon-first workflow
- root prompt includes brainstorming saved-spec Plannotator instructions only for the brainstorming entry flow when enabled
- root prompt does not request Plannotator review for every brainstorming design section
- existing `/superpowers` behavior remains intact
- existing implementation-plan Plannotator review behavior remains intact

## Migration Plan

1. Replace the old `skillHooks` concept with `skillOverlays` and `interceptSkillCommands`.
2. Keep existing Superpowers command/profile behavior unchanged.
3. Add `/sp-brainstorm` as the first skill-entry adapter.
4. Add opt-in `/skill:brainstorming` interception after `/sp-brainstorm` is covered by tests.
5. Add the brainstorming saved-spec Plannotator contract.
6. Document that direct skill interception is opt-in and limited to supported entry skills.

## Risks

- Direct input interception depends on Pi's pre-expansion `input` event semantics. Tests should mock the event contract and documentation should state this dependency clearly.
- If interception silently handles too much, users may lose native Pi skill behavior. Keeping interception opt-in reduces this risk.
- Overlay skill guidance can conflict with root workflow skills. User instructions still win, and overlays must be additive rather than replacements.
- Plannotator review after the saved spec depends on the model following the prompt contract. A future implementation can strengthen this by adding a dedicated tool call contract and tests around prompt wording.
- Root model switching is tempting but can leak across turns. This spec intentionally leaves root model switching out of the first implementation.

## Decisions

Resolved:

- Use the hybrid explicit command plus opt-in skill interception architecture.
- Add `/sp-brainstorm` as the first explicit skill-entry command.
- Support opt-in direct `/skill:brainstorming` interception through Pi's `input` event.
- Keep `/superpowers` as the canonical controller, not a thin macro.
- Put extra domain skills in central `skillOverlays` config.
- Keep role-agent files for role defaults rather than user-level skill composition.
- Use Plannotator after the saved brainstorming spec is written, before `writing-plans`.
- Do not add broad Plannotator `annotate` or `code-review` actions in this pass.
- Do not require root model switching in the first implementation.

Open for future specs:

- Add `/sp-plan` or a `writing-plans` skill-entry adapter.
- Add root model profile policy with safe turn scoping.
- Add richer overlay objects with append/disable semantics if simple arrays are not enough.

## Self-Review

- Placeholder scan: no TBD or placeholder sections remain.
- Internal consistency: command adapters, config, Plannotator gates, and role-agent boundaries are described as separate concerns.
- Scope check: this spec covers one coherent feature: Superpowers-backed root skill entry for brainstorming, with central overlays and opt-in interception.
- Ambiguity check: direct skill interception is explicitly opt-in, limited to supported entry skills, and implemented through Pi's pre-expansion `input` event rather than active-skill inference.
