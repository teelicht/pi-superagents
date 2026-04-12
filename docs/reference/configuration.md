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

## Configuration Keys

### `superagents`

Configures the Superpowers workflow and role execution policy.

| Key | Description |
|-----|-------------|
| `modelTiers` | Maps abstract tier names (`cheap`, `balanced`, `max`) to concrete model configs. |
| `worktrees.enabled` | Whether to use git worktree isolation for parallel tasks (bundled default: `false`). When false, Superpowers root prompts and subagent runs must not request worktrees. |
| `worktrees.root` | Directory for Superpowers parallel worktrees (default: system temp). |
| `worktrees.setupHook` | Path to a script to run for each created worktree. |
| `worktrees.setupHookTimeoutMs` | Maximum time to wait for the setup hook (default: 30000ms). |

#### Model Tier Schema

Each tier in `modelTiers` can be a string (model ID) or an object:

```json
{
  "model": "anthropic/claude-3-5-sonnet",
  "thinking": "low"
}
```

**Supported thinking levels:** `off`, `minimal`, `low`, `medium`, `high`, `xhigh`.
