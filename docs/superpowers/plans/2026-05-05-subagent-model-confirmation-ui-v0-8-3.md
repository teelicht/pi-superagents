# Subagent Model Confirmation UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the runtime-confirmed model in the inline Pi chat subagent rows where started/running subagents are displayed, and show model plus separate thinking level in expanded/details views for v0.8.3.

**Architecture:** Treat the child execution loop as the source of truth for displayed model data. Add optional model/thinking metadata to live progress and result/history records, keep completed model updates driven by assistant `message_end` events, then render compact model labels in inline subagent rows and `/subagents-status` rows. Update user documentation and the unreleased 0.8.3 changelog entry.

**Tech Stack:** TypeScript, Node test runner (`node:test`), Pi JSONL subprocess events, compact inline Pi tool-result rendering, Pi TUI status overlay, JSONL run history.

---

## Spec and Scope Check

Spec: `docs/superpowers/specs/2026-05-05-subagent-model-confirmation-ui-design.md`

The user clarified that the primary UI is the inline Pi chat subagent UI: the rows shown directly in the conversation/tool-result block when subagents start, run, and finish. `/subagents-status` should also show the same confirmation data, but it is not the only target. The feature belongs in unreleased version `0.8.3`; update `CHANGELOG.md` under `## [0.8.3] - 2026-05-05`.

## File Structure

- Modify `src/shared/types.ts`
  - Responsibility: shared subagent progress/result contracts.
  - Add `model?: string` and `thinking?: ThinkingLevel` to `AgentProgress` so inline running rows can display provisional model data before completion.
  - Add `thinking?: ThinkingLevel` to `SingleResult` so completed/expanded rows can carry thinking separately from `model`.
- Modify `src/execution/run-history.ts`
  - Responsibility: active/persisted run metadata for `/subagents-status`.
  - Import `ThinkingLevel` and add `thinking?: ThinkingLevel` to `RunEntry`.
- Modify `src/execution/child-runner.ts`
  - Responsibility: child Pi execution loop and authoritative model event capture.
  - Initialize `result.model` from the effective launch model, `result.thinking` from effective thinking, and `progress.model`/`progress.thinking` from the same provisional values.
  - Update `result.model` and `progress.model` from child Pi assistant `message_end` model events when available.
  - Propagate model/thinking through live updates, final run history, and artifacts.
- Modify `src/execution/subagent-executor.ts`
  - Responsibility: building pending parallel progress rows before children start.
  - Add provisional `model` and `thinking` to pending rows by resolving the same effective child launch model/thinking that `child-runner.ts` will use.
- Modify `src/ui/subagent-result-lines.ts`
  - Responsibility: inline Pi chat subagent row formatting.
  - Add compact model labels to collapsed and expanded row headlines; show thinking as a separate expanded detail line.
- Modify `src/ui/subagents-status.ts`
  - Responsibility: `/subagents-status` overlay.
  - Add compact model labels in rows and separate thinking details when present.
- Modify tests:
  - `test/unit/run-history.test.ts` verifies active history preserves thinking.
  - `test/unit/subagent-result-lines.test.ts` verifies inline collapsed running rows show model labels and expanded details show model/thinking separately.
  - `test/unit/subagents-status.test.ts` verifies overlay row model labels and selected thinking details.
  - `test/integration/single-execution.test.ts` verifies runtime-reported model wins over frontmatter/tier expectations in result, progress, active history, and persisted history, while thinking stays separate.
- Modify docs:
  - `README.md`
  - `docs/configuration.md`
  - `docs/worktrees.md`
  - `docs/parameters.md`
  - `docs/skills.md`
  - `CHANGELOG.md`

## Task 1: Add Model/Thinking to Shared Progress, Result, and Run History Types

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/execution/run-history.ts`
- Test: `test/unit/run-history.test.ts`

- [x] **Step 1: Write the failing run-history test**

Edit `test/unit/run-history.test.ts` and append this test after `globalRunHistory tracks active and finished runs`:

```ts
void test("globalRunHistory preserves model thinking metadata", () => {
	globalRunHistory.activeRuns.clear();
	const runId = "test-run-thinking";

	globalRunHistory.startRun(runId, {
		agent: "sp-code-review",
		task: "Review model confirmation",
		model: "anthropic/claude-sonnet-4",
		thinking: "medium",
	});

	const active = globalRunHistory.activeRuns.get(runId);
	assert.strictEqual(active?.model, "anthropic/claude-sonnet-4");
	assert.strictEqual(active?.thinking, "medium");

	globalRunHistory.updateRun(runId, {
		model: "anthropic/claude-sonnet-4-actual",
		thinking: "high",
	});

	const updated = globalRunHistory.activeRuns.get(runId);
	assert.strictEqual(updated?.model, "anthropic/claude-sonnet-4-actual");
	assert.strictEqual(updated?.thinking, "high");

	globalRunHistory.finishRun(runId, "ok");
	const persisted = globalRunHistory.getRecent(5).find((run) => run.agent === "sp-code-review" && run.task === "Review model confirmation");
	assert.strictEqual(persisted?.model, "anthropic/claude-sonnet-4-actual");
	assert.strictEqual(persisted?.thinking, "high");
});
```

- [x] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --experimental-strip-types --test test/unit/run-history.test.ts
```

Expected: FAIL because `thinking` is not part of `RunEntry` yet.

- [x] **Step 3: Add model/thinking to shared progress and result metadata**

In `src/shared/types.ts`, update `AgentProgress` immediately after `task: string;`:

```ts
	model?: string;
	thinking?: ThinkingLevel;
	skills?: string[];
```

Update `SingleResult` near the existing `model?: string;` field:

```ts
	model?: string;
	thinking?: ThinkingLevel;
	error?: string;
```

- [x] **Step 4: Add thinking to run history entries**

In `src/execution/run-history.ts`, add this import after the Node imports:

```ts
import type { ThinkingLevel } from "../shared/types.ts";
```

Update `RunEntry` near `model?: string;`:

```ts
	model?: string;
	thinking?: ThinkingLevel;
	skills?: string[];
```

Do not add custom serialization logic. Existing `startRun`, `updateRun`, `finishRun`, and `recordRun` already shallow-copy optional fields through the lifecycle once the type allows them.

- [x] **Step 5: Run the focused test and verify it passes**

Run:

```bash
node --experimental-strip-types --test test/unit/run-history.test.ts
```

Expected: PASS for both run-history tests.

- [x] **Step 6: Commit Task 1**

Run:

```bash
git add src/shared/types.ts src/execution/run-history.ts test/unit/run-history.test.ts
git commit -m "feat: type subagent model confirmation metadata"
```

## Task 2: Record Provisional Thinking and Runtime-Confirmed Model in Child Execution

**Files:**
- Modify: `src/execution/child-runner.ts`
- Test: `test/integration/single-execution.test.ts`

- [ ] **Step 1: Write the failing integration test for runtime-confirmed result/progress/history**

In `test/integration/single-execution.test.ts`, add this test after `records the actual model emitted by child pi`:

```ts
	void it("records runtime-confirmed model and separate thinking in result progress and run history", async () => {
		globalRunHistory.activeRuns.clear();
		const updates: unknown[] = [];
		mockPi.onCall({
			jsonl: [
				{
					type: "message_end",
					message: {
						role: "assistant",
						content: [{ type: "text", text: "Done" }],
						model: "runtime/provider-model",
						usage: {
							input: 10,
							output: 5,
							cacheRead: 0,
							cacheWrite: 0,
							cost: { total: 0.001 },
						},
					},
				},
			],
		});
		const agents = [makeAgent("sp-code-review", { model: "balanced" })];

		const result = await runPreparedChild(tempDir, agents, "sp-code-review", "History task", {
			workflow: "superpowers",
			runId: "history-confirmation",
			onUpdate: (update) => updates.push(update),
			config: {
				superagents: {
					modelTiers: {
						balanced: {
							model: "configured/provider-model",
							thinking: "medium",
						},
					},
				},
			},
		});

		assert.equal(result.exitCode, 0);
		assert.equal(result.model, "runtime/provider-model");
		assert.equal(result.thinking, "medium");
		assert.equal(result.progress?.model, "runtime/provider-model");
		assert.equal(result.progress?.thinking, "medium");

		const lastUpdate = updates.at(-1) as { details?: { results?: Array<{ model?: string; thinking?: string; progress?: { model?: string; thinking?: string } }> } };
		assert.equal(lastUpdate.details?.results?.[0]?.model, "runtime/provider-model");
		assert.equal(lastUpdate.details?.results?.[0]?.thinking, "medium");
		assert.equal(lastUpdate.details?.results?.[0]?.progress?.model, "runtime/provider-model");
		assert.equal(lastUpdate.details?.results?.[0]?.progress?.thinking, "medium");

		const historyRun = globalRunHistory.getRecent(10).find((run) => run.agent === "sp-code-review" && run.task === "History task");
		assert.equal(historyRun?.model, "runtime/provider-model");
		assert.equal(historyRun?.thinking, "medium");
	});
```

If `globalRunHistory` is not imported in this file, add this import at the top with the other project imports:

```ts
import { globalRunHistory } from "../../src/execution/run-history.ts";
```

- [ ] **Step 2: Run the focused integration test and verify it fails**

Run:

```bash
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/single-execution.test.ts
```

Expected: FAIL because `result.thinking`, `progress.model`, `progress.thinking`, and persisted `historyRun.thinking` are missing.

- [ ] **Step 3: Initialize result and progress model/thinking metadata**

In `src/execution/child-runner.ts`, update the `result` object so model and thinking are separate fields:

```ts
	const result: SingleResult = {
		agent: agentName,
		task,
		exitCode: 0,
		messages: [],
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
		model: effectiveModel,
		thinking: effectiveThinking,
		skills: resolvedSkillNames,
		skillsWarning,
		sessionMode,
		sessionFile: options.sessionFile,
	};
```

Update the `progress` object by adding model/thinking immediately after `task`:

```ts
		model: effectiveModel,
		thinking: effectiveThinking,
```

Replace the current `globalRunHistory.startRun(...)` call with:

```ts
	globalRunHistory.startRun(historyId, {
		agent: agentName,
		task,
		model: effectiveModel,
		thinking: effectiveThinking,
		skills: resolvedSkillNames,
		skillsWarning,
	});
```

These are provisional values shown while the child is starting or before it emits a model event.

- [ ] **Step 4: Update progress and history when runtime model events arrive**

In the assistant `message_end` branch in `src/execution/child-runner.ts`, replace the one-line model assignment:

```ts
							if (evt.message.model && !evt.message.errorMessage) result.model = evt.message.model;
```

with:

```ts
							if (evt.message.model && !evt.message.errorMessage) {
								result.model = evt.message.model;
								progress.model = evt.message.model;
							}
```

Keep the error model guard exactly as shown. Do not replace the runtime event model with frontmatter, tier config, `modelOverride`, or `modelArg`.

- [ ] **Step 5: Propagate thinking through live and final history updates**

In the `fireUpdate` function in `src/execution/child-runner.ts`, include `thinking` in the update payload:

```ts
				globalRunHistory.updateRun(historyId, {
					duration: progress.durationMs,
					model: result.model,
					thinking: result.thinking,
					skills: result.skills,
					skillsWarning: result.skillsWarning,
					tokens: { total: result.usage.input + result.usage.output },
				});
```

Near the end of `runPreparedChild`, before assigning `result.progress = progress`, keep progress aligned with the final result:

```ts
	progress.model = result.model;
	progress.thinking = result.thinking;
```

Update the final `globalRunHistory.updateRun(...)` payload:

```ts
	globalRunHistory.updateRun(historyId, {
		duration: progress.durationMs,
		model: result.model,
		thinking: result.thinking,
		skills: result.skills,
		skillsWarning: result.skillsWarning,
		tokens: { total: result.usage.input + result.usage.output },
	});
```

- [ ] **Step 6: Write thinking to artifacts metadata**

In `src/execution/child-runner.ts`, update the `writeMetadata(...)` object to include thinking immediately after model:

```ts
			writeMetadata(artifactPathsResult.metadataPath, {
				runId,
				agent: agentName,
				task,
				exitCode: result.exitCode,
				usage: result.usage,
				model: result.model,
				thinking: result.thinking,
				durationMs: progress.durationMs,
				toolCount: progress.toolCount,
				error: result.error,
				skills: result.skills,
				skillsWarning: result.skillsWarning,
				timestamp: Date.now(),
			});
```

- [ ] **Step 7: Run the focused integration test and verify it passes**

Run:

```bash
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/single-execution.test.ts
```

Expected: PASS, including the new runtime-confirmed result/progress/history test.

- [ ] **Step 8: Commit Task 2**

Run:

```bash
git add src/execution/child-runner.ts test/integration/single-execution.test.ts
git commit -m "feat: confirm subagent model from execution events"
```

## Task 3: Seed Pending Parallel Inline Rows with Provisional Model Metadata

**Files:**
- Modify: `src/execution/subagent-executor.ts`
- Test: `test/unit/subagent-result-lines.test.ts`

- [ ] **Step 1: Add inline renderer coverage for pending/running model labels**

In `test/unit/subagent-result-lines.test.ts`, append this test in the `renderSubagentResultLines parallel runs` describe block before the truncation test:

```ts
	void it("shows model labels for inline pending and running rows", () => {
		const lines = renderSubagentResultLines(
			toolResult({
				mode: "parallel",
				results: [],
				progress: [
					{
						index: 0,
						agent: "sp-recon",
						status: "running",
						task: "Inspect auth flow",
						model: "configured/recon-runtime-model",
						thinking: "low",
						recentTools: [],
						recentOutput: [],
						toolCount: 1,
						durationMs: 1000,
					},
					{
						index: 1,
						agent: "sp-code-review",
						status: "pending",
						task: "Review auth changes",
						model: "configured/review-runtime-model",
						thinking: "medium",
						recentTools: [],
						recentOutput: [],
						toolCount: 0,
						durationMs: 0,
					},
				],
			}),
			{ expanded: false, width: 160 },
		);

		const text = lines.join("\n");
		assert.match(text, /sp-recon\s+recon-runtime-model\s+Inspect auth flow/);
		assert.match(text, /sp-code-review\s+review-runtime-model\s+Review auth changes/);
	});
```

This test initially fails until Task 4 changes the inline row formatter.

- [ ] **Step 2: Add pending progress model/thinking seeding in parallel executor**

In `src/execution/subagent-executor.ts`, import `resolveModelForAgent` from `./superpowers-policy.ts` if it is not already imported in that file. Keep the existing `ExecutionRole` import usage unchanged.

In the `pendingProgress = tasks.map(...)` callback, before `return { index, ... }`, add:

```ts
			const tierModel = resolveModelForAgent({
				workflow,
				agentModel: agentConfigs[index].model,
				config,
			});
			const provisionalModel = modelOverrides[index] ?? tierModel?.model ?? agentConfigs[index].model;
			const provisionalThinking = agentConfigs[index].thinking ?? (modelOverrides[index] ? undefined : tierModel?.thinking);
```

Add `model` and `thinking` to the returned pending `AgentProgress` object immediately after `task`:

```ts
				model: provisionalModel,
				thinking: provisionalThinking,
```

This mirrors child launch resolution so inline pending rows can show the model expected to launch with until the execution loop confirms the runtime-reported model.

- [ ] **Step 3: Run the inline formatter test and verify it still fails only on formatting**

Run:

```bash
node --experimental-strip-types --test test/unit/subagent-result-lines.test.ts
```

Expected: FAIL on missing model labels in row text. There should be no type error for `AgentProgress.model` or `AgentProgress.thinking` after Task 1.

- [ ] **Step 4: Commit Task 3**

Run:

```bash
git add src/execution/subagent-executor.ts test/unit/subagent-result-lines.test.ts
git commit -m "feat: seed inline subagent progress models"
```

## Task 4: Render Model in Inline Pi Chat Rows and Thinking in Inline Details

**Files:**
- Modify: `src/ui/subagent-result-lines.ts`
- Test: `test/unit/subagent-result-lines.test.ts`

- [ ] **Step 1: Add expanded inline detail tests**

In `test/unit/subagent-result-lines.test.ts`, update the `shows bounded running details when expanded` fixture by adding `thinking: "medium",` immediately after `model: "openai/gpt-5.4-mini",`.

Add these assertions in that test after the existing model assertion:

```ts
		assert.match(text, /thinking: medium/);
		assert.match(text, /sp-recon\s+gpt-5\.4-mini\s+Inspect auth flow/);
```

Update the completed details test fixture by adding `thinking: "high",` immediately after `model: "anthropic/claude-sonnet-4.5",`.

Add this assertion after the existing completed model assertion:

```ts
		assert.match(text, /thinking: high/);
```

- [ ] **Step 2: Add inline model label helper**

In `src/ui/subagent-result-lines.ts`, add this helper above `formatExpandedRow`:

```ts
/**
 * Formats a runtime model for compact inline subagent rows.
 *
 * @param row Normalized display row that may contain completed or live progress metadata.
 * @returns Compact model label with an explicit unknown fallback.
 */
function formatRowModelLabel(row: SubagentDisplayRow): string {
	const model = row.result?.model ?? row.progress?.model;
	if (!model) return "unknown";
	const tail = model.split("/").pop() ?? model;
	return tail.length > 28 ? `${tail.slice(0, 25)}...` : tail;
}
```

- [ ] **Step 3: Include model in expanded inline row headlines**

In `src/ui/subagent-result-lines.ts`, replace `formatExpandedRow` with:

```ts
/**
 * Formats the expanded row headline.
 *
 * @param row Normalized display row.
 * @returns Expanded row headline.
 */
function formatExpandedRow(row: SubagentDisplayRow): string {
	const summary = row.summary;
	const stats = summary && summary.toolCount > 0 ? `  ${summary.toolCount} tools  ${formatDuration(summary.durationMs)}` : "";
	return `- ${row.status}  ${row.agent}  ${formatRowModelLabel(row)}  ${row.task}${stats}`;
}
```

- [ ] **Step 4: Include thinking in expanded inline details**

In `formatExpandedDetails`, replace:

```ts
	if (result?.model) lines.push(`model: ${result.model}`);
```

with:

```ts
	const model = result?.model ?? progress?.model;
	const thinking = result?.thinking ?? progress?.thinking;
	if (model) lines.push(`model: ${model}`);
	if (thinking) lines.push(`thinking: ${thinking}`);
```

- [ ] **Step 5: Include model in collapsed inline rows**

In `src/ui/subagent-result-lines.ts`, replace `formatCollapsedRow` with:

```ts
/**
 * Formats one collapsed row.
 *
 * @param row Normalized display row.
 * @param includeStatus Whether to include status at the start of the row.
 * @returns Row text.
 */
function formatCollapsedRow(row: SubagentDisplayRow, includeStatus: boolean): string {
	const summary = row.summary;
	const stats = summary && summary.toolCount > 0 ? `  ${summary.toolCount} tools  ${formatDuration(summary.durationMs)}` : "";
	const status = includeStatus ? `${row.status}  ` : "";
	return `- ${status}${row.agent}  ${formatRowModelLabel(row)}  ${row.task}${stats}`;
}
```

- [ ] **Step 6: Run the focused inline renderer tests and verify they pass**

Run:

```bash
node --experimental-strip-types --test test/unit/subagent-result-lines.test.ts
```

Expected: PASS for all inline subagent result line tests.

- [ ] **Step 7: Commit Task 4**

Run:

```bash
git add src/ui/subagent-result-lines.ts test/unit/subagent-result-lines.test.ts
git commit -m "feat: show model in inline subagent rows"
```

## Task 5: Render Model in `/subagents-status` Rows and Thinking in Selected Details

**Files:**
- Modify: `src/ui/subagents-status.ts`
- Test: `test/unit/subagents-status.test.ts`

- [ ] **Step 1: Write failing status overlay tests**

In `test/unit/subagents-status.test.ts`, add `thinking: "medium",` to the `createRun()` default object immediately after `model: "test-model",`:

```ts
		model: "test-model",
		thinking: "medium",
```

Append these tests before `SubagentsStatusComponent closes and disposes safely`:

```ts
void test("SubagentsStatusComponent renders compact model labels in run rows", () => {
	const component = new SubagentsStatusComponent(createTuiMock().tui as never, createThemeMock() as never, () => {}, {
		refreshMs: 60_000,
		getActiveRuns: () => [],
		getRecentRuns: () => [createRun({ model: "anthropic/claude-sonnet-4-runtime" })],
	});

	const rendered = component.render(120).join("\n");

	assert.match(rendered, /claude-sonnet-4-runtime/);
	assert.match(rendered, /Implement auth fix/);
	component.dispose();
});

void test("SubagentsStatusComponent renders selected model and thinking separately", () => {
	const component = new SubagentsStatusComponent(createTuiMock().tui as never, createThemeMock() as never, () => {}, {
		refreshMs: 60_000,
		getActiveRuns: () => [],
		getRecentRuns: () => [createRun({ model: "runtime/model", thinking: "high" })],
	});

	const rendered = component.render(120).join("\n");

	assert.match(rendered, /Model:\s+runtime\/model/);
	assert.match(rendered, /Thinking:\s+high/);
	component.dispose();
});

void test("SubagentsStatusComponent omits selected thinking when absent", () => {
	const component = new SubagentsStatusComponent(createTuiMock().tui as never, createThemeMock() as never, () => {}, {
		refreshMs: 60_000,
		getActiveRuns: () => [],
		getRecentRuns: () => [createRun({ thinking: undefined })],
	});

	const rendered = component.render(120).join("\n");

	assert.match(rendered, /Model:\s+test-model/);
	assert.doesNotMatch(rendered, /Thinking:/);
	component.dispose();
});
```

- [ ] **Step 2: Run the focused status tests and verify they fail**

Run:

```bash
node --experimental-strip-types --test test/unit/subagents-status.test.ts
```

Expected: FAIL because overlay row rendering does not include model labels and details do not render thinking.

- [ ] **Step 3: Render thinking in selected details**

In `src/ui/subagents-status.ts`, replace the initial `lines` array in `renderRunDetails` with:

```ts
		const lines = [
			this.theme.fg("success", "Selected Details:"),
			`  Agent:  ${run.agent}`,
			`  Status: ${run.status}`,
			`  Model:  ${run.model ?? "unknown"}`,
		];
		if (run.thinking) {
			lines.push(`  Thinking: ${run.thinking}`);
		}
		lines.push(`  Tokens: ${run.tokens ? formatTokens(run.tokens.total) : "0"}`, `  Time:   ${formatDuration(run.duration)}`);
```

Keep the existing skills, warning, and step-detail rendering after this block.

- [ ] **Step 4: Render compact model labels in status rows**

In `src/ui/subagents-status.ts`, replace `formatRunRow` with:

```ts
/**
 * Render one run row with compact model confirmation metadata.
 *
 * @param run Run entry to summarize.
 * @param selected Whether the row is currently selected.
 * @param theme Active Pi theme for status colors.
 * @returns A single width-bounded row string before outer truncation.
 */
function formatRunRow(run: RunEntry, selected: boolean, theme: Theme): string {
	const prefix = selected ? theme.fg("success", ">") : " ";
	const status = run.status === "ok" ? theme.fg("success", "OK ") : theme.fg("error", "ERR");
	const duration = formatDuration(run.duration).padStart(6);
	const model = compactModelLabel(run.model);
	const task = run.task.length > 36 ? `${run.task.slice(0, 33)}...` : run.task;
	return `${prefix} ${run.agent.padEnd(15)} | ${status} | ${duration} | ${model.padEnd(22)} | ${task}`;
}
```

Add this helper above `formatRunRow`:

```ts
/**
 * Format a run model for row-level status display.
 *
 * @param model Runtime-confirmed model id, if available.
 * @returns A compact model label with an explicit unknown fallback.
 */
function compactModelLabel(model: string | undefined): string {
	if (!model) return "unknown";
	const tail = model.split("/").pop() ?? model;
	return tail.length > 22 ? `${tail.slice(0, 19)}...` : tail;
}
```

- [ ] **Step 5: Run the focused status tests and verify they pass**

Run:

```bash
node --experimental-strip-types --test test/unit/subagents-status.test.ts
```

Expected: PASS for all status overlay tests.

- [ ] **Step 6: Commit Task 5**

Run:

```bash
git add src/ui/subagents-status.ts test/unit/subagents-status.test.ts
git commit -m "feat: show subagent model in status overlay"
```

## Task 6: Update Documentation and v0.8.3 Changelog

**Files:**
- Modify: `README.md`
- Modify: `docs/configuration.md`
- Modify: `docs/worktrees.md`
- Modify: `docs/parameters.md`
- Modify: `docs/skills.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update README feature and status descriptions**

In `README.md`, replace this bullet:

```md
- **Compact Inline Subagent Results**: Subagent tool results render as collapsed single-line summaries with an expandable details view, keeping the Pi conversation readable during multi-step Superpowers workflows.
```

with:

```md
- **Compact Inline Subagent Results**: Subagent tool results render as collapsed summaries with per-subagent rows that include runtime-confirmed model labels, plus expandable details for thinking levels, skills, tools, and output previews.
```

Replace this table row:

```md
| `/subagents-status`     | Open active and recent subagent run status, including resolved skills       |
```

with:

```md
| `/subagents-status`     | Open active and recent subagent run status, including runtime-confirmed models, thinking levels, and resolved skills |
```

Replace this paragraph:

```md
Run history is persisted at `~/.pi/agent/run-history.jsonl` for `/subagents-status`. Set `PI_SUPERAGENTS_RUN_HISTORY_PATH` to isolate that file for tests or sandboxed sessions.
```

with:

```md
Run history is persisted at `~/.pi/agent/run-history.jsonl` for `/subagents-status`. Inline subagent rows and the status overlay show the model reported by the child Pi execution loop and, when available, the effective thinking level used for that run. Set `PI_SUPERAGENTS_RUN_HISTORY_PATH` to isolate that file for tests or sandboxed sessions.
```

- [ ] **Step 2: Update configuration docs for inline and status rendering**

In `docs/configuration.md`, replace:

```md
Subagent tool results are rendered inline in the Pi conversation as compact, width-bounded lines. A collapsed view shows the subagent name, task, status, and live activity (e.g., current tool). Clicking or expanding the result reveals concise details: model, skills, recent tools, output preview, errors, and artifact paths. This keeps long-running Superpowers workflows readable without scrolling through verbose JSON or full Markdown output.
```

with:

```md
Subagent tool results are rendered inline in the Pi conversation as compact, width-bounded lines. A collapsed view shows the subagent name, runtime-confirmed model label, task, status, and live activity (e.g., current tool). Clicking or expanding the result reveals concise details: model, thinking level when available, skills, recent tools, output preview, errors, and artifact paths. This keeps long-running Superpowers workflows readable without scrolling through verbose JSON or full Markdown output.
```

Replace:

```md
The compact renderer is active for all `subagent` tool results produced by `pi-superagents`. `/subagents-status` remains available for inspecting active or recently completed runs in a dedicated overlay.
```

with:

```md
The compact renderer is active for all `subagent` tool results produced by `pi-superagents`. `/subagents-status` remains available for inspecting active or recently completed runs in a dedicated overlay, including the runtime-confirmed model and separate thinking level when available.
```

Replace:

```md
Completed subagent runs are stored as JSONL at `~/.pi/agent/run-history.jsonl` so `/subagents-status` can show recent runs across sessions. Set `PI_SUPERAGENTS_RUN_HISTORY_PATH` to an absolute file path when you need to isolate run history, for example in tests or sandboxed PI sessions.
```

with:

```md
Completed subagent runs are stored as JSONL at `~/.pi/agent/run-history.jsonl` so `/subagents-status` can show recent runs across sessions. Inline rows use live progress/result metadata, and run history stores the child Pi-reported model separately from the effective thinking level so the overlay can confirm actual model routing instead of only showing configured defaults. Set `PI_SUPERAGENTS_RUN_HISTORY_PATH` to an absolute file path when you need to isolate run history, for example in tests or sandboxed PI sessions.
```

Replace:

```md
Use `/subagents-status` to inspect active and recent subagent runs (`Ctrl+Alt+S`).
```

with:

```md
Use `/subagents-status` to inspect active and recent subagent runs (`Ctrl+Alt+S`), including runtime-confirmed model labels, thinking levels, resolved skills, and warnings.
```

- [ ] **Step 3: Update worktrees docs**

In `docs/worktrees.md`, replace:

```md
While parallel worktree runs are active, `/subagents-status` shows each delegated subagent separately, including its resolved skills and any missing-skill warnings. Worktree isolation does not change entrypoint or role skill resolution; for example, `/sp-implement` root lifecycle skills and `sp-debug`'s `systematic-debugging` assignment are resolved before any child process runs in a worktree.
```

with:

```md
While parallel worktree runs are active, inline subagent rows and `/subagents-status` show each delegated subagent separately, including its runtime-confirmed model, effective thinking level when available, resolved skills, and any missing-skill warnings. Worktree isolation does not change entrypoint or role skill resolution; for example, `/sp-implement` root lifecycle skills and `sp-debug`'s `systematic-debugging` assignment are resolved before any child process runs in a worktree.
```

- [ ] **Step 4: Update parameters docs**

In `docs/parameters.md`, replace:

```md
Resolved skills, including per-call `skill` overrides and agent frontmatter defaults, are shown in `/subagents-status` for active and recent subagent runs. Missing skills are shown as warnings there. The bundled `sp-debug` role resolves `systematic-debugging` from its frontmatter unless a call overrides or disables skills.
```

with:

```md
Runtime-confirmed models, effective thinking levels, and resolved skills are shown in inline subagent rows/details and `/subagents-status` for active and recent subagent runs. Missing skills are shown as warnings there. The bundled `sp-debug` role resolves `systematic-debugging` from its frontmatter unless a call overrides or disables skills.
```

Replace:

```md
- **Collapsed**: status line, task name, current tool activity, and timing stats.
- **Expanded**: model, skills, recent tools, bounded output preview, errors, session file, and artifact paths.
```

with:

```md
- **Collapsed**: status line plus per-subagent rows with agent, compact runtime-confirmed model label, task name, current tool activity, and timing stats.
- **Expanded**: runtime-confirmed model, thinking level when available, skills, recent tools, bounded output preview, errors, session file, and artifact paths.
```

- [ ] **Step 5: Update skills docs**

In `docs/skills.md`, replace:

```md
Open `/subagents-status` and select an active or recent subagent run to see the resolved skill names injected for that run. This includes default agent skills, runtime `skill` overrides, and TDD skill injection from the explicit `useTestDrivenDevelopment` tool parameter. Missing skills are shown as warnings in the selected run details.
```

with:

```md
Inline subagent result rows show each run's compact runtime-confirmed model label. Open `/subagents-status` and select an active or recent subagent run to see the runtime-confirmed model, effective thinking level when available, and resolved skill names injected for that run. Skill details include default agent skills, runtime `skill` overrides, and TDD skill injection from the explicit `useTestDrivenDevelopment` tool parameter. Missing skills are shown as warnings in the selected run details.
```

Replace:

```md
Subagent results are rendered as compact inline lines in the Pi conversation. Collapsed view shows the agent name, task, status, and current tool activity. Expanded view reveals model, skills, recent tools, output preview, errors, and artifact paths. This keeps long-running Superpowers workflows readable without scrolling through verbose output.
```

with:

```md
Subagent results are rendered as compact inline lines in the Pi conversation. Collapsed view shows the agent name, compact runtime-confirmed model label, task, status, and current tool activity. Expanded view reveals model, thinking level when available, skills, recent tools, output preview, errors, and artifact paths. This keeps long-running Superpowers workflows readable without scrolling through verbose output.
```

- [ ] **Step 6: Update unreleased v0.8.3 changelog**

In `CHANGELOG.md`, under `## [0.8.3] - 2026-05-05` and below the existing `- **Hardened Subagent Execution**` block, add:

```md
- **Subagent Model Confirmation UI**
  - Inline Pi chat subagent rows now show compact runtime-confirmed model labels for started, running, and completed subagent runs.
  - Expanded inline details and `/subagents-status` selected details show the child Pi-reported model separately from the effective thinking level.
  - Run history records thinking metadata separately from model ids so the status overlay can confirm actual subagent model routing.
```

- [ ] **Step 7: Commit Task 6**

Run:

```bash
git add README.md docs/configuration.md docs/worktrees.md docs/parameters.md docs/skills.md CHANGELOG.md
git commit -m "docs: document subagent model confirmation UI"
```

## Task 7: Full Verification

**Files:**
- No source changes expected.

- [ ] **Step 1: Run focused inline/status tests**

Run:

```bash
node --experimental-strip-types --test test/unit/subagent-result-lines.test.ts test/unit/subagents-status.test.ts test/unit/run-history.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run focused execution integration tests**

Run:

```bash
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/single-execution.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run unit tests**

Run:

```bash
npm run test:unit
```

Expected: PASS.

- [ ] **Step 4: Run integration tests**

Run:

```bash
npm run test:integration
```

Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Run full QA if time allows**

Run:

```bash
npm run qa
```

Expected: PASS. If `npm run qa` modifies formatting, inspect the diff and commit those formatting changes with the relevant task commit or a final `chore: apply formatting` commit.

- [ ] **Step 7: Inspect git state**

Run:

```bash
git status --short
```

Expected: no uncommitted source, test, documentation, or changelog changes. `.superpowers/` visual-companion files must remain untracked and excluded locally.

## Self-Review Notes

- Spec coverage: Tasks 1-2 cover clean data model, runtime-confirmed source of truth, thinking separation, active/persisted run history, and live progress metadata for inline rows. Tasks 3-4 cover the corrected primary UI: inline Pi chat subagent rows and expanded inline details. Task 5 covers `/subagents-status` as a secondary overlay. Task 6 covers required user docs and v0.8.3 changelog updates.
- Red-flag scan: No unresolved markers, undefined future functions, or vague test instructions are intentionally present in the plan. All code-touching steps include concrete code blocks or exact replacements.
- Type consistency: `model?: string` and `thinking?: ThinkingLevel` are shared optional property names across `AgentProgress`; `thinking?: ThinkingLevel` is used by `SingleResult` and `RunEntry`; inline UI reads `row.result?.model ?? row.progress?.model` and `row.result?.thinking ?? row.progress?.thinking`; child runner updates progress and result from runtime model events.
