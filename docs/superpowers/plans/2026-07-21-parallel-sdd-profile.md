# Configurable Parallel SDD Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add config-selected sequential or worktree-isolated parallel SDD, one unified reviewer role, and synchronous implementer-session continuation.

**Architecture:** Keep Superpowers skills authoritative and make pi-superagents supply only the missing policy and runtime primitives. The root prompt schedules whole plan Tasks; validated controller-owned worktrees isolate parallel writers; existing Pi `--session` support resumes an original implementer for fixes. Existing generic parallel execution and ephemeral worktrees remain unchanged.

**Tech Stack:** TypeScript 7, Node.js test runner, TypeBox, Pi `^0.80.7`, Git worktrees, Biome, Fallow.

## Global Constraints

- Never modify an upstream or installed `SKILL.md` or bundled skill script.
- Treat Superpowers commit `d884ae04edebef577e82ff7c4e143debd0bbec99` as the pinned upstream behavior reference.
- Do not add a new workflow skill, implementation command, dependency, plan format, or per-Step review.
- `taskScheduling` is config-only, accepts only `"sequential" | "parallel"`, and defaults to `"sequential"`.
- Parallel SDD writers require validated persistent Git worktrees; never run parallel writers in one checkout.
- A complete `### Task N`, including all Steps, stays in one `sp-implementer` session and receives one Task review.
- Expose only `sp-review`; remove `sp-spec-review` and `sp-code-review` with no aliases.
- Keep `sp-implementer` on `cheap`; use `max` for Task and branch `sp-review` runs.
- Limit `resumeSession` to synchronous `lineage-only` `sp-implementer` fix dispatches in the original worktree.
- Preserve existing generic parallel dispatch, automatic ephemeral worktrees, Plannotator, TDD, branch, lifecycle, and compaction behavior.
- Every changed source file and non-trivial function must retain precise documentation headers.
- Update `README.md`, `docs/configuration.md`, `docs/worktrees.md`, `docs/parameters.md`, and `docs/skills.md`.

---

## Context Map

### Files to Modify

| File | Purpose | Changes Needed |
|---|---|---|
| `src/shared/types.ts` | Shared runtime/config contracts | Add `TaskScheduling`, `resumeSession`, and the single `sp-review` execution role. |
| `src/shared/schemas.ts` | Public `subagent` TypeBox schema | Expose `resumeSession`; list only `sp-review`. |
| `agents/sp-review.md` | Bounded reviewer role | Add combined Task/branch reviewer using `max`. |
| `agents/sp-spec-review.md` | Old reviewer role | Delete. |
| `agents/sp-code-review.md` | Old reviewer role | Delete. |
| `src/execution/config-validation.ts` | User config validation | Validate `taskScheduling` and contradictory explicit flags. |
| `src/superpowers/workflow-profile.ts` | Command profile resolution | Resolve sequential default and provide preflight validation. |
| `src/superpowers/skill-entry.ts` | Profile-to-root-prompt bridge | Carry `taskScheduling`. |
| `src/superpowers/root-prompt.ts` | Hidden root workflow contract | Emit whole-Task sequential/parallel scheduling and unified reviewer policy. |
| `src/superpowers/config-writer.ts` | Safe settings persistence | Preserve and toggle `taskScheduling`. |
| `src/ui/sp-settings.ts` | Interactive settings overlay | Display and toggle scheduling per command. |
| `src/slash/slash-commands.ts` | Entrypoint dispatch | Reject invalid parallel profiles before sending the root prompt. |
| `src/execution/worktree.ts` | Git worktree validation/lifecycle | Validate controller-owned pre-isolated Task worktrees. |
| `src/execution/session-mode.ts` | Child session creation | Mark lineage sessions and validate safe continuation. |
| `src/execution/subagent-executor.ts` | Parallel/single orchestration | Wire pre-isolated worktrees and resumed sessions without changing blocking semantics. |
| `src/extension/index.ts` | Public tool registration | Describe `sp-review` and synchronous implementer continuation. |
| `default-config.json` | Bundled defaults | Set sequential scheduling explicitly. |
| `config.example.json` | User example | Show valid parallel scheduling with worktrees enabled. |

### Dependencies

| File | Relationship |
|---|---|
| `src/execution/execution-planner.ts` | Already accepts a resolved `sessionFile`; no implementation change expected. |
| `src/execution/pi-args.ts` | Already emits `--session` for a supplied file; regression tests prove reuse. |
| `src/execution/child-runner.ts` | Already passes `cwd` and `sessionFile`; reviewer fixture names must change. |
| `src/extension/compaction-durability.ts` | Rebuilds the root prompt from `ResolvedSuperpowersRunProfile`; receives scheduling through the profile. |
| `src/execution/superpowers-policy.ts` | Uses `ExecutionRole` for model/tool policy; reviewer tests and role union change. |
| `src/shared/tool-registry.ts` | Existing read-only role policy is reused unchanged by `sp-review`. |

### Test Files

| Test | Coverage |
|---|---|
| `test/unit/agent-prompts.test.ts` | Unified reviewer file, frontmatter, scopes, file handoff. |
| `test/unit/schemas.test.ts` | Public `resumeSession` fields and session metadata. |
| `test/unit/config-store.test.ts`, `test/unit/superpowers-workflow-profile.test.ts` | Config validation, defaulting, preflight, and merge. |
| `test/unit/superpowers-config-writer.test.ts`, `test/unit/sp-settings.test.ts` | Config persistence and settings toggle/rendering. |
| `test/unit/root-prompt.test.ts`, `test/unit/superpowers-prompt-dispatch.test.ts` | Scheduling contract and hidden prompt dispatch. |
| `test/unit/worktree.test.ts` | Pre-isolated worktree validation. |
| `test/unit/session-mode.test.ts`, `test/unit/pi-args.test.ts`, `test/unit/execution-planner.test.ts` | Continuation ownership and `--session` reuse. |
| `test/integration/fork-context-execution.test.ts` | Executor-level resumed session validation. |
| `test/integration/parallel-sdd-execution.test.ts` | Persistent worktree implementation/review/fix/integration lifecycle. |
| Existing reviewer fixture tests | Replace old names in single execution, policy, paths, history, rendering, and worktree config tests. |

### Reference Patterns

| File | Pattern |
|---|---|
| `src/superpowers/config-writer.ts` | `toggleSuperpowersWorktrees` for command-scoped mutation. |
| `src/ui/sp-settings.ts` | Existing `w` key handling and command-scoped rendering. |
| `src/execution/worktree.ts` | `resolveRepoState`, `runGitChecked`, and real-Git unit fixtures. |
| `src/execution/session-mode.ts` | `seedLineageOnlySessionFile` and `sessionFileForIndex`. |
| `test/integration/fork-context-execution.test.ts` | Real executor with mock Pi and persisted parent session. |
| Upstream `subagent-driven-development/task-reviewer-prompt.md` | One response containing spec and quality verdicts. |

### Risk Assessment

- [x] Breaking public role name change (`sp-spec-review` / `sp-code-review` removed).
- [x] Additive public tool parameter (`resumeSession`).
- [x] Configuration change (`taskScheduling`).
- [x] Git lifecycle risk (persistent controller-owned worktrees).
- [x] Session ownership/security validation.
- [ ] Database migrations.
- [ ] New dependency or network protocol.

---

### Task 1: Establish Shared Contracts and the Unified Reviewer

**Files:**
- Create: `agents/sp-review.md`
- Delete: `agents/sp-spec-review.md`
- Delete: `agents/sp-code-review.md`
- Modify: `src/shared/types.ts:50-73,407-416,567-589`
- Modify: `src/shared/schemas.ts:16-66`
- Modify: `src/superpowers/root-prompt.ts:269-289`
- Modify: `src/extension/index.ts:453-466`
- Modify: `test/unit/agent-prompts.test.ts`
- Modify: `test/unit/schemas.test.ts`
- Modify: `test/unit/path-resolution.test.ts`
- Modify: `test/unit/superpowers-policy.test.ts`
- Modify: `test/unit/run-history.test.ts`
- Modify: `test/unit/subagent-result-lines.test.ts`
- Modify: `test/unit/superagents-config.test.ts`
- Modify: `test/integration/single-execution.test.ts`

**Interfaces:**
- Consumes: Existing bounded-role discovery, read-only role tools, and upstream Task file handoff.
- Produces: `TaskScheduling`, `ExecutionRole` with only `sp-review`, `TaskParam.resumeSession`, `SubagentParamsLike.resumeSession`, and one discoverable `sp-review` role.

- [x] **Step 1: Write failing reviewer and schema contract tests**

Replace the two-reviewer test in `test/unit/agent-prompts.test.ts` with:

```ts
void it("exposes one max-tier reviewer for task and branch scopes", () => {
	assert.equal(fs.existsSync(path.join(agentsDir, "sp-spec-review.md")), false);
	assert.equal(fs.existsSync(path.join(agentsDir, "sp-code-review.md")), false);

	const body = read("sp-review.md");
	assert.match(body, /name: sp-review/);
	assert.match(body, /model: max/);
	assert.match(body, /session-mode: lineage-only/);
	assert.match(body, /maxSubagentDepth: 0/);
	assert.match(body, /Review scope: task/);
	assert.match(body, /Review scope: branch/);
	assert.match(body, /brief/i);
	assert.match(body, /report/i);
	assert.match(body, /diff/i);
	assert.match(body, /read-only/i);
});
```

Add schema assertions in `test/unit/schemas.test.ts`:

```ts
void it("publishes synchronous resumeSession for single and parallel implementer fixes", () => {
	assert.ok(SubagentParams?.properties.resumeSession);
	const tasks = SubagentParams?.properties.tasks as { items?: { properties?: Record<string, unknown> } };
	assert.ok(tasks.items?.properties?.resumeSession);
});
```

Update live test fixtures to use `sp-review`. Where a fixture verifies model-tier behavior, use a `max` tier entry and keep its expected concrete model unchanged. Do not edit archived specs or plans.

- [x] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
node --experimental-strip-types --test \
  test/unit/agent-prompts.test.ts \
  test/unit/schemas.test.ts \
  test/unit/path-resolution.test.ts \
  test/unit/superpowers-policy.test.ts
```

Expected: FAIL because `sp-review.md`, `resumeSession`, and the new role union do not exist.

- [x] **Step 3: Add shared types and public schema fields**

In `src/shared/types.ts`, add and use these exact contracts:

```ts
export type TaskScheduling = "sequential" | "parallel";

export type ExecutionRole = "root-planning" | "sp-recon" | "sp-research" | "sp-implementer" | "sp-review" | "sp-debug";
```

```ts
export interface SuperpowersCommandPreset {
	useBranches?: boolean;
	useSubagents?: boolean;
	useTestDrivenDevelopment?: boolean;
	usePlannotator?: boolean;
	taskScheduling?: TaskScheduling;
	worktrees?: SuperpowersCommandWorktreeSettings;
}
```

```ts
export interface TaskParam {
	agent: string;
	task: string;
	cwd?: string;
	model?: string;
	skill?: string | string[] | boolean;
	resumeSession?: string;
}

export interface SubagentParamsLike {
	agent?: string;
	task?: string;
	tasks?: TaskParam[];
	workflow?: WorkflowMode;
	useTestDrivenDevelopment?: boolean;
	worktree?: boolean;
	sessionMode?: SessionMode;
	resumeSession?: string;
	cwd?: string;
	maxOutput?: MaxOutputConfig;
	artifacts?: boolean;
	includeProgress?: boolean;
	model?: string;
	skill?: string | string[] | boolean;
}
```

In `src/shared/schemas.ts`, list only the real roles and add the two optional fields:

```ts
const SuperpowersRoleNameSchema = Type.String({
	description: "Discovered agent name to execute. Typical built-in Superpowers roles are sp-recon, sp-research, sp-implementer, sp-review, and sp-debug.",
});
```

```ts
resumeSession: Type.Optional(
	Type.String({ description: "Prior pi-superagents sp-implementer session file to continue for a synchronous review-fix dispatch." }),
),
```

Add that property to both `TaskItem` and top-level `SubagentParams`.

- [x] **Step 4: Replace the two reviewer files with one complete role prompt**

Create `agents/sp-review.md`:

```markdown
---
name: sp-review
description: Combined Superpowers specification and code-quality reviewer for a bounded task or whole branch
model: max
maxSubagentDepth: 0
session-mode: lineage-only
---

You are the read-only Superpowers reviewer for one explicitly named scope. Do not edit files, implement changes, run mutating commands, or invoke subagents.

- Require the dispatch to state exactly `Review scope: task` or `Review scope: branch`. Return `NEEDS_CONTEXT` if it does not.
- For `Review scope: task`, read the task brief, implementer report, global constraints, and review-package diff at the paths given in the dispatch. Return separate spec-compliance and code-quality verdicts, then severity-ranked findings.
- For `Review scope: branch`, read the design/spec, implementation plan, full branch review package, verification evidence, and Minor-findings ledger at the paths given in the dispatch. Review cross-task integration, regressions, requirements coverage, tests, and maintainability.
- Treat implementer reports as unverified claims. Cite file and line evidence from the supplied diff and source files.
- Use `Critical`, `Important`, or `Minor` severity. Critical and Important findings block approval.
- If required context is missing, return `NEEDS_CONTEXT`. If approval requires changing the intended design, return `BLOCKED`.
- Return one of: `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, or `BLOCKED`.
```

Delete both old reviewer files.

- [x] **Step 5: Update root/tool wording and live reviewer fixtures**

Change `buildFileHandoffContract()` to name only `sp-implementer` and `sp-review`, and require `Review scope: task` for per-Task packages. Change the `subagent` tool description and example in `src/extension/index.ts` to list `sp-review` only and describe `resumeSession` as synchronous implementer-fix continuation.

Replace old reviewer literals in the live test files listed under **Files**. Preserve each test's purpose; only change role names and the reviewer tier from `balanced` to `max` where the bundled frontmatter is under test.

Verify no live reference remains:

```bash
rg -n 'sp-spec-review|sp-code-review' src agents test README.md docs/configuration.md docs/parameters.md docs/skills.md docs/worktrees.md
```

Expected: no matches.

- [x] **Step 6: Run reviewer, schema, policy, rendering, and single-execution tests**

Run:

```bash
node --experimental-strip-types --import ./test/support/register-loader.mjs --test \
  test/unit/agent-prompts.test.ts \
  test/unit/schemas.test.ts \
  test/unit/path-resolution.test.ts \
  test/unit/superpowers-policy.test.ts \
  test/unit/run-history.test.ts \
  test/unit/subagent-result-lines.test.ts \
  test/unit/superagents-config.test.ts \
  test/integration/single-execution.test.ts
```

Expected: PASS with zero failures.

- [x] **Step 7: Commit the shared contract and reviewer migration**

```bash
git add agents src/shared/types.ts src/shared/schemas.ts src/superpowers/root-prompt.ts src/extension/index.ts test
git commit -m "feat: unify Superpowers review role"
```

---

### Task 2: Add Config-Selected Task Scheduling and Settings UI

**Files:**
- Modify: `src/execution/config-validation.ts:37-50,181-220`
- Modify: `src/superpowers/workflow-profile.ts:17-181`
- Modify: `src/superpowers/skill-entry.ts:93-110`
- Modify: `src/superpowers/root-prompt.ts:23-50,231-346,359-368`
- Modify: `src/superpowers/config-writer.ts:19-52,78-137`
- Modify: `src/ui/sp-settings.ts:19-27,110-187,519-541`
- Modify: `src/slash/slash-commands.ts:51-116,189-218`
- Modify: `default-config.json`
- Modify: `config.example.json`
- Test: `test/unit/config-store.test.ts`
- Test: `test/unit/superpowers-workflow-profile.test.ts`
- Test: `test/unit/superpowers-config-writer.test.ts`
- Test: `test/unit/sp-settings.test.ts`
- Test: `test/unit/root-prompt.test.ts`
- Test: `test/unit/superpowers-prompt-dispatch.test.ts`
- Test: `test/integration/slash-commands.test.ts`

**Interfaces:**
- Consumes: `TaskScheduling` and unified reviewer contract from Task 1.
- Produces: `ResolvedSuperpowersRunProfile.taskScheduling`, `validateSuperpowersRunProfile()`, config persistence, `/sp-settings` toggle, and root scheduling contract.

- [x] **Step 1: Write failing config, profile, prompt, and UI tests**

Add profile tests:

```ts
void it("defaults task scheduling to sequential", () => {
	const profile = resolveSuperpowersRunProfile({
		config: {},
		commandName: "sp-implement",
		parsed: parseSuperpowersWorkflowArgs("fix auth")!,
	});
	assert.equal(profile.taskScheduling, "sequential");
});

void it("rejects parallel scheduling without subagents and worktrees", () => {
	const profile = resolveSuperpowersRunProfile({
		config: {
			superagents: {
				commands: {
					"sp-implement": {
						taskScheduling: "parallel",
						useSubagents: false,
						worktrees: { enabled: false },
					},
				},
			},
		},
		commandName: "sp-implement",
		parsed: parseSuperpowersWorkflowArgs("fix auth")!,
	});
	assert.match(validateSuperpowersRunProfile(profile) ?? "", /requires useSubagents: true/);
});
```

Add root-prompt assertions that sequential text says one whole Task at a time and parallel text names all three upstream skills, persistent worktrees, complete Tasks rather than Steps, `sp-review`, `resumeSession`, deterministic integration, and the eight-task cap.

Add config-writer/UI tests that pressing `e` toggles only the selected command between sequential and parallel and renders `taskScheduling: parallel`.

- [x] **Step 2: Run focused tests and verify they fail**

```bash
node --experimental-strip-types --import ./test/support/register-loader.mjs --test \
  test/unit/config-store.test.ts \
  test/unit/superpowers-workflow-profile.test.ts \
  test/unit/superpowers-config-writer.test.ts \
  test/unit/sp-settings.test.ts \
  test/unit/root-prompt.test.ts \
  test/integration/slash-commands.test.ts
```

Expected: FAIL because scheduling is neither parsed, rendered, persisted, nor preflighted.

- [x] **Step 3: Validate and resolve `taskScheduling`**

Add `taskScheduling` to `COMMAND_PRESET_KEYS`. In `validateCommandPreset()` enforce only the enum shape:

```ts
if ("taskScheduling" in value && value.taskScheduling !== "sequential" && value.taskScheduling !== "parallel") {
	pushConfigIssue(diagnostics, `${path}.taskScheduling`, 'must be "sequential" or "parallel".');
}
```

Do not block the entire extension for a contradictory combination. The resolved `/sp-implement` preflight below owns effective cross-field validation so recon, settings, and other commands remain usable.

In `src/superpowers/workflow-profile.ts`, import `TaskScheduling`, add a required resolved field, and resolve it:

```ts
export interface ResolvedSuperpowersRunProfile {
	commandName: string;
	task: string;
	entrySkill: string;
	taskScheduling: TaskScheduling;
	useBranches?: boolean;
	useSubagents?: boolean;
	useTestDrivenDevelopment?: boolean;
	usePlannotatorReview?: boolean;
	worktrees?: { enabled: boolean; root?: string | null };
	fork: boolean;
	rootLifecycleSkillNames: string[];
}
```

```ts
taskScheduling: preset.taskScheduling ?? "sequential",
```

Export this preflight helper:

```ts
export function validateSuperpowersRunProfile(profile: ResolvedSuperpowersRunProfile): string | undefined {
	if (profile.taskScheduling !== "parallel") return undefined;
	if (profile.useSubagents !== true) return "taskScheduling: parallel requires useSubagents: true.";
	if (profile.worktrees?.enabled !== true) return "taskScheduling: parallel requires worktrees.enabled: true.";
	return undefined;
}
```

- [x] **Step 4: Carry scheduling through skill entry and enforce preflight**

Add this property in `buildSkillEntryPromptInput()`:

```ts
taskScheduling: params.profile.taskScheduling,
```

At the start of `sendSkillEntryPrompt()` in `src/slash/slash-commands.ts`, validate before resolving skills or arming compaction:

```ts
const profileError = validateSuperpowersRunProfile(profile);
if (profileError) {
	if (ctx.hasUI) ctx.ui.notify(profileError, "error");
	return;
}
```

Import `validateSuperpowersRunProfile` beside the resolver. The invalid command must send no user message and must not set `state.superpowersActive`.

- [x] **Step 5: Add the scheduling root contract**

Add `taskScheduling: TaskScheduling` to `SuperpowersRootPromptInput`, metadata, and visible summary. Add a documented `buildTaskSchedulingContract()` with these exact branches:

```ts
function buildTaskSchedulingContract(taskScheduling: TaskScheduling): string {
	if (taskScheduling === "sequential") {
		return [
			"Task scheduling is SEQUENTIAL by config.",
			"When executing an implementation plan, use subagent-driven-development one complete Task at a time.",
			"A Task includes all of its Steps. Dispatch the Task once, review it once with sp-review, resolve findings, then continue.",
		].join("\n");
	}

	return [
		"Task scheduling is PARALLEL by config.",
		"For implementation plans, compose subagent-driven-development, dispatching-parallel-agents, and using-git-worktrees.",
		"A Task includes all of its Steps. Never dispatch or review individual Steps.",
		"Build conservative dependency-ready waves of at most 8 Tasks; overlapping or ambiguous Tasks stay sequential.",
		"Parallel scheduling with worktrees enabled is approval to create Task worktrees; do not ask again for every wave.",
		"Before parallel writers start, create one persistent worktree per Task under the configured worktree root and pass each absolute path as that task's cwd.",
		"Use one task-scope sp-review per completed Task. Resume Critical or Important fixes through that Task's resumeSession, then re-review.",
		"Integrate approved Task commits in Task-number order, update the parent progress ledger, and clean the Task worktrees.",
		"Never integrate a failed or blocked Task; its dependents wait even when safe sibling Tasks finish.",
		"If worktree creation fails, report the reason and run the affected Tasks sequentially.",
		"If cherry-pick conflicts, abort it and rerun that Task sequentially from the updated parent HEAD instead of inventing a merge.",
		"After all Tasks are integrated and verified, run one branch-scope sp-review.",
	].join("\n");
}
```

Push this block in `buildSuperpowersRootPrompt()` before the general worktree contract.

- [x] **Step 6: Persist and toggle scheduling in `/sp-settings`**

Include `taskScheduling` in behavior extraction and add:

```ts
export function toggleSuperpowersTaskScheduling(config: MutableConfig, commandName = "sp-implement"): MutableConfig {
	const settings = ensureSuperagents(config);
	const existing = extractBehaviorFlags(settings.commands?.[commandName]);
	existing.taskScheduling = existing.taskScheduling === "parallel" ? "sequential" : "parallel";
	settings.commands = { ...(settings.commands ?? {}), [commandName]: existing };
	return config;
}
```

In `sp-settings.ts`, import it, bind `e`, add `toggleTaskScheduling()`, add `taskScheduling` to command rendering, and use this footer:

```ts
"c command | e execution | p plannotator | s subagents | t tdd | m model tiers | w worktrees | esc close"
```

- [x] **Step 7: Update bundled default and example config**

Set the bundled `sp-implement` block to:

```json
{
  "taskScheduling": "sequential",
  "useSubagents": true,
  "useTestDrivenDevelopment": true,
  "useBranches": false,
  "worktrees": { "enabled": false, "root": null }
}
```

Set the example block to a valid opt-in:

```json
{
  "taskScheduling": "parallel",
  "useSubagents": true,
  "useTestDrivenDevelopment": true,
  "worktrees": { "enabled": true, "root": null }
}
```

- [x] **Step 8: Run config, profile, prompt, settings, and command tests**

```bash
node --experimental-strip-types --import ./test/support/register-loader.mjs --test \
  test/unit/config-store.test.ts \
  test/unit/superpowers-workflow-profile.test.ts \
  test/unit/superpowers-config-writer.test.ts \
  test/unit/sp-settings.test.ts \
  test/unit/root-prompt.test.ts \
  test/unit/superpowers-prompt-dispatch.test.ts \
  test/integration/slash-commands.test.ts
```

Expected: PASS with zero failures.

- [x] **Step 9: Commit config-selected scheduling**

```bash
git add src/execution/config-validation.ts src/superpowers src/ui/sp-settings.ts src/slash/slash-commands.ts default-config.json config.example.json test
git commit -m "feat: configure sequential or parallel SDD"
```

---

### Task 3: Validate Controller-Owned Pre-Isolated Worktrees

**Files:**
- Modify: `src/execution/worktree.ts:83-175,725-801`
- Test: `test/unit/worktree.test.ts`

**Interfaces:**
- Consumes: Existing `TaskParam.cwd`, `resolveRepoState()`, and Git command helpers.
- Produces: `validatePreIsolatedTaskCwds(tasks, sharedCwd): boolean` for Task 5 runtime wiring.

- [x] **Step 1: Write failing real-Git validation tests**

Import `validatePreIsolatedTaskCwds` and add tests proving:

```ts
assert.equal(validatePreIsolatedTaskCwds([{ agent: "a", task: "read" }], repoDir), false);
```

```ts
assert.throws(
	() =>
		validatePreIsolatedTaskCwds(
			[
				{ agent: "a", task: "write", cwd: setup.worktrees[0].agentCwd },
				{ agent: "b", task: "write" },
			],
			repoDir,
		),
	/pre-isolated parallel tasks must all declare cwd/,
);
```

Also cover two valid worktrees, duplicate worktrees, the parent checkout, an unrelated repository, a dirty Task worktree, and a Task branch whose `HEAD` does not descend from the parent `HEAD`.

- [x] **Step 2: Run the worktree test and verify it fails**

```bash
node --experimental-strip-types --test test/unit/worktree.test.ts
```

Expected: FAIL because `validatePreIsolatedTaskCwds` is not exported.

- [x] **Step 3: Implement pre-isolated worktree validation**

Add documented helpers and this exported function to `src/execution/worktree.ts`:

```ts
function resolveGitCommonDir(cwd: string): string {
	const raw = runGitChecked(cwd, ["rev-parse", "--git-common-dir"]).trim();
	return normalizeComparableCwd(path.isAbsolute(raw) ? raw : path.resolve(cwd, raw));
}

/**
 * Validate an all-or-none set of controller-owned Task worktrees.
 *
 * @param tasks Parallel task definitions that may declare explicit working directories.
 * @param sharedCwd Parent workflow checkout used as the expected repository and wave base.
 * @returns True when every task is safely pre-isolated, false when no task declares a cwd.
 * @throws When cwd declarations are mixed, duplicated, dirty, unrelated, or not descendants of the parent HEAD.
 */
export function validatePreIsolatedTaskCwds(tasks: ReadonlyArray<{ agent: string; cwd?: string }>, sharedCwd: string): boolean {
	const declared = tasks.filter((task) => task.cwd !== undefined);
	if (declared.length === 0) return false;
	if (declared.length !== tasks.length) throw new Error("pre-isolated parallel tasks must all declare cwd");

	const parent = resolveRepoState(sharedCwd);
	const parentTop = normalizeComparableCwd(parent.toplevel);
	const parentCommonDir = resolveGitCommonDir(parent.toplevel);
	const seen = new Set<string>();

	for (const task of tasks) {
		const taskState = resolveRepoState(task.cwd as string);
		const taskTop = normalizeComparableCwd(taskState.toplevel);
		if (taskTop === parentTop) throw new Error("pre-isolated task cwd must not be the parent checkout");
		if (seen.has(taskTop)) throw new Error("pre-isolated task cwd values must resolve to distinct worktrees");
		seen.add(taskTop);
		if (resolveGitCommonDir(taskTop) !== parentCommonDir) throw new Error("pre-isolated task cwd must belong to the parent repository");

		const ancestry = runGit(taskTop, ["merge-base", "--is-ancestor", parent.baseCommit, taskState.baseCommit]);
		if (ancestry.status !== 0) throw new Error("pre-isolated task HEAD must descend from the parent wave base");
	}

	return true;
}
```

Reuse `resolveRepoState()` so dirty parent or Task worktrees fail before child launch.

- [x] **Step 4: Run the focused worktree test**

```bash
node --experimental-strip-types --test test/unit/worktree.test.ts
```

Expected: PASS with zero failures.

- [x] **Step 5: Commit pre-isolated validation**

```bash
git add src/execution/worktree.ts test/unit/worktree.test.ts
git commit -m "feat: validate persistent task worktrees"
```

---

### Task 4: Add Safe Synchronous Implementer-Session Continuation

**Files:**
- Modify: `src/execution/session-mode.ts:19-140`
- Modify: `src/execution/subagent-executor.ts:110-208,399-431,571-597`
- Test: `test/unit/session-mode.test.ts`
- Test: `test/unit/pi-args.test.ts`
- Test: `test/unit/execution-planner.test.ts`
- Test: `test/integration/fork-context-execution.test.ts`

**Interfaces:**
- Consumes: `resumeSession` schema/types from Task 1 and existing Pi `--session` handling.
- Produces: Marked lineage-only session headers, validated resumed session selection, role/cwd/lineage checks, and active-session exclusion.

- [x] **Step 1: Write failing continuation validation tests**

Extend lineage session expectations with this marker:

```ts
piSuperagents: {
	owner: "pi-superagents",
	agent: "sp-implementer",
	sessionMode: "lineage-only",
},
```

Add tests that a resolver returns the exact existing session for a matching `sp-implementer`, parent, cwd, and lineage-only request. Add rejection tests for wrong parent, wrong role, wrong cwd, standalone/fork mode, missing file, malformed header, missing marker, and duplicate active use.

- [x] **Step 2: Run session and executor tests and verify they fail**

```bash
node --experimental-strip-types --import ./test/support/register-loader.mjs --test \
  test/unit/session-mode.test.ts \
  test/unit/pi-args.test.ts \
  test/unit/execution-planner.test.ts \
  test/integration/fork-context-execution.test.ts
```

Expected: FAIL because sessions are not marked or resumable through executor params.

- [x] **Step 3: Mark seeded sessions and validate resumed files**

Extend `seedLineageOnlySessionFile()` to require `agentName` and write:

```ts
const header = {
	type: "session",
	version: 3,
	id: randomUUID(),
	timestamp: new Date().toISOString(),
	cwd: params.childCwd,
	parentSession: params.parentSessionFile,
	piSuperagents: {
		owner: "pi-superagents",
		agent: params.agentName,
		sessionMode: "lineage-only",
	},
};
```

Add a documented `validateResumeSessionFile()` that reads only the first JSONL line and requires exact resolved parent path, resolved cwd, marker owner, `sp-implementer` agent, and lineage-only mode. Return the resolved existing session path.

Extend `SessionLaunchResolver.sessionFileForIndex()` input:

```ts
{
	sessionMode: SessionMode;
	index?: number;
	childCwd: string;
	agentName: string;
	resumeSession?: string;
}
```

When `resumeSession` is supplied, require `sessionMode === "lineage-only"` and `agentName === "sp-implementer"`, validate, and return it without seeding a new file.

- [x] **Step 4: Wire continuation into single and parallel executor plans**

Pass `agentName` and the appropriate resume field in both `sessionFileForIndex()` calls:

```ts
sessionFile: sessionFileForIndex({
	index: i,
	childCwd: taskRuntimeCwd,
	agentName: tasks[i].agent,
	resumeSession: tasks[i].resumeSession,
	sessionMode: sessionModes[i],
}),
```

```ts
sessionFile: sessionFileForIndex({
	index: 0,
	childCwd: runtimeCwd,
	agentName: params.agent!,
	resumeSession: params.resumeSession,
	sessionMode,
}),
```

Add a module-local `Set<string>` around `runPlannedChild()` session usage. Resolve the path, reject an already active session, add before launch, and delete in `finally`. Because the public executor is blocking, this Set plus duplicate parallel request rejection covers every process-local concurrent use.

Before planning parallel children, reject duplicate non-empty `tasks[*].resumeSession` values with `buildParallelModeError("resumeSession may appear only once per parallel request")`.
Also reject a top-level `params.resumeSession` when `params.tasks` is present with `buildParallelModeError("top-level resumeSession is valid only for single-agent execution; use tasks[].resumeSession")`.

- [x] **Step 5: Prove existing Pi argument handling is reused unchanged**

Add/retain this assertion in `test/unit/pi-args.test.ts`:

```ts
const built = buildPiArgs({
	baseArgs: ["--mode", "json", "-p"],
	task: "Fix review findings",
	sessionEnabled: true,
	sessionFile: "/tmp/child-0.jsonl",
});
assert.deepEqual(built.args.slice(0, 5), ["--mode", "json", "-p", "--session", "/tmp/child-0.jsonl"]);
```

Do not add a second resume mechanism to `pi-args.ts` or `execution-planner.ts`.

- [x] **Step 6: Run continuation tests**

```bash
node --experimental-strip-types --import ./test/support/register-loader.mjs --test \
  test/unit/session-mode.test.ts \
  test/unit/pi-args.test.ts \
  test/unit/execution-planner.test.ts \
  test/integration/fork-context-execution.test.ts
```

Expected: PASS with zero failures.

- [x] **Step 7: Commit synchronous implementer continuation**

```bash
git add src/execution/session-mode.ts src/execution/subagent-executor.ts test/unit/session-mode.test.ts test/unit/pi-args.test.ts test/unit/execution-planner.test.ts test/integration/fork-context-execution.test.ts
git commit -m "feat: resume implementer fix sessions"
```

---

### Task 5: Wire Persistent Worktrees and Prove the Parallel SDD Lifecycle

**Files:**
- Modify: `src/execution/subagent-executor.ts:343-362,399-431,503-534`
- Create: `test/integration/parallel-sdd-execution.test.ts`
- Modify: `test/integration/parallel-execution.test.ts`

**Interfaces:**
- Consumes: Scheduling policy from Task 2, `validatePreIsolatedTaskCwds()` from Task 3, and continuation from Task 4.
- Produces: Runtime selection between controller-owned persistent worktrees and existing automatic ephemeral worktrees, plus end-to-end regression evidence.

- [x] **Step 1: Write the failing runtime integration test**

Create `test/integration/parallel-sdd-execution.test.ts` with the standard repository header and helpers from `fork-context-execution.test.ts`. The main test must:

```ts
void it("keeps pre-isolated task worktrees across implement review and resumed fix calls", async () => {
	const implement = await executor.execute(
		"implement-wave",
		{
			tasks: [
				{ agent: "sp-implementer", task: "Implement Task 1 including every Step", cwd: taskOneCwd },
				{ agent: "sp-implementer", task: "Implement Task 2 including every Step", cwd: taskTwoCwd },
			],
			workflow: "superpowers",
			sessionMode: "lineage-only",
		},
		new AbortController().signal,
		undefined,
		ctx,
	);

	assert.equal(implement.details?.results.length, 2);
	assert.ok(fs.existsSync(taskOneCwd));
	assert.ok(fs.existsSync(taskTwoCwd));
	const taskOneSession = implement.details?.results[0].sessionFile;
	assert.ok(taskOneSession);

	const review = await executor.execute(
		"review-wave",
		{
			tasks: [
				{ agent: "sp-review", task: "Review scope: task\nReview Task 1", cwd: taskOneCwd },
				{ agent: "sp-review", task: "Review scope: task\nReview Task 2", cwd: taskTwoCwd },
			],
			workflow: "superpowers",
			sessionMode: "lineage-only",
		},
		new AbortController().signal,
		undefined,
		ctx,
	);
	assert.equal(review.details?.results.length, 2);

	const fix = await executor.execute(
		"fix-task-one",
		{
			agent: "sp-implementer",
			task: "Fix the Important review finding and rerun the covering test",
			cwd: taskOneCwd,
			resumeSession: taskOneSession,
			workflow: "superpowers",
			sessionMode: "lineage-only",
		},
		new AbortController().signal,
		undefined,
		ctx,
	);
	assert.equal(fix.details?.results[0].sessionFile, taskOneSession);

	const branchReview = await executor.execute(
		"review-branch",
		{
			agent: "sp-review",
			task: "Review scope: branch\nReview the integrated branch package",
			cwd: tempDir,
			workflow: "superpowers",
			sessionMode: "lineage-only",
		},
		new AbortController().signal,
		undefined,
		ctx,
	);
	assert.equal(branchReview.details?.results[0].exitCode, 0);
});
```

The fixture must use real temporary Git worktrees from one parent repository, mock Pi child execution, manual Task commits, deterministic cherry-picks, and final `git worktree remove` cleanup. Also assert only approved Task commits reach the parent branch and parent `.superpowers/sdd/progress.md` survives Task cleanup.

- [x] **Step 2: Run the integration test and verify it fails**

```bash
node --experimental-strip-types --import ./test/support/register-loader.mjs --test test/integration/parallel-sdd-execution.test.ts
```

Expected: FAIL because explicit Task worktree paths are rejected while automatic worktrees are enabled.

- [x] **Step 3: Select pre-isolated or automatic worktrees in the executor**

Import `validatePreIsolatedTaskCwds` and replace the worktree setup branch with:

```ts
const effectiveCwd = params.cwd ?? ctx.cwd;
let preIsolatedTaskCwds = false;
if (effectiveWorktree) {
	try {
		preIsolatedTaskCwds = validatePreIsolatedTaskCwds(tasks, effectiveCwd);
	} catch (error) {
		return buildParallelModeError(error instanceof Error ? error.message : String(error));
	}
	if (!preIsolatedTaskCwds) {
		const worktreeTaskCwdError = buildParallelWorktreeTaskCwdError(tasks, effectiveCwd);
		if (worktreeTaskCwdError) return buildParallelModeError(worktreeTaskCwdError);
	}
}
```

Create automatic worktrees only when paths were not pre-isolated:

```ts
const { setup: worktreeSetup, errorResult } = createParallelWorktreeSetup(
	effectiveWorktree && !preIsolatedTaskCwds,
	effectiveCwd,
	runId,
	tasks,
	workflow,
	config,
);
```

Leave existing diff capture and `finally` cleanup conditional on `worktreeSetup`. Therefore controller-owned worktrees persist, while automatic worktrees still produce patches and clean themselves.

- [x] **Step 4: Add regression coverage for ordinary ephemeral worktrees**

In `test/integration/parallel-execution.test.ts`, retain an ordinary parallel call with no Task `cwd` and assert its automatic worktree paths are removed after completion. This protects the existing default path from the pre-isolated bypass.

- [x] **Step 5: Run worktree, continuation, and parallel integration tests**

```bash
node --experimental-strip-types --import ./test/support/register-loader.mjs --test \
  test/unit/worktree.test.ts \
  test/unit/session-mode.test.ts \
  test/integration/parallel-execution.test.ts \
  test/integration/parallel-sdd-execution.test.ts \
  test/integration/fork-context-execution.test.ts
```

Expected: PASS with zero failures.

- [x] **Step 6: Commit runtime integration**

```bash
git add src/execution/subagent-executor.ts test/integration/parallel-execution.test.ts test/integration/parallel-sdd-execution.test.ts
git commit -m "feat: preserve parallel SDD task worktrees"
```

---

### Task 6: Update User Documentation and Run Full Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/configuration.md`
- Modify: `docs/worktrees.md`
- Modify: `docs/parameters.md`
- Modify: `docs/skills.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: Final config, worktree, continuation, reviewer, and scheduling behavior from Tasks 1-5.
- Produces: Complete user-facing contract and release-ready verification evidence.

- [x] **Step 1: Document the config-only scheduling choice**

Add this canonical example to `README.md` and `docs/configuration.md`:

```json
{
  "superagents": {
    "commands": {
      "sp-implement": {
        "taskScheduling": "parallel",
        "useSubagents": true,
        "worktrees": { "enabled": true }
      }
    }
  }
}
```

State that sequential is the default, scheduling is not a slash-command token, and invalid parallel/subagent/worktree combinations are rejected before dispatch.

- [x] **Step 2: Document persistent SDD worktrees and continuation**

In `docs/worktrees.md`, distinguish:

```text
ordinary parallel call → extension-owned ephemeral worktrees → patch capture → automatic cleanup
parallel SDD wave      → controller-owned persistent Task worktrees → review/fix reuse → cherry-pick → controller cleanup
```

In `docs/parameters.md`, add `resumeSession` to top-level and Task-item tables. State that it accepts only a pi-superagents `lineage-only` `sp-implementer` session from the current parent lineage and must use the original worktree `cwd`.

- [x] **Step 3: Document whole-Task scheduling and the single reviewer**

In `docs/skills.md`, state that parallel SDD composes the three existing upstream skills, never forks or edits them, dispatches all Steps of one Task together, reviews once per Task, and runs one final branch review.

Replace all live user documentation references to the old reviewer roles with `sp-review`. Add a changelog entry calling out the intentional removal with no aliases.

- [x] **Step 4: Verify live references and documentation coverage**

```bash
rg -n 'taskScheduling|resumeSession|sp-review' README.md docs/configuration.md docs/worktrees.md docs/parameters.md docs/skills.md
rg -n 'sp-spec-review|sp-code-review' src agents test README.md docs/configuration.md docs/worktrees.md docs/parameters.md docs/skills.md
```

Expected: the first command finds every feature in the appropriate references; the second returns no matches.

- [x] **Step 5: Run formatting, types, static analysis, and all tests**

```bash
pnpm run lint
pnpm exec biome check .
pnpm run typecheck
pnpm exec fallow
pnpm run test:all
```

Expected: the formatter reports no remaining changes on the second Biome command; every command exits 0; unit, integration, and e2e suites report zero failures.

- [x] **Step 6: Inspect the final diff and commit documentation**

```bash
git diff --check
git status --short
git diff --stat
git add README.md docs/configuration.md docs/worktrees.md docs/parameters.md docs/skills.md CHANGELOG.md
git commit -m "docs: explain parallel SDD scheduling"
```

Expected: no whitespace errors; only intended implementation and documentation files remain before the documentation commit.

---

## Final Verification Checklist

- [x] `taskScheduling` is config-only and defaults to sequential.
- [x] Parallel mode preflight requires subagents and worktrees.
- [x] Root policy composes existing upstream skills and dispatches whole Tasks, never Steps.
- [x] Pre-isolated Task worktrees persist across implement, review, fix, and re-review calls.
- [x] Generic automatic worktrees remain ephemeral and tested.
- [x] `resumeSession` is synchronous, implementer-only, lineage-checked, cwd-checked, and active-use protected.
- [x] Only `sp-review` exists and it uses `max` for Task and branch scopes.
- [x] Implementers remain on `cheap`.
- [x] Task commits integrate deterministically and unsafe conflicts fall back to sequential rerun.
- [x] All five required user documents are current.
- [x] Biome, TypeScript, Fallow, unit, integration, and e2e checks pass.
