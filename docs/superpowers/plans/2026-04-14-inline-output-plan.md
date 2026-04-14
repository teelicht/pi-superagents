# Inline Subagent Output: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the file-based subagent output mechanism with inline JSONL stream output, removing `write` from read-only agents and eliminating orphaned `.md` artifacts.

**Architecture:** The child PI process already streams complete assistant text via `message_end` JSONL events. The extension extracts this with `getFinalOutput()`. Currently `resolveSingleOutput()` reads the agent-written file back and replaces the JSONL text. This plan removes the file round-trip: JSONL text becomes authoritative, no agent writes output files, and the `single-output.ts` module is deleted.

**Tech Stack:** TypeScript, Vitest, Node.js child_process

---

## Task 1: Remove output-file frontmatter from agent definitions

**Files:**
- Modify: `agents/sp-code-review.md`
- Modify: `agents/sp-spec-review.md`
- Modify: `agents/sp-debug.md`

- [ ] **Step 1: Remove `write` from `sp-code-review.md` tools**

Change the frontmatter `tools` line from:
```
tools: read, grep, find, ls, write
```
to:
```
tools: read, grep, find, ls
```

- [ ] **Step 2: Remove `write` from `sp-spec-review.md` tools**

Change the frontmatter `tools` line from:
```
tools: read, grep, find, ls, write
```
to:
```
tools: read, grep, find, ls
```

- [ ] **Step 3: Remove `write` from `sp-debug.md` tools**

Change the frontmatter `tools` line from:
```
tools: read, grep, find, ls, bash, write
```
to:
```
tools: read, grep, find, ls, bash
```

- [ ] **Step 4: Remove the `debug-brief.md` reference from `sp-debug.md` system prompt**

In `agents/sp-debug.md`, remove the line:
```
- Treat `debug-brief.md` as an in-place working document: preserve the original report and append your findings or updates instead of overwriting it with unrelated content.
```

- [ ] **Step 5: Update `NON_DELEGATING_ROLE_TOOLS` in `superpowers-policy.ts`**

In `src/execution/superpowers-policy.ts`, change the `NON_DELEGATING_ROLE_TOOLS` constant from:

```typescript
const NON_DELEGATING_ROLE_TOOLS: Partial<Record<ExecutionRole, string[]>> = {
	"sp-recon": ["read", "grep", "find", "ls"],
	"sp-research": ["read", "grep", "find", "ls"],
	"sp-implementer": ["read", "grep", "find", "ls", "bash", "write"],
	"sp-spec-review": ["read", "grep", "find", "ls"],
	"sp-code-review": ["read", "grep", "find", "ls"],
	"sp-debug": ["read", "grep", "find", "ls", "bash"],
};
```

to:

```typescript
const NON_DELEGATING_ROLE_TOOLS: Partial<Record<ExecutionRole, string[]>> = {
	"sp-recon": ["read", "grep", "find", "ls"],
	"sp-research": ["read", "grep", "find", "ls"],
	"sp-implementer": ["read", "grep", "find", "ls", "bash", "write"],
	"sp-spec-review": ["read", "grep", "find", "ls"],
	"sp-code-review": ["read", "grep", "find", "ls"],
	"sp-debug": ["read", "grep", "find", "ls", "bash"],
};
```

(No change needed — `write` was already absent from the fallback. This step confirms the fallback now matches the frontmatter.)

- [ ] **Step 6: Commit**

```bash
git add agents/sp-code-review.md agents/sp-spec-review.md agents/sp-debug.md
git commit -m "feat: remove write tool from read-only agents and update debug prompt"
```

---

## Task 2: Set packet output to false for all roles

**Files:**
- Modify: `src/execution/superpowers-packets.ts`
- Modify: `test/integration/superpowers-packets.test.ts`

- [ ] **Step 1: Write the failing test — assert all roles return `output: false`**

In `test/integration/superpowers-packets.test.ts`, update the first test ("uses task and review packet names instead of context.md/plan.md/progress.md") to assert `output: false` for `sp-implementer`:

Change:
```typescript
assert.equal(packets.output, "implementer-report.md");
```
to:
```typescript
assert.equal(packets.output, false);
```

Update the "maps review, debug, and default roles" test to assert `output: false` for all roles:

Change:
```typescript
assert.deepEqual(buildSuperpowersPacketPlan("sp-spec-review"), {
    reads: ["task-brief.md", "implementer-report.md"],
    output: "spec-review.md",
    progress: false,
});
assert.deepEqual(buildSuperpowersPacketPlan("sp-code-review"), {
    reads: ["task-brief.md", "spec-review.md"],
    output: "code-review.md",
    progress: false,
});
assert.deepEqual(buildSuperpowersPacketPlan("sp-debug"), {
    reads: ["debug-brief.md"],
    output: "debug-brief.md",
    progress: false,
});
```
to:
```typescript
assert.deepEqual(buildSuperpowersPacketPlan("sp-spec-review"), {
    reads: ["task-brief.md", "implementer-report.md"],
    output: false,
    progress: false,
});
assert.deepEqual(buildSuperpowersPacketPlan("sp-code-review"), {
    reads: ["task-brief.md", "spec-review.md"],
    output: false,
    progress: false,
});
assert.deepEqual(buildSuperpowersPacketPlan("sp-debug"), {
    reads: ["debug-brief.md"],
    output: false,
    progress: false,
});
```

- [ ] **Step 2: Run the test — expect it to fail**

```bash
npx vitest run test/integration/superpowers-packets.test.ts
```

Expected: FAIL (assertions expect `output: false` but code still returns filenames).

- [ ] **Step 3: Update `buildSuperpowersPacketPlan` to return `output: false` for all roles**

In `src/execution/superpowers-packets.ts`, change the `buildSuperpowersPacketPlan` function from:

```typescript
export function buildSuperpowersPacketPlan(role: ExecutionRole): SuperpowersPacketPlan {
	switch (role) {
		case "sp-implementer":
			return {
				reads: ["task-brief.md"],
				output: "implementer-report.md",
				progress: false,
			};
		case "sp-spec-review":
			return {
				reads: ["task-brief.md", "implementer-report.md"],
				output: "spec-review.md",
				progress: false,
			};
		case "sp-code-review":
			return {
				reads: ["task-brief.md", "spec-review.md"],
				output: "code-review.md",
				progress: false,
			};
		case "sp-debug":
			return {
				reads: ["debug-brief.md"],
				output: "debug-brief.md",
				progress: false,
			};
		default:
			return {
				reads: [],
				output: false,
				progress: false,
			};
	}
}
```

to:

```typescript
export function buildSuperpowersPacketPlan(role: ExecutionRole): SuperpowersPacketPlan {
	switch (role) {
		case "sp-implementer":
			return {
				reads: ["task-brief.md"],
				output: false,
				progress: false,
			};
		case "sp-spec-review":
			return {
				reads: ["task-brief.md", "implementer-report.md"],
				output: false,
				progress: false,
			};
		case "sp-code-review":
			return {
				reads: ["task-brief.md", "spec-review.md"],
				output: false,
				progress: false,
			};
		case "sp-debug":
			return {
				reads: ["debug-brief.md"],
				output: false,
				progress: false,
			};
		default:
			return {
				reads: [],
				output: false,
				progress: false,
			};
	}
}
```

- [ ] **Step 4: Remove the `[Write to:]` injection branch from `injectSuperpowersPacketInstructions`**

In `src/execution/superpowers-packets.ts`, change `injectSuperpowersPacketInstructions` from:

```typescript
export function injectSuperpowersPacketInstructions(task: string, behavior: ResolvedStepBehavior): string {
	let instructedTask = task;
	if (behavior.reads && behavior.reads.length > 0) {
		instructedTask += `\n\n[Read from: ${behavior.reads.join(", ")}]`;
	}
	if (behavior.output) {
		instructedTask += `\n\n[Write to: ${behavior.output}]`;
	}
	return instructedTask;
}
```

to:

```typescript
export function injectSuperpowersPacketInstructions(task: string, behavior: ResolvedStepBehavior): string {
	let instructedTask = task;
	if (behavior.reads && behavior.reads.length > 0) {
		instructedTask += `\n\n[Read from: ${behavior.reads.join(", ")}]`;
	}
	return instructedTask;
}
```

- [ ] **Step 5: Update integration tests that assert `[Write to:]` was injected**

In `test/integration/superpowers-packets.test.ts`, find the test "injects packet filenames into task text for implementer role" and update it. The test currently asserts:
```typescript
assert.ok(task.includes("implementer-report.md"), "should reference implementer-report.md");
```
This assertion must change to verify that `[Write to:]` is NOT injected. Replace:

```typescript
assert.ok(task.includes("implementer-report.md"), "should reference implementer-report.md");
```

with:

```typescript
assert.ok(!task.includes("[Write to:"), "should not inject [Write to:] instruction");
```

Also, in the "does not inject into tasks whose agents have no superpowers packet defaults" test, the assertion:
```typescript
assert.ok(!injected.includes("debug-brief.md"), "should not force debug-brief.md output");
```
remains valid as-is.

Find the test "injects superpowers packet instructions into foreground single tasks" and update the assertion about `implementer-report.md`:

Change:
```typescript
assert.ok(taskText.includes("implementer-report.md"), `task should reference implementer-report.md: ${taskText}`);
```
to:
```typescript
assert.ok(!taskText.includes("[Write to:"), `should not inject [Write to:] instruction: ${taskText}`);
assert.ok(taskText.includes("task-brief.md"), `task should reference task-brief.md: ${taskText}`);
```

Apply the same change to the "injects superpowers packet instructions into foreground parallel tasks" test and the "applies packet defaults over agent frontmatter defaults for parallel tasks" test.

- [ ] **Step 6: Run tests — expect them to pass**

```bash
npx vitest run test/integration/superpowers-packets.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/execution/superpowers-packets.ts test/integration/superpowers-packets.test.ts
git commit -m "feat: set output=false for all packet plans and remove Write to injection"
```

---

## Task 3: Delete `single-output.ts` and remove all its consumers

**Files:**
- Delete: `src/execution/single-output.ts`
- Delete: `test/unit/single-output.test.ts`
- Modify: `src/execution/subagent-executor.ts`
- Modify: `src/execution/execution.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/ui/render.ts`

- [ ] **Step 1: Remove `single-output` imports from `subagent-executor.ts`**

In `src/execution/subagent-executor.ts`, remove the import line:
```typescript
import { finalizeSingleOutput, injectSingleOutputInstruction, resolveSingleOutputPath } from "./single-output.ts";
```

- [ ] **Step 2: Remove output-file logic from `runSinglePath` in `subagent-executor.ts`**

In the `runSinglePath` function, remove the following lines:
```typescript
const rawOutput = params.output !== undefined ? params.output : agentConfig.output;
const _effectiveOutput: string | false | undefined = rawOutput === true ? agentConfig.output : (rawOutput);
```

Remove:
```typescript
const outputPath = resolveSingleOutputPath(behavior.output || undefined, ctx.cwd, params.cwd);
task = injectSingleOutputInstruction(task, outputPath);
```

Remove `outputPath` from the `runSync` call options — delete these two lines:
```typescript
outputPath,
```
(the one near line 530 in the runSync options object)

Remove the `finalizeSingleOutput` call block and replace it with direct display logic. Change:

```typescript
const fullOutput = getSingleResultOutput(r);
const finalizedOutput = finalizeSingleOutput({
    fullOutput,
    truncatedOutput: r.truncation?.text,
    outputPath,
    exitCode: r.exitCode,
    savedPath: r.savedOutputPath,
    saveError: r.outputSaveError,
});
```

to:

```typescript
const fullOutput = getSingleResultOutput(r);
const displayOutput = r.truncation?.text || fullOutput;
```

Then in the success return, change:
```typescript
content: [{ type: "text", text: finalizedOutput.displayOutput || "(no output)" }],
```
to:
```typescript
content: [{ type: "text", text: displayOutput || "(no output)" }],
```

In the error return path, remove `truncation: r.truncation,` additions only if they duplicate. Keep `truncation` in both return blocks — it's still useful for display.

- [ ] **Step 3: Remove `single-output` imports and calls from `execution.ts`**

In `src/execution/execution.ts`, remove the import line:
```typescript
import { captureSingleOutputSnapshot, resolveSingleOutput } from "./single-output.ts";
```

Remove:
```typescript
const outputSnapshot = captureSingleOutputSnapshot(options.outputPath);
```

Remove the entire `resolveSingleOutput` block:
```typescript
if (options.outputPath && result.exitCode === 0) {
    const resolvedOutput = resolveSingleOutput(options.outputPath, fullOutput, outputSnapshot);
    fullOutput = resolvedOutput.fullOutput;
    result.savedOutputPath = resolvedOutput.savedPath;
    result.outputSaveError = resolvedOutput.saveError;
}
```

- [ ] **Step 4: Remove `outputPath` from `RunSyncOptions` in `types.ts`**

In `src/shared/types.ts`, remove this line from the `RunSyncOptions` interface:
```typescript
outputPath?: string;
```

- [ ] **Step 5: Remove `savedOutputPath` and `outputSaveError` from `SingleResult` in `types.ts`**

In `src/shared/types.ts`, remove from the `SingleResult` interface:
```typescript
savedOutputPath?: string;
outputSaveError?: string;
```

- [ ] **Step 6: Remove `extractOutputTarget` and simplify `hasEmptyTextOutputWithoutOutputTarget` in `render.ts`**

In `src/ui/render.ts`, delete the entire `extractOutputTarget` function:

```typescript
function extractOutputTarget(task: string): string | undefined {
	const writeToMatch = task.match(/\[Write to:\s*([^\]\n]+)\]/i);
	if (writeToMatch?.[1]?.trim()) return writeToMatch[1].trim();
	const findingsMatch = task.match(/Write your findings to:\s*(\S+)/i);
	if (findingsMatch?.[1]?.trim()) return findingsMatch[1].trim();
	const outputMatch = task.match(/[Oo]utput(?:\s+to)?\s*:\s*(\S+)/i);
	if (outputMatch?.[1]?.trim()) return outputMatch[1].trim();
	return undefined;
}
```

Simplify `hasEmptyTextOutputWithoutOutputTarget` to just check for empty output:

```typescript
function hasEmptyOutput(task: string, output: string): boolean {
	if (output.trim()) return false;
	return true;
}
```

Rename all call sites from `hasEmptyTextOutputWithoutOutputTarget` to `hasEmptyOutput`.

Remove the `extractOutputTarget` call site in the parallel results rendering (around line 298):

```typescript
const outputTarget = extractOutputTarget(r.task);
if (outputTarget) {
    c.addChild(new Text(truncLine(theme.fg("dim", `    output: ${outputTarget}`), w), 0, 0));
}
```

Replace with nothing (just delete these 3 lines) — there's no longer an output target to display.

- [ ] **Step 7: Delete test file `test/unit/single-output.test.ts`**

```bash
rm test/unit/single-output.test.ts
```

- [ ] **Step 8: Delete `src/execution/single-output.ts`**

```bash
rm src/execution/single-output.ts
```

- [ ] **Step 9: Run all tests — expect them to pass**

```bash
npx vitest run
```

Expected: PASS (after fixing any remaining references)

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: delete single-output module and remove file-based output path"
```

---

## Task 4: Simplify `resolveStepBehavior` — remove `output`, `defaultReads`, `defaultProgress`

**Files:**
- Modify: `src/execution/settings.ts`
- Modify: `src/execution/subagent-executor.ts`
- Modify: `src/agents/agents.ts`
- Modify: `test/integration/superpowers-packets.test.ts`

- [ ] **Step 1: Simplify `ResolvedStepBehavior` and `StepOverrides` in `settings.ts`**

In `src/execution/settings.ts`, change the interfaces to:

```typescript
export interface ResolvedStepBehavior {
	reads: string[] | false;
	progress: boolean;
	skills: string[] | false;
	model?: string;
}

export interface StepOverrides {
	reads?: string[] | false;
	progress?: boolean;
	skills?: string[] | false;
	model?: string;
}

export interface PacketDefaults {
	reads?: string[];
	progress?: boolean;
}
```

Remove `output` from `PacketDefaults`. Update `resolveStepBehavior` to remove all `output` resolution and the `agentConfig.output` / `agentConfig.defaultReads` / `agentConfig.defaultProgress` references:

```typescript
export function resolveStepBehavior(
	agentConfig: AgentConfig,
	stepOverrides: StepOverrides,
	packetDefaults?: PacketDefaults,
): ResolvedStepBehavior {
	const reads =
		stepOverrides.reads !== undefined
			? stepOverrides.reads
			: packetDefaults?.reads !== undefined
				? packetDefaults.reads
				: false;

	const progress =
		stepOverrides.progress !== undefined
			? stepOverrides.progress
			: packetDefaults?.progress !== undefined
				? packetDefaults.progress
				: false;

	let skills: string[] | false;
	if (stepOverrides.skills === false) {
		skills = false;
	} else if (stepOverrides.skills !== undefined) {
		skills = [...stepOverrides.skills];
	} else {
		skills = agentConfig.skills ? [...agentConfig.skills] : [];
	}

	const model = stepOverrides.model ?? agentConfig.model;
	return { reads, progress, skills, model };
}
```

- [ ] **Step 2: Remove `output`, `defaultReads`, `defaultProgress`, `interactive` from `AgentConfig` and `KNOWN_FIELDS`**

In `src/agents/agents.ts`, remove from `KNOWN_FIELDS`:
```typescript
"output",
"defaultReads",
"defaultProgress",
"interactive",
```

Remove from the `AgentConfig` interface:
```typescript
output?: string;
defaultReads?: string[];
defaultProgress?: boolean;
interactive?: boolean;
```

Remove their parsing in `loadAgentsFromDir`:
```typescript
const defaultReads = frontmatter.defaultReads
    ?.split(",")
    .map((f) => f.trim())
    .filter(Boolean);
```
and:
```typescript
output: frontmatter.output,
defaultReads: defaultReads && defaultReads.length > 0 ? defaultReads : undefined,
defaultProgress: frontmatter.defaultProgress === "true",
interactive: frontmatter.interactive === "true",
```

- [ ] **Step 3: Remove `output` from `StepOverrides` usage in `subagent-executor.ts`**

In the `runParallelPath` function, find the `resolveStepBehavior` call and remove `output: undefined` from the overrides:

Change:
```typescript
return resolveStepBehavior(
    config,
    {
        output: undefined,
        reads: undefined,
        progress: undefined,
        skills: skillOverride,
        model: t.model,
    },
    packetDefaults,
);
```
to:
```typescript
return resolveStepBehavior(
    config,
    {
        reads: undefined,
        progress: undefined,
        skills: skillOverride,
        model: t.model,
    },
    packetDefaults,
);
```

In `runSinglePath`, change:
```typescript
const behavior = resolveStepBehavior(
    agentConfig,
    {
        output: params.output === true ? undefined : (params.output),
        reads: undefined,
        progress: undefined,
        skills: skillOverride,
        model: modelOverride,
    },
    packetDefaults,
);
```
to:
```typescript
const behavior = resolveStepBehavior(
    agentConfig,
    {
        reads: undefined,
        progress: undefined,
        skills: skillOverride,
        model: modelOverride,
    },
    packetDefaults,
);
```

Remove these lines from `runSinglePath`:
```typescript
const rawOutput = params.output !== undefined ? params.output : agentConfig.output;
const _effectiveOutput: string | false | undefined = rawOutput === true ? agentConfig.output : (rawOutput);
```

- [ ] **Step 4: Update integration tests that assert `output` in `ResolveStepBehavior`**

In `test/integration/superpowers-packets.test.ts`, find the "prefers explicit step overrides, then packet defaults, then agent defaults" test and remove the `output` assertions. Change the test to remove `output` from the agent config and step overrides:

```typescript
void it("prefers explicit step overrides, then packet defaults, then agent defaults", () => {
    const behavior = resolveStepBehavior(
        {
            name: "sp-implementer",
            description: "Implementer",
            systemPrompt: "Implement one task.",
            source: "builtin",
            filePath: "/tmp/sp-implementer.md",
        },
        {
            reads: ["custom-task.md"],
        },
        {
            reads: ["task-brief.md"],
            progress: false,
        },
    );

    assert.deepEqual(behavior.reads, ["custom-task.md"]);
    assert.equal(behavior.progress, false);
});
```

- [ ] **Step 5: Run tests — expect them to pass**

```bash
npx vitest run
```

- [ ] **Step 6: Commit**

```bash
git add src/execution/settings.ts src/execution/subagent-executor.ts src/agents/agents.ts test/integration/superpowers-packets.test.ts
git commit -m "feat: remove output/defaultReads/defaultProgress from step behavior and agent config"
```

---

## Task 5: Remove stale files and update `.gitignore`

**Files:**
- Delete: `code-review.md` (repo root)
- Delete: `debug-brief.md` (repo root)
- Delete: `implementer-report.md` (repo root)
- Delete: `spec-review.md` (repo root)
- Modify: `.gitignore`

- [ ] **Step 1: Delete orphaned output files**

```bash
rm code-review.md debug-brief.md implementer-report.md spec-review.md
```

- [ ] **Step 2: Add packet filenames to `.gitignore`**

Append to `.gitignore`:
```
# Agent output artifacts
implementer-report.md
spec-review.md
code-review.md
debug-brief.md
task-brief.md
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: delete orphaned agent output files and add them to .gitignore"
```

---

## Task 6: Clean up `SubagentParamsLike` — remove `output` parameter

**Files:**
- Modify: `src/execution/subagent-executor.ts`
- Modify: `src/shared/schemas.ts` (if needed)

- [ ] **Step 1: Remove `output` from `SubagentParamsLike`**

In `src/execution/subagent-executor.ts`, find the `SubagentParamsLike` interface and remove:

```typescript
output?: string | boolean;
```

- [ ] **Step 2: Verify no references remain to `params.output` in `subagent-executor.ts`**

Search for `params.output`. All references should be gone after Tasks 3 and 4. If any remain, remove them.

- [ ] **Step 3: Run all tests**

```bash
npx vitest run
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/execution/subagent-executor.ts
git commit -m "feat: remove output param from SubagentParamsLike"
```

---

## Task 7: Fix the `sp-implementer` description prefix

**Files:**
- Modify: `agents/sp-implementer.md`

- [ ] **Step 1: Update description for consistency**

In `agents/sp-implementer.md`, change:
```
description: Superpowers-native implementer for one bounded plan task
```
to:
```
description: Superpowers implementer for one bounded plan task
```

- [ ] **Step 2: Commit**

```bash
git add agents/sp-implementer.md
git commit -m "fix: normalize sp-implementer description prefix to match other agents"
```

---

## Task 8: Update the `render.ts` empty-output UI logic

**Files:**
- Modify: `src/ui/render.ts`

- [ ] **Step 1: Replace `hasEmptyTextOutputWithoutOutputTarget` with `hasEmptyOutput`**

Already handled in Task 3 Step 6. Verify that all call sites in `render.ts` use `hasEmptyOutput` instead of `hasEmptyTextOutputWithoutOutputTarget`. The semantics are the same: `hasEmptyOutput(task, output)` returns `true` when `output.trim()` is falsy.

- [ ] **Step 2: Run all tests**

```bash
npx vitest run
```

Expected: PASS

- [ ] **Step 3: Commit** (if any changes were needed beyond Task 3)

```bash
git add src/ui/render.ts
git commit -m "refactor: simplify empty-output check in render"
```

---

## Task 9: Run full test suite and verify no regressions

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run
```

Expected: ALL PASS

- [ ] **Step 2: Verify no import errors or leftover references**

```bash
grep -rn "single-output\|resolveSingleOutputPath\|injectSingleOutputInstruction\|captureSingleOutputSnapshot\|persistSingleOutput\|resolveSingleOutput\|finalizeSingleOutput" src/ --include="*.ts"
```

Expected: No results (all references removed).

- [ ] **Step 3: Verify no references to `savedOutputPath` or `outputSaveError`**

```bash
grep -rn "savedOutputPath\|outputSaveError" src/ --include="*.ts"
```

Expected: No results.

- [ ] **Step 4: Verify agent tool lists match the hardcoded fallback**

```bash
for f in agents/sp-*.md; do name=$(sed -n 's/^name: //p' "$f"); tools=$(sed -n 's/^tools: //p' "$f"); echo "$name: $tools"; done
```

Compare each output against `NON_DELEGATING_ROLE_TOOLS` in `src/execution/superpowers-policy.ts` to confirm they match.

- [ ] **Step 5: Verify no `[Write to:]` patterns remain in task prompts**

```bash
grep -rn "\[Write to:" src/ --include="*.ts"
grep -rn "Write your findings to:" src/ --include="*.ts"
```

Expected: No results.