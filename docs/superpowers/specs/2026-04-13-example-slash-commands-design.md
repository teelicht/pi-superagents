# Example Slash Commands in default-config.json

**Date:** 2026-04-13
**Status:** Draft

## Goal

Ship two illustrative slash command presets in `default-config.json` so users discover the custom command feature immediately and learn the configuration pattern from working examples.

## Rationale

The `superagents.commands` config key is already functional — validated, resolved, and registered at startup — but both shipped config templates (`default-config.json` and `config.example.json`) ship with `"commands": {}`. This means users must read the docs before they can try the feature, and the config surface is invisible until they do.

Adding two small presets gives users runnable examples the moment the extension loads. Both commands are safe to rename or remove.

## Presets

```json
"commands": {
  "sp-lean": {
    "description": "Run Superpowers lean: no subagents, no TDD",
    "useSubagents": false,
    "useTestDrivenDevelopment": false
  },
  "sp-plannotator": {
    "description": "Run Superpowers with Plannotator review enabled",
    "usePlannotator": true
  }
}
```

**Design choices:**

- Each command demonstrates one concept — `sp-lean` shows workflow-mode overrides, `sp-plannotator` shows a policy flag override.
- Only non-default booleans are included. Omitted fields inherit from global defaults through the existing merge chain.
- Neither command includes `worktrees` or `useBranches` overrides, keeping the examples minimal and focused.
- Command names follow the `sp-*` prefix convention already enforced by `COMMAND_NAME_PATTERN` in validation. `sp-plannotator` names the feature it enables, avoiding ambiguity with generic terms like "reviewed".

## Changes

### `default-config.json`

Replace `"commands": {}` with the two-entry object above. No other fields change.

### `config.example.json`

Add the same two entries under `"commands"` so the user-facing example template stays aligned with shipped defaults. The example file may also continue to demonstrate the custom `modelTiers` (`creative`) entry it already has — that is unrelated to this change.

### `test/unit/default-config.test.ts`

Add one test assertion that verifies both commands exist with their expected field values. This prevents accidental removal or renaming of the examples without updating the test.

```ts
void it("includes two illustrative slash command presets", () => {
  const config = readConfigFile("default-config.json");
  const commands = (config.superagents as Record<string, unknown>).commands as Record<string, Record<string, unknown>>;
  assert.deepEqual(commands["sp-lean"], {
    description: "Run Superpowers lean: no subagents, no TDD",
    useSubagents: false,
    useTestDrivenDevelopment: false,
  });
  assert.deepEqual(commands["sp-plannotator"], {
    description: "Run Superpowers with Plannotator review enabled",
    usePlannotator: true,
  });
});
```

### `docs/reference/configuration.md`

Add a **Custom Commands** section showing the two shipped presets and explaining how to add new ones. Document that preset fields override global defaults and that omitted fields inherit from the global `superagents` settings.

## No-change files

- `src/shared/types.ts` — `SuperpowersCommandPreset` already includes `usePlannotator`; no type changes needed.
- `src/execution/config-validation.ts` — `COMMAND_NAME_PATTERN` and `COMMAND_PRESET_KEYS` already accept `sp-lean`, `sp-reviewed`, and `usePlannotator`.
- `src/superpowers/workflow-profile.ts` — `resolveCommandPreset` already merges presets with global defaults.
- `src/slash/slash-commands.ts` — already iterates `config.superagents?.commands` to register slash commands.
- `test/integration/slash-commands.test.ts` — already tests configured custom commands.