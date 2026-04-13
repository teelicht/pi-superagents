# Superpowers Skill Bootstrap And Subagent Config Design

Date: 2026-04-11

## Goal

Make `/superpowers` behave as a thin, future-compatible Superpowers skill bootstrap instead of a fixed `sp-recon` workflow prompt, add `superagents.useSubagents` so users can choose whether skill-guided Superpowers workflows may delegate through the `subagent` tool, and replace the config-facing `defaultImplementerMode` string with `superagents.useTestDrivenDevelopment`.

This release should be versioned as `0.3.0` and documented in `CHANGELOG.md`.

## Current Behavior

`/superpowers` currently parses `tdd` or `direct`, builds a root-session prompt, and sends that prompt through `pi.sendUserMessage(...)`.

The prompt tells the root model to use the `subagent` tool and to start with `sp-recon`. That creates two problems:

- it does not guarantee root-session activation of the actual `using-superpowers` skill
- it imposes a recon-first workflow before the Superpowers skills decide the appropriate workflow

The extension already has strong skill injection for spawned subagents. `runSync` and the async runner resolve configured skills, append skill content to spawned Pi system prompts, and pass skill names to the Pi CLI. The root `/superpowers` session is different: it stays in the existing parent Pi session, so the extension currently only influences it through a generated user message.

## Design Principles

- `/superpowers` must bootstrap Superpowers through `using-superpowers`.
- The extension must avoid encoding a custom Superpowers workflow engine.
- Superpowers skills remain authoritative for workflow selection.
- Subagent delegation should be strongly encouraged when enabled, but selected by the active skills and task shape.
- `sp-recon` is available as a bounded role, not a mandatory first step.
- The default behavior should preserve the product promise that `/superpowers` can use subagents.
- A user can disable subagent delegation while still getting Superpowers skill discipline.

## Configuration

Add two Superpowers config settings:

```json
{
  "superagents": {
    "useSubagents": true,
    "useTestDrivenDevelopment": true
  }
}
```

Default:

- `superagents.useSubagents: true`
- `superagents.useTestDrivenDevelopment: true`

`useSubagents` meaning:

- `true`: `/superpowers` bootstraps `using-superpowers` and strongly directs the root model to use `subagent` whenever the active Superpowers skills call for delegation.
- `false`: `/superpowers` bootstraps `using-superpowers`, but explicitly forbids `subagent` and `subagent_status`; any normally delegated workflow must be adapted inline in the root session.

`useTestDrivenDevelopment` meaning:

- `true`: default Superpowers implementation work should use the TDD path, including `test-driven-development` for bounded implementer roles when that skill is available.
- `false`: default Superpowers implementation work may use the direct implementation path while still requiring verification and review.

The current config setting `superagents.defaultImplementerMode: "tdd" | "direct"` should be replaced by `superagents.useTestDrivenDevelopment: true | false`.

Slash command compatibility:

- `/superpowers tdd <task>` should remain a per-run alias for `useTestDrivenDevelopment: true`.
- `/superpowers direct <task>` should remain a per-run alias for `useTestDrivenDevelopment: false`.
- When no per-run token is provided, the command uses `superagents.useTestDrivenDevelopment`.
- Internal runtime code may keep an adapter during implementation, but public config and prompt metadata should prefer `useTestDrivenDevelopment`.

Validation:

- `superagents.useSubagents` must be a boolean when present.
- `superagents.useTestDrivenDevelopment` must be a boolean when present.
- `superagents.defaultImplementerMode` should no longer be a supported config key for `0.3.0`; when encountered, fail closed with diagnostics that point users to `superagents.useTestDrivenDevelopment`.
- Unknown config keys must still fail closed.
- Empty user override files continue to inherit bundled defaults.

## Root Skill Bootstrap

The `/superpowers` command should treat `using-superpowers` as the required root entrypoint for every Superpowers run.

Preferred runtime behavior:

1. Use a native Pi root-session skill activation mechanism if one is available.
2. If no such API is available, load the current `using-superpowers` skill through the existing skill discovery/resolution code and include its current contents in the generated root prompt.
3. Do not copy static skill text into source code.

The fallback prompt injection should be explicit that the embedded skill content is authoritative for this Superpowers turn. This keeps the command compatible with future skill updates because the extension reads the skill file at runtime.

If `using-superpowers` cannot be resolved:

- `/superpowers` should still send a root prompt that names the missing skill clearly.
- The prompt should tell the model that the bootstrap skill was unavailable and to proceed with best-effort Superpowers behavior.
- The slash result or notification should expose the missing-skill warning when practical.

## Prompt Contract

Remove the current unconditional recon-first wording.

### When `useSubagents` Is `true`

The generated root prompt should use strong delegation wording:

```text
This is a Superpowers session. The `using-superpowers` skill is the workflow bootstrap for this turn.

Before doing substantive work or asking clarifying questions, follow `using-superpowers` exactly and identify every relevant Superpowers skill for the task.

Subagent delegation is ENABLED by config. When a selected Superpowers skill calls for delegated work, you must use the `subagent` tool rather than doing that delegated work inline. This applies especially to implementation-plan execution, independent parallel investigations, bounded implementation, review, focused research, and debugging workflows.

Do not skip subagent delegation merely because you can do the work yourself. Stay inline only for clarification, tiny answer-only tasks, or when the subagent tool is unavailable, blocked by config, or genuinely inappropriate. If you do not use a subagent for a non-trivial workflow step, state the concrete reason.
```

The prompt should also preserve existing run metadata:

- `workflow: "superpowers"`
- `useTestDrivenDevelopment: true | false`
- optional `async: true`
- optional `clarify: false`
- optional `context: "fork"`

### When `useSubagents` Is `false`

The generated root prompt should use local-only wording:

```text
This is a Superpowers session. The `using-superpowers` skill is the workflow bootstrap for this turn.

Before doing substantive work or asking clarifying questions, follow `using-superpowers` exactly and identify every relevant Superpowers skill for the task.

Subagent delegation is DISABLED by config. Do not call `subagent` or `subagent_status`. When a selected Superpowers skill would normally dispatch delegated agents, adapt that workflow inline in the root session and briefly note that delegation is disabled by config.
```

## Dispatching Parallel Agents Compatibility

`dispatching-parallel-agents` should remain a root-session skill.

The current setup supports it conceptually when `/superpowers` is root-owned:

- the root session receives the `/superpowers` prompt
- the root session follows `using-superpowers`
- if multiple independent problem domains exist, the root session may select `dispatching-parallel-agents`
- when `useSubagents` is true, that skill can direct the root session to call the `subagent` tool

The current setup should not pass `dispatching-parallel-agents` into bounded `sp-*` roles:

- bounded roles are intentionally non-orchestrating
- current policy treats `dispatching-parallel-agents` as root-only
- bounded Superpowers roles strip `subagent` and `subagent_status`

The feature must preserve that separation. Parallel dispatch is allowed when the root skill flow chooses it; it is not the default workflow, and it is not a capability of `sp-recon`, `sp-implementer`, `sp-spec-review`, or `sp-code-review`.

## Files To Modify

| File                                  | Purpose                              | Changes Needed                                                                                                                                                                                                        |
| ------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/types.ts`                 | Config and runtime type definitions  | Add `useSubagents?: boolean` and `useTestDrivenDevelopment?: boolean` to `SuperpowersSettings`; replace runtime `implementerMode` metadata with boolean-first metadata where practical.                               |
| `src/execution/config-validation.ts`  | Strict config validation and merging | Add `useSubagents` and `useTestDrivenDevelopment` to supported `superagents` keys; validate boolean values; reject `defaultImplementerMode` with a migration-oriented diagnostic.                                     |
| `default-config.json`                 | Bundled runtime defaults             | Add `"useSubagents": true` and `"useTestDrivenDevelopment": true` under `superagents`; remove `"defaultImplementerMode": "tdd"`.                                                                                      |
| `config.example.json`                 | User-facing config reference         | Add `"useSubagents": true` and `"useTestDrivenDevelopment": true` under `superagents`; remove `"defaultImplementerMode": "tdd"`.                                                                                      |
| `src/slash/slash-commands.ts`         | `/superpowers` prompt generation     | Resolve effective `useSubagents` and `useTestDrivenDevelopment`; load/bootstrap `using-superpowers`; remove recon-first wording; emit enabled/disabled prompt contract; map `tdd` and `direct` tokens to the boolean. |
| `src/execution/subagent-executor.ts`  | Runtime metadata threading           | Accept boolean-first Superpowers TDD metadata and pass it through single, chain, parallel, and async paths.                                                                                                           |
| `src/execution/execution.ts`          | Spawned subagent execution           | Use boolean-first Superpowers TDD metadata when resolving implementer skills.                                                                                                                                         |
| `src/execution/async-execution.ts`    | Async runner setup                   | Persist and pass boolean-first Superpowers TDD metadata into async runner steps.                                                                                                                                      |
| `src/execution/chain-execution.ts`    | Chain execution                      | Use boolean-first Superpowers TDD metadata for sequential and parallel chain steps.                                                                                                                                   |
| `src/execution/subagent-runner.ts`    | Async subprocess runner              | Read boolean-first Superpowers TDD metadata from async configs.                                                                                                                                                       |
| `src/execution/superpowers-policy.ts` | Role policy helpers                  | Replace `SuperpowersImplementerMode` inputs with `useTestDrivenDevelopment: boolean`; keep behavior equivalent for implementer TDD skill injection.                                                                   |
| `src/shared/skills.ts`                | Skill resolution utilities           | Reuse existing resolution where possible; add a small root-bootstrap helper only if needed to resolve one named skill cleanly.                                                                                        |
| `docs/reference/configuration.md`     | Config reference                     | Document `superagents.useSubagents` and `superagents.useTestDrivenDevelopment`; remove `defaultImplementerMode` as supported config.                                                                                  |
| `docs/guides/superpowers.md`          | User guide                           | Explain that `/superpowers` starts with `using-superpowers`, not mandatory `sp-recon`.                                                                                                                                |
| `README.md`                           | Short command docs                   | Adjust `/superpowers` description if it currently implies fixed recon-first behavior.                                                                                                                                 |
| `package.json`                        | Package metadata                     | Bump version from `0.2.0` to `0.3.0`.                                                                                                                                                                                 |
| `package-lock.json`                   | Locked package metadata              | Update lockfile version entries to `0.3.0`.                                                                                                                                                                           |
| `CHANGELOG.md`                        | Release notes                        | Add `0.3.0` entry describing skill bootstrap, `useSubagents`, and removal of fixed recon-first behavior.                                                                                                              |

## Tests

Add or update tests for:

- config validation accepts `superagents.useSubagents: true`
- config validation accepts `superagents.useSubagents: false`
- config validation rejects non-boolean `superagents.useSubagents`
- config validation accepts `superagents.useTestDrivenDevelopment: true`
- config validation accepts `superagents.useTestDrivenDevelopment: false`
- config validation rejects non-boolean `superagents.useTestDrivenDevelopment`
- config validation rejects `superagents.defaultImplementerMode` with a migration-oriented diagnostic
- default and example config templates expose `useSubagents` and `useTestDrivenDevelopment`
- `/superpowers` default prompt includes Superpowers bootstrap wording and delegation-enabled wording
- `/superpowers` with `useSubagents: false` includes delegation-disabled wording
- `/superpowers` no longer says “Start with `sp-recon`”
- `/superpowers tdd` carries `useTestDrivenDevelopment: true`
- `/superpowers direct` carries `useTestDrivenDevelopment: false`
- `/superpowers` without `tdd` or `direct` uses config-derived `useTestDrivenDevelopment`
- `/superpowers` still carries `--bg` and `--fork` metadata
- missing `using-superpowers` produces a clear warning or best-effort prompt path

Existing tests that assert recon-first wording must be replaced with skill-bootstrap assertions.

## Documentation And Release Notes

The `0.3.0` changelog entry should include:

- **Superpowers skill bootstrap** — `/superpowers` now starts from `using-superpowers` instead of a fixed recon-first prompt.
- **Configurable subagent delegation** — new `superagents.useSubagents` setting controls whether Superpowers skill flows may call `subagent`.
- **Boolean TDD config** — new `superagents.useTestDrivenDevelopment` setting replaces `defaultImplementerMode` for the default Superpowers implementation style.
- **Skill-guided orchestration** — root Superpowers skills decide whether to use recon, implementation, review, debugging, or parallel dispatch.
- **Compatibility note** — deterministic harnesses must still execute or script the root `subagent` tool call when they need to assert actual subagent utilization.

The README and guide should avoid promising that every `/superpowers` run starts with `sp-recon`. They should describe `sp-recon` as an available bounded role selected when the active skill flow needs reconnaissance.

Migration notes should tell users to replace:

```json
{
  "superagents": {
    "defaultImplementerMode": "tdd"
  }
}
```

with:

```json
{
  "superagents": {
    "useTestDrivenDevelopment": true
  }
}
```

and to replace `"direct"` with `false`.

## Risk Assessment

- [x] Public config shape changes
- [x] Prompt behavior changes
- [x] Tests and docs need updates
- [ ] Database migrations needed

Primary risks:

- If Pi exposes no root skill activation API, fallback prompt injection is only as reliable as the root model following the prompt.
- Strong delegation wording may cause over-delegation for small tasks. The prompt should preserve explicit exceptions for clarification, tiny answer-only tasks, unavailable tools, and inappropriate delegation.
- Loading skill content into the root prompt may increase prompt size. Only `using-superpowers` should be bootstrapped automatically; other skills should remain selected through the skill workflow.
- Renaming `defaultImplementerMode` to `useTestDrivenDevelopment` changes a public config key. The fail-closed diagnostic must be specific enough that users can migrate without hunting through docs.

## Open Questions

1. Does the installed Pi API expose a root-session skill activation mechanism that can be used instead of prompt injection?
2. Should `/superpowers` expose a per-run override such as `--no-subagents`, or should the first version keep this config-only?
3. Should `/superpowers` keep `tdd` and `direct` as per-run aliases after the config setting becomes boolean?
4. Should missing `using-superpowers` block `/superpowers`, or is best-effort behavior with a visible warning sufficient?

Recommended answers:

- Use a native root skill API if available; otherwise use runtime prompt injection.
- Keep `useSubagents` config-only in this release to avoid expanding slash parsing.
- Keep `tdd` and `direct` slash aliases, but map them to `useTestDrivenDevelopment: true | false`.
- Do not block on missing `using-superpowers`; warn clearly and proceed best-effort.

## Spec Self-Review

- Placeholder scan: no TBD/TODO placeholders remain.
- Consistency check: `useSubagents` and `useTestDrivenDevelopment` are consistently under `superagents`.
- Scope check: this is one focused feature covering config, prompt generation, docs, tests, and version metadata.
- Ambiguity check: `sp-recon` is explicitly optional and skill-selected, not automatic.
