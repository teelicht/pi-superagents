# Configuration Reference

`pi-superagents` reads user overrides from:

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

Runtime config precedence:

1. Bundled [default-config.json](../../default-config.json) always loads first.
2. User `config.json` overrides bundled defaults.
3. Empty `{}` means "use all bundled defaults."

`default-config.json` and `config.example.json` are package-owned files and may be refreshed during updates. Do not edit them for local overrides.

## Validation And Repair

`pi-superagents` fails closed when `config.json` cannot be trusted. If the file has invalid JSON, unknown keys, wrong value types, invalid enum values, or unsupported stale settings, subagent execution is disabled until the file is fixed.

When Pi starts, the extension shows a notification with the config path and exact diagnostics. You can also inspect diagnostics with:

```json
{
  "action": "config"
}
```

using the `subagent_status` tool.

If diagnostics say your config duplicates the bundled defaults, apply the safe empty-override migration:

```bash
npx @teelicht/pi-superagents --migrate-config
```

or call `subagent_status` with:

```json
{
  "action": "migrate-config"
}
```

Both migration paths write a timestamped backup before replacing `config.json` with `{}`.

Common repairs:

- Remove misspelled or unknown keys.
- Compare your file with `config.example.json`.
- Delete a key to fall back to the bundled default.
- Keep `config.json` as a small override file instead of copying the full example.

## Common Override Examples

Enable background execution by default:

```json
{
  "asyncByDefault": true
}
```

Set a default session directory:

```json
{
  "defaultSessionDir": "~/.pi/agent/sessions/subagent/"
}
```

Disable Superpowers worktree defaults:

```json
{
  "superagents": {
    "worktrees": {
      "enabled": false
    }
  }
}
```

Override one model tier while inheriting the rest:

```json
{
  "superagents": {
    "modelTiers": {
      "max": {
        "model": "openai/gpt-5.4",
        "thinking": "high"
      }
    }
  }
}
```

Add a custom model tier:

```json
{
  "superagents": {
    "modelTiers": {
      "free": {
        "model": "google/gemini-flash"
      }
    }
  }
}
```

## Config Keys

### `defaultSessionDir`

Sets the fallback directory for session logs:

```json
{
  "defaultSessionDir": "~/.pi/agent/sessions/subagent/"
}
```

Session root resolution precedence:
1. `params.sessionDir` from the `subagent` tool call
2. `config.defaultSessionDir`
3. Derived from parent session

Sessions are always enabled — every subagent run gets a session directory.

### `maxSubagentDepth`

Default recursion limit for nested delegation. Per-agent `maxSubagentDepth` can tighten further but cannot relax an inherited stricter limit.

```json
{
  "maxSubagentDepth": 1
}
```

Can also be set via `PI_SUBAGENT_MAX_DEPTH` environment variable before starting pi. Internal `PI_SUBAGENT_DEPTH` is propagated automatically — don't set it manually.

### `asyncByDefault`

Runs subagents in the background by default. When `true`, all `/run`, `/chain`, and `/parallel` commands run asynchronously unless `--bg` or explicit `async: false` overrides.

```json
{
  "asyncByDefault": true
}
```

### `superagents`

Configures the `/superpowers` command path without changing default `/run`, `/chain`, `/parallel` behavior.

```json
{
  "superagents": {
    "defaultImplementerMode": "tdd",
    "worktrees": {
      "enabled": true,
      "root": null,
      "setupHook": "./scripts/setup-worktree.mjs",
      "setupHookTimeoutMs": 45000
    },
    "modelTiers": {
      "cheap": {
        "model": "openai/gpt-5.3-mini",
        "thinking": "off"
      },
      "balanced": {
        "model": "openai/gpt-5.4",
        "thinking": "medium"
      },
      "max": {
        "model": "anthropic/claude-opus-4-6",
        "thinking": "high"
      }
    }
  }
}
```

**Supported keys:**

| Key | Description |
|-----|-------------|
| `defaultImplementerMode` | `tdd` (default) or `direct` |
| `worktrees.enabled` | Default Superpowers parallel to worktree isolation |
| `worktrees.root` | Directory for Superpowers parallel worktrees |
| `worktrees.setupHook` | Per-worktree setup hook (see [Worktree Reference](worktrees.md)) |
| `worktrees.setupHookTimeoutMs` | Hook timeout in ms (default: 30000) |
| `modelTiers` | Maps tier names to model+thinking configs |

#### Custom Model Tiers

Define your own tier names beyond the built-in `cheap`, `balanced`, and `max`:

```json
{
  "superagents": {
    "modelTiers": {
      "cheap": { "model": "openai/gpt-5.3-mini" },
      "balanced": { "model": "openai/gpt-5.4" },
      "max": { "model": "anthropic/claude-opus-4-6" },
      "creative": {
        "model": "anthropic/claude-sonnet-4",
        "thinking": "high"
      },
      "free": {
        "model": "google/gemini-flash"
      }
    }
  }
}
```

Then use in agent frontmatter:

```yaml
---
name: writer
model: creative
description: Creative writing assistant
---
```

Tier resolution works in all workflows (`/run`, `/chain`, `/parallel`, `/superpowers`).