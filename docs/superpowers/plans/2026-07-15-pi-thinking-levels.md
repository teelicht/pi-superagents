# Pi-Owned Thinking Levels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every extension-owned thinking-level enumeration and source model picker choices exclusively from Pi.

**Architecture:** The slash-command layer asks Pi's `getSupportedThinkingLevels(model)` for each registry model and passes those results to the settings component. Execution helpers preserve precedence while treating configured and suffixed values as opaque Pi input, leaving validity checks to Pi runtime.

**Tech Stack:** TypeScript, `@earendil-works/pi-ai`, Pi model registry, Node test runner, Biome.

## Global Constraints

- Do not maintain a static thinking-level list or extension-side validity gate.
- Pi is the sole authority for per-model supported levels and runtime validity.
- Preserve the existing model-override suffix precedence.
- Add no dependencies or abstractions.

---

### Task 1: Source picker options from Pi per model

**Files:**
- Modify: `test/unit/sp-settings.test.ts`
- Modify: `src/ui/sp-settings.ts`
- Modify: `src/slash/slash-commands.ts`

**Interfaces:**
- Consumes: `getSupportedThinkingLevels(model): ModelThinkingLevel[]` from `@earendil-works/pi-ai`.
- Produces: `SettingsModelOption.thinkingLevels: readonly ThinkingLevel[]` for the settings picker.

- [ ] **Step 1: Write the failing picker test**

Extend the test model helper to accept Pi-provided levels and add a test that selects a model with `['off', 'minimal']`, enters the thinking picker, and asserts that `off` and `minimal` render while `medium`, `high`, `xhigh`, and `max` do not.

```ts
function createModel(provider: string, id: string, name?: string, thinkingLevels: readonly ThinkingLevel[] = ["off"]): ModelOption {
	return { provider, id, name, thinkingLevels };
}

void test("SuperpowersSettingsComponent uses the selected model's Pi thinking levels", () => {
	const config: ExtensionConfig = {
		superagents: { modelTiers: { cheap: { model: "provider/old" } } },
	};
	const component = new SuperpowersSettingsComponent(
		createTuiMock() as never,
		createThemeMock() as never,
		createState() as never,
		getConfigForTest(config),
		{
		models: [createModel("provider", "limited", "Limited", ["off", "minimal"])],
		},
	);
	component.handleInput("m");
	component.handleInput("\r");
	component.handleInput("\r");
	const rendered = component.render(92).join("\n");
	assert.match(rendered, /off/);
	assert.match(rendered, /minimal/);
	assert.doesNotMatch(rendered, /xhigh|max/);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --experimental-strip-types --test test/unit/sp-settings.test.ts`

Expected: FAIL because `SettingsModelOption` and picker state do not consume `thinkingLevels` and the global picker still exposes every local value.

- [ ] **Step 3: Implement minimal per-model options**

In `src/slash/slash-commands.ts`, import and call Pi's helper while mapping registry models:

```ts
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";

modelOptions = models.map((model) => ({
	provider: model.provider,
	id: model.id,
	name: model.name,
	thinkingLevels: getSupportedThinkingLevels(model),
}));
```

In `src/ui/sp-settings.ts`, add `thinkingLevels` to `SettingsModelOption`, remove `VALID_THINKING_LEVELS` and `THINKING_OPTIONS`, store the selected model's options during `applyModelSelection`, and make index/navigation/render methods read that instance value:

```ts
private thinkingOptions: readonly (ThinkingLevel | undefined)[] = [undefined];

private applyModelSelection(filteredModels: SettingsModelOption[]): void {
	const editedTier = this.selectedTier!;
	const selectedModel = filteredModels[this.selectedModelIndex];
	this.thinkingOptions = [undefined, ...selectedModel.thinkingLevels];
	this.writeModelTier(editedTier, modelToValue(selectedModel));
	this.mode = "thinking-picker";
	this.selectedTier = this.modelTierEntries().includes(editedTier) ? editedTier : this.firstModelTier();
	this.selectedModelIndex = 0;
	this.selectedThinkingIndex = this.currentThinkingIndex(editedTier);
	this.modelSearchQuery = "";
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --experimental-strip-types --test test/unit/sp-settings.test.ts`

Expected: PASS with zero failures.

---

### Task 2: Remove local recognition and pass values to Pi

**Files:**
- Modify: `test/unit/thinking-levels.test.ts`
- Modify: `src/shared/thinking-levels.ts`
- Modify: `src/execution/pi-args.ts`
- Verify: `test/integration/single-execution.test.ts`

**Interfaces:**
- Produces: `toThinkingLevel(...)` with existing precedence and no validation.
- Produces: `extractThinkingSuffix(...)` returning any non-empty suffix as opaque Pi input.
- Consumes: `extractThinkingSuffix(...)` in `applyThinkingSuffix` to preserve an existing suffix.

- [ ] **Step 1: Replace allowlist tests with pass-through tests**

Delete tests for `VALID_THINKING_LEVELS` and `isThinkingLevel`. Change invalid-value expectations to verify that a future value passes through and that any non-empty suffix is returned:

```ts
void it("passes configured values through for Pi to validate", () => {
	assert.strictEqual(toThinkingLevel("future-level" as ThinkingLevel, "medium", false), "future-level");
});

void it("passes non-empty model suffixes through for Pi to validate", () => {
	assert.strictEqual(extractThinkingSuffix("provider/model:future-level"), "future-level");
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --experimental-strip-types --test test/unit/thinking-levels.test.ts`

Expected: FAIL because current helpers reject values not present in the extension list.

- [ ] **Step 3: Implement minimal pass-through helpers**

Delete `THINKING_LEVEL_BY_KEY`, `VALID_THINKING_LEVELS`, and `isThinkingLevel`. Keep precedence without validation:

```ts
export function toThinkingLevel(
	thinking: ThinkingLevel | undefined,
	tierThinking: ThinkingLevel | undefined,
	hasModelOverride: boolean,
): ThinkingLevel | undefined {
	if (thinking !== undefined) return thinking;
	return hasModelOverride ? undefined : tierThinking;
}

export function extractThinkingSuffix(model: string | undefined): ThinkingLevel | undefined {
	if (!model) return undefined;
	const suffix = model.slice(model.lastIndexOf(":") + 1);
	return model.includes(":") && suffix ? (suffix as ThinkingLevel) : undefined;
}
```

In `src/execution/pi-args.ts`, replace the validity check with presence detection:

```ts
import { extractThinkingSuffix } from "../shared/thinking-levels.ts";

if (extractThinkingSuffix(model) !== undefined) return model;
```

- [ ] **Step 4: Run focused unit and precedence integration tests**

Run:

```bash
node --experimental-strip-types --test test/unit/thinking-levels.test.ts
node --experimental-strip-types --import ./test/support/register-loader.mjs --test test/integration/single-execution.test.ts
```

Expected: both commands PASS; the existing model-override suffix test remains green.

---

### Task 3: Documentation, verification, and local installation

**Files:**
- Modify: `README.md`
- Modify: `docs/configuration.md`
- Modify: `CHANGELOG.md`
- Review unchanged: `docs/worktrees.md`, `docs/parameters.md`, `docs/skills.md`

**Interfaces:**
- Documents: `/sp-settings` shows only Pi-reported levels for the selected model; unknown configured levels are validated by Pi at runtime.

- [ ] **Step 1: Update user documentation**

Use this wording in the relevant README/configuration/changelog sections:

```md
The `/sp-settings` thinking picker uses the levels Pi reports for the selected model. The extension maintains no thinking-level allowlist; configured values are passed to Pi for runtime validation.
```

Remove the changelog claim that the picker uses a compiler-pinned extension list. Confirm that `docs/worktrees.md`, `docs/parameters.md`, and `docs/skills.md` contain no conflicting thinking-level guidance; leave them unchanged when they do not.

- [ ] **Step 2: Run full verification**

Run:

```bash
pnpm run typecheck
pnpm run test:all
pnpm exec biome check src test README.md docs CHANGELOG.md
```

Expected: all commands exit 0 with zero test failures and no Biome errors.

- [ ] **Step 3: Confirm no local enumeration remains**

Run:

```bash
rg -n "VALID_THINKING_LEVELS|THINKING_LEVEL_BY_KEY|isThinkingLevel|off.*minimal.*low.*medium.*high.*xhigh.*max" src test
```

Expected: no extension-owned list or recognizer matches.

- [ ] **Step 4: Install the verified extension into Pi**

Run: `pnpm run install:local`

Expected: the local Pi extension refresh is copied to `~/.pi/agent/extensions/subagent`; Pi must be restarted to load it.
