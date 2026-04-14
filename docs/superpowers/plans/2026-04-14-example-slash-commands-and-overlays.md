# Example Slash Commands and Skill Overlays Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship illustrative slash command presets and skill overlay examples in `config.example.json` and update documentation to reference them.

**Architecture:** Config-only change — add preset data to `config.example.json`, add guardrail test assertions, and expand documentation to cross-reference the new examples. No source code changes.

**Tech Stack:** TypeScript (Node built-in test runner), JSON config, Markdown docs.

---

### Task 1: Add slash command presets and skill overlay examples to config.example.json

**Files:**
- Modify: `config.example.json`

- [x] **Step 1: Update config.example.json with the two slash command presets and two skill overlay entries**

Replace the empty `"commands": {}` and `"skillOverlays": {}` with the presets from the design spec.

The `commands` object becomes:

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

The `skillOverlays` object becomes:

```json
"skillOverlays": {
  "brainstorming": ["react-native-best-practices"],
  "writing-plans": ["supabase-postgres-best-practices"]
}
```

The existing `modelTiers.creative` entry stays unchanged.

- [x] **Step 2: Validate config.example.json parses as valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('config.example.json','utf8')); console.log('OK')"`
Expected: `OK`

- [x] **Step 3: Commit**

```bash
git add config.example.json
git commit -m "feat: add example slash command presets and skill overlays to config.example.json"
```

---

### Task 2: Add test assertions for config.example.json presets

**Files:**
- Modify: `test/unit/default-config.test.ts`

- [x] **Step 1: Write the failing test for slash command presets**

Add after the existing `assert.deepEqual(metadataKeys, [])` block inside the `"ships a parseable user-facing example config with the same public surface"` test (or as new separate tests):

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
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/default-config.test.ts`
Expected: FAIL — `commands["sp-lean"]` is `undefined` because config.example.json still has empty commands (if running before Task 1) OR PASS if running after Task 1.

> Note: Since Task 1 changes config.example.json first, and this test depends on that file, the test should pass once both changes are in place. If running TDD strictly, write the test first against the current (empty) config to see it fail, then the config change from Task 1 makes it pass.

- [x] **Step 3: Write the failing test for skill overlay examples**

```ts
void it("includes illustrative skill overlay examples in config.example.json", () => {
	const config = readConfigFile("config.example.json");
	const overlays = (config.superagents as Record<string, unknown>).skillOverlays as Record<string, string[]>;
	assert.deepEqual(overlays["brainstorming"], ["react-native-best-practices"]);
	assert.deepEqual(overlays["writing-plans"], ["supabase-postgres-best-practices"]);
});
```

- [x] **Step 4: Run test to verify it fails (or passes if config already updated)**

Run: `npx vitest run test/unit/default-config.test.ts`
Expected: FAIL if config not yet updated, PASS if already updated from Task 1.

- [x] **Step 5: Run all unit tests to confirm nothing else broke**

Run: `npx vitest run`
Expected: All tests pass.

- [x] **Step 6: Commit**

```bash
git add test/unit/default-config.test.ts
git commit -m "test: add assertions for config.example.json slash command presets and skill overlays"
```

---

### Task 3: Update docs/reference/configuration.md — Skill Overlays and Custom Commands sections

**Files:**
- Modify: `docs/reference/configuration.md`

- [x] **Step 1: Update the Skill Overlays section to reference config.example.json**

In the **Skill Overlays** section, add a reference to config.example.json after the existing example. Find the paragraph that currently reads:

> Keys must be non-empty skill names. Values must be arrays of non-empty skill names. Missing overlay skills are blocking errors at runtime.

Add after the existing JSON example block:

```
The `config.example.json` file ships with two overlay presets that demonstrate common pairings:

- `brainstorming` → `["react-native-best-practices"]`
- `writing-plans` → `["supabase-postgres-best-practices"]`

Copy these into your own `config.json` to try them out.
```

- [x] **Step 2: Update the Custom Command Presets section to reference the new examples and document inheritance**

Replace the existing **Custom Command Presets** section prose. The current section shows only a single `sp-review` example and lists supported keys. Update it to:

1. Reference the two presets in `config.example.json`
2. Explain that preset fields override global defaults
3. Explain that omitted fields inherit from the global `superagents` settings
4. Show how to add new presets

New content for the section:

```markdown
### Custom Command Presets

Custom command presets register additional slash commands that use the same Superpowers prompt builder as `/sp-implement`.

The `config.example.json` file ships with two illustrative presets:

| Command | Description | Overrides |
|---------|-------------|-----------|
| `sp-lean` | Run Superpowers lean: no subagents, no TDD | `useSubagents: false`, `useTestDrivenDevelopment: false` |
| `sp-plannotator` | Run Superpowers with Plannotator review enabled | `usePlannotator: true` |

Copy either or both into your own `config.json` to try them out, or define your own:

```json
{
  "superagents": {
    "commands": {
      "sp-review": {
        "description": "Review-focused Superpowers run",
        "useBranches": false,
        "useSubagents": true,
        "useTestDrivenDevelopment": false,
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

**Preset field inheritance:** Each preset field overrides the corresponding global `superagents` default. Omitted fields inherit from global defaults through the existing merge chain. The `sp-lean` preset only sets `useSubagents` and `useTestDrivenDevelopment` — all other fields (like `useBranches`, `usePlannotator`) still inherit their default values.

Supported preset keys are `description`, `useBranches`, `useSubagents`, `useTestDrivenDevelopment`, `usePlannotator`, and `worktrees`. Preset `worktrees` supports only `enabled` and `root`.

Command names must match `superpowers-<name>` or `sp-<name>` (lowercase alphanumeric and hyphens).
```

Keep the existing Plannotator integration subsection intact (starting with "When `usePlannotator` is `true`:").

- [x] **Step 3: Commit**

```bash
git add docs/reference/configuration.md
git commit -m "docs: update configuration reference with preset examples and inheritance docs"
```

---

### Task 4: Update README.md with custom commands and skill overlays documentation

**Files:**
- Modify: `README.md`

- [x] **Step 1: Add Custom Commands subsection and Skill Overlays mention to README.md**

After the existing Quick Commands table (which lists `/sp-brainstorm`, `/sp-implement`, `/subagents-status`, `/sp-settings`), add:

```markdown
### Custom Commands

Define your own slash commands with preset workflow options in `config.json`. Example presets ship in `config.example.json`:

- **`/sp-lean`** — Run Superpowers without subagents or TDD.
- **`/sp-plannotator`** — Run Superpowers with Plannotator browser review enabled.

See [Configuration Reference](docs/reference/configuration.md#custom-command-presets) for the full preset schema and inheritance rules.
```

Add a brief skill overlays mention in the Features section, after **Skill Injection**:

```markdown
- **Skill Overlays**: Configure additional skills to load alongside entry skills (e.g., load `react-native-best-practices` when brainstorming). See [Configuration Reference](docs/reference/configuration.md#skill-overlays).
```

- [x] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add custom commands and skill overlays to README"
```

---

### Task 5: Update docs/guides/superpowers.md with custom commands reference

**Files:**
- Modify: `docs/guides/superpowers.md`

- [x] **Step 1: Add a Custom Commands section to the Superpowers guide**

After the existing **Model Tiers** section (before **Worktree Isolation**), add:

```markdown
## Custom Commands

You can define preset slash commands in your `config.json` that use the same Superpowers workflow as `/sp-implement`. Two example presets ship in `config.example.json`:

- `/sp-lean` — Disables subagents and TDD for a minimal workflow.
- `/sp-plannotator` — Enables Plannotator browser review.

Each preset field overrides the corresponding global default. Omitted fields inherit their values from the top-level `superagents` settings. See [Configuration Reference](../reference/configuration.md#custom-command-presets) for the full schema.
```

- [x] **Step 2: Commit**

```bash
git add docs/guides/superpowers.md
git commit -m "docs: add custom commands section to superpowers guide"
```

---

### Task 6: Verification

- [x] **Step 1: Run all unit tests**

Run: `npx vitest run`
Expected: All tests pass.

- [x] **Step 2: Validate config.example.json with the config validator**

Run: `node -e "const {validateConfigObject}=await import('./src/execution/config-validation.ts'); const cfg=JSON.parse(require('fs').readFileSync('config.example.json','utf8')); const result=validateConfigObject(cfg); console.log(JSON.stringify(result,null,2));"`
Expected: `{"blocked":false,"diagnostics":[]}` — no errors.

- [x] **Step 3: Verify documentation is internally consistent**

Check that:
- `docs/reference/configuration.md` references `config.example.json` examples
- `README.md` links to configuration reference for both Custom Commands and Skill Overlays
- `docs/guides/superpowers.md` links to configuration reference for custom commands
- All described presets match the actual `config.example.json` content