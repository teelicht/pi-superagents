# Subagent Extension Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make subagent Pi launches isolated by default while adding `superagents.extensions` as a global allowlist that is combined with agent frontmatter extensions.

**Architecture:** Apply the base behavior from PR #17 by ensuring subagent execution passes a defined extensions array so `buildPiArgs()` emits `--no-extensions`. Add a small resolver in `superagents-config.ts` that merges global config extensions with agent frontmatter extensions. Keep CLI argument construction responsible for preserving path-like tool extension entries.

**Tech Stack:** TypeScript, Node test runner, Pi CLI argument construction, JSON config validation and merge helpers, Markdown docs.

---

## Context Map

### Files to Modify
| File | Purpose | Changes Needed |
|------|---------|----------------|
| `src/shared/types.ts` | Runtime and config contracts | Add `extensions?: string[]` to `SuperpowersSettings`. |
| `src/execution/superagents-config.ts` | Shared Superagents config helper functions | Add `resolveSubagentExtensions(config, agentExtensions)` with documentation header. |
| `src/execution/pi-args.ts` | Converts execution settings into Pi CLI args | Preserve path-like tool extension args even when `input.extensions` is defined. |
| `src/execution/execution.ts` | Launches child Pi process for one subagent | Use PR #17 isolation behavior plus merged global/agent extensions. |
| `src/execution/config-validation.ts` | Validates and merges `config.json` | Accept and validate `superagents.extensions`; merge with replace semantics. |
| `default-config.json` | Bundled runtime defaults | Add `superagents.extensions: []` without changing existing model values. |
| `config.example.json` | User config example | Add example global extension allowlist. |
| `README.md` | User overview | Mention isolated subagent extension loading and global allowlist. |
| `docs/configuration.md` | Config reference | Document `superagents.extensions`, validation, and examples. |
| `docs/worktrees.md` | Required docs update | Mention extension loading is independent from worktree isolation. |
| `docs/parameters.md` | Required docs update | Note subagent tool parameters do not include ad-hoc extensions; config/frontmatter controls them. |
| `docs/skills.md` | Agent frontmatter docs | Document `extensions` frontmatter as additive to global config. |

### Dependencies
| File | Relationship |
|------|--------------|
| `src/agents/agents.ts` | Already parses `extensions:` frontmatter into `agent.extensions`; no change expected. |
| `test/support/helpers.ts` | Already supports `extensions?: string[]` in helper configs; no change expected. |
| `src/execution/superpowers-policy.ts` | Resolves tools before `buildPiArgs()`; path-like tool entries must remain supported. |

### Test Files
| Test | Coverage |
|------|----------|
| `test/unit/pi-args.test.ts` | `--no-extensions`, explicit extension args, path-like tool extension preservation. |
| `test/unit/superagents-config.test.ts` | Global + agent extension merge order and empty defaults. |
| `test/unit/config-validation.test.ts` | Valid/invalid `superagents.extensions` and replace-merge behavior. |
| `test/integration/single-execution.test.ts` | PR #17 base behavior: subagent launch includes `--no-extensions`. |

### Reference Patterns
| File | Pattern |
|------|---------|
| `src/execution/config-validation.ts` | `interceptSkillCommands` uses replace semantics for arrays. |
| `src/execution/pi-args.ts` | Existing `toolExtensionPaths` extraction from path-like tool entries. |
| `src/execution/superagents-config.ts` | Small pure resolver helpers with TSDoc comments. |
| `docs/configuration.md` | Configuration key tables and override examples. |

### Risk Assessment
- [ ] Breaking changes to public API: yes, subagents no longer implicitly inherit globally installed Pi extensions; intentional and documented.
- [ ] Database migrations needed: no.
- [ ] Configuration changes required: optional; users add `superagents.extensions` only when they need global subagent extension allowlist entries.
- [ ] Existing uncommitted user changes: do not overwrite `AGENTS.md` or existing `default-config.json` model edits.

---

### Task 1: Apply PR #17 Base Isolation Behavior Safely

**Files:**
- Modify: `src/execution/execution.ts`
- Modify: `test/integration/single-execution.test.ts`

- [x] **Step 1: Fetch PR #17 without switching branches or worktrees**

Run:

```bash
git fetch origin pull/17/head:refs/remotes/origin/pr-17
```

Expected: command exits `0`. It may print fetch progress.

- [x] **Step 2: Inspect the PR #17 patch before applying it**

Run:

```bash
git diff HEAD...origin/pr-17 -- src/execution/execution.ts test/integration/single-execution.test.ts
```

Expected: diff shows the base change from `extensions: agent.extensions` to an isolated default equivalent, plus an integration test asserting `--no-extensions` for missing agent extensions.

- [x] **Step 3: Apply the PR #17 patch to the current working tree**

Run:

```bash
git diff HEAD...origin/pr-17 -- src/execution/execution.ts test/integration/single-execution.test.ts > /tmp/pi-superagents-pr17.patch
git apply /tmp/pi-superagents-pr17.patch
```

Expected: `git apply` exits `0`. If it conflicts because the PR was already merged, inspect with `git diff` and continue only if the current files already contain equivalent behavior and test coverage.

- [x] **Step 4: Verify the PR #17 integration test fails or passes for the expected reason before further changes**

Run:

```bash
npm run test:integration -- test/integration/single-execution.test.ts
```

Expected: If the PR patch applied cleanly, the test should pass or integration suite may skip optional Pi-dependent cases. If it fails, failure should point at argument wiring rather than syntax errors. Do not continue with global config changes until this base behavior is present.

- [x] **Step 5: Commit the PR #17 base behavior**

Run:

```bash
git add src/execution/execution.ts test/integration/single-execution.test.ts
git commit -m "fix: isolate subagent extension loading"
```

Expected: commit succeeds. Do not include unrelated existing changes in `AGENTS.md` or model edits in `default-config.json`.

---

### Task 2: Preserve Path-Like Tool Extensions in `buildPiArgs()`

**Files:**
- Modify: `test/unit/pi-args.test.ts`
- Modify: `src/execution/pi-args.ts`

- [x] **Step 1: Write failing unit tests for explicit extensions and tool-path extensions**

Append these tests inside `void describe("buildPiArgs session wiring", () => { ... })` in `test/unit/pi-args.test.ts`:

```typescript
	void it("emits --no-extensions when an explicit empty extension list is provided", () => {
		const { args } = buildPiArgs({
			baseArgs: ["--mode", "json", "-p"],
			task: "hello",
			sessionEnabled: false,
			extensions: [],
		});

		assert.ok(args.includes("--no-extensions"));
		assert.equal(args.includes("--extension"), false);
	});

	void it("keeps path-like tool extensions when explicit extensions are provided", () => {
		const { args } = buildPiArgs({
			baseArgs: ["--mode", "json", "-p"],
			task: "hello",
			sessionEnabled: false,
			tools: ["read", "./tools/custom-tool.ts"],
			extensions: ["./extensions/global.ts"],
		});

		assert.ok(args.includes("--no-extensions"));
		assert.deepEqual(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2), ["--tools", "read"]);
		assert.deepEqual(
			args.filter((arg, index) => arg === "--extension" || args[index - 1] === "--extension"),
			["--extension", "./extensions/global.ts", "--extension", "./tools/custom-tool.ts"],
		);
	});
```

- [x] **Step 2: Run the focused unit test and verify failure**

Run:

```bash
node --experimental-strip-types --test test/unit/pi-args.test.ts
```

Expected: first new test may pass if PR #17 behavior is already present in `buildPiArgs()`. Second new test must fail before implementation because `./tools/custom-tool.ts` is not emitted when `extensions` is defined.

- [x] **Step 3: Update `buildPiArgs()` to emit tool-path extensions in both branches**

In `src/execution/pi-args.ts`, replace the current extension block:

```typescript
	if (input.extensions !== undefined) {
		args.push("--no-extensions");
		for (const extPath of input.extensions) {
			args.push("--extension", extPath);
		}
	} else {
		for (const extPath of toolExtensionPaths) {
			args.push("--extension", extPath);
		}
	}
```

with:

```typescript
	if (input.extensions !== undefined) {
		args.push("--no-extensions");
		for (const extPath of input.extensions) {
			args.push("--extension", extPath);
		}
	}
	for (const extPath of toolExtensionPaths) {
		args.push("--extension", extPath);
	}
```

This preserves legacy path-like tool extension behavior when `extensions` is undefined and also preserves it for isolated subagent launches.

- [x] **Step 4: Run the focused unit test and verify pass**

Run:

```bash
node --experimental-strip-types --test test/unit/pi-args.test.ts
```

Expected: all tests in `test/unit/pi-args.test.ts` pass.

- [x] **Step 5: Commit the CLI arg fix**

Run:

```bash
git add test/unit/pi-args.test.ts src/execution/pi-args.ts
git commit -m "fix: preserve tool extension args"
```

Expected: commit succeeds.

---

### Task 3: Add Global Extension Resolution Helper

**Files:**
- Modify: `test/unit/superagents-config.test.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/execution/superagents-config.ts`
- Modify: `src/execution/execution.ts`

- [ ] **Step 1: Write failing resolver tests**

Update the import in `test/unit/superagents-config.test.ts` from:

```typescript
import { getSuperagentSettings, resolveSuperagentWorktreeCreateOptions, resolveSuperagentWorktreeEnabled } from "../../src/execution/superagents-config.ts";
```

to:

```typescript
import { getSuperagentSettings, resolveSubagentExtensions, resolveSuperagentWorktreeCreateOptions, resolveSuperagentWorktreeEnabled } from "../../src/execution/superagents-config.ts";
```

Then add these tests inside the existing `describe` block:

```typescript
	/**
	 * Verifies global and agent-specific extensions are additive and ordered.
	 *
	 * @returns Nothing; asserts extension resolution order.
	 */
	void it("combines global subagent extensions before agent extensions", () => {
		assert.deepEqual(
			resolveSubagentExtensions(
				{ superagents: { extensions: ["./global-a.ts", "./global-b.ts"] } },
				["./agent-only.ts"],
			),
			["./global-a.ts", "./global-b.ts", "./agent-only.ts"],
		);
	});

	/**
	 * Verifies missing config and missing frontmatter still produce a defined empty list.
	 *
	 * @returns Nothing; asserts default isolation input shape.
	 */
	void it("returns an empty extension list when no config or agent extensions exist", () => {
		assert.deepEqual(resolveSubagentExtensions({}, undefined), []);
	});
```

- [ ] **Step 2: Run resolver tests and verify failure**

Run:

```bash
node --experimental-strip-types --test test/unit/superagents-config.test.ts
```

Expected: fails because `resolveSubagentExtensions` is not exported.

- [ ] **Step 3: Add `extensions` to the Superagents settings type**

In `src/shared/types.ts`, update `SuperpowersSettings` to include `extensions?: string[]`:

```typescript
export interface SuperpowersSettings {
	commands?: Record<string, SuperpowersCommandPreset>;
	modelTiers?: Record<string, ModelTierSetting>;
	skillOverlays?: SkillOverlayConfig;
	interceptSkillCommands?: string[];
	extensions?: string[];
	superpowersSkills?: string[];
}
```

- [ ] **Step 4: Implement the resolver**

Add this function to `src/execution/superagents-config.ts` after `getSuperagentSettings()`:

```typescript
/**
 * Resolve Pi extension entrypoints passed to every child subagent process.
 *
 * Inputs/outputs:
 * - reads global allowlisted extensions from `superagents.extensions`
 * - appends agent frontmatter extensions after global extensions
 * - always returns a defined array so callers can request isolated Pi extension loading
 *
 * @param config Extension config containing optional Superagents extension allowlist.
 * @param agentExtensions Optional extensions declared by the selected agent frontmatter.
 * @returns Ordered extension entrypoints for the child Pi process.
 */
export function resolveSubagentExtensions(config: ExtensionConfig, agentExtensions: string[] | undefined): string[] {
	return [...(config.superagents?.extensions ?? []), ...(agentExtensions ?? [])];
}
```

- [ ] **Step 5: Wire the resolver into execution**

In `src/execution/execution.ts`, update the import:

```typescript
import { inferExecutionRole, resolveModelForAgent, resolveRoleTools } from "./superpowers-policy.ts";
```

Add:

```typescript
import { resolveSubagentExtensions } from "./superagents-config.ts";
```

Then add this near `effectiveTools`:

```typescript
	const effectiveExtensions = resolveSubagentExtensions(config, agent.extensions);
```

Replace the `buildPiArgs()` field:

```typescript
		extensions: agent.extensions,
```

with:

```typescript
		extensions: effectiveExtensions,
```

- [ ] **Step 6: Run focused tests and verify pass**

Run:

```bash
node --experimental-strip-types --test test/unit/superagents-config.test.ts test/unit/pi-args.test.ts
npm run test:integration -- test/integration/single-execution.test.ts
```

Expected: unit tests pass; integration test passes or skips optional Pi-dependent cases.

- [ ] **Step 7: Commit extension resolution wiring**

Run:

```bash
git add test/unit/superagents-config.test.ts src/shared/types.ts src/execution/superagents-config.ts src/execution/execution.ts
git commit -m "feat: resolve global subagent extensions"
```

Expected: commit succeeds.

---

### Task 4: Validate and Merge `superagents.extensions`

**Files:**
- Modify: `test/unit/config-validation.test.ts`
- Modify: `src/execution/config-validation.ts`

- [ ] **Step 1: Write failing config validation tests**

Add these tests inside `void describe("config validation", () => { ... })` in `test/unit/config-validation.test.ts`, near the existing array-merge tests:

```typescript
	void it("accepts and merges global subagent extensions with replace semantics", () => {
		const result = loadEffectiveConfig(
			{
				superagents: {
					...defaults.superagents,
					extensions: ["./default-extension.ts"],
				},
			},
			{
				superagents: {
					extensions: ["./user-extension.ts"],
				},
			},
		);

		assert.equal(result.blocked, false);
		assert.deepEqual(result.diagnostics, []);
		assert.deepEqual(result.config.superagents?.extensions, ["./user-extension.ts"]);
	});

	void it("rejects malformed global subagent extensions", () => {
		const result = validateConfigObject({
			superagents: {
				extensions: ["./ok.ts", "", 42],
			},
		});

		assert.equal(result.blocked, true);
		assert.deepEqual(
			result.diagnostics.map((diagnostic) => diagnostic.path),
			["superagents.extensions[1]", "superagents.extensions[2]"],
		);
	});

	void it("rejects non-array global subagent extensions", () => {
		const result = validateConfigObject({
			superagents: {
				extensions: "./not-an-array.ts",
			},
		});

		assert.equal(result.blocked, true);
		assert.deepEqual(
			result.diagnostics.map((diagnostic) => diagnostic.path),
			["superagents.extensions"],
		);
	});
```

- [ ] **Step 2: Run validation tests and verify failure**

Run:

```bash
node --experimental-strip-types --test test/unit/config-validation.test.ts
```

Expected: tests fail because `superagents.extensions` is currently an unknown key or does not merge correctly.

- [ ] **Step 3: Add `extensions` to supported Superagents keys**

In `src/execution/config-validation.ts`, update:

```typescript
const SUPERAGENTS_KEYS = new Set(["commands", "modelTiers", "skillOverlays", "interceptSkillCommands", "superpowersSkills"]);
```

to:

```typescript
const SUPERAGENTS_KEYS = new Set(["commands", "modelTiers", "skillOverlays", "interceptSkillCommands", "extensions", "superpowersSkills"]);
```

- [ ] **Step 4: Add a reusable non-empty string array validator**

Add this function near `validateSkillNameArray()` in `src/execution/config-validation.ts`:

```typescript
/**
 * Validate an array whose entries must all be non-empty strings.
 *
 * @param diagnostics Mutable diagnostic accumulator.
 * @param value Unknown array value.
 * @param path Dot-separated path for diagnostics.
 * @param label Human-readable value label used in diagnostics.
 */
function validateNonEmptyStringArray(diagnostics: ConfigDiagnostic[], value: unknown, path: string, label: string): void {
	if (!Array.isArray(value)) {
		addError(diagnostics, path, `must be an array of non-empty ${label}.`);
		return;
	}
	value.forEach((entry, index) => {
		if (typeof entry !== "string" || !entry.trim()) {
			addError(diagnostics, `${path}[${index}]`, `must be a non-empty ${label}.`);
		}
	});
}
```

Then simplify `validateSkillNameArray()` to call the new helper:

```typescript
function validateSkillNameArray(diagnostics: ConfigDiagnostic[], value: unknown, path: string): void {
	validateNonEmptyStringArray(diagnostics, value, path, "skill name");
}
```

- [ ] **Step 5: Validate `superagents.extensions`**

In `validateConfigObject()`, after the `interceptSkillCommands` validation block and before the `superpowersSkills` block, add:

```typescript
			if ("extensions" in superagents) {
				validateNonEmptyStringArray(diagnostics, superagents.extensions, "superagents.extensions", "extension path");
			}
```

- [ ] **Step 6: Merge `extensions` with replace semantics**

In `mergeConfig()`, after `mergedInterceptSkillCommands`, add:

```typescript
	// Replace-not-merge for globally allowlisted child Pi extensions.
	const mergedExtensions = overrideSuperagents?.extensions ?? defaultSuperagents?.extensions ?? [];
```

In the `mergedSuperagents` object, add:

```typescript
				extensions: mergedExtensions,
```

near `interceptSkillCommands: mergedInterceptSkillCommands,`.

- [ ] **Step 7: Run validation tests and verify pass**

Run:

```bash
node --experimental-strip-types --test test/unit/config-validation.test.ts
```

Expected: all validation tests pass.

- [ ] **Step 8: Commit config validation and merge**

Run:

```bash
git add test/unit/config-validation.test.ts src/execution/config-validation.ts
git commit -m "feat: validate global subagent extensions"
```

Expected: commit succeeds.

---

### Task 5: Update Defaults and User-Facing Documentation

**Files:**
- Modify: `default-config.json`
- Modify: `config.example.json`
- Modify: `README.md`
- Modify: `docs/configuration.md`
- Modify: `docs/worktrees.md`
- Modify: `docs/parameters.md`
- Modify: `docs/skills.md`

- [ ] **Step 1: Update bundled defaults without overwriting existing local edits**

In `default-config.json`, add `"extensions": []` as a direct child of `superagents`. Keep the current local `modelTiers.max` value exactly as it is in the working tree.

Expected shape:

```json
{
  "superagents": {
    "extensions": [],
    "commands": {
      "sp-implement": {
        "description": "Run a Superpowers implementation workflow",
        "entrySkill": "using-superpowers",
        "useSubagents": true,
        "useTestDrivenDevelopment": true,
        "useBranches": false,
        "worktrees": { "enabled": false, "root": null }
      }
    }
  }
}
```

Only add the `extensions` line; do not rewrite unrelated JSON values.

- [ ] **Step 2: Update `config.example.json`**

Add an example `extensions` array under `superagents` before `commands`:

```json
    "extensions": [
      "./src/extension/custom-subagent-tools.ts"
    ],
```

Expected: file remains parseable JSON.

- [ ] **Step 3: Update README feature list**

In `README.md`, add one bullet after `Skill Overlays`:

```markdown
- **Subagent Extension Allowlist**: Subagents run with implicit Pi extension discovery disabled by default; configure `superagents.extensions` for extensions every subagent should receive.
```

- [ ] **Step 4: Update `docs/configuration.md` key table and example**

In the `superagents` key table, add:

```markdown
| `extensions` | Global allowlist of Pi extension entrypoints passed to every subagent. Subagents do not inherit globally installed Pi extensions by default. |
```

After the existing worktree override example, add:

````markdown
Allow specific Pi extensions for every subagent:

```json
{
  "superagents": {
    "extensions": [
      "./src/extension/custom-subagent-tools.ts"
    ]
  }
}
```

Agent frontmatter `extensions:` entries are appended after these global entries for that specific agent.
````

- [ ] **Step 5: Update `docs/parameters.md`**

After the main tool parameter table, add:

```markdown
The `subagent` tool does not accept ad-hoc Pi extension paths. Child Pi extension loading is controlled by `superagents.extensions` for global allowlisted extensions and by `extensions:` in agent frontmatter for role-specific additions. Subagents launch with implicit Pi extension discovery disabled by default.
```

- [ ] **Step 6: Update `docs/skills.md` agent frontmatter table**

Add this row to the Agent Frontmatter table:

```markdown
| `extensions` | No | Comma-separated Pi extension entrypoints to append for this agent. Global `superagents.extensions` entries are loaded first. |
```

- [ ] **Step 7: Update `docs/worktrees.md`**

In the Usage or Internals section, add:

```markdown
Extension loading is separate from worktree isolation. Subagents disable implicit Pi extension discovery by default in every worktree mode; use `superagents.extensions` or agent frontmatter `extensions:` to make specific Pi extensions available.
```

- [ ] **Step 8: Validate JSON and run docs-adjacent tests**

Run:

```bash
node -e 'JSON.parse(require("node:fs").readFileSync("default-config.json", "utf8")); JSON.parse(require("node:fs").readFileSync("config.example.json", "utf8")); console.log("json ok")'
node --experimental-strip-types --test test/unit/default-config.test.ts test/unit/config-validation.test.ts
```

Expected: prints `json ok`; tests pass.

- [ ] **Step 9: Commit defaults and docs**

Run:

```bash
git add default-config.json config.example.json README.md docs/configuration.md docs/worktrees.md docs/parameters.md docs/skills.md
git commit -m "docs: document subagent extension allowlist"
```

Expected: commit succeeds. Confirm `AGENTS.md` is not included unless the user separately asked for that change.

---

### Task 6: Final Verification and Review Prep

**Files:**
- Read-only verification across the repository.

- [ ] **Step 1: Run full quality gate**

Run:

```bash
npm run qa
```

Expected: Biome check/write completes, TypeScript passes, unit/integration/e2e tests pass or documented optional harness skips appear as existing behavior.

- [ ] **Step 2: Inspect final diff**

Run:

```bash
git status --short
git diff --stat HEAD~5..HEAD
git diff HEAD~5..HEAD -- src/execution/execution.ts src/execution/pi-args.ts src/execution/superagents-config.ts src/execution/config-validation.ts src/shared/types.ts
```

Expected: changes match this plan. No unrelated `AGENTS.md` changes are staged or committed by these tasks.

- [ ] **Step 3: Confirm PR #17 behavior is represented**

Run:

```bash
grep -R "--no-extensions" -n src test | cat
```

Expected: output includes `src/execution/pi-args.ts`, unit tests, and the PR #17 integration test in `test/integration/single-execution.test.ts`.

- [ ] **Step 4: Summarize implementation for review**

Prepare a review summary with these bullets:

```markdown
Summary:
- Subagent child Pi processes now disable implicit extension discovery by passing a defined extensions array into `buildPiArgs()`.
- Added `superagents.extensions` as a global allowlist merged before agent frontmatter `extensions:`.
- Preserved path-like `tools` entries as explicit `--extension` args even when extension isolation is enabled.
- Updated validation, defaults, examples, and user docs.

Tests:
- `node --experimental-strip-types --test test/unit/pi-args.test.ts`
- `node --experimental-strip-types --test test/unit/superagents-config.test.ts`
- `node --experimental-strip-types --test test/unit/config-validation.test.ts`
- `npm run qa`
```

- [ ] **Step 5: Commit any formatter-only changes if `npm run qa` produced them**

Run:

```bash
git status --short
```

If Biome changed files, run:

```bash
git add <formatted-files>
git commit -m "chore: format extension allowlist changes"
```

Expected: final `git status --short` contains only pre-existing user changes that were intentionally left untouched, such as `AGENTS.md`, or is clean.

---

## Self-Review

- Spec coverage: PR #17 base behavior is Task 1; global `superagents.extensions` is Tasks 3-5; frontmatter additive behavior is Task 3; tool-path extension preservation is Task 2; validation/docs/tests are Tasks 4-6.
- Placeholder scan: no placeholder tasks remain; every code change step includes exact file paths, commands, and code snippets.
- Type consistency: the plan uses `extensions?: string[]` on `SuperpowersSettings`, `resolveSubagentExtensions(config, agentExtensions)`, and `effectiveExtensions` consistently across tests and implementation.
