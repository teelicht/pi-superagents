/**
 * Unit coverage for agent frontmatter parsing and built-in discovery.
 *
 * Responsibilities:
 * - verify frontmatter serialization/parsing behavior
 * - verify built-in agent discovery includes required Superpowers roles
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import { serializeAgent, updateFrontmatterField } from "../../src/agents/agent-serializer.ts";
import { discoverAgents, type AgentConfig } from "../../src/agents/agents.ts";

const tempDirs: string[] = [];

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (!dir) continue;
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe("agent frontmatter maxSubagentDepth", () => {
	it("serializes maxSubagentDepth into agent frontmatter", () => {
		const agent: AgentConfig = {
			name: "scout",
			description: "Scout",
			systemPrompt: "Inspect code",
			source: "project",
			filePath: "/tmp/scout.md",
			maxSubagentDepth: 1,
		};

		const serialized = serializeAgent(agent);
		assert.match(serialized, /maxSubagentDepth: 1/);
	});

	it("parses maxSubagentDepth from discovered agent frontmatter", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-superagents-agent-frontmatter-"));
		tempDirs.push(dir);
		const agentsDir = path.join(dir, ".pi", "agents");
		fs.mkdirSync(agentsDir, { recursive: true });
		fs.writeFileSync(path.join(agentsDir, "scout.md"), `---
name: scout
description: Scout
maxSubagentDepth: 1
---

Inspect code
`, "utf-8");

		const result = discoverAgents(dir, "project");
		const scout = result.agents.find((agent) => agent.name === "scout");
		assert.equal(scout?.maxSubagentDepth, 1);
	});
});

describe("agent frontmatter skills", () => {
	it("ignores the legacy skill field during discovery", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-superagents-agent-frontmatter-"));
		tempDirs.push(dir);
		const agentsDir = path.join(dir, ".agents");
		fs.mkdirSync(agentsDir, { recursive: true });
		fs.writeFileSync(path.join(agentsDir, "scout.md"), `---
name: scout
description: Scout
skill: web-search, pdf
---

Inspect code
`, "utf-8");

		const result = discoverAgents(dir, "project");
		const scout = result.agents.find((agent) => agent.name === "scout");
		assert.equal(scout?.skills, undefined);
	});

	it("rejects updates that try to write the legacy skill field", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-superagents-agent-frontmatter-"));
		tempDirs.push(dir);
		const agentPath = path.join(dir, "scout.md");
		fs.writeFileSync(agentPath, `---
name: scout
description: Scout
skills: web-search
---

Inspect code
`, "utf-8");

		assert.throws(
			() => updateFrontmatterField(agentPath, "skill", "pdf"),
			/legacy 'skill' field is not supported/i,
		);
	});
});

describe("agent discovery", () => {
	/**
	 * Verifies built-in Superpowers agents are exposed through standard discovery.
	 *
	 * Inputs/outputs:
	 * - discovers agents from the current workspace using builtin+project scopes
	 * - expects the Superpowers review loop roles to be present
	 *
	 * Invariants:
	 * - built-in discovery must include the canonical review roles
	 */
	it("discovers built-in superpowers agents", () => {
		const result = discoverAgents(process.cwd(), "both");
		const names = new Set(result.agents.map((agent) => agent.name));
		assert.ok(names.has("sp-implementer"));
		assert.ok(names.has("sp-spec-review"));
		assert.ok(names.has("sp-code-review"));
	});
});
