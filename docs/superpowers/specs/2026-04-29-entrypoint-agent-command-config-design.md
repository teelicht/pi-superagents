# Entrypoint Agent Command Configuration Design

## Goal

Remove duplicated Superpowers command metadata from runtime configuration by making entrypoint agent frontmatter the source of truth for slash-command identity, while keeping `config.json` focused on user-configurable runtime behavior flags.

## Background

`agents/sp-implement.md` now describes an interactive Superpowers entrypoint, but `default-config.json` also contains command metadata for `/sp-implement`, `/sp-brainstorm`, and `/sp-plan`. The duplicated fields include command descriptions and entry skills. Adding matching entrypoint files for `/sp-brainstorm` and `/sp-plan` would increase this duplication unless command ownership is clarified.

The current configuration model also supports `skillOverlays`, which can preload extra skills with entry skills. After reviewing the Superpowers skill definitions, generic entrypoint overlays are not a good fit. Superpowers root skills are process controllers with hard gates and explicit transitions. Extra skills should be selected by `using-superpowers` when relevant, not injected by command metadata unless they are lifecycle skills with clear trigger points.

## Design Summary

Entrypoint agent frontmatter owns slash-command metadata. Configuration owns only runtime behavior toggles.

The runtime will register Superpowers slash commands from discovered agents that declare:

```yaml
kind: entrypoint
execution: interactive
command: sp-example
```

For each matching entrypoint agent, the command description and entry skill come from frontmatter. The matching `superagents.commands.<command>` config object is only consulted for behavior flags such as subagent use, TDD mode, Plannotator review, branch policy, and worktree policy.

## Entrypoint Agent Frontmatter

Supported entrypoint fields are:

| Field | Purpose |
|---|---|
| `name` | Agent identifier and fallback command identity. |
| `description` | Slash-command help description. |
| `kind` | Must be `entrypoint` for interactive root commands. |
| `execution` | Must be `interactive` for slash-command registration. |
| `command` | Slash command name without leading slash. |
| `entrySkill` | Root entry skill to load for the workflow. |
| `skills` | Root lifecycle skills with explicit trigger points. |

`skills` remains valid for entrypoint lifecycle skills, such as the `/sp-implement` skills that guide verification, code-review feedback, and branch completion. It should not be used as a generic overlay mechanism for domain skills.

No new `overlays` frontmatter field will be added.

## Built-In Entrypoint Agents

The package will include three built-in interactive entrypoint agents:

### `agents/sp-implement.md`

Existing file remains the implementation entrypoint:

```yaml
---
name: sp-implement
description: Interactive Superpowers implementation workflow entrypoint
kind: entrypoint
execution: interactive
command: sp-implement
entrySkill: using-superpowers
skills: verification-before-completion, receiving-code-review, finishing-a-development-branch
---
```

### `agents/sp-brainstorm.md`

New brainstorming entrypoint:

```yaml
---
name: sp-brainstorm
description: Run brainstorming through the Superpowers workflow profile
kind: entrypoint
execution: interactive
command: sp-brainstorm
entrySkill: brainstorming
---
```

### `agents/sp-plan.md`

New planning entrypoint:

```yaml
---
name: sp-plan
description: Run planning through the Superpowers workflow profile
kind: entrypoint
execution: interactive
command: sp-plan
entrySkill: writing-plans
---
```

## Runtime Configuration Boundary

`default-config.json` will continue to provide defaults that become the installed `config.json` baseline, but command presets will only contain behavior settings.

Allowed command behavior keys:

| Key | Purpose |
|---|---|
| `useBranches` | Require or skip dedicated branch policy. |
| `useSubagents` | Allow or disallow delegated subagent use. |
| `useTestDrivenDevelopment` | Enable or disable TDD guidance. |
| `usePlannotator` | Enable or disable Plannotator review for the workflow phase. |
| `worktrees.enabled` | Enable or disable git worktree isolation. |
| `worktrees.root` | Optional worktree parent directory. |

Removed command metadata keys:

- `description`
- `entrySkill`

Removed global overlay key:

- `skillOverlays`

The default command behavior remains:

```json
{
  "superagents": {
    "commands": {
      "sp-implement": {
        "useSubagents": true,
        "useTestDrivenDevelopment": true,
        "useBranches": false,
        "worktrees": { "enabled": false }
      },
      "sp-brainstorm": {
        "usePlannotator": true
      },
      "sp-plan": {
        "usePlannotator": true
      }
    }
  }
}
```

## Slash Command Registration

Command registration will change from config-driven to entrypoint-agent-driven:

1. Discover built-in, user, and project agents.
2. Filter agents where `kind === "entrypoint"`, `execution === "interactive"`, and `command` is present.
3. Register one slash command per entrypoint agent.
4. Use the entrypoint agent description for command help text.
5. Resolve behavior flags from `superagents.commands.<command>` when present.
6. Ignore config command blocks that have no matching entrypoint agent at registration time.

User and project agents already override built-in agents by name during discovery. That precedence continues to apply. A project can replace a built-in entrypoint by defining an agent with the same `name`, or create an additional command by defining a new entrypoint agent.

## Profile Resolution

`resolveSuperpowersRunProfile` will use this precedence:

- Entry skill: explicit caller value, then entrypoint agent `entrySkill`, then `using-superpowers` fallback.
- Root lifecycle skills: entrypoint agent `skills`.
- Behavior flags: config command preset plus inline command tokens.
- Overlay skills: none.

Inline workflow tokens such as `tdd`, `direct`, `subagents`, `no-subagents`, `full`, and `lean` continue to override config behavior for the current invocation.

## Validation

Config validation will be updated to match the new boundary.

Errors:

- Unknown command preset keys other than behavior keys.
- Wrong types for behavior keys.
- Invalid `worktrees` shape.
- Unknown top-level `superagents` keys, including `skillOverlays`.

Warnings:

- `superagents.commands.<command>` exists but no discovered interactive entrypoint agent exposes that command.

This warning is non-fatal so stale config does not disable the extension unnecessarily. It tells users to add an entrypoint agent or remove the unused command behavior block.

## Installer Semantics

The install flow should treat the bundled default configuration as the baseline that becomes user `config.json` on install. If the current installer still creates `{}` as the initial user override, it should be updated so fresh installs get the default behavior flags directly.

The filename can remain `default-config.json` unless renaming improves clarity. If renamed, `config.default.json` is preferred because it states that the file is the install-time default, not a second runtime config layer.

## Documentation Updates

Update user documentation to state:

- Slash commands come from interactive entrypoint agents.
- `config.json` contains behavior flags, not command metadata.
- Custom commands require custom entrypoint agent markdown files.
- `skillOverlays` are removed and should not be replaced with entrypoint overlays.
- Domain skills should be selected by `using-superpowers` based on task relevance.
- Entry point `skills` are reserved for lifecycle/root skills with explicit trigger points.

Files to update:

- `README.md`
- `docs/configuration.md`
- `docs/worktrees.md`
- `docs/parameters.md`
- `docs/skills.md`

## Testing Strategy

Add or update tests for:

1. Discovery and parsing of `sp-brainstorm.md` and `sp-plan.md` entrypoint agents.
2. Slash command registration from entrypoint agents only.
3. Config-only command blocks not registering commands.
4. Profile resolution using entrypoint `entrySkill` and config behavior flags.
5. Rejection of `description`, `entrySkill`, and `skillOverlays` in config validation.
6. Warning when config references a command with no matching entrypoint agent.
7. Existing inline token overrides continuing to work.

## Non-Goals

- No generic entrypoint overlay system.
- No generated command config from agent files.
- No config-only custom slash commands.
- No changes to bounded role agent behavior beyond any type updates required by shared frontmatter parsing.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Existing users rely on config-only custom commands. | Document migration path: create an entrypoint agent and keep behavior flags in config. |
| Stale config contains old metadata keys. | Validation errors should point to exact keys and docs. |
| Users expect overlays to preload domain skills. | Document that `using-superpowers` selects relevant skills by trigger; entrypoint `skills` are lifecycle-only. |
| Fresh installs lose defaults if installer semantics are unclear. | Copy bundled defaults into `config.json` on install or rename default file for clarity. |

## Success Criteria

- `/sp-implement`, `/sp-brainstorm`, and `/sp-plan` all register from bundled entrypoint agents.
- `default-config.json` contains only runtime behavior settings and global non-command settings.
- No command description or entry skill is duplicated in config.
- `skillOverlays` are removed from config and runtime profile resolution.
- Documentation clearly separates entrypoint metadata from runtime behavior flags.
