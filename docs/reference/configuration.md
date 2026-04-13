# Configuration Reference

`@teelicht/pi-superagents` reads user overrides from:

```text
~/.pi/agent/extensions/subagent/config.json
```

This file is user-owned and should usually contain only the settings you want to change. A fresh install creates it as:

```json
{}
```

Full parseable examples are available in:

```text
~/.pi/agent/extensions/subagent/config.example.json
```

## Validation And Repair

`pi-superagents` fails closed when `config.json` cannot be trusted. If the file has invalid JSON, unknown keys, or wrong value types, subagent execution is disabled until the file is fixed.

When Pi starts, the extension shows a notification with the config path and exact diagnostics. You can also inspect diagnostics with:

```json
{
  "action": "config"
}
```

using the `subagent_status` tool.

## Common Override Examples

Override one model tier while inheriting the rest:

```json
{
  "superagents": {
    "modelTiers": {
      "max": {
        "model": "anthropic/claude-3-5-sonnet",
        "thinking": "medium"
      }
    }
  }
}
```

Disable automatic worktree creation for parallel tasks:

```json
{
  "superagents": {
    "worktrees": {
      "enabled": false
    }
  }
}
```

Enable the optional Plannotator browser review flow at the plan approval point:

```json
{
  "superagents": {
    "usePlannotator": true
  }
}
```

## Configuration Keys

### `superagents`

Configures the Superpowers workflow and role execution policy.

| Key | Description |
|-----|-------------|
| `modelTiers` | Maps abstract tier names (`cheap`, `balanced`, `max`) to concrete model configs. |
| `worktrees.enabled` | Whether to use git worktree isolation for parallel tasks (bundled default: `false`). When false, Superpowers root prompts and subagent runs must not request worktrees. |
| `worktrees.root` | Directory for Superpowers parallel worktrees (default: system temp). |
| `usePlannotator` | Open the optional Plannotator browser review UI at the Superpowers plan approval point and wait for approval/rejection (default: `false`). |
| `skillOverlays` | Maps entry skill names to arrays of additional skill names to load with them (default: `{}`). |
| `interceptSkillCommands` | List of skill names that should be intercepted and handled by Superpowers (default: `[]`). Only `brainstorming` is currently supported. |

When `usePlannotator` is `true`:

- Install Plannotator separately:

  ```bash
  pi install npm:@plannotator/pi-extension
  ```

- `pi-superagents` uses only Plannotator's shared event API.
- Do not enable Plannotator's native `/plannotator` planning mode for the same Superpowers workflow.

#### Model Tier Schema

Each tier in `modelTiers` can be a string (model ID) or an object:

```json
{
  "model": "anthropic/claude-3-5-sonnet",
  "thinking": "low"
}
```

**Supported thinking levels:** `off`, `minimal`, `low`, `medium`, `high`, `xhigh`.

### Skill Overlays

Map entry skills to additional skills that should be loaded together. Useful for loading domain-specific knowledge alongside a brainstorming session.

```json
{
  "superagents": {
    "skillOverlays": {
      "brainstorming": ["react-native-best-practices"],
      "writing-plans": ["supabase-postgres-best-practices"]
    }
  }
}
```

Keys must be non-empty skill names. Values must be arrays of non-empty skill names. Missing overlay skills are blocking errors at runtime.

### Direct Skill Interception

By default, Pi skill commands like `/skill:brainstorming` run through Pi's native skill expansion. You can opt in to intercept specific skill commands and route them through the Superpowers workflow instead.

```json
{
  "superagents": {
    "interceptSkillCommands": ["brainstorming"]
  }
}
```

Currently only `brainstorming` is supported. When enabled:

- `/skill:brainstorming <task>` is handled by Superpowers with the same profile and Plannotator integration as `/sp-brainstorm`.
- Skill commands not in the list continue through native Pi behavior.
- Extension-injected messages are not re-intercepted.

Combine with `skillOverlays` to enrich the intercepted skill with additional context:

```json
{
  "superagents": {
    "interceptSkillCommands": ["brainstorming"],
    "skillOverlays": {
      "brainstorming": ["react-native-best-practices"]
    }
  }
}
```
