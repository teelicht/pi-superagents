# Superpowers v6.2 Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Pi Superagents a thin adapter over Superpowers v6.2's authoritative SDD lifecycle while preserving Pi-owned role routing, scheduling, and parallel Task worktrees.

**Architecture:** Replace copied SDD lifecycle mechanics in the generated root prompt with a scope-routing adapter, and make the bounded reviewer defer valid-scope behavior to the upstream template included in each dispatch. Keep sequential/parallel ordering and Task-worktree integration local, but let upstream own review cadence, retries, adjudication, plan workspace, ledger, and final cleanup.

**Tech Stack:** TypeScript 7, Node.js test runner, Markdown agent prompts and documentation, pnpm 11, Biome 2.5.

## Global Constraints

- Require Superpowers v6.2 or newer.
- Do not add runtime version detection or support for pre-v6.2 SDD contracts.
- Upstream Superpowers is the sole authority for SDD scripts, workspace/ledger paths, handoff files, review behavior, retry/adjudication, and final plan-workspace cleanup.
- Pi Superagents retains only role routing, `Review scope: task|re-review|branch`, conditional `resumeSession`, sequential/parallel Task scheduling, and parallel Task-worktree orchestration.
- Final upstream SDD cleanup must complete after a clean final branch review and before `finishing-a-development-branch`.
- No test may copy or execute upstream Superpowers scripts.
- Use TypeScript for application code; keep existing source-file and function documentation accurate.
- Update `README.md`, `docs/configuration.md`, `docs/worktrees.md`, `docs/parameters.md`, and `docs/skills.md` with every behavior change.
- Add no dependency.

## File Map

| File | Responsibility | Planned change |
| --- | --- | --- |
| `src/superpowers/root-prompt.ts` | Builds the hidden Superpowers root-session contract | Replace copied file-handoff mechanics with the Pi adapter and narrow scheduling text to Pi-owned orchestration. |
| `test/unit/root-prompt.test.ts` | Guards generated root prompt policy | Add positive adapter/scope/cleanup assertions and negative pre-v6.2 assertions. |
| `agents/sp-review.md` | Defines the bounded read-only reviewer | Add `re-review` and make supplied upstream templates authoritative for every valid scope. |
| `test/unit/agent-prompts.test.ts` | Guards bounded role contracts | Assert all three scopes and template delegation. |
| `test/integration/parallel-sdd-execution.test.ts` | Exercises parallel Task worktrees, review/fix dispatch, and integration | Replace the committed flat ledger fixture with an ignored plan-scoped ledger. |
| `README.md` | Short installation and workflow overview | State the v6.2+ floor and upstream lifecycle ownership. |
| `docs/configuration.md` | Configuration and generated-contract reference | Remove copied script/cleanup details and document three reviewer scopes. |
| `docs/worktrees.md` | Worktree ownership and lifecycle reference | Separate Pi-owned Task worktrees from upstream-owned plan workspace and conditional implementer resume. |
| `docs/parameters.md` | `subagent` tool API | Tie `resumeSession` use to upstream's request to resume the original implementer. |
| `docs/skills.md` | Skill and role behavior reference | Document the three scope markers and upstream SDD authority. |
| `CHANGELOG.md` | Release history | Add an unreleased compatibility entry. |

---

### Task 1: Replace the copied root-prompt lifecycle with the v6.2 adapter

**Files:**
- Modify: `test/unit/root-prompt.test.ts:7-63`
- Modify: `src/superpowers/root-prompt.ts:262-323,372-376`

**Interfaces:**
- Consumes: `SuperpowersRootPromptInput.useSubagents`, `taskScheduling`, and existing root lifecycle skill names.
- Produces: `buildSuperpowersRootPrompt(input): string` containing the three exact review markers, conditional `resumeSession` guidance, and cleanup-before-finishing invariant without upstream script or workspace details.

- [ ] **Step 1: Replace the old file-handoff assertions with failing v6.2 adapter assertions**

```typescript
void describe("root prompt SDD adapter contract", () => {
	void it("emits the upstream-authoritative SDD adapter when useSubagents is true", () => {
		const prompt = buildSuperpowersRootPrompt({ ...base, useSubagents: true });
		assert.match(prompt, /Superpowers SDD Adapter Contract/);
		assert.match(prompt, /selected upstream.*subagent-driven-development.*authoritative/i);
		assert.match(prompt, /Review scope: task/);
		assert.match(prompt, /Review scope: re-review/);
		assert.match(prompt, /Review scope: branch/);
		assert.match(prompt, /resumeSession/);
		assert.match(prompt, /upstream requests resuming the original implementer/i);
		assert.match(prompt, /final cleanup step/i);
		assert.match(prompt, /before invoking.*finishing-a-development-branch/i);
		assert.doesNotMatch(prompt, /scripts\/task-brief/);
		assert.doesNotMatch(prompt, /scripts\/review-package/);
		assert.doesNotMatch(prompt, /rm -f/);
		assert.doesNotMatch(prompt, /progress\.md/);
	});

	void it("omits the SDD adapter when useSubagents is false or undefined", () => {
		assert.doesNotMatch(buildSuperpowersRootPrompt({ ...base, useSubagents: false }), /Superpowers SDD Adapter Contract/);
		assert.doesNotMatch(buildSuperpowersRootPrompt({ ...base }), /Superpowers SDD Adapter Contract/);
	});
});
```

Extend the existing sequential scheduling test with:

```typescript
assert.match(prompt, /scheduling controls Task order only/i);
assert.match(prompt, /follow the selected upstream SDD workflow/i);
```

Extend the existing parallel scheduling test with:

```typescript
assert.match(prompt, /scheduling controls Task order and isolation only/i);
assert.match(prompt, /follow the selected upstream SDD workflow/i);
assert.doesNotMatch(prompt, /Resume Critical or Important fixes/);
assert.doesNotMatch(prompt, /parent progress ledger/);
```

- [ ] **Step 2: Run the root-prompt test and verify the new contract fails**

Run: `node --experimental-strip-types --test test/unit/root-prompt.test.ts`

Expected: FAIL because the prompt still says `File Handoff Contract`, lacks `Review scope: re-review`, and contains pre-v6.2 script and cleanup text.

- [ ] **Step 3: Replace the file-handoff builder with the minimal Pi adapter**

In `src/superpowers/root-prompt.ts`, replace `buildFileHandoffContract` and its doc comment with:

```typescript
/**
 * Build the Pi adapter for the upstream Superpowers SDD lifecycle.
 *
 * The installed upstream skill owns lifecycle mechanics. This block only maps
 * those mechanics to Pi role names, review scopes, and session continuation.
 *
 * @returns Prompt block for the local SDD adapter contract.
 */
function buildSddAdapterContract(): string {
	return [
		"Superpowers SDD Adapter Contract:",
		"The selected upstream `subagent-driven-development` skill is authoritative for scripts, workspace and ledger paths, handoff files, review and fix loops, retry and adjudication rules, and final plan-workspace cleanup.",
		"Do not reconstruct those upstream mechanics from this Pi adapter.",
		"- Dispatch implementers through `sp-implementer`.",
		"- Initial task review: dispatch `sp-review` with exactly `Review scope: task`.",
		"- Scoped fix re-review: dispatch `sp-review` with exactly `Review scope: re-review`.",
		"- Final whole-branch review: dispatch `sp-review` with exactly `Review scope: branch`.",
		"- The upstream reviewer template in the dispatch controls review inputs, boundaries, and output format; the marker only selects the Pi role mode.",
		"- When upstream requests resuming the original implementer, pass its prior session file through `resumeSession`; otherwise follow upstream's implementer selection.",
		"- After the final branch review is clean, complete upstream's final cleanup step before invoking `finishing-a-development-branch`.",
	].join("\n");
}
```

Change the `useSubagents === true` emission call to:

```typescript
sections.push(buildSddAdapterContract());
```

- [ ] **Step 4: Narrow sequential and parallel scheduling text to Pi-owned orchestration**

Use this sequential branch in `buildTaskSchedulingContract`:

```typescript
if (taskScheduling === "sequential") {
	return [
		"Task scheduling is SEQUENTIAL by config; scheduling controls Task order only.",
		"Execute one complete Task at a time. A Task includes all of its Steps.",
		"For each Task and the final branch review, follow the selected upstream SDD workflow and apply the Pi SDD adapter's role and review-scope mapping.",
	].join("\n");
}
```

Use this parallel branch:

```typescript
return [
	"Task scheduling is PARALLEL by config; scheduling controls Task order and isolation only.",
	"For implementation plans, compose subagent-driven-development, dispatching-parallel-agents, and using-git-worktrees.",
	"A Task includes all of its Steps. Never dispatch or review individual Steps.",
	"Build conservative dependency-ready waves of at most 8 Tasks; overlapping or ambiguous Tasks stay sequential.",
	"Parallel scheduling with worktrees enabled is approval to create Task worktrees; do not ask again for every wave.",
	"Before parallel writers start, create one persistent worktree per Task under the configured worktree root and pass each absolute path as that task's cwd.",
	"For each Task, follow the selected upstream SDD workflow and apply the Pi SDD adapter's role and review-scope mapping.",
	"Integrate upstream-approved Task commits in Task-number order, then clean the Task worktrees.",
	"Never integrate a failed or blocked Task; its dependents wait even when safe sibling Tasks finish.",
	"If worktree creation fails, report the reason and run the affected Tasks sequentially.",
	"If cherry-pick conflicts, abort it and rerun that Task sequentially from the updated parent HEAD instead of inventing a merge.",
	"After all Tasks are integrated and verified, continue the selected upstream SDD workflow through final review using `Review scope: branch`.",
].join("\n");
```

- [ ] **Step 5: Run the root-prompt unit test**

Run: `node --experimental-strip-types --test test/unit/root-prompt.test.ts`

Expected: PASS with no old script, flat-ledger, or per-task cleanup text in generated subagent-enabled prompts.

- [ ] **Step 6: Commit the root adapter**

```bash
git add src/superpowers/root-prompt.ts test/unit/root-prompt.test.ts
git commit -m "feat: align root SDD adapter with Superpowers v6.2"
```

---

### Task 2: Delegate all bounded review scopes to upstream templates

**Files:**
- Modify: `test/unit/agent-prompts.test.ts:35-50`
- Modify: `agents/sp-review.md:1-18`

**Interfaces:**
- Consumes: dispatch text containing exactly one of `Review scope: task`, `Review scope: re-review`, or `Review scope: branch`, plus the corresponding upstream reviewer template.
- Produces: a read-only `sp-review` role that follows the supplied template's inputs, boundaries, and successful output format; invalid scope returns `NEEDS_CONTEXT`, and design-changing approval returns `BLOCKED`.

- [ ] **Step 1: Extend the reviewer prompt test for all scopes and upstream authority**

Replace the reviewer test body with:

```typescript
void it("exposes one max-tier reviewer for task, re-review, and branch scopes", () => {
	assert.equal(fs.existsSync(path.join(agentsDir, "sp-spec-review.md")), false);
	assert.equal(fs.existsSync(path.join(agentsDir, "sp-code-review.md")), false);

	const body = read("sp-review.md");
	assert.match(body, /name: sp-review/);
	assert.match(body, /model: max/);
	assert.match(body, /session-mode: lineage-only/);
	assert.match(body, /maxSubagentDepth: 0/);
	assert.match(body, /Review scope: task/);
	assert.match(body, /Review scope: re-review/);
	assert.match(body, /Review scope: branch/);
	assert.match(body, /upstream reviewer template/i);
	assert.match(body, /inputs, boundaries, and successful output format/i);
	assert.match(body, /prior findings and the fix diff only/i);
	assert.match(body, /read-only/i);
	assert.doesNotMatch(body, /Return one of: `DONE`/);
});
```

- [ ] **Step 2: Run the agent-prompt test and verify it fails**

Run: `node --experimental-strip-types --test test/unit/agent-prompts.test.ts`

Expected: FAIL because `sp-review.md` has no `re-review` scope or upstream-template authority and still forces the local `DONE` status vocabulary.

- [ ] **Step 3: Replace the bounded reviewer body with the three-scope adapter**

Keep the existing frontmatter, changing only its description to include scoped re-review, then use this body:

```markdown
You are the read-only Superpowers reviewer for one explicitly named scope. Do not edit files, implement changes, run mutating commands, or invoke subagents.

- Require the dispatch to state exactly `Review scope: task`, `Review scope: re-review`, or `Review scope: branch`. Return `NEEDS_CONTEXT` if it does not.
- For every valid scope, follow the upstream reviewer template included in the dispatch. That template controls the review inputs, boundaries, and successful output format.
- For `Review scope: task`, perform only the supplied upstream task review.
- For `Review scope: re-review`, verify the supplied prior findings and the fix diff only. Do not restart the full task or branch review.
- For `Review scope: branch`, perform only the supplied upstream final code review.
- Treat implementer reports as unverified claims. Cite file and line evidence from supplied diffs and source files as required by the upstream template.
- Do not replace a successful template report with `DONE` or `DONE_WITH_CONCERNS`.
- If required context is missing, return `NEEDS_CONTEXT`. If approval requires changing the intended design, return `BLOCKED`.
```

Set the frontmatter description to:

```yaml
description: Superpowers reviewer for a bounded task, scoped fix re-review, or whole branch
```

- [ ] **Step 4: Run the agent-prompt unit test**

Run: `node --experimental-strip-types --test test/unit/agent-prompts.test.ts`

Expected: PASS; the role remains max-tier, lineage-only, read-only, and non-delegating.

- [ ] **Step 5: Commit the reviewer adapter**

```bash
git add agents/sp-review.md test/unit/agent-prompts.test.ts
git commit -m "feat: delegate review scopes to upstream templates"
```

---

### Task 3: Make the parallel SDD ledger fixture plan-scoped and ignored

**Files:**
- Modify: `test/integration/parallel-sdd-execution.test.ts:217-235,383-388`

**Interfaces:**
- Consumes: the test repository's ignored `.superpowers/sdd/` directory.
- Produces: an ignored `.superpowers/sdd/parallel-sdd/progress.md` fixture whose first line is `# SDD ledger — plan: docs/superpowers/plans/parallel-sdd.md` and which survives Task cherry-pick integration.

- [ ] **Step 1: Change the final assertion to require the plan-scoped ledger**

Replace the flat-path assertion with:

```typescript
const progressLedger = path.join(tempDir, ".superpowers", "sdd", "parallel-sdd", "progress.md");
assert.ok(fs.existsSync(progressLedger), "controller progress ledger must survive the lifecycle");
assert.match(
	fs.readFileSync(progressLedger, "utf-8"),
	/^# SDD ledger — plan: docs\/superpowers\/plans\/parallel-sdd\.md$/m,
);
```

- [ ] **Step 2: Run the integration test and verify the plan-scoped assertion fails**

Run: `node --experimental-strip-types --import ./test/support/register-loader.mjs --test test/integration/parallel-sdd-execution.test.ts`

Expected: FAIL because setup still creates `.superpowers/sdd/progress.md`.

- [ ] **Step 3: Replace the committed flat ledger setup with an ignored plan-scoped workspace**

Include `.superpowers/` in the initial ignore file:

```typescript
fs.writeFileSync(
	path.join(tempDir, ".gitignore"),
	"node_modules/\n.worktrees/\nsessions/\n.superpowers/\nparent.jsonl\n",
	"utf-8",
);
```

After the `wave base` commit, create the ignored ledger without a second git commit:

```typescript
const sddDir = path.join(tempDir, ".superpowers", "sdd", "parallel-sdd");
fs.mkdirSync(sddDir, { recursive: true });
fs.writeFileSync(
	path.join(sddDir, "progress.md"),
	"# SDD ledger — plan: docs/superpowers/plans/parallel-sdd.md\nwave: T1+T2\n",
	"utf-8",
);
```

Delete the old `git add -A` and `seed progress ledger` commit after fixture creation.

- [ ] **Step 4: Run the focused integration test**

Run: `node --experimental-strip-types --import ./test/support/register-loader.mjs --test test/integration/parallel-sdd-execution.test.ts`

Expected: PASS; the ignored plan ledger remains in the parent checkout after approved Task commits are cherry-picked.

- [ ] **Step 5: Commit the fixture correction**

```bash
git add test/integration/parallel-sdd-execution.test.ts
git commit -m "test: use plan-scoped SDD ledger fixture"
```

---

### Task 4: Publish the v6.2 compatibility boundary and verify the repository

**Files:**
- Modify: `README.md:3-27,84-112`
- Modify: `docs/configuration.md:1-5,230-236,483-487`
- Modify: `docs/worktrees.md:1-25`
- Modify: `docs/parameters.md:1-7,24,61-76`
- Modify: `docs/skills.md:1-5,117-181`
- Modify: `CHANGELOG.md:1-3`

**Interfaces:**
- Consumes: the root adapter, reviewer scope contract, and existing `resumeSession` API.
- Produces: active documentation that requires Superpowers v6.2+, identifies upstream as SDD lifecycle authority, and distinguishes upstream plan-workspace cleanup from Pi Task-worktree cleanup.

- [ ] **Step 1: Run a documentation-floor check and verify it fails before edits**

```bash
for file in README.md docs/configuration.md docs/worktrees.md docs/parameters.md docs/skills.md; do
  grep -Fq 'Superpowers `v6.2+`' "$file" || { echo "missing v6.2 floor: $file"; exit 1; }
done
```

Expected: FAIL on `README.md`; no active document currently declares the required floor.

- [ ] **Step 2: Update the README compatibility and workflow summary**

Use this compatibility line:

```markdown
Current compatibility targets: Pi `^0.82.1` and Superpowers `v6.2+`.
```

Replace copied handoff/review-loop prose with this concise boundary:

```markdown
The installed upstream `subagent-driven-development` skill owns its plan-scoped workspace, ledger, handoff artifacts, review/fix loop, retry and adjudication rules, and final cleanup. Pi Superagents only maps those steps to `sp-implementer`, `sp-review`, `resumeSession` when upstream requests the original implementer, and the local `Review scope: task`, `Review scope: re-review`, and `Review scope: branch` markers. Parallel mode additionally owns dependency-ready Task waves and per-Task worktree integration.
```

In the installation note, change the requirement to `Requires Superpowers v6.2+` while retaining the existing install link and command.

- [ ] **Step 3: Update the configuration reference**

Change its target line to:

```markdown
This reference targets Pi `^0.82.1` and Superpowers `v6.2+`.
```

Replace the current `Inline Role Output` file-handoff paragraph with:

```markdown
Superpowers role agents return their findings through Pi tool results. For SDD runs, the selected upstream `subagent-driven-development` skill is authoritative for plan-scoped workspace paths, ledger and handoff files, review/fix loops, and final cleanup; Pi Superagents does not duplicate those mechanics in its generated prompt.
```

Replace the parallel-SDD lifecycle paragraph with:

```markdown
When preflight passes, Pi Superagents controls dependency-ready waves, persistent per-Task worktrees, and Task-number integration. Each Task and the final branch review otherwise follows the selected upstream SDD workflow; the Pi adapter only supplies `sp-implementer`, `sp-review`, conditional `resumeSession`, and the exact `Review scope: task`, `Review scope: re-review`, and `Review scope: branch` markers.
```

Update the reviewer role table entry to name all three exact scope markers and state that the supplied upstream reviewer template controls each review.

- [ ] **Step 4: Update the worktree reference**

Change its target line to:

```markdown
This reference targets Pi `^0.82.1` and Superpowers `v6.2+`.
```

Use this ownership clarification in the parallel SDD section:

```markdown
The upstream SDD skill owns the plan-scoped `.superpowers/sdd/<plan-basename>/` workspace and its final cleanup. Pi Superagents separately owns the persistent per-Task worktrees used for parallel scheduling: it creates them for dependency-ready Tasks, keeps each through upstream's review/fix loop, integrates upstream-approved commits in Task-number order, and then removes those Task worktrees. `resumeSession` is used only when upstream requests resuming the original implementer; later rounds may use a fresh session.
```

- [ ] **Step 5: Update the parameters reference**

Change its target line to:

```markdown
This reference targets Pi `^0.82.1` and Superpowers `v6.2+`.
```

Add this paragraph under `## Resuming a Superpowers implementer session`:

```markdown
During SDD fix rounds, the installed upstream skill decides whether to resume the original implementer or dispatch a fresh one. Pass `resumeSession` only for the former; Pi Superagents validates and continues that session synchronously but does not define retry limits or implementer-selection policy.
```

- [ ] **Step 6: Update the skills reference**

Change its target line to:

```markdown
This reference targets Pi `^0.82.1` and Superpowers `v6.2+`.
```

Replace the two-scope reviewer list with:

```markdown
- `Review scope: task` — use the supplied upstream task-review template.
- `Review scope: re-review` — verify only prior findings and the fix diff using the supplied upstream scoped re-review template.
- `Review scope: branch` — use the supplied upstream final code-review template.
```

Replace exact `scripts/task-brief`, `scripts/review-package`, per-task deletion, retry-count, and plan-ledger path instructions with this authority rule:

```markdown
For SDD execution, the installed upstream `subagent-driven-development` skill is authoritative for scripts, plan workspace and ledger, handoff artifacts, review/fix cadence, retry and adjudication rules, and final cleanup. Pi's generated contract supplies only role names, the three local review-scope markers, conditional `resumeSession`, Task scheduling, and parallel Task-worktree orchestration. After a clean final branch review, complete upstream's final cleanup before invoking `finishing-a-development-branch`.
```

- [ ] **Step 7: Add an unreleased changelog entry**

Insert immediately below `# Changelog`:

```markdown
## [Unreleased]

- **Superpowers v6.2 Compatibility**
  - Required Superpowers v6.2+ and made the installed upstream SDD skill authoritative for lifecycle mechanics.
  - Added `Review scope: re-review`, conditional implementer continuation through `resumeSession`, and cleanup-before-branch-finishing guidance without copying upstream scripts or workspace paths.
  - Preserved Pi-owned sequential/parallel scheduling and persistent parallel Task-worktree integration.
```

- [ ] **Step 8: Run the documentation-floor and stale-copy checks**

```bash
for file in README.md docs/configuration.md docs/worktrees.md docs/parameters.md docs/skills.md; do
  grep -Fq 'Superpowers `v6.2+`' "$file" || { echo "missing v6.2 floor: $file"; exit 1; }
done
! rg 'scripts/(task-brief|review-package)|rm -f.*(brief|report|diff)|\.superpowers/sdd/progress\.md' README.md docs/configuration.md docs/worktrees.md docs/parameters.md docs/skills.md
```

Expected: PASS with no copied pre-v6.2 lifecycle mechanics in active documentation.

- [ ] **Step 9: Run all tests**

Run: `pnpm test:all`

Expected: PASS for unit, integration, and end-to-end suites.

- [ ] **Step 10: Run type checking**

Run: `pnpm typecheck`

Expected: PASS with no TypeScript diagnostics.

- [ ] **Step 11: Run formatting and lint checks without rewriting files**

Run: `pnpm exec biome check .`

Expected: PASS with no diagnostics.

- [ ] **Step 12: Commit documentation and final compatibility state**

```bash
git add README.md docs/configuration.md docs/worktrees.md docs/parameters.md docs/skills.md CHANGELOG.md
git commit -m "docs: require Superpowers v6.2"
```
