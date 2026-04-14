/**
 * Integration coverage for opt-in Superpowers skill command interception.
 *
 * Responsibilities:
 * - verify `/skill:brainstorming` can be wrapped before native Pi skill expansion
 * - verify non-opted-in skill commands continue through native Pi behavior
 * - verify extension-injected messages are not re-intercepted
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";

type InputHandler = (event: { text: string; source: "interactive" | "rpc" | "extension" }, ctx: ReturnType<typeof createCtx>) => { action: "continue" | "handled" | "transform" } | undefined;
type LifecycleHandler = (event: unknown, ctx?: unknown) => unknown;

function createEventBus() {
	return {
		on() {
			return () => {};
		},
		emit() {},
	};
}

function createPiMock() {
	const lifecycle = new Map<string, LifecycleHandler[]>();
	const userMessages: string[] = [];
	return {
		lifecycle,
		userMessages,
		pi: {
			events: createEventBus(),
			registerTool() {},
			registerCommand() {},
			registerShortcut() {},
			registerMessageRenderer() {},
			sendMessage() {},
			sendUserMessage(content: string | unknown[]) {
				userMessages.push(String(content));
			},
			on(event: string, handler: LifecycleHandler) {
				const existing = lifecycle.get(event) ?? [];
				existing.push(handler);
				lifecycle.set(event, existing);
			},
		},
	};
}

function createCtx(cwd: string, notifications: string[] = []) {
	return {
		cwd,
		hasUI: true,
		isIdle: () => true,
		ui: {
			notify(message: string) {
				notifications.push(message);
			},
			setWidget() {},
		},
		sessionManager: {
			getSessionFile: () => null,
			getEntries: () => [],
		},
		modelRegistry: {
			getAvailable: () => [],
		},
	};
}

void describe("skill entry interception", () => {
	const originalHome = process.env.HOME;
	const tempDirs: string[] = [];

	afterEach(() => {
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;
		for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
	});

	/**
	 * Set up minimal skills directories with proper skill file format.
	 * Skills need YAML frontmatter with name and description.
	 */
	function setupSkillsDir(cwd: string): void {
		// Create skills in {cwd}/.agents/skills (project-level skills)
		const projectSkillsDir = path.join(cwd, ".agents", "skills");
		fs.mkdirSync(path.join(projectSkillsDir, "using-superpowers"), { recursive: true });
		fs.writeFileSync(
			path.join(projectSkillsDir, "using-superpowers", "SKILL.md"),
			`---
name: using-superpowers
description: Superpowers bootstrap skill
---
# Using Superpowers

Use the subagent tool for delegation.`,
			"utf-8",
		);

		fs.mkdirSync(path.join(projectSkillsDir, "brainstorming"), { recursive: true });
		fs.writeFileSync(
			path.join(projectSkillsDir, "brainstorming", "SKILL.md"),
			`---
name: brainstorming
description: Creative problem solving skill
---
# Brainstorming

Creative problem solving skill.`,
			"utf-8",
		);
	}

	async function loadExtension(config: unknown) {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-skill-entry-home-"));
		tempDirs.push(home);
		process.env.HOME = home;
		const extensionDir = path.join(home, ".pi", "agent", "extensions", "subagent");
		fs.mkdirSync(extensionDir, { recursive: true });
		fs.writeFileSync(path.join(extensionDir, "config.json"), JSON.stringify(config), "utf-8");

		// Set up skills directory in the home folder (in .agents/skills for project-level)
		setupSkillsDir(home);

		// Clear skill cache before importing the extension
		const { clearSkillCache } = await import("../../src/shared/skills.ts") as { clearSkillCache: () => void };
		clearSkillCache();

		const module = await import("../../src/extension/index.ts");
		const mock = createPiMock();
		module.default(mock.pi as never);
		return { mock, cwd: home };
	}

	void it("handles opted-in /skill:brainstorming input", async () => {
		const { mock, cwd } = await loadExtension({
			superagents: {
				interceptSkillCommands: ["brainstorming"],
				usePlannotator: true,
			},
		});
		const inputHandler = mock.lifecycle.get("input")?.[0];
		assert.ok(inputHandler, "expected input handler to be registered");

		const notifications: string[] = [];
		const ctx = createCtx(cwd, notifications);
		const result = (inputHandler as InputHandler)(
			{ text: "/skill:brainstorming design middleware", source: "interactive" },
			ctx,
		);

		assert.deepEqual(result, { action: "handled" });
		assert.equal(mock.userMessages.length, 1);
		assert.match(mock.userMessages[0], /Superpowers ▸ design middleware/);
		assert.match(mock.userMessages[0], /Config:/);
		assert.match(mock.userMessages[0], /useBranches:\s*false/);
		assert.match(mock.userMessages[0], /usePlannotatorReview:\s*true/);
		assert.doesNotMatch(mock.userMessages[0], /Entry skill:/);

		const hidden = mock.lifecycle.get("before_agent_start")
			?.map((handler) => handler({ prompt: mock.userMessages[0] }) as { message?: { content: string; display: boolean } } | undefined)
			.find((entry) => entry?.message);
		assert.equal(hidden?.message?.display, false);
		assert.match(hidden?.message?.content ?? "", /Entry skill:/);
		assert.match(hidden?.message?.content ?? "", /Name: brainstorming/);
		assert.match(hidden?.message?.content ?? "", /design middleware/);
		assert.match(hidden?.message?.content ?? "", /superpowers_spec_review/);
	});

	void it("continues for non-opted-in and extension-sourced skill input", async () => {
		const { mock, cwd } = await loadExtension({
			superagents: {
				interceptSkillCommands: [],
			},
		});
		const inputHandler = mock.lifecycle.get("input")?.[0];
		assert.ok(inputHandler, "expected input handler to be registered");

		assert.deepEqual((inputHandler as InputHandler)(
			{ text: "/skill:brainstorming design middleware", source: "interactive" },
			createCtx(cwd),
		), { action: "continue" });
		assert.deepEqual((inputHandler as InputHandler)(
			{ text: "/skill:brainstorming design middleware", source: "extension" },
			createCtx(cwd),
		), { action: "continue" });
		assert.equal(mock.userMessages.length, 0);
	});
});
