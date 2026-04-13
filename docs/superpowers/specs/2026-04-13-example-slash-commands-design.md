# Example Slash Commands and Skill Overlays in config.example.json

**Date:** 2026-04-13
**Status:** Draft

## Goal

Ship illustrative slash command presets and skill overlay examples in `config.example.json` so users discover these features immediately and learn the configuration pattern from working examples. `default-config.json` remains minimal — it ships empty defaults and is package-owned.

## Rationale

The `superagents.commands` and `superagents.skillOverlays` config keys are already functional — validated, resolved, and active at runtime — but both shipped config templates currently ship with empty values (`"commands": {}` and `"skillOverlays": {}`). This means users must read the docs before they can try either feature.

Adding examples to `config.example.json` gives users copy-paste-ready patterns without polluting the runtime defaults in `default-config.json`. Users who want these presets can copy them into their own `config.json`.

## Presets

### Slash commands

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

### Skill overlays

```json
"skillOverlays": {
  "brainstorming": ["react-native-best-practices"],
  "writing-plans": ["supabase-postgres-best-practices"]
}
```

**Design choices:**

- Both examples pair a Superpowers entry skill with one commonly relevant domain skill, showing the overlay pattern without being overwhelming.
- Skill names reference skills that are published in the pi-superagents skill catalogue (`react-native-best-practices`, `supabase-postgres-best-practices`).
- Each overlay is a single-element array to keep the example minimal; the config system supports multiple overlay skills per entry skill.

## Changes

### `default-config.json`

No changes. `"commands"` stays `{}` and `"skillOverlays"` stays `{}`. The bundled defaults remain minimal and package-owned.

### `config.example.json`

Replace the empty `"commands": {}` with the two-entry slash command object and replace the empty `"skillOverlays": {}` with the two-entry overlay object. The example file continues to demonstrate its existing custom `modelTiers` (`creative`) entry — that is unrelated to this change.

### `test/unit/default-config.test.ts`

Add one test assertion that verifies `config.example.json` contains both slash command presets with their expected field values and both skill overlay entries. This prevents accidental removal or renaming of the examples without updating the test.

```ts
void it("includes illustrative slash command presets in config.example.json", () => {
  const config = readConfigFile("config.example.json");
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

void it("includes illustrative skill overlay examples in config.example.json", () => {
  const config = readConfigFile("config.example.json");
  const overlays = (config.superagents as Record<string, unknown>).skillOverlays as Record<string, string[]>;
  assert.deepEqual(overlays["brainstorming"], ["react-native-best-practices"]);
  assert.deepEqual(overlays["writing-plans"], ["supabase-postgres-best-practices"]);
});
```

The existing assertion that `default-config.json` has empty commands and skill overlays should remain unchanged.

### `docs/reference/configuration.md`

- Update the **Skill Overlays** section to reference the new examples in `config.example.json`.
- Add a **Custom Commands** section referencing the two preset examples in `config.example.json` and explaining how to add new ones. Document that preset fields override global defaults and that omitted fields inherit from the global `superagents` settings.

## No-change files

- `src/shared/types.ts` — `SuperpowersCommandPreset` already includes `usePlannotator`; no type changes needed.
- `src/execution/config-validation.ts` — `COMMAND_NAME_PATTERN` and `COMMAND_PRESET_KEYS` already accept `sp-lean`, `sp-plannotator`, and `usePlannotator`. Skill overlay validation already accepts string arrays keyed by skill names.
- `src/superpowers/workflow-profile.ts` — `resolveCommandPreset` already merges presets with global defaults. Overlay resolution already reads `skillOverlays`.
- `src/slash/slash-commands.ts` — already iterates `config.superagents?.commands` to register slash commands.
- `test/integration/slash-commands.test.ts` — already tests configured custom commands.