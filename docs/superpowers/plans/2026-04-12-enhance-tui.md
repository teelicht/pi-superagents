# Enhance TUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the basic Container-based status component with a rich, interactive, border-boxed string-array TUI component that displays live run metrics.

**Architecture:** Update `RunEntry` and `globalRunHistory` to track active runs. Move run logging directly into `runSync` to get realtime updates. Build new UI primitives `render-helpers.ts` and refactor `superpowers-status.ts` to implement the `Component` interface using string arrays.

**Tech Stack:** Node.js, TypeScript, `@mariozechner/pi-tui`, `@mariozechner/pi-coding-agent`.

---

### Task 1: Update Run History Model

**Files:**
- Modify: `src/execution/run-history.ts`
- Create: `test/unit/run-history.test.ts`

- [x] **Step 1: Write the failing test**

```typescript
// test/unit/run-history.test.ts
import { test } from "node:test";
import * as assert from "node:assert";
import { globalRunHistory, recordRun } from "../../src/execution/run-history.ts";

test("globalRunHistory tracks active and finished runs", () => {
	globalRunHistory.activeRuns.clear();
	const runId = "test-run-123";
	
	// Start
	globalRunHistory.startRun(runId, { agent: "TestAgent", task: "Test Task" });
	assert.strictEqual(globalRunHistory.activeRuns.size, 1);
	
	const active = globalRunHistory.activeRuns.get(runId);
	assert.strictEqual(active?.status, "ok");
	assert.strictEqual(active?.duration, 0);

	// Update
	globalRunHistory.updateRun(runId, { duration: 500, model: "gpt-4" });
	const updated = globalRunHistory.activeRuns.get(runId);
	assert.strictEqual(updated?.duration, 500);
	assert.strictEqual(updated?.model, "gpt-4");

	// Finish
	globalRunHistory.finishRun(runId, "ok");
	assert.strictEqual(globalRunHistory.activeRuns.size, 0);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- test/unit/run-history.test.ts`
Expected: FAIL with "globalRunHistory.startRun is not a function"

- [x] **Step 3: Write minimal implementation**

Modify `src/execution/run-history.ts` to implement the new schema and tracking:

```typescript
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface RunEntry {
	agent: string;
	task: string;
	ts: number;
	status: "ok" | "error";
	duration: number;
	exit?: number;
	model?: string;
	tokens?: { total: number };
	steps?: Array<{
		index: number;
		agent: string;
		status: string;
		durationMs?: number;
		tokens?: { total: number };
		error?: string;
	}>;
}

const HISTORY_PATH = path.join(os.homedir(), ".pi", "agent", "run-history.jsonl");
const ROTATE_READ_THRESHOLD = 1200;
const ROTATE_KEEP = 1000;

export function recordRun(entry: RunEntry): void {
	try {
		fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
		fs.appendFileSync(HISTORY_PATH, `${JSON.stringify(entry)}\n`);
	} catch {
		// Best-effort — never crash the execution flow for history recording
	}
}

export function loadRunsForAgent(agent: string): RunEntry[] {
	if (!fs.existsSync(HISTORY_PATH)) return [];
	let raw: string;
	try {
		raw = fs.readFileSync(HISTORY_PATH, "utf-8");
	} catch {
		return [];
	}

	let lines = raw.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);

	if (lines.length > ROTATE_READ_THRESHOLD) {
		lines = lines.slice(-ROTATE_KEEP);
		try { fs.writeFileSync(HISTORY_PATH, `${lines.join("\n")}\n`, "utf-8"); } catch { /* empty */ }
	}

	return lines
		.map((line) => { try { return JSON.parse(line) as RunEntry; } catch { return undefined; } })
		.filter((entry): entry is RunEntry => entry !== undefined && entry.agent === agent)
		.reverse();
}

export function loadAllRuns(): RunEntry[] {
	if (!fs.existsSync(HISTORY_PATH)) return [];
	let raw: string;
	try {
		raw = fs.readFileSync(HISTORY_PATH, "utf-8");
	} catch {
		return [];
	}

	const lines = raw.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);

	return lines
		.map((line) => {
			try {
				return JSON.parse(line) as RunEntry;
			} catch {
				return undefined;
			}
		})
		.filter((entry): entry is RunEntry => Boolean(entry))
		.reverse();
}

export const globalRunHistory = {
	activeRuns: new Map<string, RunEntry>(),

	startRun(id: string, entry: Omit<RunEntry, "ts" | "status" | "duration">): void {
		this.activeRuns.set(id, {
			...entry,
			ts: Math.floor(Date.now() / 1000),
			status: "ok",
			duration: 0,
		});
	},

	updateRun(id: string, updates: Partial<RunEntry>): void {
		const existing = this.activeRuns.get(id);
		if (existing) {
			this.activeRuns.set(id, { ...existing, ...updates });
		}
	},

	finishRun(id: string, finalStatus: "ok" | "error", error?: string): void {
		const existing = this.activeRuns.get(id);
		if (existing) {
			existing.status = finalStatus;
			if (finalStatus === "error" && existing.exit === undefined) {
				existing.exit = 1;
			}
			if (error && !existing.steps?.find(s => s.error)) {
				existing.steps = existing.steps || [];
				existing.steps.push({ index: 0, agent: existing.agent, status: "failed", error });
			}
			this.activeRuns.delete(id);
			recordRun({ ...existing, task: existing.task.slice(0, 200) });
		}
	},

	getRecent(limit = 50): RunEntry[] {
		return loadAllRuns().slice(0, limit);
	},
};
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- test/unit/run-history.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

Run: `git add src/execution/run-history.ts test/unit/run-history.test.ts && git commit -m "feat(history): track active runs and metrics"`

---

### Task 2: Hook real-time history into Execution Engine

**Files:**
- Modify: `src/execution/execution.ts`
- Modify: `src/execution/subagent-executor.ts`

- [x] **Step 1: Write the minimal implementation for execution.ts**

Modify `src/execution/execution.ts`. Add the import for `globalRunHistory` at the top:
```typescript
import { globalRunHistory } from "./run-history.ts";
```

Inside `runSync`, right after `const startTime = Date.now();`, add:
```typescript
	const historyId = options.runId ? `${options.runId}-${agentName}-${index || 0}` : `run-${Date.now()}-${agentName}`;
	globalRunHistory.startRun(historyId, { agent: agentName, task });
```

In `runSync`, update the `fireUpdate` function to also update the history:
```typescript
		const fireUpdate = () => {
			if (!onUpdate || processClosed) return;
			progress.durationMs = Date.now() - startTime;
			
			globalRunHistory.updateRun(historyId, {
				duration: progress.durationMs,
				model: result.model,
				tokens: { total: result.usage.input + result.usage.output },
			});

			onUpdate({
				content: [{ type: "text", text: getFinalOutput(result.messages) || "(running...)" }],
				details: { mode: "single", results: [result], progress: [progress] },
			});
		};
```

At the very end of `runSync`, just before `return result;`, finish the run:
```typescript
	globalRunHistory.updateRun(historyId, {
		duration: progress.durationMs,
		model: result.model,
		tokens: { total: result.usage.input + result.usage.output },
	});
	globalRunHistory.finishRun(historyId, result.exitCode === 0 ? "ok" : "error", result.error);
```

- [x] **Step 2: Clean up subagent-executor.ts**

Modify `src/execution/subagent-executor.ts` to remove manual `recordRun` calls.

Remove:
```typescript
import { recordRun } from "./run-history.ts";
```

In `runForegroundParallelTasks` loop (around line 434), remove this block completely:
```typescript
		for (let i = 0; i < results.length; i++) {
			const run = results[i];
			recordRun(run.agent, taskTexts[i], run.exitCode, run.progressSummary?.durationMs ?? 0);
		}
```

In `runSinglePath` (around line 545), remove this line completely:
```typescript
	recordRun(params.agent!, cleanTask, r.exitCode, r.progressSummary?.durationMs ?? 0);
```

- [x] **Step 3: Verify all tests still pass**

Run: `npm run test`
Expected: PASS

- [x] **Step 4: Commit**

Run: `git add src/execution/execution.ts src/execution/subagent-executor.ts && git commit -m "refactor(history): move run recording into runSync for live tracking"`

---

### Task 3: Render Helpers

**Files:**
- Create: `src/ui/render-helpers.ts`
- Create: `test/unit/render-helpers.test.ts`

- [x] **Step 1: Write the failing test**

```typescript
// test/unit/render-helpers.test.ts
import { test } from "node:test";
import * as assert from "node:assert";
import { formatScrollInfo, pad } from "../../src/ui/render-helpers.ts";

test("pad strings correctly", () => {
	assert.strictEqual(pad("test", 6), "test  ");
	assert.strictEqual(pad("longtest", 4), "longtest");
});

test("formatScrollInfo returns correct labels", () => {
	assert.strictEqual(formatScrollInfo(0, 0), "");
	assert.strictEqual(formatScrollInfo(2, 3), "↑ 2 more ... ↓ 3 more");
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- test/unit/render-helpers.test.ts`
Expected: FAIL with "Cannot find module"

- [x] **Step 3: Write minimal implementation**

```typescript
// src/ui/render-helpers.ts
import type { Theme } from "@mariozechner/pi-coding-agent";

export function pad(text: string, length: number, char = " "): string {
	if (text.length >= length) return text;
	return text + char.repeat(length - text.length);
}

export function row(text: string, width: number, theme: Theme): string {
	return text;
}

export function renderHeader(title: string, width: number, theme: Theme): string {
	const prefix = "--[ ";
	const suffix = " ]";
	const dashCount = Math.max(2, width - prefix.length - title.length - suffix.length);
	return theme.fg("accent", `${prefix}${title}${suffix}${"-".repeat(dashCount)}`);
}

export function renderFooter(text: string, width: number, theme: Theme): string {
	const dashes = "-".repeat(width);
	return theme.fg("dim", `${dashes}\n${text}`);
}

export function formatScrollInfo(above: number, below: number): string {
	if (above === 0 && below === 0) return "";
	if (above > 0 && below > 0) return `↑ ${above} more ... ↓ ${below} more`;
	if (above > 0) return `↑ ${above} more`;
	return `↓ ${below} more`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- test/unit/render-helpers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

Run: `git add src/ui/render-helpers.ts test/unit/render-helpers.test.ts && git commit -m "feat(ui): add TUI layout primitives"`

---

### Task 4: Superpowers Status Component Refactor

**Files:**
- Modify: `src/ui/superpowers-status.ts`
- Create: `test/unit/superpowers-status.test.ts`

- [x] **Step 1: Write the failing test**

```typescript
// test/unit/superpowers-status.test.ts
import { test } from "node:test";
import * as assert from "node:assert";
import { SuperpowersStatusComponent } from "../../src/ui/superpowers-status.ts";

test("SuperpowersStatusComponent returns string array on render", () => {
    const tuiMock = { requestRender: () => {} } as any;
    const themeMock = { fg: (_: string, text: string) => text } as any;
    const stateMock = { configGate: { blocked: false } } as any;
    const configMock = { superagents: {} } as any;
    
    const comp = new SuperpowersStatusComponent(tuiMock, themeMock, stateMock, configMock, () => {});
    
    const lines = comp.render(80);
    assert.ok(Array.isArray(lines));
    assert.ok(lines.length > 0);
    comp.dispose();
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- test/unit/superpowers-status.test.ts`
Expected: FAIL because `comp.render()` currently returns an array from `Container` which might not be just strings, or `dispose` doesn't exist.

- [x] **Step 3: Write minimal implementation**

Rewrite `src/ui/superpowers-status.ts` entirely:

```typescript
/**
 * Superpowers status and settings overlay.
 */

import * as fs from "node:fs";
import type { Component, TUI } from "@mariozechner/pi-tui";
import { matchesKey, truncateToWidth } from "@mariozechner/pi-tui";
import type { Theme } from "@mariozechner/pi-coding-agent";
import type { ExtensionConfig, SubagentState } from "../shared/types.ts";
import {
	toggleSuperpowersBoolean,
	toggleSuperpowersWorktrees,
	updateSuperpowersConfigText,
} from "../superpowers/config-writer.ts";
import { globalRunHistory } from "../execution/run-history.ts";
import { formatScrollInfo, renderFooter, renderHeader, row } from "./render-helpers.ts";

export class SuperpowersStatusComponent implements Component {
	private readonly width = 84;
	private readonly viewportHeight = 12;
	private readonly refreshTimer: NodeJS.Timeout;

	private lastWriteMessage = "";
	private activePane: "settings" | "runs" = "settings";
	
	private cursor = 0;
	private scrollOffset = 0;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly state: SubagentState,
		private readonly config: ExtensionConfig,
		private readonly done: () => void,
	) {
		this.refreshTimer = setInterval(() => {
			this.tui.requestRender();
		}, 2000);
		this.refreshTimer.unref?.();
	}

	dispose(): void {
		clearInterval(this.refreshTimer);
	}

	render(width: number): string[] {
		const w = Math.min(width, this.width);
		const innerW = w - 2;

		const tabs = this.activePane === "settings" ? "[ Settings ]  Runs" : "Settings  [ Runs ]";
		const lines: string[] = [renderHeader(`Superpowers ${tabs}`, w, this.theme)];

		if (this.activePane === "settings") {
			lines.push(...this.renderSettingsPane(w, innerW));
		} else {
			lines.push(...this.renderRunsPane(w, innerW));
		}

		lines.push(renderFooter("Tab: Switch View | q: Close | ↑↓: Select", w, this.theme));
		return lines;
	}

	private renderSettingsPane(w: number, innerW: number): string[] {
		const settings = this.config.superagents ?? {};
		const commands = Object.entries(settings.commands ?? {});
		const modelTiers = Object.entries(settings.modelTiers ?? {});
		const tierModel = (value: unknown): string => {
			if (typeof value === "string") return value;
			if (value && typeof value === "object" && "model" in value) {
				const model = (value as { model?: unknown }).model;
				return typeof model === "string" ? model : "unknown";
			}
			return "unknown";
		};

		const lines = [
			row(`useSubagents: ${settings.useSubagents ?? true} (s)`, w, this.theme),
			row(`useTestDrivenDevelopment: ${settings.useTestDrivenDevelopment ?? true} (t)`, w, this.theme),
			row(`configStatus: ${this.state.configGate.blocked ? "blocked" : "valid"}`, w, this.theme),
			row(`worktrees.enabled: ${settings.worktrees?.enabled ?? false} (w)`, w, this.theme),
			row(`worktrees.root: ${settings.worktrees?.root ?? "default"}`, w, this.theme),
			row("", w, this.theme),
			row("Commands:", w, this.theme),
			...(commands.length
				? commands.map(
						([name, preset]) =>
							row(`- ${name}: subagents=${preset.useSubagents ?? "default"}, tdd=${preset.useTestDrivenDevelopment ?? "default"}`, w, this.theme),
					)
				: [row("- none", w, this.theme)]),
			row("", w, this.theme),
			row("Model tiers:", w, this.theme),
			...(modelTiers.length
				? modelTiers.map(([name, value]) => row(`- ${name}: ${tierModel(value)}`, w, this.theme))
				: [row("- none", w, this.theme)]),
		];

		if (this.state.configGate.message) {
			lines.push(row("", w, this.theme), row(this.theme.fg("error", this.state.configGate.message), w, this.theme));
		}

		if (this.lastWriteMessage) {
			lines.push(row("", w, this.theme), row(this.theme.fg("warning", this.lastWriteMessage), w, this.theme));
		}

		return lines;
	}

	private renderRunsPane(w: number, innerW: number): string[] {
		const activeRuns = Array.from(globalRunHistory.activeRuns.values());
		const recentRuns = globalRunHistory.getRecent(20);
		const rows: any[] = [];
		
		if (activeRuns.length > 0) {
			rows.push({ kind: "section", label: "Active" });
			for (const run of activeRuns) rows.push({ kind: "run", run });
		}
		if (recentRuns.length > 0) {
			rows.push({ kind: "section", label: "Recent" });
			for (const run of recentRuns) rows.push({ kind: "run", run });
		}
		
		if (rows.length === 0) {
			return [row("No runs recorded.", w, this.theme)];
		}

		const runRows = rows.filter(r => r.kind === "run");
		if (this.cursor >= runRows.length) this.cursor = Math.max(0, runRows.length - 1);
		
		const selectedRun = runRows[this.cursor]?.run;

		const visibleRows = rows.slice(this.scrollOffset, this.scrollOffset + this.viewportHeight);
		
		const lines: string[] = [];
		for (const statusRow of visibleRows) {
			if (statusRow.kind === "section") {
				lines.push(row(this.theme.fg("accent", statusRow.label), w, this.theme));
				continue;
			}
			const run = statusRow.run;
			const isSelected = selectedRun === run;
			const prefix = isSelected ? this.theme.fg("accent", ">") : " ";
			const duration = (run.duration / 1000).toFixed(1) + "s";
			const statusStr = run.status === "ok" ? "OK" : "ERR";
			const color = run.status === "ok" ? "success" : "error";
			const task = run.task.length > 40 ? run.task.slice(0, 37) + "..." : run.task;
			const formatted = `${prefix} ${run.agent.padEnd(15)} | ${this.theme.fg(color as any, statusStr.padEnd(3))} | ${duration.padStart(5)} | ${task}`;
			lines.push(row(truncateToWidth(formatted, innerW), w, this.theme));
		}

		const above = this.scrollOffset;
		const below = Math.max(0, rows.length - (this.scrollOffset + visibleRows.length));
		const scrollInfo = formatScrollInfo(above, below);
		if (scrollInfo) lines.push(row(this.theme.fg("dim", scrollInfo), w, this.theme));
		else lines.push(row("", w, this.theme));

		if (selectedRun) {
			lines.push(row(this.theme.fg("accent", "Selected Details:"), w, this.theme));
			lines.push(row(`  Model:  ${selectedRun.model || "unknown"}`, w, this.theme));
			lines.push(row(`  Tokens: ${selectedRun.tokens?.total || 0}`, w, this.theme));
			if (selectedRun.steps && selectedRun.steps.length > 0) {
				lines.push(row(`  Steps:  ${selectedRun.steps.length}`, w, this.theme));
			}
		}

		return lines;
	}

	private writeConfig(update: Parameters<typeof updateSuperpowersConfigText>[1]): void {
		const configPath = this.state.configGate.configPath;
		if (!configPath) {
			this.lastWriteMessage = "Config path is unavailable. Restart Pi and try again.";
			return;
		}
		try {
			const current = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf-8") : "{}\n";
			const next = updateSuperpowersConfigText(current, update);
			fs.writeFileSync(configPath, next, "utf-8");
			this.lastWriteMessage = `Wrote ${configPath}. Restart or reload Pi to apply command registration changes.`;
		} catch (error) {
			this.lastWriteMessage = error instanceof Error ? error.message : String(error);
		}
	}

	toggleUseSubagents(): void {
		this.writeConfig((config) => toggleSuperpowersBoolean(config, "useSubagents"));
	}

	toggleUseTestDrivenDevelopment(): void {
		this.writeConfig((config) => toggleSuperpowersBoolean(config, "useTestDrivenDevelopment"));
	}

	toggleWorktrees(): void {
		this.writeConfig((config) => toggleSuperpowersWorktrees(config));
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "q") || matchesKey(data, "ctrl+c")) {
			this.done();
			return;
		}
		if (matchesKey(data, "tab")) {
			this.activePane = this.activePane === "settings" ? "runs" : "settings";
			this.tui.requestRender();
			return;
		}
		
		if (this.activePane === "settings") {
			if (matchesKey(data, "s")) {
				this.toggleUseSubagents();
				this.tui.requestRender();
				return;
			}
			if (matchesKey(data, "t")) {
				this.toggleUseTestDrivenDevelopment();
				this.tui.requestRender();
				return;
			}
			if (matchesKey(data, "w")) {
				this.toggleWorktrees();
				this.tui.requestRender();
			}
		} else {
			if (matchesKey(data, "up")) {
				this.cursor = Math.max(0, this.cursor - 1);
				if (this.cursor < this.scrollOffset) this.scrollOffset = this.cursor;
				this.tui.requestRender();
			}
			if (matchesKey(data, "down")) {
				this.cursor++;
				if (this.cursor >= this.scrollOffset + this.viewportHeight) {
					this.scrollOffset = this.cursor - this.viewportHeight + 1;
				}
				this.tui.requestRender();
			}
		}
	}
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- test/unit/superpowers-status.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

Run: `git add src/ui/superpowers-status.ts test/unit/superpowers-status.test.ts && git commit -m "feat(ui): refactor superpowers status to border-box TUI"`
