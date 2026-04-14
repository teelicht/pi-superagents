# `/sp-implement` and Subagents TUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `/superpowers` and `/superpowers-status` with `/sp-implement`, `/subagents-status`, and `/sp-settings`, split the current status/settings TUI into two green-framed overlays, and add `ctrl+alt+s` for the subagents status overlay.

**Architecture:** Keep the existing Superpowers workflow internals and prompt contracts unchanged, but rename the public command layer. Split the current combined `SuperpowersStatusComponent` into a run-only `SubagentsStatusComponent` and settings-only `SuperpowersSettingsComponent`, both using a shared framed-panel renderer from `render-helpers.ts`.

**Tech Stack:** TypeScript, NodeNext modules, `node:test`, Pi extension API (`registerCommand`, `registerShortcut`, `ctx.ui.custom`), `@mariozechner/pi-tui`, `@mariozechner/pi-coding-agent` theme API.

---

## File Structure

- Modify: `src/slash/slash-commands.ts`
  - Register `/sp-implement`, `/sp-brainstorm`, configured custom commands, `/subagents-status`, `/sp-settings`, and `ctrl+alt+s`.
  - Remove `/superpowers` and `/superpowers-status` registration.
  - Share a single helper for opening the subagents status overlay from both command and shortcut paths.

- Modify: `src/ui/render-helpers.ts`
  - Add `renderFramedPanel(...)` for a green border and `toolSuccessBg` panel background.
  - Keep existing helpers (`pad`, `row`, `renderHeader`, `renderFooter`, `formatScrollInfo`) for compatibility.

- Rename/Create: `src/ui/subagents-status.ts`
  - Replace `src/ui/superpowers-status.ts`.
  - Export `SubagentsStatusComponent`.
  - Own run monitoring only: active/recent runs, stable run selection, step details, auto-refresh, no config writes.

- Create: `src/ui/sp-settings.ts`
  - Export `SuperpowersSettingsComponent`.
  - Own settings display and config toggles that currently live in `SuperpowersStatusComponent`.

- Rename/Modify: `test/unit/subagents-status.test.ts`
  - Rename from `test/unit/superpowers-status.test.ts`.
  - Verify framed rendering, empty-run cursor safety, selected step details, `dispose()`, and input handling.

- Create: `test/unit/sp-settings.test.ts`
  - Verify framed settings rendering and config-writing toggle behavior.

- Modify: `test/unit/render-helpers.test.ts`
  - Verify `renderFramedPanel(...)` border/background calls and stable row count/shape.

- Modify: `test/integration/slash-commands.test.ts`
  - Update command names, remove old command expectations, add shortcut registration and `/sp-settings` coverage.

- Modify: `README.md`
  - Update quick commands and examples to `/sp-implement`, `/subagents-status`, and `/sp-settings`.

- Modify: `docs/guides/superpowers.md`
  - Update current command documentation and examples.

- Audit: `docs/superpowers/**`
  - Run a focused search for old public command names.
  - Leave historical specs/plans intact unless they are the new implementation plan or explicitly describe current command usage.

---

## Task 1: Update Slash Command Integration Tests First

**Files:**
- Modify: `test/integration/slash-commands.test.ts`

- [ ] **Step 1: Add shortcut support and theme helpers to the test harness**

Add these test helper types near the top of `test/integration/slash-commands.test.ts`, after `type EventBus`:

```ts
type CommandSpec = {
	description?: string;
	handler(args: string, ctx: unknown): Promise<void>;
};

type ShortcutSpec = {
	description?: string;
	handler(ctx: unknown): Promise<void> | void;
};

type ThemeMock = {
	fg(color: string, text: string): string;
	bg(color: string, text: string): string;
	bold(text: string): string;
};
```

Update `RegisterSlashCommandsModule` so the `pi` argument includes shortcut registration:

```ts
registerShortcut(name: string, spec: ShortcutSpec): void;
```

Add this helper after `createEventBus()`:

```ts
function createThemeMock(): ThemeMock {
	return {
		fg: (_color, text) => text,
		bg: (_color, text) => text,
		bold: (text) => text,
	};
}

function createPiHarness() {
	const commands = new Map<string, CommandSpec>();
	const shortcuts = new Map<string, ShortcutSpec>();
	const userMessages: Array<{ content: string | unknown[]; options?: { deliverAs?: "steer" | "followUp" } }> = [];
	const pi = {
		events: createEventBus(),
		registerCommand(name: string, spec: CommandSpec) {
			commands.set(name, spec);
		},
		registerShortcut(name: string, spec: ShortcutSpec) {
			shortcuts.set(name, spec);
		},
		sendMessage() {},
		sendUserMessage(content: string | unknown[], options?: { deliverAs?: "steer" | "followUp" }) {
			userMessages.push({ content, options });
		},
	};
	return { commands, shortcuts, userMessages, pi };
}
```

For every local `pi` object that remains outside `createPiHarness()`, add a no-op shortcut registration method so `registerSlashCommands(...)` can call the new API:

```ts
registerShortcut() {},
```

Keep the existing `ui.custom` override shape so tests can count overlay calls without needing to render the overlay.

- [ ] **Step 2: Replace the registration test with new public command expectations**

Replace the body of `registers only Superpowers commands and configured custom commands` with:

```ts
const { commands, shortcuts, pi } = createPiHarness();

const config = {
	superagents: {
		commands: {
			review: { description: "Run code review", useSubagents: false },
		},
	},
};

registerSlashCommands!(pi, createState(process.cwd()), config);

assert.ok(commands.has("sp-implement"), "expected /sp-implement to be registered");
assert.ok(commands.has("sp-brainstorm"), "expected /sp-brainstorm to be registered");
assert.ok(commands.has("subagents-status"), "expected /subagents-status to be registered");
assert.ok(commands.has("sp-settings"), "expected /sp-settings to be registered");
assert.ok(commands.has("review"), "expected /review preset to be registered");
assert.ok(shortcuts.has("ctrl+alt+s"), "expected ctrl+alt+s shortcut to be registered");

assert.ok(!commands.has("superpowers"), "expected /superpowers to NOT be registered");
assert.ok(!commands.has("superpowers-status"), "expected /superpowers-status to NOT be registered");
assert.ok(!commands.has("run"), "expected /run to NOT be registered");
assert.ok(!commands.has("chain"), "expected /chain to NOT be registered");
assert.ok(!commands.has("parallel"), "expected /parallel to NOT be registered");
assert.ok(!commands.has("agents"), "expected /agents to NOT be registered");

assert.equal(commands.get("review")!.description, "Run code review");
assert.match(shortcuts.get("ctrl+alt+s")!.description ?? "", /subagents status/i);
```

- [ ] **Step 3: Rename `/superpowers` behavior tests to `/sp-implement`**

Change every test name and handler call for the primary command:

```ts
await commands.get("sp-implement")!.handler("tdd implement auth fix", createCommandContext());
```

Update assertions that mention usage to require the new command:

```ts
assert.match(notifications[0].message, /Usage: \/sp-implement/);
```

Leave assertions for internal prompt content such as `workflow: "superpowers"`, `superpowers_plan_review`, and `superpowers-root-contract` unchanged.

- [ ] **Step 4: Replace status/settings overlay integration tests**

Replace the `/superpowers-status` tests with these three tests:

```ts
void it("/subagents-status opens the run status overlay", async () => {
	const { commands, pi } = createPiHarness();
	let customCalls = 0;

	registerSlashCommands!(pi, createState(process.cwd()), {});

	await commands.get("subagents-status")!.handler("", createCommandContext({
		hasUI: true,
		custom: async () => {
			customCalls++;
			return undefined;
		},
	}));

	assert.equal(customCalls, 1);
});

void it("ctrl+alt+s opens the run status overlay", async () => {
	const { shortcuts, pi } = createPiHarness();
	let customCalls = 0;

	registerSlashCommands!(pi, createState(process.cwd()), {});

	await shortcuts.get("ctrl+alt+s")!.handler(createCommandContext({
		hasUI: true,
		custom: async () => {
			customCalls++;
			return undefined;
		},
	}));

	assert.equal(customCalls, 1);
});

void it("/sp-settings opens the settings overlay", async () => {
	const { commands, pi } = createPiHarness();
	let customCalls = 0;

	registerSlashCommands!(pi, createState(process.cwd()), {});

	await commands.get("sp-settings")!.handler("", createCommandContext({
		hasUI: true,
		custom: async () => {
			customCalls++;
			return undefined;
		},
	}));

	assert.equal(customCalls, 1);
});
```

Add UI-unavailable checks:

```ts
await assert.doesNotReject(async () => {
	await commands.get("subagents-status")!.handler("", {
		cwd: process.cwd(),
		isIdle: () => true,
		hasUI: false,
		modelRegistry: { getAvailable: () => [] },
	} as never);
});

await assert.doesNotReject(async () => {
	await commands.get("sp-settings")!.handler("", {
		cwd: process.cwd(),
		isIdle: () => true,
		hasUI: false,
		modelRegistry: { getAvailable: () => [] },
	} as never);
});
```

- [ ] **Step 5: Run the integration test to verify the new tests fail**

Run:

```bash
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/slash-commands.test.ts
```

Expected result: FAIL because `registerShortcut` is not called, `/sp-implement`, `/subagents-status`, and `/sp-settings` are not registered, and `/superpowers` plus `/superpowers-status` still exist.

- [ ] **Step 6: Commit the failing integration tests**

```bash
git add test/integration/slash-commands.test.ts
git commit -m "test: define renamed slash command contract"
```

---

## Task 2: Add Shared Green Framed Panel Rendering

**Files:**
- Modify: `test/unit/render-helpers.test.ts`
- Modify: `src/ui/render-helpers.ts`

- [ ] **Step 1: Write failing tests for `renderFramedPanel`**

Replace `test/unit/render-helpers.test.ts` with:

```ts
/**
 * Unit tests for TUI rendering helpers.
 *
 * Responsibilities:
 * - verify string padding utilities
 * - verify scroll labels
 * - verify framed panel rendering uses theme border/background APIs
 */

import { test } from "node:test";
import * as assert from "node:assert";
import { formatScrollInfo, pad, renderFramedPanel } from "../../src/ui/render-helpers.ts";

function createRecordingTheme() {
	const calls: string[] = [];
	return {
		calls,
		theme: {
			fg(color: string, text: string): string {
				calls.push(`fg:${color}`);
				return text;
			},
			bg(color: string, text: string): string {
				calls.push(`bg:${color}`);
				return text;
			},
			bold(text: string): string {
				return text;
			},
		},
	};
}

test("pad strings correctly", () => {
	assert.strictEqual(pad("test", 6), "test  ");
	assert.strictEqual(pad("longtest", 4), "longtest");
});

test("formatScrollInfo returns correct labels", () => {
	assert.strictEqual(formatScrollInfo(0, 0), "");
	assert.strictEqual(formatScrollInfo(2, 3), "↑ 2 more ... ↓ 3 more");
});

test("renderFramedPanel wraps content in a stable green frame with background", () => {
	const { calls, theme } = createRecordingTheme();
	const lines = renderFramedPanel("Subagents Status", ["Active", "> sp-implementer | OK"], 32, theme as never, "q close");

	assert.deepStrictEqual(lines, [
		"┌──────────────────────────────┐",
		"│ Subagents Status             │",
		"├──────────────────────────────┤",
		"│ Active                       │",
		"│ > sp-implementer | OK        │",
		"├──────────────────────────────┤",
		"│ q close                      │",
		"└──────────────────────────────┘",
	]);
	assert.ok(calls.includes("fg:success"), "expected green success foreground calls");
	assert.ok(calls.includes("bg:toolSuccessBg"), "expected green background calls");
});

test("renderFramedPanel truncates long rows inside the frame", () => {
	const { theme } = createRecordingTheme();
	const lines = renderFramedPanel("Title", ["abcdefghijklmnopqrstuvwxyz"], 14, theme as never);

	assert.deepStrictEqual(lines, [
		"┌────────────┐",
		"│ Title      │",
		"├────────────┤",
		"│ abcdefgh...│",
		"└────────────┘",
	]);
});
```

- [ ] **Step 2: Run the helper test to verify it fails**

Run:

```bash
node --experimental-strip-types --test test/unit/render-helpers.test.ts
```

Expected result: FAIL with an import error because `renderFramedPanel` is not exported.

- [ ] **Step 3: Implement `renderFramedPanel`**

Add the import and helper functions to `src/ui/render-helpers.ts`:

```ts
import { truncateToWidth } from "@mariozechner/pi-tui";
```

Append this implementation after `renderFooter`:

```ts
/**
 * Render a stable green framed panel with themed background on every row.
 *
 * @param title Title shown in the framed panel header.
 * @param bodyLines Body rows to render inside the frame.
 * @param width Requested total panel width, including borders.
 * @param theme Pi theme used for green border and panel background.
 * @param footer Optional footer/help row shown above the bottom border.
 * @returns Fully framed string rows, each padded to the same visible width.
 */
export function renderFramedPanel(
	title: string,
	bodyLines: string[],
	width: number,
	theme: Theme,
	footer?: string,
): string[] {
	const panelWidth = Math.max(12, width);
	const innerWidth = panelWidth - 2;
	const border = (left: string, fill: string, right: string): string =>
		stylePanelRow(theme.fg("success", `${left}${fill.repeat(innerWidth)}${right}`), panelWidth, theme);
	const content = (text: string): string => {
		const padded = truncateToWidth(text, innerWidth, "...", true);
		return stylePanelRow(`${theme.fg("success", "│")}${padded}${theme.fg("success", "│")}`, panelWidth, theme);
	};

	const lines = [
		border("┌", "─", "┐"),
		content(` ${title}`),
		border("├", "─", "┤"),
		...bodyLines.map((line) => content(line.length === 0 ? "" : ` ${line}`)),
	];

	if (footer !== undefined) {
		lines.push(border("├", "─", "┤"), content(` ${footer}`));
	}

	lines.push(border("└", "─", "┘"));
	return lines;
}

/**
 * Apply the configured panel background to one complete frame row.
 *
 * @param line Row content already padded to panel width.
 * @param _width Visible row width, retained to document the stable-width invariant.
 * @param theme Pi theme used for the background.
 * @returns Themed row string.
 */
function stylePanelRow(line: string, _width: number, theme: Theme): string {
	return theme.bg("toolSuccessBg", line);
}
```

- [ ] **Step 4: Run helper tests to verify they pass**

Run:

```bash
node --experimental-strip-types --test test/unit/render-helpers.test.ts
```

Expected result: PASS for all render helper tests.

- [ ] **Step 5: Commit shared frame helper**

```bash
git add src/ui/render-helpers.ts test/unit/render-helpers.test.ts
git commit -m "feat: add framed tui panel helper"
```

---

## Task 3: Split Run Monitoring Into `SubagentsStatusComponent`

**Files:**
- Rename: `src/ui/superpowers-status.ts` -> `src/ui/subagents-status.ts`
- Rename: `test/unit/superpowers-status.test.ts` -> `test/unit/subagents-status.test.ts`
- Modify: `test/unit/subagents-status.test.ts`
- Modify: `src/ui/subagents-status.ts`

- [ ] **Step 1: Rename files before editing**

Run:

```bash
git mv src/ui/superpowers-status.ts src/ui/subagents-status.ts
git mv test/unit/superpowers-status.test.ts test/unit/subagents-status.test.ts
```

Expected result: both paths are renamed in `git status --short`.

- [ ] **Step 2: Replace the status unit tests with run-monitor tests**

Replace `test/unit/subagents-status.test.ts` with:

```ts
/**
 * Unit tests for SubagentsStatusComponent.
 *
 * Responsibilities:
 * - verify the status overlay renders as a framed subagents run monitor
 * - verify empty-run navigation cannot create a negative cursor
 * - verify selected run details include step metrics and errors
 * - verify timer cleanup is safe
 */

import { test } from "node:test";
import * as assert from "node:assert";
import type { RunEntry } from "../../src/execution/run-history.ts";
import { SubagentsStatusComponent } from "../../src/ui/subagents-status.ts";

function createThemeMock() {
	return {
		fg: (_color: string, text: string) => text,
		bg: (_color: string, text: string) => text,
		bold: (text: string) => text,
	};
}

function createTuiMock() {
	let renderCount = 0;
	return {
		tui: {
			requestRender: () => {
				renderCount++;
			},
		},
		get renderCount() {
			return renderCount;
		},
	};
}

function createRun(overrides: Partial<RunEntry> = {}): RunEntry {
	return {
		agent: "sp-implementer",
		task: "Implement auth fix",
		ts: 1,
		status: "ok",
		duration: 1250,
		model: "test-model",
		tokens: { total: 1536 },
		steps: [
			{ index: 0, agent: "sp-recon", status: "complete", durationMs: 250, tokens: { total: 256 } },
			{ index: 1, agent: "sp-implementer", status: "failed", durationMs: 1000, tokens: { total: 1280 }, error: "boom" },
		],
		...overrides,
	};
}

test("SubagentsStatusComponent renders a framed status panel", () => {
	const tuiMock = createTuiMock();
	const component = new SubagentsStatusComponent(
		tuiMock.tui as never,
		createThemeMock() as never,
		() => {},
		{
			refreshMs: 60_000,
			getActiveRuns: () => [createRun({ task: "Active task", duration: 0 })],
			getRecentRuns: () => [],
		},
	);

	const rendered = component.render(84).join("\n");
	assert.match(rendered, /Subagents Status/);
	assert.match(rendered, /Active/);
	assert.match(rendered, /Active task/);
	assert.match(rendered, /┌/);
	assert.match(rendered, /┘/);

	component.dispose();
});

test("SubagentsStatusComponent keeps empty-run navigation safe", () => {
	const tuiMock = createTuiMock();
	const component = new SubagentsStatusComponent(
		tuiMock.tui as never,
		createThemeMock() as never,
		() => {},
		{
			refreshMs: 60_000,
			getActiveRuns: () => [],
			getRecentRuns: () => [],
		},
	);

	component.handleInput("\u001b[B");
	const rendered = component.render(84).join("\n");

	assert.match(rendered, /No runs recorded/);
	assert.equal(tuiMock.renderCount, 1);
	component.dispose();
});

test("SubagentsStatusComponent renders selected step details", () => {
	const component = new SubagentsStatusComponent(
		createTuiMock().tui as never,
		createThemeMock() as never,
		() => {},
		{
			refreshMs: 60_000,
			getActiveRuns: () => [],
			getRecentRuns: () => [createRun()],
		},
	);

	const rendered = component.render(100).join("\n");

	assert.match(rendered, /Selected Details/);
	assert.match(rendered, /sp-recon/);
	assert.match(rendered, /complete/);
	assert.match(rendered, /256 tok/);
	assert.match(rendered, /sp-implementer/);
	assert.match(rendered, /failed/);
	assert.match(rendered, /boom/);
	component.dispose();
});

test("SubagentsStatusComponent closes and disposes safely", () => {
	let closed = 0;
	const component = new SubagentsStatusComponent(
		createTuiMock().tui as never,
		createThemeMock() as never,
		() => {
			closed++;
		},
		{
			refreshMs: 60_000,
			getActiveRuns: () => [],
			getRecentRuns: () => [],
		},
	);

	component.handleInput("q");
	assert.equal(closed, 1);
	assert.doesNotThrow(() => component.dispose());
	assert.doesNotThrow(() => component.dispose());
});
```

- [ ] **Step 3: Run status unit tests to verify they fail**

Run:

```bash
node --experimental-strip-types --test test/unit/subagents-status.test.ts
```

Expected result: FAIL because `SubagentsStatusComponent` is not exported and the constructor dependency shape is not implemented.

- [ ] **Step 4: Replace `src/ui/subagents-status.ts` with run-only implementation**

Use this implementation shape:

```ts
/**
 * Subagents run status overlay.
 *
 * Responsibilities:
 * - display active and recent subagent runs
 * - keep run selection stable across refreshes
 * - render step-level run details
 * - auto-refresh until disposed
 *
 * Important side effects:
 * - starts an interval timer that requests TUI re-rendering
 */

import type { Theme } from "@mariozechner/pi-coding-agent";
import type { Component, TUI } from "@mariozechner/pi-tui";
import { matchesKey, truncateToWidth } from "@mariozechner/pi-tui";
import { globalRunHistory, type RunEntry } from "../execution/run-history.ts";
import { formatDuration, formatTokens } from "../shared/formatters.ts";
import { formatScrollInfo, renderFramedPanel } from "./render-helpers.ts";

const DEFAULT_REFRESH_MS = 2000;
const DEFAULT_RECENT_LIMIT = 20;

interface StatusRow {
	kind: "section" | "run";
	label?: string;
	run?: RunEntry;
	runIndex?: number;
}

export interface SubagentsStatusDeps {
	getActiveRuns?: () => RunEntry[];
	getRecentRuns?: (limit: number) => RunEntry[];
	refreshMs?: number;
}

export class SubagentsStatusComponent implements Component {
	private readonly refreshTimer: NodeJS.Timeout;
	private readonly viewportHeight = 12;
	private cursorRunIndex = 0;
	private scrollOffset = 0;
	private rows: StatusRow[] = [];
	private runRows: StatusRow[] = [];

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly done: () => void,
		private readonly deps: SubagentsStatusDeps = {},
	) {
		this.reloadRows();
		this.refreshTimer = setInterval(() => {
			this.reloadRows();
			this.tui.requestRender();
		}, deps.refreshMs ?? DEFAULT_REFRESH_MS);
		this.refreshTimer.unref?.();
	}

	render(width: number): string[] {
		this.reloadRows();
		const bodyLines = this.renderBody(Math.min(width, 84));
		return renderFramedPanel("Subagents Status", bodyLines, Math.min(width, 84), this.theme, "↑↓ select | q close | Ctrl+Option+S");
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "q") || matchesKey(data, "ctrl+c")) {
			this.done();
			return;
		}
		if (matchesKey(data, "up")) {
			this.cursorRunIndex = Math.max(0, this.cursorRunIndex - 1);
			this.ensureScrollVisible();
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "down")) {
			const maxCursor = Math.max(0, this.runRows.length - 1);
			this.cursorRunIndex = Math.min(maxCursor, this.cursorRunIndex + 1);
			this.ensureScrollVisible();
			this.tui.requestRender();
		}
	}

	invalidate(): void {
		this.reloadRows();
	}

	dispose(): void {
		clearInterval(this.refreshTimer);
	}

	private reloadRows(): void {
		const selectedRun = this.selectedRun();
		const previousKey = selectedRun ? runKey(selectedRun) : undefined;
		const activeRuns = this.deps.getActiveRuns?.() ?? Array.from(globalRunHistory.activeRuns.values());
		const recentRuns = this.deps.getRecentRuns?.(DEFAULT_RECENT_LIMIT) ?? globalRunHistory.getRecent(DEFAULT_RECENT_LIMIT);
		this.rows = buildRows(activeRuns, recentRuns);
		this.runRows = this.rows.filter((row) => row.kind === "run");
		this.restoreSelection(previousKey);
		this.ensureScrollVisible();
	}

	private restoreSelection(previousKey?: string): void {
		if (this.runRows.length === 0) {
			this.cursorRunIndex = 0;
			this.scrollOffset = 0;
			return;
		}
		if (previousKey) {
			const nextIndex = this.runRows.findIndex((row) => row.run && runKey(row.run) === previousKey);
			if (nextIndex !== -1) {
				this.cursorRunIndex = nextIndex;
				return;
			}
		}
		this.cursorRunIndex = Math.min(Math.max(0, this.cursorRunIndex), this.runRows.length - 1);
	}

	private selectedRun(): RunEntry | undefined {
		return this.runRows[this.cursorRunIndex]?.run;
	}

	private ensureScrollVisible(): void {
		if (this.rows.length <= this.viewportHeight || this.runRows.length === 0) {
			this.scrollOffset = 0;
			return;
		}
		const selected = this.selectedRun();
		if (!selected) {
			this.scrollOffset = 0;
			return;
		}
		const selectedIndex = this.rows.findIndex((row) => row.kind === "run" && row.run && runKey(row.run) === runKey(selected));
		if (selectedIndex === -1) return;
		if (selectedIndex < this.scrollOffset) this.scrollOffset = selectedIndex;
		if (selectedIndex >= this.scrollOffset + this.viewportHeight) {
			this.scrollOffset = selectedIndex - this.viewportHeight + 1;
		}
	}

	private renderBody(width: number): string[] {
		if (this.rows.length === 0) return ["No runs recorded."];
		const selected = this.selectedRun();
		const visibleRows = this.rows.slice(this.scrollOffset, this.scrollOffset + this.viewportHeight);
		const lines = visibleRows.map((row) => {
			if (row.kind === "section") return this.theme.fg("success", row.label ?? "");
			const run = row.run!;
			return truncateToWidth(formatRunRow(run, selected === run, this.theme), width - 4);
		});
		const scrollInfo = formatScrollInfo(
			this.scrollOffset,
			Math.max(0, this.rows.length - (this.scrollOffset + visibleRows.length)),
		);
		lines.push(scrollInfo ? this.theme.fg("dim", scrollInfo) : "");
		if (selected) lines.push(...this.renderRunDetails(selected, width - 4));
		else lines.push(this.theme.fg("dim", "No runs selected."));
		return lines;
	}

	private renderRunDetails(run: RunEntry, innerWidth: number): string[] {
		const lines = [
			this.theme.fg("success", "Selected Details:"),
			`  Agent:  ${run.agent}`,
			`  Status: ${run.status}`,
			`  Model:  ${run.model ?? "unknown"}`,
			`  Tokens: ${run.tokens ? formatTokens(run.tokens.total) : "0"}`,
			`  Time:   ${formatDuration(run.duration)}`,
		];
		for (const step of run.steps ?? []) {
			const duration = step.durationMs !== undefined ? ` | ${formatDuration(step.durationMs)}` : "";
			const tokens = step.tokens ? ` | ${formatTokens(step.tokens.total)} tok` : "";
			lines.push(truncateToWidth(`  ${step.index + 1}. ${step.agent} | ${step.status}${duration}${tokens}`, innerWidth));
			if (step.error) lines.push(truncateToWidth(`     ${step.error}`, innerWidth));
		}
		if (!run.steps || run.steps.length === 0) lines.push(this.theme.fg("dim", "  No step details available."));
		return lines;
	}
}

function buildRows(activeRuns: RunEntry[], recentRuns: RunEntry[]): StatusRow[] {
	const rows: StatusRow[] = [];
	let runIndex = 0;
	if (activeRuns.length > 0) {
		rows.push({ kind: "section", label: "Active" });
		for (const run of activeRuns) rows.push({ kind: "run", run, runIndex: runIndex++ });
	}
	if (recentRuns.length > 0) {
		rows.push({ kind: "section", label: "Recent" });
		for (const run of recentRuns) rows.push({ kind: "run", run, runIndex: runIndex++ });
	}
	return rows;
}

function runKey(run: RunEntry): string {
	return `${run.ts}:${run.agent}:${run.task}`;
}

function formatRunRow(run: RunEntry, selected: boolean, theme: Theme): string {
	const prefix = selected ? theme.fg("success", ">") : " ";
	const status = run.status === "ok" ? theme.fg("success", "OK ") : theme.fg("error", "ERR");
	const duration = formatDuration(run.duration).padStart(6);
	const task = run.task.length > 44 ? `${run.task.slice(0, 41)}...` : run.task;
	return `${prefix} ${run.agent.padEnd(15)} | ${status} | ${duration} | ${task}`;
}
```

- [ ] **Step 5: Run status unit tests**

Run:

```bash
node --experimental-strip-types --test test/unit/subagents-status.test.ts
```

Expected result: PASS.

- [ ] **Step 6: Commit status split**

```bash
git add src/ui/subagents-status.ts test/unit/subagents-status.test.ts
git commit -m "feat: split subagents status overlay"
```

---

## Task 4: Add `SuperpowersSettingsComponent`

**Files:**
- Create: `src/ui/sp-settings.ts`
- Create: `test/unit/sp-settings.test.ts`

- [ ] **Step 1: Write failing settings unit tests**

Create `test/unit/sp-settings.test.ts`:

```ts
/**
 * Unit tests for SuperpowersSettingsComponent.
 *
 * Responsibilities:
 * - verify settings render in the framed settings overlay
 * - verify toggle actions write config changes
 * - verify unavailable config paths report a visible write message
 */

import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SuperpowersSettingsComponent } from "../../src/ui/sp-settings.ts";

function createThemeMock() {
	return {
		fg: (_color: string, text: string) => text,
		bg: (_color: string, text: string) => text,
		bold: (text: string) => text,
	};
}

function createTuiMock() {
	return { requestRender: () => {} };
}

function createState(configPath?: string) {
	return {
		configGate: {
			blocked: false,
			diagnostics: [],
			message: "",
			configPath,
		},
	};
}

test("SuperpowersSettingsComponent renders settings in a framed panel", () => {
	const component = new SuperpowersSettingsComponent(
		createTuiMock() as never,
		createThemeMock() as never,
		createState() as never,
		{
			superagents: {
				useSubagents: false,
				useTestDrivenDevelopment: true,
				commands: {
					"sp-review": { description: "Review", useSubagents: false },
				},
				worktrees: { enabled: true, root: "/tmp/superpowers-worktrees" },
				modelTiers: { cheap: { model: "test-model" } },
			},
		} as never,
		() => {},
	);

	const rendered = component.render(100).join("\n");
	assert.match(rendered, /Superpowers Settings/);
	assert.match(rendered, /useSubagents: false/);
	assert.match(rendered, /useTestDrivenDevelopment: true/);
	assert.match(rendered, /sp-review/);
	assert.match(rendered, /test-model/);
	assert.match(rendered, /┌/);
	assert.match(rendered, /┘/);
});

test("SuperpowersSettingsComponent writes setting toggles to config", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-settings-"));
	const configPath = path.join(dir, "config.json");
	fs.writeFileSync(configPath, '{\n  "superagents": { "useSubagents": true, "worktrees": { "enabled": false } }\n}\n', "utf-8");
	const component = new SuperpowersSettingsComponent(
		createTuiMock() as never,
		createThemeMock() as never,
		createState(configPath) as never,
		{ superagents: { useSubagents: true, worktrees: { enabled: false } } } as never,
		() => {},
	);

	component.toggleUseSubagents();
	component.toggleWorktrees();

	assert.deepStrictEqual(JSON.parse(fs.readFileSync(configPath, "utf-8")), {
		superagents: {
			useSubagents: false,
			worktrees: { enabled: true },
		},
	});
	fs.rmSync(dir, { recursive: true, force: true });
});

test("SuperpowersSettingsComponent reports unavailable config path", () => {
	const component = new SuperpowersSettingsComponent(
		createTuiMock() as never,
		createThemeMock() as never,
		createState() as never,
		{ superagents: {} } as never,
		() => {},
	);

	component.toggleUseSubagents();

	assert.match(component.render(84).join("\n"), /Config path is unavailable/);
});
```

- [ ] **Step 2: Run settings tests to verify they fail**

Run:

```bash
node --experimental-strip-types --test test/unit/sp-settings.test.ts
```

Expected result: FAIL because `src/ui/sp-settings.ts` does not exist.

- [ ] **Step 3: Implement `SuperpowersSettingsComponent`**

Create `src/ui/sp-settings.ts`:

```ts
/**
 * Superpowers workflow settings overlay.
 *
 * Responsibilities:
 * - display current Superpowers/subagent workflow settings
 * - expose safe toggle keybindings for supported boolean config values
 * - write config changes through config-writer helpers
 *
 * Important side effects:
 * - writes to the user's Pi extension config file when toggles are invoked
 */

import * as fs from "node:fs";
import type { Theme } from "@mariozechner/pi-coding-agent";
import type { Component, TUI } from "@mariozechner/pi-tui";
import { matchesKey } from "@mariozechner/pi-tui";
import type { ExtensionConfig, SubagentState } from "../shared/types.ts";
import {
	toggleSuperpowersBoolean,
	toggleSuperpowersWorktrees,
	updateSuperpowersConfigText,
} from "../superpowers/config-writer.ts";
import { renderFramedPanel } from "./render-helpers.ts";

export class SuperpowersSettingsComponent implements Component {
	private lastWriteMessage = "";
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly state: SubagentState;
	private readonly config: ExtensionConfig;
	private readonly done: () => void;

	constructor(
		tui: TUI,
		theme: Theme,
		state: SubagentState,
		config: ExtensionConfig,
		done: () => void,
	) {
		this.tui = tui;
		this.theme = theme;
		this.state = state;
		this.config = config;
		this.done = done;
	}

	render(width: number): string[] {
		return renderFramedPanel(
			"Superpowers Settings",
			this.renderBody(),
			Math.min(width, 84),
			this.theme,
			"s subagents | t tdd | w worktrees | q close",
		);
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "q") || matchesKey(data, "ctrl+c")) {
			this.done();
			return;
		}
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
	}

	invalidate(): void {}

	toggleUseSubagents(): void {
		this.writeConfig((config) => toggleSuperpowersBoolean(config, "useSubagents"));
	}

	toggleUseTestDrivenDevelopment(): void {
		this.writeConfig((config) => toggleSuperpowersBoolean(config, "useTestDrivenDevelopment"));
	}

	toggleWorktrees(): void {
		this.writeConfig((config) => toggleSuperpowersWorktrees(config));
	}

	private renderBody(): string[] {
		const settings = this.config.superagents ?? {};
		const commands = Object.entries(settings.commands ?? {});
		const modelTiers = Object.entries(settings.modelTiers ?? {});
		const lines = [
			`useSubagents: ${settings.useSubagents ?? true} (s)`,
			`useTestDrivenDevelopment: ${settings.useTestDrivenDevelopment ?? true} (t)`,
			`configStatus: ${this.state.configGate.blocked ? "blocked" : "valid"}`,
			`worktrees.enabled: ${settings.worktrees?.enabled ?? false} (w)`,
			`worktrees.root: ${settings.worktrees?.root ?? "default"}`,
			"",
			"Commands:",
			...(commands.length
				? commands.map(
						([name, preset]) =>
							`- ${name}: subagents=${preset.useSubagents ?? "default"}, tdd=${preset.useTestDrivenDevelopment ?? "default"}`,
					)
				: ["- none"]),
			"",
			"Model tiers:",
			...(modelTiers.length
				? modelTiers.map(([name, value]) => `- ${name}: ${tierModel(value)}`)
				: ["- none"]),
		];

		if (this.state.configGate.message) lines.push("", this.theme.fg("error", this.state.configGate.message));
		if (this.lastWriteMessage) lines.push("", this.theme.fg("warning", this.lastWriteMessage));
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
}

function tierModel(value: unknown): string {
	if (typeof value === "string") return value;
	if (value && typeof value === "object" && "model" in value) {
		const model = (value as { model?: unknown }).model;
		return typeof model === "string" ? model : "unknown";
	}
	return "unknown";
}
```

- [ ] **Step 4: Run settings tests**

Run:

```bash
node --experimental-strip-types --test test/unit/sp-settings.test.ts
```

Expected result: PASS.

- [ ] **Step 5: Commit settings overlay**

```bash
git add src/ui/sp-settings.ts test/unit/sp-settings.test.ts
git commit -m "feat: add superpowers settings overlay"
```

---

## Task 5: Wire Commands, Shortcut, and Imports

**Files:**
- Modify: `src/slash/slash-commands.ts`
- Modify: `test/integration/slash-commands.test.ts`

- [ ] **Step 1: Update imports and command registration docs**

In `src/slash/slash-commands.ts`, replace the status import:

```ts
import { SubagentsStatusComponent } from "../ui/subagents-status.ts";
import { SuperpowersSettingsComponent } from "../ui/sp-settings.ts";
```

Update the file header bullets:

```ts
 * - register `/sp-implement`, `/sp-brainstorm`, `/subagents-status`, `/sp-settings`, and configured custom commands
 * - `ui/subagents-status` for the run status overlay
 * - `ui/sp-settings` for the settings overlay
```

- [ ] **Step 2: Add overlay opener helpers**

Add these helpers before `registerSlashCommands`:

```ts
/**
 * Open the Subagents status overlay when UI is available.
 *
 * @param ctx Current extension command or shortcut context.
 */
async function openSubagentsStatusOverlay(
	ctx: ExtensionContext,
): Promise<void> {
	if (!ctx.hasUI) return;
	await ctx.ui.custom<void>(
		(tui, theme, _kb, done) => new SubagentsStatusComponent(tui, theme, () => done(undefined)),
		{ overlay: true, overlayOptions: { anchor: "center", width: 92, maxHeight: "80%" } },
	);
}

/**
 * Open the Superpowers settings overlay when UI is available.
 *
 * @param ctx Current extension command context.
 * @param state Shared extension state for config gate checks.
 * @param config Effective extension config displayed in the overlay.
 */
async function openSuperpowersSettingsOverlay(
	ctx: ExtensionContext,
	state: SubagentState,
	config: ExtensionConfig,
): Promise<void> {
	if (!ctx.hasUI) return;
	await ctx.ui.custom<void>(
		(tui, theme, _kb, done) => new SuperpowersSettingsComponent(tui, theme, state, config, () => done(undefined)),
		{ overlay: true, overlayOptions: { anchor: "center", width: 92, maxHeight: "80%" } },
	);
}
```

- [ ] **Step 3: Register new commands and remove old commands**

Replace the primary command registration with:

```ts
registerSuperpowersCommand(
	pi,
	dispatcher,
	state,
	config,
	"sp-implement",
	"Run a Superpowers implementation workflow: /sp-implement [lean|full|tdd|direct|subagents|no-subagents] <task> [--fork]",
);
```

Replace the old `superpowers-status` registration with:

```ts
pi.registerCommand("subagents-status", {
	description: "Show active and recent subagent run status",
	handler: async (_args, ctx) => {
		await openSubagentsStatusOverlay(ctx);
	},
});

pi.registerShortcut("ctrl+alt+s", {
	description: "Open subagents status",
	handler: async (ctx) => {
		await openSubagentsStatusOverlay(ctx);
	},
});

pi.registerCommand("sp-settings", {
	description: "Show Superpowers and subagent workflow settings",
	handler: async (_args, ctx) => {
		await openSuperpowersSettingsOverlay(ctx, state, config);
	},
});
```

Do not register `superpowers` or `superpowers-status`.

- [ ] **Step 4: Run integration tests**

Run:

```bash
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/slash-commands.test.ts
```

Expected result: PASS for slash command integration tests.

- [ ] **Step 5: Run related unit tests**

Run:

```bash
node --experimental-strip-types --test test/unit/render-helpers.test.ts test/unit/subagents-status.test.ts test/unit/sp-settings.test.ts
```

Expected result: PASS for all listed unit tests.

- [ ] **Step 6: Commit command wiring**

```bash
git add src/slash/slash-commands.ts test/integration/slash-commands.test.ts
git commit -m "feat: rename commands and wire subagents overlays"
```

---

## Task 6: Remove Old Status Files and References

**Files:**
- Delete: `src/ui/superpowers-status.ts`
- Delete: `test/unit/superpowers-status.test.ts`
- Modify: imports and references found by search

- [ ] **Step 1: Search for old status module references**

Run:

```bash
rg -n "superpowers-status|SuperpowersStatusComponent|ui/superpowers-status|src/ui/superpowers-status" src test README.md docs
```

Expected result before cleanup: references remain in tests, docs, and possibly old generated notes.

- [ ] **Step 2: Remove or update current-code references**

Apply these rules:

- `src/**` references to `superpowers-status` become `subagents-status`.
- `test/**` references to `SuperpowersStatusComponent` become `SubagentsStatusComponent` only in status tests.
- Settings tests import `SuperpowersSettingsComponent` from `src/ui/sp-settings.ts`.
- User-facing docs use `/subagents-status`, not `/superpowers-status`.

Do not edit historical specs/plans just to rewrite old command history.

- [ ] **Step 3: Verify old source/test files no longer exist**

Run:

```bash
test ! -e src/ui/superpowers-status.ts
test ! -e test/unit/superpowers-status.test.ts
```

Expected result: both commands exit successfully.

- [ ] **Step 4: Verify no old current-code references remain**

Run:

```bash
rg -n "superpowers-status|SuperpowersStatusComponent|ui/superpowers-status|src/ui/superpowers-status" src test README.md docs/guides docs/reference
```

Expected result: no matches in current source, tests, README, guides, or reference docs.

- [ ] **Step 5: Commit cleanup**

```bash
git add src test README.md docs
git commit -m "chore: remove old superpowers status surface"
```

---

## Task 7: Update README and Superpowers Docs

**Files:**
- Modify: `README.md`
- Modify: `docs/guides/superpowers.md`
- Audit: `docs/superpowers/**`

- [ ] **Step 1: Update README quick commands**

Replace the Quick Commands table in `README.md` with:

```md
| Command                  | Description                                             |
| ------------------------ | ------------------------------------------------------- |
| `/sp-brainstorm <task>`  | Brainstorm a task and save a spec with Plannotator UI   |
| `/sp-implement <task>`   | Run an implementation task through the Superpowers flow |
| `/subagents-status`      | Open active and recent subagent run status              |
| `/sp-settings`           | Open Superpowers and subagent workflow settings         |
```

Replace the workflow examples with:

```text
/sp-implement fix the auth regression
/sp-implement tdd implement the cache invalidation task
/sp-implement direct update the Expo config
/sp-implement tdd review the release branch --fork
```

Replace the background bullet with:

```md
- `--bg`: Run in the background. Check status with `/subagents-status` or `Ctrl+Option+S` on macOS (`ctrl+alt+s` in Pi keybinding notation).
```

- [ ] **Step 2: Update `docs/guides/superpowers.md` command sections**

Replace the opening sentence with:

```md
The `/sp-implement` command activates a structured workflow for task execution with role-specific agents, model tiers, and built-in quality gates.
```

Replace the overview paragraph and examples with:

```md
When you use `/sp-implement`, pi-superagents runs your task through a bounded workflow with specialized agents (recon, research, implement, review) instead of a single generic agent. This structured approach ensures that context is gathered before implementation and that results are verified before completion.

```text
/sp-implement fix the auth regression
/sp-implement tdd implement the cache invalidation task
/sp-implement direct update the Expo config
/sp-implement tdd review the release branch --fork
```
```

Replace the implementer-mode sentence with:

```md
Specify the mode as the first argument: `/sp-implement tdd <task>` or `/sp-implement direct <task>`.
```

Add this section after "Brainstorming Entry":

```md
## Status and Settings

Use `/subagents-status` to inspect active and recent subagent runs. The same overlay is available through `Ctrl+Option+S` on macOS, represented internally as `ctrl+alt+s`.

Use `/sp-settings` to inspect and toggle workflow settings such as `useSubagents`, `useTestDrivenDevelopment`, and worktree behavior.
```

- [ ] **Step 3: Audit `docs/superpowers/**` for current command docs**

Run:

```bash
rg -n "/superpowers\\b|/superpowers-status\\b|superpowers-status" docs/superpowers
```

Expected result: matches may appear in historical specs and plans. For each match:

- If the file is an older spec or plan describing past behavior, leave it unchanged.
- If the file is this implementation plan, update the current-command wording.
- If a new task-specific doc has been added during implementation, update it to `/sp-implement`, `/subagents-status`, or `/sp-settings`.

- [ ] **Step 4: Verify current docs no longer advertise old commands**

Run:

```bash
rg -n "/superpowers\\b|/superpowers-status\\b" README.md docs/guides docs/reference
```

Expected result: no matches.

- [ ] **Step 5: Commit docs updates**

```bash
git add README.md docs/guides/superpowers.md docs/superpowers/plans/2026-04-14-sp-implement-subagents-tui.md
git commit -m "docs: document sp implement and subagents overlays"
```

---

## Task 8: Final Verification and Release Readiness

**Files:**
- Modify only files required by failing checks.

- [ ] **Step 1: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected result: PASS with `tsc --noEmit`.

- [ ] **Step 2: Run lint**

Run:

```bash
npm run lint
```

Expected result: PASS with no ESLint errors. If lint reports `@typescript-eslint/no-explicit-any` in new tests, replace `any` casts with `unknown`, `never`, or local typed mocks.

- [ ] **Step 3: Run targeted unit tests**

Run:

```bash
node --experimental-strip-types --test test/unit/render-helpers.test.ts test/unit/subagents-status.test.ts test/unit/sp-settings.test.ts
```

Expected result: PASS for all targeted unit tests.

- [ ] **Step 4: Run slash command integration tests**

Run:

```bash
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/slash-commands.test.ts
```

Expected result: PASS for all slash command integration tests.

- [ ] **Step 5: Run current full test target**

Run:

```bash
npm test
```

Expected result: PASS for the repository's unit test suite.

- [ ] **Step 6: Search for accidental old public command registration**

Run:

```bash
rg -n "registerCommand\\(\"superpowers\"|registerCommand\\(\"superpowers-status\"|/superpowers\\b|/superpowers-status\\b" src test README.md docs/guides docs/reference
```

Expected result: no matches.

- [ ] **Step 7: Inspect changed files**

Run:

```bash
git diff --stat
git diff -- src/slash/slash-commands.ts src/ui/render-helpers.ts src/ui/subagents-status.ts src/ui/sp-settings.ts
```

Expected result: diff shows only the command rename, overlay split, shared frame helper, tests, and docs requested by the spec.

- [ ] **Step 8: Final commit**

If any final verification fixes were needed, commit them:

```bash
git add src test README.md docs
git commit -m "fix: finish sp implement subagents tui verification"
```

If no final fixes were needed, do not create an empty commit.

---

## Self-Review Notes

- Spec coverage: Tasks cover public command rename, removal of old commands, status shortcut, status/settings split, green framed background, run selection safety, selected step details, tests, README updates, and `docs/superpowers` audit.
- Internal names intentionally unchanged: `workflow: "superpowers"`, `superpowers_plan_review`, `superpowers_spec_review`, and `superagents` config keys remain as-is.
- Historical docs policy: current user-facing docs are updated; old specs/plans under `docs/superpowers` are audited but not rewritten as history.
