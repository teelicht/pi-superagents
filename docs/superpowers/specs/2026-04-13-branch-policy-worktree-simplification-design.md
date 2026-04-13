# Superpowers Branch Policy And Worktree Simplification Design

Date: 2026-04-13

## Goal

Add a new `superagents.useBranches` workflow policy, simplify Superpowers worktree configuration by removing setup-hook support, and make all command-level workflow presets treat root settings consistently.

This design must preserve the distinction between:

- **session forks**: Pi conversation/context branching
- **git branches**: repository version-control branches
- **git worktrees**: runtime filesystem isolation for parallel execution

These concepts may interact in implementation, but they are not the same feature and must not be documented or modeled as one shared subsystem.

## Decisions

### Accepted product decisions

1. Add `superagents.useBranches?: boolean`.
2. Allow `superagents.commands.<name>.useBranches?: boolean`.
3. Treat `useBranches: true` as a **strong requirement** to use a dedicated git branch for the implementation plan/spec.
4. Keep branch policy **config- and preset-driven only**. Do not add inline slash tokens such as `branches` or `no-branches`.
5. Keep `superagents.worktrees` as a separate nested config object. Do not group branches and worktrees under a common parent config element.
6. Simplify `superagents.worktrees` to only:

   ```json
   {
     "enabled": false,
     "root": null
   }
   ```

7. Remove `superagents.worktrees.setupHook` and `superagents.worktrees.setupHookTimeoutMs`, plus all runtime code and tests that support them.
8. Allow custom Superpowers commands to override the full simplified `worktrees` object.
9. Allow `superagents.usePlannotator` to be overridden per custom command the same way other root workflow booleans are.
10. Preserve the existing meanings of `useSubagents`, `useTestDrivenDevelopment`, and `usePlannotator`; this feature changes config consistency and worktree complexity, not the behavior of those flags.

### Recommended defaults

- `superagents.useBranches: false`
- `superagents.useSubagents: true`
- `superagents.useTestDrivenDevelopment: true`
- `superagents.usePlannotator: false`
- `superagents.worktrees.enabled: false`
- `superagents.worktrees.root: null`

`useBranches` should default to `false` to preserve current behavior and avoid silently imposing a new branch requirement on existing `/superpowers` users.

## Current Behavior

Today, Superpowers supports root-level booleans for:

- `superagents.useSubagents`
- `superagents.useTestDrivenDevelopment`
- `superagents.usePlannotator`

It also supports a nested worktree config:

```json
{
  "superagents": {
    "worktrees": {
      "enabled": false,
      "root": null,
      "setupHook": null,
      "setupHookTimeoutMs": 30000
    }
  }
}
```

Custom command presets currently support only a partial override set. In practice:

- `useSubagents` is overridable per command
- `useTestDrivenDevelopment` is overridable per command
- `usePlannotator` is not currently overridable per command
- `worktrees` is not currently overridable per command as an object
- there is no branch policy flag

This creates an inconsistent config story for custom Superpowers commands and leaves unnecessary complexity in the worktree runtime.

## Non-Goals

- Do not add a Pi-native git branch management API.
- Do not make branch creation a guaranteed runtime-enforced extension feature in this release.
- Do not add inline slash tokens for branch policy.
- Do not collapse branches and worktrees into one config concept.
- Do not add new worktree customization features to replace setup hooks.
- Do not change session-fork semantics.

## Configuration Design

### Root-level Superpowers settings

Add or preserve the following root settings under `superagents`:

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

### Custom command preset settings

Each command preset under `superagents.commands.<name>` may override these settings independently:

```json
{
  "superagents": {
    "commands": {
      "superpowers-branching": {
        "description": "Require a dedicated git branch while keeping parallel worktrees off.",
        "useBranches": true,
        "useSubagents": true,
        "useTestDrivenDevelopment": true,
        "usePlannotator": false,
        "worktrees": {
          "enabled": false,
          "root": null
        }
      }
    }
  }
}
```

### Important config rules

- `useBranches`, `useSubagents`, `useTestDrivenDevelopment`, and `usePlannotator` are independent boolean workflow-policy flags.
- `worktrees` remains an independent nested runtime config object.
- Command presets may override any subset of the above settings.
- Command presets must not introduce a shared `branching`, `executionIsolation`, or similar grouping object.
- `worktrees` overrides merge by object field.
- boolean workflow flags override by direct replacement.
- when a command preset omits a field, the run inherits the root-level `superagents` setting.

### Validation rules

Add validation support for:

- `superagents.useBranches` as an optional boolean
- `superagents.commands.<name>.useBranches` as an optional boolean
- `superagents.commands.<name>.usePlannotator` as an optional boolean
- `superagents.commands.<name>.worktrees` as an optional object
- `superagents.commands.<name>.worktrees.enabled` as an optional boolean
- `superagents.commands.<name>.worktrees.root` as an optional string or `null`

Remove validation support for:

- `superagents.worktrees.setupHook`
- `superagents.worktrees.setupHookTimeoutMs`

Any appearance of removed worktree hook keys should become a blocking config diagnostic with explicit migration guidance that those options no longer exist.

## Workflow Semantics

### Branch policy

`useBranches` is a Superpowers workflow policy, not a Pi runtime integration point.

When `useBranches` is `true`:

- the root workflow should require a dedicated git branch for the implementation plan/spec before implementation begins
- the workflow should prefer **one git branch per plan/spec**, not one branch per prompt or subtask
- prompts must explicitly distinguish git branches from Pi session forks
- downstream skill guidance may refer to branch discipline, but should not imply that every delegated role or follow-up prompt creates a new branch
- if the branch requirement cannot be satisfied, the workflow should say so explicitly and adapt rather than pretending success

When `useBranches` is `false`:

- Superpowers should not impose branch-specific guidance beyond whatever the repo or user already does manually

### Worktree policy

`worktrees` remains a runtime isolation feature for parallel execution.

When `worktrees.enabled` is `true`:

- parallel Superpowers runs may use git worktree isolation
- worktrees may still rely on temporary git branches internally for implementation reasons
- that internal behavior must not be documented as equivalent to `useBranches`

When `worktrees.enabled` is `false`:

- Superpowers must not request or create worktree isolation for the run

`worktrees.root` continues to control the directory where temporary worktrees are created when worktree isolation is enabled.

### Plannotator policy

`usePlannotator` remains the flag that enables the Plannotator review bridge at the normal plan-approval point.

This release extends that flag so a custom command may set it differently from the global default, for example:

- a normal `/superpowers` run with text-based approval
- a `/superpowers-reviewed` command that always enables Plannotator review

## Prompt Contract

The Superpowers root prompt should carry resolved run metadata for:

- `useBranches`
- `useSubagents`
- `useTestDrivenDevelopment`
- `usePlannotator`
- `worktrees.enabled`
- `worktrees.root` when configured
- `context: "fork"` when requested

### Branching prompt guidance

When `useBranches` is `true`, the root prompt should say the equivalent of:

```text
Branch policy is ENABLED by config.
Use a dedicated git branch for this implementation plan/spec before implementation work begins.
Treat git branches and Pi session forks as separate concepts.
Do not create a new git branch for every delegated subtask or follow-up prompt unless the active workflow explicitly requires it.
If branch creation or switching is not possible, say so clearly and adapt the workflow without pretending the branch requirement was satisfied.
```

When `useBranches` is `false`, the prompt may either omit branch guidance or include one concise line stating that branch policy is disabled by config.

### Worktree prompt guidance

When worktrees are enabled, the prompt should describe worktree isolation only as parallel filesystem isolation.
It must not imply that enabling worktrees also enables the branch-policy requirement.

When worktrees are disabled, the prompt should continue to treat that as an explicit user instruction that overrides any workflow asking for worktrees.

### Plannotator prompt guidance

`usePlannotator` should follow the same prompt-generation pattern it uses today, but based on the resolved per-run value after command-preset merging.

## Runtime Resolution Design

### Workflow profile resolution

Extend the resolved Superpowers run profile so it carries:

- `useBranches: boolean`
- `useSubagents: boolean`
- `useTestDrivenDevelopment: boolean`
- `usePlannotatorReview: boolean`
- `worktrees: { enabled: boolean; root: string | null }`
- `fork: boolean`

This is preferable to carrying only `worktreesEnabled: boolean`, because command presets now need to override the full simplified worktree object and root-prompt generation should be able to describe the resolved root path when present.

### Worktree runtime options

Simplify runtime worktree option resolution so it only maps:

- `worktrees.enabled`
- `worktrees.root`

Remove all setup-hook-related runtime plumbing, including:

- setup-hook option types
- hook path resolution
- hook subprocess execution
- hook timeout handling
- synthetic-path hook response handling
- tests that exist only to verify setup-hook behavior

The remaining worktree runtime should still:

- create isolated worktrees when enabled
- enforce existing repo-safety checks
- capture diffs
- clean up temporary worktrees and temporary branches

## Files To Modify

| File | Purpose | Changes Needed |
| ---- | ------- | -------------- |
| `src/shared/types.ts` | Config and workflow typing | Add `useBranches?: boolean` and `usePlannotator?: boolean` to `SuperpowersCommandPreset`; add `useBranches?: boolean` to `SuperpowersSettings`; add a command-preset worktree object type; simplify `SuperpowersWorktreeSettings` to `enabled` and `root` only; extend resolved workflow profile typing accordingly. |
| `src/execution/config-validation.ts` | Strict config validation | Accept `superagents.useBranches`; accept command-level `useBranches`, `usePlannotator`, and `worktrees`; remove support for worktree hook keys; emit migration diagnostics for removed hook keys. |
| `default-config.json` | Bundled defaults | Add `useBranches: false`; remove `setupHook` and `setupHookTimeoutMs` from `worktrees`. |
| `config.example.json` | User-facing config example | Add `useBranches: false`; remove hook keys; add at least one example custom command showing independent overrides for branch policy, Plannotator, and worktrees. |
| `src/superpowers/workflow-profile.ts` | Run-profile resolution | Merge root settings plus command-preset overrides for `useBranches`, `useSubagents`, `useTestDrivenDevelopment`, `usePlannotator`, and full `worktrees` object. |
| `src/superpowers/root-prompt.ts` | Root prompt generation | Include resolved branch metadata and branching contract; describe worktrees separately; include per-run Plannotator resolution. |
| `src/execution/superagents-config.ts` | Config helpers | Resolve simplified worktree runtime options; remove setup-hook logic; expose helpers needed by profile/prompt/runtime callers. |
| `src/execution/worktree.ts` | Worktree runtime | Remove setup-hook support and any code reachable only from that feature; keep root-directory support and existing clean-up behavior. |
| `docs/reference/configuration.md` | Config reference | Document `useBranches`; document command-level `usePlannotator`; document simplified `worktrees` object; remove setup-hook documentation. |
| `docs/guides/superpowers.md` | User guide | Explain branch policy versus worktree isolation as distinct concepts; document per-command overrides. |
| `docs/reference/worktrees.md` | Worktree reference | Remove setup-hook section and timeout discussion; retain `enabled` and `root` behavior only. |
| `README.md` | Top-level docs | Update any examples or wording that assume Plannotator is global-only or that over-describe worktree setup features. |
| `test/unit/config-validation.test.ts` | Validation tests | Add coverage for `useBranches`, command-level `usePlannotator`, command-level `worktrees`, and removed hook-key diagnostics. |
| `test/unit/default-config.test.ts` | Default config tests | Assert `useBranches: false` is present and hook keys are absent. |
| `test/unit/superpowers-config.test.ts` | Config helper tests | Cover simplified worktree runtime option resolution. |
| `test/unit/superpowers-workflow-profile.test.ts` | Workflow-profile tests | Cover root plus command-preset resolution for `useBranches`, `usePlannotator`, and merged worktree objects. |
| `test/unit/superpowers-root-prompt.test.ts` | Prompt tests | Assert branch guidance appears only when enabled, worktrees are described separately, and per-command Plannotator resolution is reflected. |
| `test/unit/worktree.test.ts` | Worktree tests | Remove setup-hook-specific tests and keep coverage for enabled/root behavior and cleanup semantics. |

## Testing

Add or update tests for:

### Config validation

- accepts `superagents.useBranches: true`
- accepts `superagents.useBranches: false`
- rejects non-boolean `superagents.useBranches`
- accepts `superagents.commands.<name>.useBranches: true|false`
- rejects non-boolean `superagents.commands.<name>.useBranches`
- accepts `superagents.commands.<name>.usePlannotator: true|false`
- rejects non-boolean `superagents.commands.<name>.usePlannotator`
- accepts `superagents.commands.<name>.worktrees.enabled: true|false`
- accepts `superagents.commands.<name>.worktrees.root: string|null`
- rejects unsupported keys under command-level `worktrees`
- rejects `superagents.worktrees.setupHook`
- rejects `superagents.worktrees.setupHookTimeoutMs`

### Workflow-profile resolution

- root config default for `useBranches` resolves to `false`
- command preset may enable `useBranches` when root config disables it
- command preset may override `usePlannotator`
- command preset may override `worktrees.enabled`
- command preset may override `worktrees.root`
- omitted command fields inherit root config values
- inline tokens continue to affect only the existing tokenized policies (`useSubagents`, `useTestDrivenDevelopment`) and do not affect `useBranches`

### Prompt generation

- branch-policy prompt text appears when `useBranches` is true
- branch-policy prompt text does not imply worktrees
- worktree prompt text does not imply branch policy
- resolved Plannotator prompt contract respects command-level overrides
- metadata includes resolved worktree root when configured

### Worktree runtime

- simplified worktree runtime still honors configured root directory
- setup-hook support no longer exists in runtime option resolution
- setup-hook-specific tests and fixtures are removed

## Migration Notes

### New branch policy

Users may opt into branch discipline with:

```json
{
  "superagents": {
    "useBranches": true
  }
}
```

### Removed worktree hook settings

Users must delete configurations like:

```json
{
  "superagents": {
    "worktrees": {
      "setupHook": "./scripts/setup-worktree.mjs",
      "setupHookTimeoutMs": 30000
    }
  }
}
```

There is no replacement in this release. The feature is intentionally removed to simplify the worktree subsystem.

### New command-level Plannotator override

Users may now write command presets such as:

```json
{
  "superagents": {
    "usePlannotator": false,
    "commands": {
      "superpowers-reviewed": {
        "usePlannotator": true
      }
    }
  }
}
```

## Risk Assessment

- [x] Public config shape changes
- [x] Documentation changes required
- [x] Test updates required
- [x] Runtime behavior changes in worktree setup path
- [ ] Database migrations needed

Primary risks:

- removing worktree setup hooks may break advanced local workflows that depended on pre-agent worktree bootstrapping
- adding `useBranches` prompt guidance without runtime enforcement means the workflow depends on prompt discipline rather than guaranteed extension-side branch automation
- per-command override logic becomes broader and must be tested carefully so inheritance and replacement rules stay predictable
- simplifying worktree profile resolution from boolean-only to object-based resolution may touch several code paths that currently assume a single `worktreesEnabled` flag

## Recommendation

Implement this as one focused config-and-runtime simplification release.

The value of the change is not just the new branch policy flag. It is the combined cleanup:

- branch policy becomes a first-class Superpowers workflow control
- worktree configuration becomes smaller and easier to understand
- Plannotator gains the same command-preset flexibility as the other workflow controls
- docs can clearly separate branch policy, session forks, and worktree isolation

## Spec Self-Review

- Placeholder scan: no TBD or TODO markers remain.
- Internal consistency: branch policy, worktrees, session forks, and Plannotator are described as separate concerns throughout.
- Scope check: this remains one focused config, prompt, runtime, docs, and test change set.
- Ambiguity check: `useBranches` is explicitly config/preset-driven, defaults to `false`, and is a strong workflow requirement rather than a promised runtime automation feature.
