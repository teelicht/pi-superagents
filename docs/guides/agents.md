# Agents Guide

How to create, manage, and use agents with pi-superagents.

## Overview

Agents are markdown files with YAML frontmatter that define specialized subagent configurations. They live in three locations with increasing priority:

| Scope   | Path                                                | Priority |
| ------- | --------------------------------------------------- | -------- |
| Builtin | `~/.pi/agent/extensions/subagent/agents/`           | Lowest   |
| User    | `~/.pi/agent/agents/{name}.md`                      | Medium   |
| Project | `.pi/agents/{name}.md` (searches up directory tree) | Highest  |

Use `agentScope` to control discovery: `"user"`, `"project"`, or `"both"` (default; project takes priority).

## Builtin Agents

The extension ships with: `scout`, `planner`, `worker`, `reviewer`, `context-builder`, `researcher`, and `delegate`. They load at lowest priority so any user or project agent with the same name overrides them. Builtin agents appear with a `[builtin]` badge in listings and cannot be modified through management actions (create a same-named user agent to override instead).

> **Note:** The `researcher` agent uses `web_search`, `fetch_content`, and `get_search_content` tools which require the [pi-web-access](https://github.com/nicobailon/pi-web-access) extension.

## Creating Agents

### By hand

Create a `.md` file with YAML frontmatter in `~/.pi/agent/agents/` (user scope) or `.pi/agents/` (project scope):

```markdown
---
name: my-scout
description: Custom codebase recon
model: claude-haiku-4-5
thinking: high
tools: read, grep, find, ls, bash
skill: safe-bash
output: context.md
---
You are a specialized code scout. Focus on finding architectural patterns.
```

See the [Agents Reference](../reference/agents-reference.md) for the complete frontmatter schema.

### Via Agents Manager

Press **Ctrl+Shift+A** or type `/agents` to open the Agents Manager, then press **Ctrl+N** to create from templates:

- **Blank** — minimal agent
- **Scout** — codebase recon pattern
- **Planner** — implementation planning pattern
- **Implementer** — code-first implementation
- **Code Reviewer** — review pattern
- **Blank Chain** — multi-step pipeline

### Via LLM Management Actions

The LLM can create agents at runtime through the `subagent` tool's management actions. New agents are immediately usable in the same session. See [Parameters API → Management Actions](../reference/parameters.md#management-actions).

## Agents Manager

The Agents Manager is a TUI overlay for browsing, viewing, editing, creating, and launching agents and chains.

### Screens

| Screen | Description |
|--------|-------------|
| List | Browse all agents/chains with search/filter, scope badges, chain badges |
| Detail | View resolved prompt, frontmatter fields, recent run history |
| Edit | Edit fields with specialized pickers (model, thinking, skills, prompt editor) |
| Chain Detail | View chain steps with flow visualization and dependency map |
| Parallel Builder | Build parallel execution slots, per-slot task overrides |
| Task Input | Enter task and launch with optional skip-clarify toggle |
| New Agent | Create from templates |

### Keybindings

**List screen:** `↑↓` navigate, `Enter` view detail, type to search, `Tab` toggle selection, `Ctrl+N` new, `Ctrl+K` clone, `Ctrl+D`/`Del` delete, `Ctrl+R` run (1 agent: launch, 2+: chain), `Ctrl+P` parallel builder, `Esc` clear/close.

**Parallel builder:** `↑↓` navigate slots, `Ctrl+A` add agent, `Del`/`Ctrl+D` remove slot, `Enter` edit task, `Ctrl+R` launch (2+ required), `Esc` back.

**Task input:** `Enter` launch, `Tab` toggle skip-clarify, `Esc` back.

**Multi-select workflow:** Select agents with `Tab`, then `Ctrl+R` for chain or `Ctrl+P` for parallel builder.