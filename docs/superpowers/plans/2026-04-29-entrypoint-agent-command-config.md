# Entrypoint Agent Command Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Superpowers slash-command metadata from `config.json` into interactive entrypoint agent frontmatter, remove skill overlays, and add bundled `/sp-brainstorm` and `/sp-plan` entrypoint agents.

**Architecture:** Agent discovery already parses `kind`, `execution`, `command`, `entrySkill`, and `skills`; reuse that as the command registry. Config remains the runtime behavior source for command flags, model tiers, extension allowlists, intercepted skill commands, and the bundled `superpowersSkills` list. Slash command registration discovers interactive entrypoint agents, registers those commands, and passes the matching agent into workflow profile resolution.

**Tech Stack:** TypeScript, Node test runner, JSON config templates, Pi extension API, Markdown agent definitions, existing Superpowers prompt/profile modules.

---

## File Structure

- Create `agents/sp-brainstorm.md`: bundled brainstorming entrypoint agent.
- Create `agents/sp-plan.md`: bundled planning entrypoint agent.
- Modify `agents/sp-implement.md`: verify it remains the command metadata source and contains no config-only metadata assumptions.
- Modify `src/shared/types.ts`: remove command metadata and skill overlay config types from runtime config.
- Modify `src/execution/config-validation.ts`: reject config metadata keys, remove overlay validation/merge, and support optional stale command warnings.
- Modify `src/extension/config-store.ts`: pass discovered entrypoint commands into config validation so stale command blocks can warn.
- Modify `src/extension/index.ts`: discover package/project entrypoints for config warnings when loading/reloading config.
- Modify `src/slash/slash-commands.ts`: register commands from entrypoint agents only.
- Modify `src/superpowers/workflow-profile.ts`: resolve `entrySkill` only from explicit parameter or entrypoint agent, remove overlay resolution.
- Modify `src/superpowers/skill-entry.ts`: remove overlay resolution and error handling.
- Modify `src/superpowers/root-prompt.ts`: remove overlay prompt block if present.
- Modify `src/ui/sp-settings.ts`: keep settings UI behavior-flag-only and avoid presenting command metadata as config.
- Modify `default-config.json`: keep behavior flags and global settings only.
- Modify `config.example.json`: remove config-only custom command examples and overlay examples; show behavior-only command blocks and explain custom entrypoint agents in docs instead.
- Modify `install.mjs`: create initial `config.json` from bundled defaults instead of `{}` and adjust migration text.
- Modify docs: `README.md`, `docs/configuration.md`, `docs/worktrees.md`, `docs/parameters.md`, `docs/skills.md`.
- Modify tests: `test/unit/config-validation.test.ts`, `test/unit/default-config.test.ts`, `test/unit/superpowers-workflow-profile.test.ts`, `test/unit/superpowers-skill-entry.test.ts`, `test/unit/superpowers-root-prompt.test.ts`, `test/unit/sp-settings.test.ts`, `test/integration/slash-commands.test.ts`, and installer-related e2e tests if they assert empty config creation.

---

### Task 1: Add bundled entrypoint agents and lock agent discovery expectations

**Files:**
- Create: `agents/sp-brainstorm.md`
- Create: `agents/sp-plan.md`
- Modify: `test/integration/slash-commands.test.ts`
- Modify: `test/unit/superpowers-workflow-profile.test.ts`

- [x] **Step 1: Create `agents/sp-brainstorm.md`**

Write exactly:

```markdown
---
name: sp-brainstorm
description: Brainstorm a task and save a Superpowers design spec
kind: entrypoint
execution: interactive
command: sp-brainstorm
entrySkill: brainstorming
---

Interactive entrypoint for Superpowers brainstorming workflows.

This agent owns the `/sp-brainstorm` slash command metadata. Runtime behavior such as Plannotator review is configured under `superagents.commands.sp-brainstorm`.
```

- [x] **Step 2: Create `agents/sp-plan.md`**

Write exactly:

```markdown
---
name: sp-plan
description: Write a Superpowers implementation plan from an approved spec
kind: entrypoint
execution: interactive
command: sp-plan
entrySkill: writing-plans
---

Interactive entrypoint for Superpowers planning workflows.

This agent owns the `/sp-plan` slash command metadata. Runtime behavior such as Plannotator review is configured under `superagents.commands.sp-plan`.
```

- [x] **Step 3: Add a failing integration assertion that bundled commands register from entrypoint agents, not config-only presets**

In `test/integration/slash-commands.test.ts`, update the first registration test to remove the config-only `sp-review` preset and assert `/sp-plan` is registered from its new agent. Replace the test body with this shape:

```ts
void it("registers Superpowers entrypoint commands only", () => {
	const { commands, shortcuts, pi } = createPiHarness();
	const config = createEffectiveConfig({
		superagents: {
			commands: {
				"sp-review": { useSubagents: false },
			},
		},
	});
	registerSlashCommands!(pi, createState(process.cwd()), config);
	assert.ok(commands.has("sp-implement"), "expected /sp-implement to be registered");
	assert.ok(commands.has("sp-brainstorm"), "expected /sp-brainstorm to be registered");
	assert.ok(commands.has("sp-plan"), "expected /sp-plan to be registered");
	assert.ok(commands.has("subagents-status"), "expected /subagents-status to be registered");
	assert.ok(commands.has("sp-settings"), "expected /sp-settings to be registered");
	assert.ok(!commands.has("sp-review"), "expected config-only /sp-review to NOT be registered");
	assert.ok(shortcuts.has("ctrl+alt+s"), "expected ctrl+alt+s shortcut to be registered");
	assert.ok(!commands.has("superpowers"), "expected /superpowers to NOT be registered");
	assert.ok(!commands.has("superpowers-status"), "expected /superpowers-status to NOT be registered");
	assert.ok(!commands.has("run"), "expected /run to NOT be registered");
	assert.ok(!commands.has("chain"), "expected /chain to NOT be registered");
	assert.ok(!commands.has("parallel"), "expected /parallel to NOT be registered");
	assert.ok(!commands.has("agents"), "expected /agents to NOT be registered");
	assert.match(shortcuts.get("ctrl+alt+s")!.description ?? "", /subagents status/i);
});
```

- [x] **Step 4: Add a failing `/sp-plan` integration test**

Near the existing `/sp-brainstorm` tests, add:

```ts
void it("registers /sp-plan and sends a writing-plans entry prompt", async () => {
	const cwd = createSkillFixtureCwd();
	const userMessages: Array<{ content: string | unknown[]; options?: { deliverAs?: "steer" | "followUp" } }> = [];
	const commands = new Map<string, CommandSpec>();
	const pi = {
		events: createEventBus(),
		registerCommand(name: string, spec: CommandSpec) {
			commands.set(name, spec);
		},
		registerShortcut() {},
		sendMessage() {},
		sendUserMessage(content: string | unknown[], options?: { deliverAs?: "steer" | "followUp" }) {
			userMessages.push({ content, options });
		},
	};

	registerSlashCommands!(pi, createState(cwd), createEffectiveConfig());

	assert.ok(commands.has("sp-plan"), "expected /sp-plan to be registered");
	await commands.get("sp-plan")!.handler("plan auth refactor", createCommandContext({ cwd }));

	assert.equal(userMessages.length, 1);
	const prompt = String(userMessages[0].content);
	assert.match(prompt, /Entry skill:/);
	assert.match(prompt, /Name: writing-plans/);
	assert.match(prompt, /plan auth refactor/);
	assert.match(prompt, /superpowers_plan_review/);
	assert.doesNotMatch(prompt, /Overlay skills:/);
});
```

- [x] **Step 5: Run the focused tests and confirm failure**

Run:

```bash
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/slash-commands.test.ts
```

Expected: FAIL because `/sp-plan` does not register from entrypoint agents yet and config-only commands still register.

- [x] **Step 6: Commit failing tests and new agents**

```bash
git add agents/sp-brainstorm.md agents/sp-plan.md test/integration/slash-commands.test.ts test/unit/superpowers-workflow-profile.test.ts
git commit -m "test: expect entrypoint-driven superpowers commands"
```

---

### Task 2: Make config behavior-only and remove skill overlays from schema

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/execution/config-validation.ts`
- Modify: `default-config.json`
- Modify: `config.example.json`
- Modify: `test/unit/config-validation.test.ts`
- Modify: `test/unit/default-config.test.ts`

- [x] **Step 1: Update shared config types**

In `src/shared/types.ts`, replace the config types around `SkillOverlayConfig`, `SuperpowersCommandPreset`, and `SuperpowersSettings` with:

```ts
/** Behavior flags for a named Superpowers entrypoint command. */
export interface SuperpowersCommandPreset {
	useBranches?: boolean;
	useSubagents?: boolean;
	useTestDrivenDevelopment?: boolean;
	usePlannotator?: boolean;
	worktrees?: SuperpowersCommandWorktreeSettings;
}

/** Worktree settings allowed inside command behavior presets. */
export interface SuperpowersCommandWorktreeSettings {
	enabled?: boolean;
	root?: string | null;
}

/** Worktree settings for superagents parallel execution. */
export interface SuperpowersWorktreeSettings {
	enabled?: boolean;
	root?: string | null;
}

export interface SuperpowersSettings {
	commands?: Record<string, SuperpowersCommandPreset>;
	modelTiers?: Record<string, ModelTierSetting>;
	interceptSkillCommands?: string[];
	superpowersSkills?: string[];
	/** Global extensions applied to all subagent runs before agent-specific extensions. */
	extensions?: string[];
}
```

This removes `SkillOverlayConfig`, `description`, `entrySkill`, and `skillOverlays` from public runtime config types.

- [x] **Step 2: Update validation key constants**

In `src/execution/config-validation.ts`, change:

```ts
const SUPERAGENTS_KEYS = new Set(["commands", "modelTiers", "interceptSkillCommands", "extensions", "superpowersSkills"]);
const COMMAND_PRESET_KEYS = new Set(["useBranches", "useSubagents", "useTestDrivenDevelopment", "usePlannotator", "worktrees"]);
```

Remove `validateSkillOverlays`, `validateSkillNameArray`, and any call to `validateSkillOverlays`.

- [x] **Step 3: Add explicit removed-key errors for metadata and overlays**

In `src/execution/config-validation.ts`, add or extend removed key maps so these paths produce errors:

```ts
const REMOVED_SUPERAGENTS_KEYS: Record<string, { code: string; message: string }> = {
	skillOverlays: {
		code: "removed_key",
		message: "was removed. Superpowers now selects relevant skills through using-superpowers; entrypoint overlays are not supported.",
	},
};

const REMOVED_COMMAND_PRESET_KEYS: Record<string, { code: string; message: string }> = {
	description: {
		code: "removed_key",
		message: "was moved to entrypoint agent frontmatter. Add or edit an agents/*.md entrypoint instead.",
	},
	entrySkill: {
		code: "removed_key",
		message: "was moved to entrypoint agent frontmatter. Add or edit an agents/*.md entrypoint instead.",
	},
};
```

Inside `validateCommandPreset`, check `REMOVED_COMMAND_PRESET_KEYS` before unknown-key handling:

```ts
for (const key of Object.keys(value)) {
	if (key in REMOVED_COMMAND_PRESET_KEYS) {
		const { code, message } = REMOVED_COMMAND_PRESET_KEYS[key];
		addError(diagnostics, `${path}.${key}`, message, code);
	} else if (!COMMAND_PRESET_KEYS.has(key)) {
		addError(diagnostics, `${path}.${key}`, "is not a supported command behavior key.", "unknown_key");
	}
}
```

Remove the old primitive validators for `description` and `entrySkill`.

- [x] **Step 4: Remove overlay merge logic**

In `mergeConfig`, delete `mergedSkillOverlays` and remove `skillOverlays: mergedSkillOverlays` from the merged object. Keep command deep merge, model tier merge, intercepted skill replacement, extension replacement, and `superpowersSkills` from defaults.

- [x] **Step 5: Update `default-config.json`**

Replace command blocks and remove `skillOverlays`:

```json
{
  "superagents": {
    "extensions": [],
    "commands": {
      "sp-implement": {
        "useSubagents": true,
        "useTestDrivenDevelopment": true,
        "useBranches": false,
        "worktrees": { "enabled": false, "root": null }
      },
      "sp-brainstorm": {
        "usePlannotator": true
      },
      "sp-plan": {
        "usePlannotator": true
      }
    },
    "modelTiers": {
      "cheap": {
        "model": "opencode-go/minimax-m2.7",
        "thinking": "low"
      },
      "balanced": {
        "model": "opencode-go/glm-5.1",
        "thinking": "high"
      },
      "max": {
        "model": "openai/gpt-5.5",
        "thinking": "medium"
      }
    },
    "interceptSkillCommands": [],
    "superpowersSkills": [
      "using-superpowers",
      "brainstorming",
      "writing-plans",
      "executing-plans",
      "test-driven-development",
      "requesting-code-review",
      "receiving-code-review",
      "verification-before-completion",
      "subagent-driven-development",
      "dispatching-parallel-agents",
      "using-git-worktrees",
      "finishing-a-development-branch"
    ]
  }
}
```

- [x] **Step 6: Update `config.example.json`**

Remove config-only custom command presets and `skillOverlays`. Keep behavior-only examples:

```json
{
  "superagents": {
    "commands": {
      "sp-implement": {
        "useSubagents": true,
        "useTestDrivenDevelopment": true,
        "worktrees": { "enabled": false, "root": null }
      },
      "sp-brainstorm": {
        "usePlannotator": true
      },
      "sp-plan": {
        "usePlannotator": true
      }
    },
    "extensions": [
      "npm:@sting8k/pi-vcc",
      "npm:@tomooshi/caveman-milk-pi",
      "npm:@tomooshi/condensed-milk-pi"
    ],
    "modelTiers": {
      "cheap": {
        "model": "opencode-go/minimax-m2.7",
        "thinking": "low"
      },
      "balanced": {
        "model": "opencode-go/glm-5.1",
        "thinking": "medium"
      },
      "max": {
        "model": "openai/gpt-5.4",
        "thinking": "high"
      },
      "creative": {
        "model": "anthropic/claude-opus-4.6",
        "thinking": "high"
      },
      "legacy": {
        "model": "openai/gpt-4o"
      }
    },
    "interceptSkillCommands": []
  }
}
```

- [x] **Step 7: Update config validation tests**

In `test/unit/config-validation.test.ts`:

- Remove `description`, `entrySkill`, and `skillOverlays` from `defaults`.
- Change “deep merges command presets” to use a behavior-only custom block:

```ts
"sp-quick": { useSubagents: false }
```

- Replace the “accepts custom commands with entrySkill” test with:

```ts
void it("rejects command metadata keys moved to entrypoint agents", () => {
	const result = validateConfigObject({
		superagents: {
			commands: {
				"sp-custom": {
					description: "Custom command",
					entrySkill: "brainstorming",
					useSubagents: true,
				},
			},
		},
	});

	assert.equal(result.blocked, true);
	assert.deepEqual(
		result.diagnostics.map((diagnostic) => diagnostic.path),
		["superagents.commands.sp-custom.description", "superagents.commands.sp-custom.entrySkill"],
	);
});
```

- Add:

```ts
void it("rejects removed skillOverlays config", () => {
	const result = validateConfigObject({
		superagents: {
			skillOverlays: {
				brainstorming: ["react-native-best-practices"],
			},
		},
	});

	assert.equal(result.blocked, true);
	assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.path), ["superagents.skillOverlays"]);
});
```

- [x] **Step 8: Update default config tests**

In `test/unit/default-config.test.ts`:

- Remove `skillOverlays` from `SUPERAGENTS_OPTION_KEYS`.
- Assert built-in command blocks do not include metadata:

```ts
assert.equal("description" in spImplement, false);
assert.equal("entrySkill" in spImplement, false);
```

- Remove tests named “includes empty skill entry defaults”, “keeps direct skill interception opt-in by default” assertions about `skillOverlays`, “includes illustrative slash command presets”, and “includes illustrative skill overlay examples”.
- Keep the `interceptSkillCommands` default assertion.

- [x] **Step 9: Run focused tests and confirm failure count narrows**

Run:

```bash
node --experimental-strip-types --test test/unit/config-validation.test.ts test/unit/default-config.test.ts
```

Expected: FAIL until runtime profile, slash registration, and settings UI no longer reference removed fields.

- [x] **Step 10: Commit schema/config changes**

```bash
git add src/shared/types.ts src/execution/config-validation.ts default-config.json config.example.json test/unit/config-validation.test.ts test/unit/default-config.test.ts
git commit -m "refactor: make superpowers command config behavior-only"
```

---

### Task 3: Register slash commands from entrypoint agents

**Files:**
- Modify: `src/slash/slash-commands.ts`
- Modify: `src/superpowers/workflow-profile.ts`
- Modify: `test/integration/slash-commands.test.ts`
- Modify: `test/unit/superpowers-workflow-profile.test.ts`

- [x] **Step 1: Update workflow profile types and docs**

In `src/superpowers/workflow-profile.ts`, update the file header bullet from “entry skill name and overlay skill names” to “entry skill name and lifecycle skill names”.

Change `ResolvedSuperpowersRunProfile` to:

```ts
export interface ResolvedSuperpowersRunProfile {
	commandName: string;
	task: string;
	entrySkill: string;
	useBranches?: boolean;
	useSubagents?: boolean;
	useTestDrivenDevelopment?: boolean;
	usePlannotatorReview?: boolean;
	worktrees?: { enabled: boolean; root?: string | null };
	fork: boolean;
	rootLifecycleSkillNames: string[];
}
```

- [x] **Step 2: Remove overlay resolution from `resolveSuperpowersRunProfile`**

Replace the top of the function after `preset` with:

```ts
const entrypointAgent = input.entrypointAgent;
const entrySkill = input.entrySkill ?? entrypointAgent?.entrySkill ?? "using-superpowers";
```

Remove:

```ts
const settings = input.config.superagents ?? {};
const superpowersSkills: readonly string[] = settings.superpowersSkills ?? [];
const invocationOverlayNames = superpowersSkills.flatMap((skillName) => settings.skillOverlays?.[skillName] ?? []);
const entryOverlayNames = settings.skillOverlays?.[entrySkill] ?? [];
const overlaySkillNames = [...new Set([...entryOverlayNames, ...invocationOverlayNames])];
```

Remove `overlaySkillNames` from the returned profile object.

- [x] **Step 3: Change slash command registration signature**

In `src/slash/slash-commands.ts`, import `AgentConfig`:

```ts
import type { AgentConfig } from "../agents/agents.ts";
```

Change `registerSuperpowersCommand` parameters from `(commandName, preset)` to `(entrypointAgent)`:

```ts
function registerSuperpowersCommand(
	pi: ExtensionAPI,
	dispatcher: ReturnType<typeof createSuperpowersPromptDispatcher>,
	state: SubagentState,
	configSource: ConfigSource,
	entrypointAgent: AgentConfig,
): void {
	const commandName = entrypointAgent.command ?? entrypointAgent.name;
	pi.registerCommand(commandName, {
		description: entrypointAgent.description,
		handler: (rawArgs, ctx) => {
			if (notifyIfConfigBlocked(state, ctx)) return Promise.resolve();
			const config = readConfig(configSource);
			const parsed = parseSuperpowersWorkflowArgs(rawArgs);
			if (!parsed?.task) {
				if (ctx.hasUI) {
					ctx.ui.notify(`Usage: /${commandName} [lean|full|tdd|direct|subagents|no-subagents] <task> [--fork]`, "error");
				}
				return Promise.resolve();
			}
			const profile = resolveSuperpowersRunProfile({
				config,
				commandName,
				parsed,
				entrypointAgent,
			});
			sendSkillEntryPrompt(dispatcher, ctx, profile);
			return Promise.resolve();
		},
	});
}
```

- [x] **Step 4: Register only discovered entrypoint agents**

In `registerSlashCommands`, replace the config loop with:

```ts
const entrypointAgents = discoverAgents(state.baseCwd).agents.filter((agent) => agent.kind === "entrypoint" && agent.execution === "interactive" && (agent.command ?? agent.name));
for (const entrypointAgent of entrypointAgents) {
	registerSuperpowersCommand(pi, dispatcher, state, configSource, entrypointAgent);
}
```

Do not register config-only commands.

- [x] **Step 5: Remove stale imports and config preset wording**

In `src/slash/slash-commands.ts`:

- Remove `SuperpowersCommandPreset` from the type import.
- Update file header from “configured custom commands” to “interactive entrypoint agent commands”.
- Update the `registerSlashCommands` docblock to say custom commands require entrypoint agent files.

- [x] **Step 6: Update workflow profile tests**

In `test/unit/superpowers-workflow-profile.test.ts`:

- Remove `entrySkill` and `description` from config fixtures.
- Remove all `overlaySkillNames` assertions.
- Change the default `sp-implement` test to pass an `entrypointAgent` with `entrySkill: "using-superpowers"`.
- Replace overlay tests with one test proving `entrySkill` comes from `entrypointAgent`:

```ts
void it("resolves entry skill from the interactive entrypoint agent", () => {
	const parsed = parseSuperpowersWorkflowArgs("design onboarding")!;
	const profile = resolveSuperpowersRunProfile({
		config: {
			superagents: {
				commands: {
					"sp-brainstorm": { usePlannotator: true },
				},
			},
		},
		commandName: "sp-brainstorm",
		parsed,
		entrypointAgent: {
			name: "sp-brainstorm",
			description: "Brainstorm",
			kind: "entrypoint",
			execution: "interactive",
			command: "sp-brainstorm",
			entrySkill: "brainstorming",
			systemPrompt: "Body",
			source: "builtin",
			filePath: "/agents/sp-brainstorm.md",
		},
	});

	assert.equal(profile.entrySkill, "brainstorming");
	assert.equal(profile.usePlannotatorReview, true);
});
```

- [x] **Step 7: Update integration tests that used config-only custom commands**

In `test/integration/slash-commands.test.ts`:

- For the custom command preset test, create a project entrypoint file before registration:

```ts
const agentsDir = path.join(cwd, ".agents");
fs.mkdirSync(agentsDir, { recursive: true });
fs.writeFileSync(
	path.join(agentsDir, "sp-review.md"),
	[
		"---",
		"name: sp-review",
		"description: Run code review",
		"kind: entrypoint",
		"execution: interactive",
		"command: sp-review",
		"entrySkill: using-superpowers",
		"---",
		"Custom review entrypoint.",
	].join("\n"),
	"utf-8",
);
```

- Keep behavior flags in config only:

```ts
"sp-review": {
	useSubagents: false,
	useTestDrivenDevelopment: false,
	worktrees: { enabled: false },
}
```

- Remove any `entrySkill` or `description` config entries.

- [x] **Step 8: Run focused tests**

Run:

```bash
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/slash-commands.test.ts
node --experimental-strip-types --test test/unit/superpowers-workflow-profile.test.ts
```

Expected: slash registration and workflow profile tests pass after implementation.

- [x] **Step 9: Commit slash/profile changes**

```bash
git add src/slash/slash-commands.ts src/superpowers/workflow-profile.ts test/integration/slash-commands.test.ts test/unit/superpowers-workflow-profile.test.ts
git commit -m "feat: register superpowers commands from entrypoint agents"
```

---

### Task 4: Remove skill overlay prompt plumbing

**Files:**
- Modify: `src/superpowers/skill-entry.ts`
- Modify: `src/superpowers/root-prompt.ts`
- Modify: `test/unit/superpowers-skill-entry.test.ts`
- Modify: `test/unit/superpowers-root-prompt.test.ts`
- Modify: `test/integration/slash-commands.test.ts`

- [x] **Step 1: Simplify skill-entry prompt input**

In `src/superpowers/skill-entry.ts`:

- Remove `overlaySkills?: ResolvedSkill[]` from `SkillEntryPromptInput`.
- Remove `overlaySkills: ResolvedSkill[]` from `BuildSkillEntryPromptInputParams`.
- Remove `resolveSkillNames` work for `input.profile.overlaySkillNames`.
- Remove the missing overlay error branch.
- Pass only `usingSuperpowersSkill`, `entrySkill`, and `rootLifecycleSkills` into `buildSkillEntryPromptInput`.

The `buildResolvedSkillEntryPrompt` middle should become:

```ts
const usingSuperpowersSkill = input.resolveSkill(input.cwd, "using-superpowers");
const entrySkillName = input.profile.entrySkill;
const entrySkill = entrySkillName ? input.resolveSkill(input.cwd, entrySkillName) : undefined;
const rootLifecycleResolution = input.resolveSkillNames(input.profile.rootLifecycleSkillNames ?? [], input.cwd);

if (!entrySkill) {
	return { error: `Superpowers entry skill could not be resolved: ${entrySkillName ?? "unknown"}` };
}
if (rootLifecycleResolution.missing.length > 0) {
	return { error: `Superpowers root lifecycle skills could not be resolved: ${rootLifecycleResolution.missing.join(", ")}` };
}
```

- [x] **Step 2: Remove overlay prompt block**

In `src/superpowers/root-prompt.ts`:

- Remove `overlaySkills?: SuperpowersRootPromptSkill[]` from `SuperpowersRootPromptInput`.
- Delete any `buildOverlaySkillBlock` helper.
- Remove the overlay block from `buildSuperpowersRootPrompt` output.

Keep entry skill and root lifecycle skill blocks intact.

- [x] **Step 3: Update skill-entry tests**

In `test/unit/superpowers-skill-entry.test.ts`:

- Rename “builds prompt input with resolved entry, overlay, and lifecycle skills” to “builds prompt input with resolved entry and lifecycle skills”.
- Remove `overlaySkillNames` and `overlaySkills` from profile/input fixtures.
- Remove assertions about `input.overlaySkills`.
- Delete the test “returns error when overlay skills cannot be resolved”.

- [x] **Step 4: Update root prompt tests**

In `test/unit/superpowers-root-prompt.test.ts`:

- Remove overlay fixture inputs.
- Remove assertions that prompt contains “Overlay skills:” or overlay skill content.
- Add/assert `assert.doesNotMatch(prompt, /Overlay skills:/);` in entry-skill tests.

- [x] **Step 5: Update slash integration tests**

In `test/integration/slash-commands.test.ts`:

- Remove the `/sp-brainstorm reports unresolved overlay skills without sending a prompt` test.
- Remove any `skillOverlays` config setup.
- Keep `assert.doesNotMatch(prompt, /Overlay skills:/)` for `/sp-brainstorm` and `/sp-plan` prompt tests.

- [x] **Step 6: Run focused tests**

Run:

```bash
node --experimental-strip-types --test test/unit/superpowers-skill-entry.test.ts test/unit/superpowers-root-prompt.test.ts
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/slash-commands.test.ts
```

Expected: overlay-specific tests are gone and root prompt tests pass.

- [x] **Step 7: Commit overlay removal**

```bash
git add src/superpowers/skill-entry.ts src/superpowers/root-prompt.ts test/unit/superpowers-skill-entry.test.ts test/unit/superpowers-root-prompt.test.ts test/integration/slash-commands.test.ts
git commit -m "refactor: remove superpowers skill overlay plumbing"
```

---

### Task 5: Add stale command behavior warnings and install default-copy behavior

**Files:**
- Modify: `src/execution/config-validation.ts`
- Modify: `src/extension/config-store.ts`
- Modify: `src/extension/index.ts`
- Modify: `install.mjs`
- Modify: `test/unit/config-validation.test.ts`
- Modify: `test/unit/config-store.test.ts`
- Modify: `test/e2e/e2e-sandbox-install.test.ts` if it asserts empty config creation

- [x] **Step 1: Add optional entrypoint command validation**

In `src/execution/config-validation.ts`, extend function signatures:

```ts
export interface ConfigValidationOptions {
	entrypointCommands?: readonly string[];
}

export function validateConfigObject(rawConfig: unknown, options: ConfigValidationOptions = {}): ConfigValidationResult {
```

After validating command preset shape, add warning logic:

```ts
const entrypointCommandSet = options.entrypointCommands ? new Set(options.entrypointCommands) : undefined;
```

Inside command iteration, after `validateCommandPreset(...)`:

```ts
if (entrypointCommandSet && !entrypointCommandSet.has(commandName)) {
	diagnostics.push({
		level: "warning",
		code: "unknown_entrypoint_command",
		path: `superagents.commands.${commandName}`,
		message: "does not match any discovered interactive entrypoint agent command. Add an entrypoint agent markdown file or remove this behavior block.",
	});
}
```

Update `loadEffectiveConfig` signature:

```ts
export function loadEffectiveConfig(defaults: ExtensionConfig, userConfig: unknown, options: ConfigValidationOptions = {}): EffectiveConfigResult {
```

Call `validateConfigObject(userConfig, options)`.

- [x] **Step 2: Add validation tests for stale command warnings**

In `test/unit/config-validation.test.ts`, add:

```ts
void it("warns when command behavior has no matching entrypoint command", () => {
	const result = validateConfigObject(
		{
			superagents: {
				commands: {
					"sp-implement": { useSubagents: true },
					"sp-missing": { useSubagents: false },
				},
			},
		},
		{ entrypointCommands: ["sp-implement"] },
	);

	assert.equal(result.blocked, false);
	assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.path), ["superagents.commands.sp-missing"]);
	assert.equal(result.diagnostics[0]?.level, "warning");
});
```

- [x] **Step 3: Pass entrypoint command names through runtime config store**

In `src/extension/config-store.ts`, update signatures:

```ts
export function loadRuntimeConfigState(packageConfigDir: string, userConfigDir = packageConfigDir, entrypointCommands: readonly string[] = []): LoadedConfigState {
```

Change load call:

```ts
const result = loadEffectiveConfig(bundledDefaults, userConfig, { entrypointCommands });
```

Update `createRuntimeConfigStore` signature:

```ts
export function createRuntimeConfigStore(packageConfigDir: string, userConfigDir = packageConfigDir, getEntrypointCommands: () => readonly string[] = () => []): RuntimeConfigStore {
	let currentState = loadRuntimeConfigState(packageConfigDir, userConfigDir, getEntrypointCommands());
```

And reload:

```ts
currentState = loadRuntimeConfigState(packageConfigDir, userConfigDir, getEntrypointCommands());
```

- [x] **Step 4: Discover entrypoint command names in extension startup**

In `src/extension/index.ts`, import `discoverAgents` if not already imported there, and create a helper near config store setup:

```ts
function discoverEntrypointCommandNames(cwd: string): string[] {
	return discoverAgents(cwd).agents
		.filter((agent) => agent.kind === "entrypoint" && agent.execution === "interactive")
		.map((agent) => agent.command ?? agent.name)
		.filter((commandName): commandName is string => Boolean(commandName));
}
```

Pass this to `createRuntimeConfigStore`:

```ts
const configStore = createRuntimeConfigStore(packageRoot, undefined, () => discoverEntrypointCommandNames(process.cwd()));
```

If current arguments differ, preserve existing package/user config directory values and add callback as the last parameter.

- [x] **Step 5: Update config-store tests**

In `test/unit/config-store.test.ts`, add a case where `config.json` contains `sp-missing`, call `loadRuntimeConfigState(packageDir, userDir, ["sp-implement"])`, and assert a non-blocking warning path `superagents.commands.sp-missing`.

- [x] **Step 6: Change installer config creation**

In `install.mjs`, replace `ensureUserConfig` implementation with default-copy behavior:

```js
function ensureUserConfig() {
	if (fs.existsSync(USER_CONFIG_PATH)) return false;
	if (fs.existsSync(DEFAULT_CONFIG_PATH)) {
		fs.copyFileSync(DEFAULT_CONFIG_PATH, USER_CONFIG_PATH);
	} else {
		fs.writeFileSync(USER_CONFIG_PATH, "{}\n", "utf-8");
	}
	return true;
}
```

Update comments and install output from “created empty” to “created from defaults”:

```js
Config file: ${USER_CONFIG_PATH}${createdUserConfig ? " (created from defaults)" : ""}
```

- [x] **Step 7: Update installer migration helper text**

Since a copied default is now expected on fresh install, change the legacy warning in `validateUserConfigFile` from:

```js
"config.json appears to duplicate bundled defaults. Replace it with {} and keep only local overrides."
```

to:

```js
"config.json matches bundled defaults. This is valid for fresh installs; edit only the behavior flags you want to change."
```

Update `migrateUserConfigForInstall` text or leave the migration command as a manual legacy cleanup tool. If left, rename output to make clear it is optional cleanup, not required validity.

- [x] **Step 8: Update installer tests if needed**

Search for empty config assertions:

```bash
grep -R "created empty\|{}\\n\|duplicate bundled defaults" -n test install.mjs
```

Update tests to expect default-copy behavior and new text.

- [x] **Step 9: Run focused tests**

Run:

```bash
node --experimental-strip-types --test test/unit/config-validation.test.ts test/unit/config-store.test.ts
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/e2e/e2e-sandbox-install.test.ts
```

Expected: config warnings are non-blocking and installer tests match default-copy behavior.

- [x] **Step 10: Commit validation/install changes**

```bash
git add src/execution/config-validation.ts src/extension/config-store.ts src/extension/index.ts install.mjs test/unit/config-validation.test.ts test/unit/config-store.test.ts test/e2e/e2e-sandbox-install.test.ts
git commit -m "feat: warn on stale superpowers command behavior config"
```

---

### Task 6: Update settings UI for behavior-only command config

**Files:**
- Modify: `src/ui/sp-settings.ts`
- Modify: `src/superpowers/config-writer.ts`
- Modify: `test/unit/sp-settings.test.ts`
- Modify: `test/unit/superpowers-config-writer.test.ts`

- [x] **Step 1: Inspect current settings UI assumptions**

Open `src/ui/sp-settings.ts` and find:

```ts
private commandNames(): string[] {
	const names = Object.keys(this.getConfig().superagents?.commands ?? {});
	return names.length > 0 ? names : ["sp-implement"];
}
```

This can stay behavior-config-driven for toggles, but labels must not imply config defines commands. If there is text showing `description` or `entrySkill`, remove it.

- [x] **Step 2: Ensure config writer creates behavior-only blocks**

In `src/superpowers/config-writer.ts`, no metadata should be created. Verify `toggleSuperpowersCommandSetting` and `toggleSuperpowersWorktrees` only write behavior keys. If any helper writes `description`, `entrySkill`, or `skillOverlays`, delete that code and add tests.

- [x] **Step 3: Update settings UI copy**

In `src/ui/sp-settings.ts`, change “Commands:” section copy to “Command behavior flags:” or equivalent. Ensure listed settings are only:

```ts
usePlannotator
useSubagents
useTestDrivenDevelopment
useBranches
worktrees.enabled
worktrees.root
```

- [x] **Step 4: Update settings tests**

In `test/unit/sp-settings.test.ts`, remove any expected display of command metadata and add assertions that behavior flags still render and toggle. In `test/unit/superpowers-config-writer.test.ts`, assert toggles produce objects like:

```ts
{
	superagents: {
		commands: {
			"sp-plan": { usePlannotator: true },
		},
	},
}
```

and never add `description`, `entrySkill`, or `skillOverlays`.

- [x] **Step 5: Run focused tests**

Run:

```bash
node --experimental-strip-types --test test/unit/sp-settings.test.ts test/unit/superpowers-config-writer.test.ts
```

Expected: settings and config-writer tests pass.

- [x] **Step 6: Commit settings changes**

```bash
git add src/ui/sp-settings.ts src/superpowers/config-writer.ts test/unit/sp-settings.test.ts test/unit/superpowers-config-writer.test.ts
git commit -m "refactor: show behavior-only superpowers command settings"
```

---

### Task 7: Update documentation and examples

**Files:**
- Modify: `README.md`
- Modify: `docs/configuration.md`
- Modify: `docs/worktrees.md`
- Modify: `docs/parameters.md`
- Modify: `docs/skills.md`
- Modify: `CHANGELOG.md` if this branch keeps unreleased notes

- [x] **Step 1: Update README feature bullets**

In `README.md`, replace the “Skill Overlays” feature bullet with text that says skills are selected by Superpowers trigger logic, while entrypoint lifecycle skills live in agent frontmatter. Update “Custom Commands” to say custom slash commands are created by adding interactive entrypoint agent markdown files, with optional behavior flags in `config.json`.

- [x] **Step 2: Update README installation config wording**

Change:

```markdown
On install, `pi-superagents` creates an empty user override file:
```

to:

```markdown
On install, `pi-superagents` creates `config.json` from the bundled defaults:
```

- [x] **Step 3: Rewrite `docs/configuration.md` command section**

Document this boundary:

```markdown
Slash commands are registered from interactive entrypoint agents. `config.json` only controls behavior flags for commands that already exist as entrypoint agents.
```

Include a custom command example as an agent file plus optional config block:

```markdown
`~/.pi/agent/agents/sp-review.md`

```yaml
---
name: sp-review
description: Review code through the Superpowers workflow
kind: entrypoint
execution: interactive
command: sp-review
entrySkill: using-superpowers
---

Review code and produce actionable findings.
```

`config.json`

```json
{
  "superagents": {
    "commands": {
      "sp-review": {
        "useSubagents": false,
        "useTestDrivenDevelopment": false
      }
    }
  }
}
```
```

- [x] **Step 4: Remove overlay docs**

In `README.md`, `docs/configuration.md`, and `docs/skills.md`, remove `skillOverlays` examples and replace with guidance:

```markdown
Do not preload domain skills through command config. Superpowers starts with `using-superpowers`, which selects relevant skills based on the task and each skill's trigger. Entrypoint `skills` are reserved for lifecycle/root skills with explicit trigger points.
```

- [x] **Step 5: Update worktree docs**

In `docs/worktrees.md`, ensure worktree examples show behavior-only config:

```json
{
  "superagents": {
    "commands": {
      "sp-implement": {
        "worktrees": { "enabled": true, "root": "../worktrees" }
      }
    }
  }
}
```

- [x] **Step 6: Update parameters docs**

In `docs/parameters.md`, update any slash-command/config examples to remove `description`, `entrySkill`, and `skillOverlays`. Keep subagent tool parameter docs unchanged unless they reference overlays.

- [x] **Step 7: Update skills docs**

In `docs/skills.md`, document supported entrypoint frontmatter fields:

```yaml
---
name: sp-example
description: Example Superpowers entrypoint
kind: entrypoint
execution: interactive
command: sp-example
entrySkill: using-superpowers
skills: verification-before-completion
---
```

Explain that `skills` is lifecycle-only for root entrypoints and not a replacement for overlays.

- [x] **Step 8: Search docs for removed keys**

Run:

```bash
grep -R "skillOverlays\|entrySkill\|description.*commands\|custom command.*config" -n README.md docs config.example.json default-config.json
```

Expected: `entrySkill` only appears in entrypoint-agent documentation, not config examples. `skillOverlays` has no active config examples.

- [x] **Step 9: Add a brief changelog entry**

Update `CHANGELOG.md` with a short entry that emphasizes intent, not implementation detail. Use concise wording like:

```markdown
- Moved Superpowers slash-command metadata into entrypoint agent frontmatter so `config.json` only carries runtime behavior flags. Added `/sp-brainstorm` and `/sp-plan` entrypoint agents and removed skill overlay config to keep Superpowers skill selection trigger-driven.
```

- [x] **Step 10: Commit docs and changelog changes**

```bash
git add README.md docs/configuration.md docs/worktrees.md docs/parameters.md docs/skills.md CHANGELOG.md
git commit -m "docs: document entrypoint-owned superpowers commands"
```

---

### Task 8: Full verification and cleanup

**Files:**
- Modify as needed based on test failures.

- [x] **Step 1: Run repository-wide removed-key search**

Run:

```bash
grep -R "skillOverlays\|overlaySkillNames\|overlaySkills\|commands.*description\|commands.*entrySkill" -n src test README.md docs default-config.json config.example.json
```

Expected:

- No `skillOverlays`, `overlaySkillNames`, or `overlaySkills` in `src` or active tests.
- `entrySkill` remains in agent frontmatter docs and agent parsing code only.
- `description` remains for agent frontmatter and normal command registration descriptions, not command config schema.

- [x] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [x] **Step 3: Run unit tests**

Run:

```bash
npm run test:unit
```

Expected: PASS.

- [x] **Step 4: Run integration tests**

Run:

```bash
npm run test:integration
```

Expected: PASS.

- [x] **Step 5: Run e2e tests**

Run:

```bash
npm run test:e2e
```

Expected: PASS.

- [x] **Step 6: Run full QA**

Run:

```bash
npm run qa
```

Expected: PASS. Note that `npm run qa` may format files via `biome check --write`; inspect the diff afterward.

- [x] **Step 7: Inspect final diff**

Run:

```bash
git status --short
git diff --stat
git diff -- README.md docs/configuration.md docs/worktrees.md docs/parameters.md docs/skills.md default-config.json config.example.json
```

Expected: only intended implementation, tests, config templates, and docs changed.

- [x] **Step 8: Final commit**

If QA changed formatting or final fixes were needed, commit them:

```bash
git add .
git commit -m "chore: verify entrypoint command config migration"
```

If there are no changes, skip this commit.

---

## Self-Review

Spec coverage:

- Entrypoint agent command ownership is covered by Tasks 1 and 3.
- Behavior-only config boundary is covered by Task 2.
- Removal of `skillOverlays` and no entrypoint overlays is covered by Tasks 2 and 4.
- Built-in `/sp-brainstorm` and `/sp-plan` agents are covered by Task 1.
- Stale command warnings and installer semantics are covered by Task 5.
- Documentation updates are covered by Task 7.
- Tests and verification are covered across each task plus Task 8.

Placeholder scan: no placeholders remain. Every task includes exact files, commands, expected outcomes, and concrete snippets where implementation code is required.

Type consistency: `SuperpowersCommandPreset`, `ResolvedSuperpowersRunProfile`, `AgentConfig`, and config validation names are consistent across tasks.
