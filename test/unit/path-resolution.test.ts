/**
 * Unit coverage for project and user path resolution.
 *
 * Responsibilities:
 * - verify skills resolve from project-local and user-global `.agents` folders
 * - verify agents resolve from project-local and user-global `.agents` folders
 * - preserve existing path resolution behavior during the src-layout refactor
 */

import { after, before, describe, test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { discoverAgents, discoverAgentsAll } from "../../src/agents/agents.js";
import { resolveSkillPath, clearSkillCache, discoverAvailableSkills } from "../../src/shared/skills.js";

const tmpDir = path.join(os.tmpdir(), "pi-path-resolution-test");
const cwdDir = path.join(tmpDir, "cwd");

const realHomeDir = os.homedir();
const realUserAgentsDir = path.join(realHomeDir, ".agents");
const userAgentsDirBackup = path.join(tmpDir, ".agents_backup");

before(() => {
	fs.mkdirSync(cwdDir, { recursive: true });

	// Backup existing ~/.agents if any.
	if (fs.existsSync(realUserAgentsDir)) {
		fs.cpSync(realUserAgentsDir, userAgentsDirBackup, { recursive: true });
	}
});

after(() => {
	// Restore ~/.agents.
	if (fs.existsSync(userAgentsDirBackup)) {
		fs.rmSync(realUserAgentsDir, { recursive: true, force: true });
		fs.cpSync(userAgentsDirBackup, realUserAgentsDir, { recursive: true });
	} else {
		// If it didn't exist before, just remove what we created.
		fs.rmSync(realUserAgentsDir, { recursive: true, force: true });
	}
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Path resolution for .agents and ~/.agents", () => {
	test("should resolve skills in .agents/skills", () => {
		const skillsDir = path.join(cwdDir, ".agents", "skills");
		fs.mkdirSync(skillsDir, { recursive: true });
		fs.writeFileSync(path.join(skillsDir, "test-skill-1.md"), "---\nname: test-skill-1\ndescription: test desc\n---\nSkill content");

		clearSkillCache();
		const resolved = resolveSkillPath("test-skill-1", cwdDir);
		if (!resolved) {
			console.error("DEBUG SKILLS:", discoverAvailableSkills(cwdDir));
			console.error("EXPECTED DIR:", skillsDir);
		}
		assert.ok(resolved);
		assert.strictEqual(resolved?.path, path.join(skillsDir, "test-skill-1.md"));
	});

	test("should resolve skills in ~/.agents/skills", () => {
		const userSkillsDir = path.join(realHomeDir, ".agents", "skills");
		fs.mkdirSync(userSkillsDir, { recursive: true });
		fs.writeFileSync(path.join(userSkillsDir, "test-skill-2.md"), "---\nname: test-skill-2\ndescription: test desc\n---\nSkill content");

		clearSkillCache();
		const resolved = resolveSkillPath("test-skill-2", cwdDir);
		if (!resolved) {
			console.error("DEBUG SKILLS 2:", discoverAvailableSkills(cwdDir));
			console.error("EXPECTED DIR 2:", userSkillsDir);
		}
		assert.ok(resolved);
		assert.strictEqual(resolved?.path, path.join(userSkillsDir, "test-skill-2.md"));
	});

	test("should resolve agents in .agents", () => {
		const agentsDir = path.join(cwdDir, ".agents");
		fs.mkdirSync(agentsDir, { recursive: true });
		fs.writeFileSync(
			path.join(agentsDir, "test-agent-1.md"),
			"---\nname: test-agent-1\ndescription: Test agent\n---\nAgent content",
		);

		const result = discoverAgents(cwdDir, "project");
		const agent = result.agents.find((candidate) => candidate.name === "test-agent-1");
		assert.ok(agent);
		assert.strictEqual(agent?.filePath, path.join(agentsDir, "test-agent-1.md"));
	});

	test("should resolve agents in ~/.agents", () => {
		const userAgentsDir = path.join(realHomeDir, ".agents");
		fs.mkdirSync(userAgentsDir, { recursive: true });
		fs.writeFileSync(
			path.join(userAgentsDir, "test-agent-2.md"),
			"---\nname: test-agent-2\ndescription: Test agent\n---\nAgent content",
		);

		const result = discoverAgents(cwdDir, "user");
		const agent = result.agents.find((candidate) => candidate.name === "test-agent-2");
		assert.ok(agent);
		assert.strictEqual(agent?.filePath, path.join(userAgentsDir, "test-agent-2.md"));
	});

	test("should expose all discovered agents through the aggregate helper", () => {
		const projectAgentsDir = path.join(cwdDir, ".agents");
		fs.mkdirSync(projectAgentsDir, { recursive: true });
		fs.writeFileSync(
			path.join(projectAgentsDir, "test-agent-aggregate.md"),
			"---\nname: test-agent-aggregate\ndescription: Test agent\n---\nAgent content",
		);

		const result = discoverAgentsAll(cwdDir);
		const agent = result.agents.find((candidate) => candidate.name === "test-agent-aggregate");
		assert.ok(agent);
	});
});
