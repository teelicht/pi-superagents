# Agents Reference

Complete reference for agent frontmatter fields, extension sandboxing, and MCP tool integration.

## Frontmatter Schema

```yaml
---
name: scout
description: Fast codebase recon
tools: read, grep, find, ls, bash, mcp:chrome-devtools # mcp: requires pi-mcp-adapter
extensions: # absent=all, empty=none, csv=allowlist
model: claude-haiku-4-5
thinking: high # off, minimal, low, medium, high, xhigh
skill: safe-bash, chrome-devtools # comma-separated skills to inject
output: context.md # writes to {chain_dir}/context.md
defaultReads: context.md # comma-separated files to read
defaultProgress: true # maintain progress.md
interactive: true # (parsed but not enforced in v1)
maxSubagentDepth: 1 # tighten nested delegation for this agent's children
---
Your system prompt goes here (the markdown body after frontmatter).
```

### Field Details

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Agent identifier (used in `/run`, `/chain`, `/parallel`) |
| `description` | string | Short description shown in listings |
| `tools` | string | Comma-separated tool list (builtins + optional `mcp:` entries) |
| `extensions` | string | Extension sandboxing (see below) |
| `model` | string | Default model (can use model tier names like `cheap`, `balanced`, `max`) |
| `thinking` | string | Extended thinking level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh` |
| `skill` | string | Comma-separated skills to inject |
| `output` | string | Output filename (relative to chain dir) |
| `defaultReads` | string | Comma-separated files to read before executing |
| `defaultProgress` | boolean | Whether to maintain `progress.md` |
| `interactive` | boolean | Parsed but not enforced in v1 |
| `maxSubagentDepth` | number | Tighten nested delegation limit for this agent's children |

The `thinking` field sets a default extended thinking level. At runtime it's appended as a `:level` suffix to the model string (e.g., `claude-sonnet-4-5:high`). If the model already has a thinking suffix, the agent's default is not double-applied.

## Extension Sandboxing

Use `extensions` in frontmatter to control which extensions a subagent can access:

```yaml
# Field absent: all extensions load (default behavior)

# Empty field: no extensions
extensions:

# Allowlist specific extensions
extensions: /abs/path/to/ext-a.ts, /abs/path/to/ext-b.ts
```

Semantics:
- `extensions` absent → all extensions load
- `extensions:` empty → `--no-extensions`
- `extensions: a,b` → `--no-extensions --extension a --extension b`

When `extensions` is present, it takes precedence over extension paths implied by `tools` entries.

## MCP Tools (optional)

If you have the [pi-mcp-adapter](https://github.com/nicobailon/pi-mcp-adapter) extension installed, subagents can use MCP server tools directly. Without that extension, everything below is ignored.

Add `mcp:` prefixed entries to the `tools` field:

```yaml
# All tools from a server
tools: read, bash, mcp:chrome-devtools

# Specific tools from a server
tools: read, bash, mcp:github/search_repositories, mcp:github/get_file_contents
```

| Syntax | Effect |
|--------|--------|
| `mcp:server-name` | All tools from that MCP server |
| `mcp:server-name/tool_name` | One specific tool |

The `mcp:` items are additive — they don't affect which builtins the agent gets. `tools: mcp:chrome-devtools` (with no regular tools listed) gives all default builtins plus chrome-devtools tools. To restrict builtins, list them explicitly.

Subagents only get direct MCP tools when `mcp:` items are explicitly listed. Even if your `mcp.json` has `directTools: true` globally, a subagent without `mcp:` in its frontmatter won't get any direct tools.

> **First-run caveat:** The MCP adapter caches tool metadata at startup. The first time you connect to a new MCP server, tools are only available through the generic `mcp` proxy. After that first session, restart pi and direct tools become available.

**Resolution priority:** step override > agent frontmatter > disabled

## pi-prompt-template-model

If you use [pi-prompt-template-model](https://github.com/nicobailon/pi-prompt-template-model), you can wrap subagent delegation in a slash command:

```markdown
---
description: Take a screenshot
model: claude-sonnet-4-20250514
subagent: browser-screenshoter
cwd: /tmp/screenshots
---

Use url in the prompt to take screenshot: $@
```

Then `/take-screenshot https://example.com` switches to Sonnet, delegates to the `browser-screenshoter` agent with `/tmp/screenshots` as the working directory, and restores your model when done. Runtime overrides like `--cwd=<path>` and `--subagent=<name>` work too.

pi-prompt-template-model is entirely optional. If you want reusable prompt-template workflows on top of subagents, including `/chain-prompts` and compare-style prompts, install it separately and copy example prompts from its `examples/` directory into `~/.pi/agent/prompts/`.