# SDD File-Handoff Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the bounded Superpowers role agents (`sp-implementer`, `sp-spec-review`, `sp-code-review`) use the `subagent-driven-development` skill's file handoff (brief/report/diff by path), fix `sp-debug`'s misleading wording, teach the controller the handoff + cleanup rule, and remove the now-dead packet-injection apparatus — net code reduction.

**Architecture:** The skills already ship `scripts/task-brief`, `scripts/review-package`, `scripts/sdd-workspace` and teach the controller to run them. The extension stops fighting that: bounded-agent prompts speak the file-handoff dialect, a new root-prompt block reinforces the handoff for `sp-*` dispatches and teaches controller-driven `rm -f` cleanup after a `DONE` review, and the dead `injectSuperpowersPacketInstructions` / `buildSuperpowersPacketPlan` / `reads` / `output` machinery is deleted. No new tool parameters, types, or runtime logic.

**Tech Stack:** TypeScript (NodeNext, strict), `node:test` + `node:assert`, Biome, the `@earendil-works/pi-*` packages, pi agent frontmatter markdown.

## Global Constraints

- **TypeScript-first** (`AGENTS.md`): no new plain JS; `.ts` only.
- **Never modify skill files** (`AGENTS.md`): the cleanup rule lives in the extension root prompt, not in `~/.agents/skills/**`.
- **No new extension cleanup machinery** (spec Non-Goals): no `cleanupFiles` tool param, no lifecycle `status` field, no `subagent_done` change, no deletion logic in the runner. Cleanup is controller-driven `rm -f`.
- **`progress.md` is never a cleanup target**; it persists until `finishing-a-development-branch`.
- **Quality gate:** `pnpm typecheck && pnpm lint` clean on changed files; `pnpm run test:all` green (e2e may skip when `pi-test-harness` is absent — pre-existing).
- **Docs updated after each change** (`AGENTS.md`): `README.md`, `docs/configuration.md`, `docs/parameters.md`, `docs/skills.md` as relevant; `CHANGELOG.md` entry.
- File/import conventions: `.ts` extensions in relative imports; tabs for indent (Biome).

---

## Task 1: Remove the dead packet-injection apparatus (simplification)

**Files:**
- Modify: `src/execution/superpowers-packets.ts`
- Modify: `src/execution/settings.ts`
- Modify: `src/execution/subagent-executor.ts`
- Modify: `test/integration/superpowers-packets.test.ts`

**Interfaces:**
- Consumes: prior commit `6437605` (inert `buildSuperpowersPacketPlan`/`injectSuperpowersPacketInstructions`).
- Produces: `superpowers-packets.ts` exports only `buildSuperpowersPacketContent`; `settings.ts` exports `resolveStepBehavior` with no `reads`; `subagent-executor.ts` builds task text from the raw task.

**Rationale (verified):** `injectSuperpowersPacketInstructions` only reads `behavior.reads` (always `[]` → no-op). `behaviors[i]` is consumed at only `subagent-executor.ts:364` (inject — dead) and `:371` (`behaviors[index].skills` — live). `SuperpowersPacketPlan.output` is never read. `buildSuperpowersPacketPlan` only produces dead defaults.

- [ ] **Step 1: Update tests to the post-removal state**

In `test/integration/superpowers-packets.test.ts`:

1. Remove the two `buildSuperpowersPacketPlan` unit tests (the `"uses inert packet defaults…"` and `"maps all built-in roles to inert packet defaults…"` cases) — the function is being deleted.
2. Remove the `"does not inject legacy packet read filenames into task text for implementer role"` test that calls `injectSuperpowersPacketInstructions` directly — the function is being deleted. (The executor-path tests below already guard no-`[Read from:]` end-to-end.)
3. Remove `injectSuperpowersPacketInstructions` from the import on the test file's import line; keep `buildSuperpowersPacketContent`. Remove `resolveStepBehavior` import only if unused after step 4.
4. Rewrite the `"prefers explicit step overrides, then packet defaults, then disabled defaults"` test to exercise `skills` override precedence instead of `reads`:

```ts
void it("prefers explicit step skill overrides, then agent defaults", () => {
	const behavior = resolveStepBehavior(
		{ name: "sp-implementer", description: "Implementer", systemPrompt: "Implement one task.", source: "builtin", filePath: "/tmp/sp-implementer.md", skills: ["default-skill"] },
		{ skills: ["override-skill"] },
	);
	assert.deepEqual(behavior.skills, ["override-skill"]);
	assert.deepEqual(behavior.model, undefined);
});
```

5. Keep the executor-path tests (`"does not inject legacy packet read filenames into foreground single/parallel tasks"`, `"applies inert packet defaults for parallel tasks without legacy read guidance"`) unchanged — they assert no `task-brief.md` / no `[Read from:]` / no `[Write to:]` in the dispatched task text and must stay green.

- [ ] **Step 2: Run tests — expect green (code unchanged still satisfies skills override)**

Run: `node --experimental-strip-types --import ./test/support/register-loader.mjs --test test/integration/superpowers-packets.test.ts`
Expected: PASS (the rewritten skills test passes against current `resolveStepBehavior`; deleted tests no longer run).

- [ ] **Step 3: Delete `injectSuperpowersPacketInstructions` and `buildSuperpowersPacketPlan` from `superpowers-packets.ts`**

Replace the whole file with:

```ts
/**
 * Superpowers packet content for command-scoped role execution.
 *
 * Responsibilities:
 * - build the runtime-authored packet file content that carries a delegated task
 * - keep the packet a dispatch vehicle: the controller's task text (including any
 *   file-handoff paths from the subagent-driven-development skill) is embedded verbatim
 *
 * Important: the packet file is the dispatch prompt, not the requirements brief. Brief,
 * report, and review-package files are authored by the SDD skill's scripts and addressed
 * by path inside the embedded task text. The extension injects no `[Read from:]` /
 * `[Write to:]` references.
 */

import type { SessionMode } from "../shared/types.ts";

export function buildSuperpowersPacketContent(input: { agent: string; sessionMode: SessionMode; task: string; useTestDrivenDevelopment: boolean }): string {
	const modeLine = input.agent === "sp-implementer" ? `Implementer Mode: ${input.useTestDrivenDevelopment ? "tdd" : "direct"}` : null;

	return [
		"# Superpowers Work Packet",
		"",
		`Agent: ${input.agent}`,
		`Session Mode: ${input.sessionMode}`,
		"Use only the information in this packet. Do not rely on parent-session history that is not included here.",
		modeLine,
		"",
		input.task.trim(),
	]
		.filter((line): line is string => Boolean(line))
		.join("\n");
}
```

This deletes `SuperpowersPacketPlan`, `buildSuperpowersPacketPlan`, `injectSuperpowersPacketInstructions`, and the `ResolvedStepBehavior` import.

- [ ] **Step 4: Strip `reads` from `settings.ts` behavior types**

Edit `src/execution/settings.ts`:

```ts
export interface ResolvedStepBehavior {
	progress: boolean;
	skills: string[] | false;
	model?: string;
}

export interface StepOverrides {
	progress?: boolean;
	skills?: string[] | false;
	model?: string;
}

export interface PacketDefaults {
	progress?: boolean;
}
```

In `resolveStepBehavior`, delete the `reads` line and the `reads` field of the returned object:

```ts
export function resolveStepBehavior(agentConfig: AgentConfig, stepOverrides: StepOverrides, packetDefaults?: PacketDefaults): ResolvedStepBehavior {
	const progress = stepOverrides.progress !== undefined ? stepOverrides.progress : packetDefaults?.progress !== undefined ? packetDefaults.progress : false;

	let skills: string[] | false;
	if (stepOverrides.skills === false) {
		skills = false;
	} else if (stepOverrides.skills !== undefined) {
		skills = [...stepOverrides.skills];
	} else {
		skills = agentConfig.skills ? [...agentConfig.skills] : [];
	}

	const model = stepOverrides.model ?? agentConfig.model;
	return { progress, skills, model };
}
```

(Update the JSDoc `@returns` line to "effective progress/skill/model behavior".)

- [ ] **Step 5: Drop the inject call sites and `buildSuperpowersPacketPlan` use in `subagent-executor.ts`**

1. Remove `injectSuperpowersPacketInstructions` and `buildSuperpowersPacketPlan` from the import at the top of `src/execution/subagent-executor.ts` (keep other imports from that module if any; after Task 1 the module only exports `buildSuperpowersPacketContent`, which this file may not import — remove the import line entirely if nothing remains).
2. Simplify `resolveChildBehavior` to stop building packet defaults (delete the `buildSuperpowersPacketPlan` call and the `reads` field in the overrides object):

```ts
function resolveChildBehavior(agentConfig: AgentConfig, skillOverride: string[] | false | undefined, modelOverride: string | undefined): ReturnType<typeof resolveStepBehavior> {
	return resolveStepBehavior(
		agentConfig,
		{
			progress: undefined,
			skills: skillOverride,
			model: modelOverride,
		},
	);
}
```

3. Parallel path — replace the inject map so task text is the raw task (`behaviors` stays because `behaviors[index].skills` is still read at the `configuredSkills` line):

```ts
const taskTexts = tasks.map((t) => t.task);
```

4. Single path — remove the now-unused `behavior` local and use the raw task:

```ts
// delete: const behavior = resolveChildBehavior(agentConfig, skillOverride, modelOverride);
// delete: const taskText = injectSuperpowersPacketInstructions(params.task!, behavior);
const taskText = params.task!;
```

(If `resolveChildBehavior` is now used only by the parallel path, keep it; do not delete it — parallel `behaviors[index].skills` at the `configuredSkills` line still depends on it.)

- [ ] **Step 6: Run typecheck and the packet suite**

Run: `pnpm typecheck && node --experimental-strip-types --import ./test/support/register-loader.mjs --test test/integration/superpowers-packets.test.ts`
Expected: typecheck clean; packet tests PASS (executor-path no-injection guards still green).

- [ ] **Step 7: Run the full suite, lint changed files, commit**

Run: `pnpm run test:all && npx biome check src/execution/superpowers-packets.ts src/execution/settings.ts src/execution/subagent-executor.ts test/integration/superpowers-packets.test.ts`
Expected: all tests pass; Biome clean.
Commit:
```bash
git add src/execution/superpowers-packets.ts src/execution/settings.ts src/execution/subagent-executor.ts test/integration/superpowers-packets.test.ts
git commit -m "refactor(superpowers): remove dead packet-injection apparatus

Delete injectSuperpowersPacketInstructions (no-op after the inert-
defaults fix), buildSuperpowersPacketPlan, SuperpowersPacketPlan, and
the reads/output fields: the controller now passes SDD file-handoff
paths in the task text. resolveStepBehavior keeps its live skills path.
Net code reduction; no behavior change for built-in roles."
```

---

## Task 2: Rewrite the bounded role agent prompts to the file-handoff dialect

**Files:**
- Modify: `agents/sp-implementer.md`
- Modify: `agents/sp-spec-review.md`
- Modify: `agents/sp-code-review.md`
- Modify: `agents/sp-debug.md`
- Add test: `test/unit/agent-prompts.test.ts`

**Interfaces:**
- Consumes: the SDD skill's `implementer-prompt.md` and `task-reviewer-prompt.md` conventions (paths in the task text).
- Produces: bounded-agent frontmatter whose body instructs reading/writing handoff files by path.

- [ ] **Step 1: Write the failing test**

Create `test/unit/agent-prompts.test.ts`:

```ts
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";

const agentsDir = path.resolve(import.meta.dirname, "../../agents");
function read(name: string): string {
	return fs.readFileSync(path.join(agentsDir, name), "utf-8");
}

void describe("bounded role agent prompts", () => {
	void it("sp-implementer instructs reading the brief and writing the report by path", () => {
		const body = read("sp-implementer.md");
		assert.match(body, /brief.*path given in your task/i);
		assert.match(body, /report.*path given in your task/i);
	});

	void it("sp-spec-review and sp-code-review instruct reading brief, report, and diff by path", () => {
		for (const name of ["sp-spec-review.md", "sp-code-review.md"]) {
			const body = read(name);
			assert.match(body, /brief/i);
			assert.match(body, /report/i);
			assert.match(body, /diff/i);
			assert.match(body, /paths given in your task/i);
		}
	});

	void it("sp-debug does not reference a debug-brief file", () => {
		const body = read("sp-debug.md");
		assert.doesNotMatch(body, /debug-brief/i);
		assert.match(body, /task packet/i);
	});
});
```

- [ ] **Step 2: Run the test — expect FAIL**

Run: `node --experimental-strip-types --test test/unit/agent-prompts.test.ts`
Expected: FAIL (current prompts say "implement exactly one extracted plan task" / "investigate the provided debug brief", not path-based handoff language).

- [ ] **Step 3: Rewrite `agents/sp-implementer.md`**

Keep the frontmatter (`name`, `description`, `model: cheap`, `tools: bash, write`, `maxSubagentDepth: 0`, `session-mode: lineage-only`). Replace the body with:

```markdown
You are a bounded implementer for one Superpowers task.

- Read your task brief at the path given in your task first — it is your requirements, with the exact values to use verbatim.
- Write your full report to the report path given in your task: what you implemented, what you tested and the results, files changed, self-review findings, and any concerns.
- Report back with ONLY status, commits (short SHA + subject), a one-line test summary, and concerns — the detail lives in the report file.
- Respect the provided implementer mode: `tdd` or `direct`.
- If requirements are unclear, report `NEEDS_CONTEXT`. If the task requires design judgment, report `BLOCKED`.
- Return status: `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, or `BLOCKED`.
```

- [ ] **Step 4: Rewrite `agents/sp-spec-review.md` and `agents/sp-code-review.md`**

Keep each frontmatter (`model: balanced`, `maxSubagentDepth: 0`, `session-mode: lineage-only`). Replace each body with (the only difference is the role focus line):

`sp-spec-review.md` body:
```markdown
You are the Superpowers spec-compliance reviewer for one bounded task.

- Read the task brief, the implementer's report, and the review-package diff at the paths given in your task.
- Verify the implementation matches the brief's requirements — nothing missing, nothing extra.
- This is a read-only role. Do not edit files, implement changes, or run mutating shell commands. Do not invoke subagents.
- If the brief is incomplete, report `NEEDS_CONTEXT`. If the task requires changing the intended design, report `BLOCKED`.
- Return one of: `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, or `BLOCKED`.
```

`sp-code-review.md` body:
```markdown
You are the Superpowers code-quality reviewer for one bounded task.

- Read the task brief, the implementer's report, and the review-package diff at the paths given in your task.
- Review the implementation for bugs, risk, maintainability, and test coverage. Prioritize findings over summaries; keep feedback actionable.
- This is a read-only role. Do not edit files, implement changes, or run mutating shell commands. Do not invoke subagents.
- If the available context is insufficient to review confidently, report `NEEDS_CONTEXT`. If the task requires architectural changes beyond the packet scope, report `BLOCKED`.
- Return one of: `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, or `BLOCKED`.
```

- [ ] **Step 5: Fix `agents/sp-debug.md` wording**

Keep frontmatter (`model: max`, `tools: bash`, `skills: systematic-debugging`, `maxSubagentDepth: 0`, `session-mode: lineage-only`). Replace the body with:

```markdown
You are the Superpowers debug role for one bounded failure investigation.

- Investigate the failure described in your task packet and focus on the narrowest reproducible cause.
- Prefer evidence, hypotheses, and concrete next actions over broad rewrites.
- Do not invoke subagents. If you run shell commands, keep them diagnostic and non-mutating.
- If the failure cannot be reproduced or scoped from the packet, report `NEEDS_CONTEXT`.
- If the fix depends on an unresolved product decision, report `BLOCKED`.
- Return one of: `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, or `BLOCKED`.
```

- [ ] **Step 6: Run the test — expect PASS**

Run: `node --experimental-strip-types --test test/unit/agent-prompts.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add agents/sp-implementer.md agents/sp-spec-review.md agents/sp-code-review.md agents/sp-debug.md test/unit/agent-prompts.test.ts
git commit -m "feat(agents): adopt SDD file-handoff dialect for bounded roles

sp-implementer reads the brief and writes the report by path; sp-spec-review
and sp-code-review read brief, report, and diff by path. sp-debug drops the
'debug brief' wording for packet-aligned language. Files are authored by the
SDD skill's scripts and addressed by path in the dispatch."
```

---

## Task 3: Add the File Handoff Contract block to the root prompt

**Files:**
- Modify: `src/superpowers/root-prompt.ts`
- Modify: `test/integration/root-prompt.test.ts` (or create `test/unit/root-prompt.test.ts` if no integration file exists — check first)

**Interfaces:**
- Consumes: `SuperpowersRootPromptInput.useSubagents`.
- Produces: a "File Handoff Contract" section in the root prompt when `useSubagents === true`.

- [ ] **Step 1: Locate or create the root-prompt test file**

Run: `ls test/integration/root-prompt.test.ts test/unit/root-prompt.test.ts 2>/dev/null`
If neither exists, create `test/unit/root-prompt.test.ts`. If one exists, add to it. (The repo has integration tests for slash commands; confirm there is no existing root-prompt unit test before creating.)

- [ ] **Step 2: Write the failing test**

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSuperpowersRootPrompt } from "../../src/superpowers/root-prompt.ts";

const base = { task: "do the thing", fork: false } as const;

void describe("root prompt file handoff contract", () => {
	void it("emits the File Handoff Contract when useSubagents is true", () => {
		const prompt = buildSuperpowersRootPrompt({ ...base, useSubagents: true });
		assert.match(prompt, /File Handoff Contract/);
		assert.match(prompt, /scripts\/task-brief/);
		assert.match(prompt, /scripts\/review-package/);
		assert.match(prompt, /rm -f/);
		assert.match(prompt, /progress\.md/);
	});

	void it("omits the File Handoff Contract when useSubagents is false", () => {
		const prompt = buildSuperpowersRootPrompt({ ...base, useSubagents: false });
		assert.doesNotMatch(prompt, /File Handoff Contract/);
	});

	void it("omits the File Handoff Contract when useSubagents is undefined", () => {
		const prompt = buildSuperpowersRootPrompt({ ...base });
		assert.doesNotMatch(prompt, /File Handoff Contract/);
	});
});
```

- [ ] **Step 3: Run the test — expect FAIL**

Run: `node --experimental-strip-types --test test/unit/root-prompt.test.ts`
Expected: FAIL (`File Handoff Contract` not present).

- [ ] **Step 4: Add `buildFileHandoffContract` and wire it into `buildSuperpowersRootPrompt`**

In `src/superpowers/root-prompt.ts`, add the builder near the other `build*Contract` helpers:

```ts
/**
 * Build the file-handoff contract block for the root session.
 *
 * Teaches the controller to use the subagent-driven-development skill's file
 * handoff (brief/report/diff by path) when delegating to the bounded sp-* roles,
 * and to clean up those files with `rm -f` after a DONE review. The extension
 * performs no cleanup itself.
 *
 * @returns Prompt block, or empty string when subagent delegation is disabled.
 */
function buildFileHandoffContract(): string {
	return [
		"File handoff for bounded role agents (sp-implementer, sp-spec-review, sp-code-review):",
		"Use the subagent-driven-development skill's file handoff — do not paste requirements inline.",
		"- Before each sp-implementer dispatch, run the skill's `scripts/task-brief PLAN N`; put the printed brief path in the dispatch (\"read this first — it is your requirements\").",
		"- Name the implementer's report file after the brief (task-<N>-brief.md → task-<N>-report.md) and put that report path in the dispatch (\"write your full report here\").",
		"- Before each sp-spec-review / sp-code-review dispatch, run the skill's `scripts/review-package BASE HEAD`; put the printed diff path, plus the brief and report paths, in the dispatch. Reviewers read all three by path.",
		"- Cleanup is your job, not the extension's: after a reviewer reports DONE (approved), `rm -f` that task's brief, report, and diff. Keep them on DONE_WITH_CONCERNS, NEEDS_CONTEXT, or BLOCKED — fix and re-dispatch loops reuse them.",
		"- Never remove `progress.md` (the SDD ledger); it persists until finishing-a-development-branch.",
		"- sp-debug, sp-recon, and sp-research do not use the file handoff; dispatch them with the task inline.",
	].join("\n");
}
```

In `buildSuperpowersRootPrompt`, after the existing `useSubagents` delegation-contract block, add:

```ts
if (input.useSubagents === true) {
	sections.push(buildFileHandoffContract());
	sections.push("");
}
```

- [ ] **Step 5: Run the test — expect PASS**

Run: `node --experimental-strip-types --test test/unit/root-prompt.test.ts`
Expected: PASS.

- [ ] **Step 6: Run full suite, typecheck, lint, commit**

Run: `pnpm typecheck && pnpm run test:all && npx biome check src/superpowers/root-prompt.ts test/unit/root-prompt.test.ts`
Expected: clean and green.
Commit:
```bash
git add src/superpowers/root-prompt.ts test/unit/root-prompt.test.ts
git commit -m "feat(superpowers): teach controller the SDD file handoff + cleanup

Add a File Handoff Contract block to the root prompt (useSubagents only)
that reinforces the subagent-driven-development skill's task-brief/review-
package handoff for bounded sp-* dispatches and teaches controller-driven
rm -f cleanup after a DONE review, with progress.md protected."
```

---

## Task 4: Update docs and CHANGELOG

**Files:**
- Modify: `docs/skills.md`
- Modify: `docs/parameters.md`
- Modify: `docs/configuration.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update `docs/skills.md` Role Output section**

State that the bounded SDD roles (`sp-implementer`, `sp-spec-review`, `sp-code-review`) read and write the skill's handoff files by path (brief/report/diff under `.superpowers/sdd/`), that the controller cleans them up with `rm -f` after a `DONE` review, and that `sp-debug`/`sp-recon`/`sp-research` keep inline delivery. Keep the existing "no `[Read from:]` injection" wording from the prior fix.

- [ ] **Step 2: Update `docs/parameters.md` packet section**

Note that the packet file carries the controller's dispatch text (including file-handoff paths); the extension injects no `[Read from:]`/`[Write to:]` references; brief/report/diff files are authored by the SDD skill's scripts and cleaned up by the controller.

- [ ] **Step 3: Update `docs/configuration.md` Inline Role Output section**

Reflect that the handoff roles read/write by path and the controller owns cleanup (`rm -f` after `DONE`); `progress.md` persists until branch finish.

- [ ] **Step 4: Add CHANGELOG entry**

Under `## [Unreleased]` (create the section if the prior entry was released), add:

```markdown
- **SDD File-Handoff Alignment**
  - The bounded SDD role agents (`sp-implementer`, `sp-spec-review`, `sp-code-review`) now use the `subagent-driven-development` skill's file handoff: they read the task brief and review-package diff and write the implementer report by path, matching the skill's `scripts/task-brief` / `scripts/review-package` convention. `sp-debug` dropped its misleading "debug brief" wording.
  - The root prompt teaches the controller to run the skill's handoff scripts and to clean up brief/report/diff files with `rm -f` after a `DONE` review (`progress.md` is preserved). The extension performs no cleanup itself.
  - Removed the dead `injectSuperpowersPacketInstructions` / `buildSuperpowersPacketPlan` / `reads` / `output` apparatus — net code reduction.
```

- [ ] **Step 5: Commit**

```bash
git add docs/skills.md docs/parameters.md docs/configuration.md CHANGELOG.md
git commit -m "docs(superpowers): document SDD file-handoff alignment and cleanup"
```

---

## Self-review (run before declaring the plan complete)

- **Spec coverage:** §1 scope → Task 2; §2-§3 file flow / packet vehicle → Task 3 (root prompt) + Task 2 (agent prompts); §4 cleanup → Task 3 root-prompt block; §5 root contract → Task 3; §6 agent prompts → Task 2; §7 code simplification → Task 1. All spec sections covered.
- **Type consistency:** `resolveStepBehavior` returns `{ progress, skills, model }` (no `reads`) after Task 1; `resolveChildBehavior` callers updated; `buildSuperpowersPacketContent` signature unchanged.
- **No placeholders:** every code step shows the exact code; every command shows expected output.
