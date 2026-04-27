/**
 * Unit coverage for project and user path resolution.
 *
 * Responsibilities:
 * - verify skills resolve from project-local and user-global `.agents` folders
 * - verify agents resolve from project-local and user-global `.agents` folders
 * - preserve existing path resolution behavior during the src-layout refactor
 */

import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, describe, test } from "node:test";

interface DiscoveredAgent {
	name: string;
	filePath?: string;
	sessionMode?: string;
}

interface AgentDiscoveryResult {
	agents: DiscoveredAgent[];
}

interface AgentDiscoveryAllResult {
	builtin: DiscoveredAgent[];
	user: DiscoveredAgent[];
	project: DiscoveredAgent[];
}

interface ResolvedSkill {
	path: string;
}

let discoverAgents: ((cwd: string) => AgentDiscoveryResult) | undefined;
let discoverAgentsAll: ((cwd: string) => AgentDiscoveryAllResult) | undefined;
let resolveSkillPath: ((skillName: string, cwd: string) => ResolvedSkill | null | undefined) | undefined;
let clearSkillCache: (() => void) | undefined;
let discoverAvailableSkills:
	| ((cwd: string) => Array<{ name: string; source: string; description?: string }>)
	| undefined;
let moduleLoadError: unknown;

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-path-resolution-test-"));
const cwdDir = path.join(tempRoot, "cwd");
const fakeHomeDir = path.join(tempRoot, "home");
const fakeUserAgentsDir = path.join(fakeHomeDir, ".agents");

/**
 * Throw the deferred module-load error if the refactored modules are still absent.
 *
 * @throws The original dynamic import error.
 */
function assertModulesLoaded(): void {
	if (moduleLoadError) throw moduleLoadError;
	if (!discoverAgents || !discoverAgentsAll || !resolveSkillPath || !clearSkillCache || !discoverAvailableSkills) {
		throw new Error("Path resolution test modules were not initialized.");
	}
}

before(async () => {
	fs.mkdirSync(cwdDir, { recursive: true });
	fs.mkdirSync(fakeHomeDir, { recursive: true });
	process.env.HOME = fakeHomeDir;
	process.env.USERPROFILE = fakeHomeDir;

	try {
		({ discoverAgents, discoverAgentsAll } = await import("../../src/agents/agents.ts"));
		({ resolveSkillPath, clearSkillCache, discoverAvailableSkills } = await import("../../src/shared/skills.ts"));
	} catch (error) {
		moduleLoadError = error;
	}
});

after(() => {
	if (originalHome === undefined) delete process.env.HOME;
	else process.env.HOME = originalHome;

	if (originalUserProfile === undefined) delete process.env.USERPROFILE;
	else process.env.USERPROFILE = originalUserProfile;

	fs.rmSync(tempRoot, { recursive: true, force: true });
});

void describe("Path resolution for .agents and ~/.agents", () => {
	void test("should resolve skills in .agents/skills", () => {
		assertModulesLoaded();

		const skillsDir = path.join(cwdDir, ".agents", "skills");
		fs.mkdirSync(skillsDir, { recursive: true });
		fs.writeFileSync(
			path.join(skillsDir, "test-skill-1.md"),
			"---\nname: test-skill-1\ndescription: test desc\n---\nSkill content",
		);

		clearSkillCache!();
		const resolved = resolveSkillPath!("test-skill-1", cwdDir);
		if (!resolved) {
			console.error("DEBUG SKILLS:", discoverAvailableSkills!(cwdDir));
			console.error("EXPECTED DIR:", skillsDir);
		}
		assert.ok(resolved);
		assert.strictEqual(resolved?.path, path.join(skillsDir, "test-skill-1.md"));
	});

	void test("should resolve skills in ~/.agents/skills", () => {
		assertModulesLoaded();

		const userSkillsDir = path.join(fakeUserAgentsDir, "skills");
		fs.mkdirSync(userSkillsDir, { recursive: true });
		fs.writeFileSync(
			path.join(userSkillsDir, "test-skill-2.md"),
			"---\nname: test-skill-2\ndescription: test desc\n---\nSkill content",
		);

		clearSkillCache!();
		const resolved = resolveSkillPath!("test-skill-2", cwdDir);
		if (!resolved) {
			console.error("DEBUG SKILLS 2:", discoverAvailableSkills!(cwdDir));
			console.error("EXPECTED DIR 2:", userSkillsDir);
		}
		assert.ok(resolved);
		assert.strictEqual(resolved?.path, path.join(userSkillsDir, "test-skill-2.md"));
	});

	void test("should resolve agents in .agents", () => {
		assertModulesLoaded();

		const agentsDir = path.join(cwdDir, ".agents");
		fs.mkdirSync(agentsDir, { recursive: true });
		fs.writeFileSync(
			path.join(agentsDir, "test-agent-1.md"),
			"---\nname: test-agent-1\ndescription: Test agent\n---\nAgent content",
		);

		const result = discoverAgentsAll!(cwdDir);
		const agent = result.project.find((candidate) => candidate.name === "test-agent-1");
		assert.ok(agent);
		assert.strictEqual(agent?.filePath, path.join(agentsDir, "test-agent-1.md"));
	});

	void test("should resolve agents in ~/.agents", () => {
		assertModulesLoaded();

		const userAgentsDir = fakeUserAgentsDir;
		fs.mkdirSync(userAgentsDir, { recursive: true });
		fs.writeFileSync(
			path.join(userAgentsDir, "test-agent-2.md"),
			"---\nname: test-agent-2\ndescription: Test agent\n---\nAgent content",
		);

		const result = discoverAgentsAll!(cwdDir);
		const agent = result.user.find((candidate) => candidate.name === "test-agent-2");
		assert.ok(agent);
		assert.strictEqual(agent?.filePath, path.join(userAgentsDir, "test-agent-2.md"));
	});

	void test("should parse session-mode from project agent frontmatter", () => {
		assertModulesLoaded();

		const agentsDir = path.join(cwdDir, ".agents");
		fs.mkdirSync(agentsDir, { recursive: true });
		fs.writeFileSync(
			path.join(agentsDir, "test-agent-session-mode.md"),
			"---\nname: test-agent-session-mode\ndescription: Test agent\nsession-mode: lineage-only\n---\nAgent content",
		);

		const result = discoverAgentsAll!(cwdDir);
		const agent = result.project.find((candidate) => candidate.name === "test-agent-session-mode");
		assert.ok(agent);
		assert.strictEqual(agent?.sessionMode, "lineage-only");
	});

	void test("should resolve built-in bounded agents with lineage-only session-mode", () => {
		assertModulesLoaded();

		const boundedAgentNames = [
			"sp-recon",
			"sp-research",
			"sp-implementer",
			"sp-spec-review",
			"sp-code-review",
			"sp-debug",
		];

		const result = discoverAgents!(cwdDir);
		for (const agentName of boundedAgentNames) {
			const agent = result.agents.find((candidate) => candidate.name === agentName);
			assert.ok(agent, `expected built-in agent ${agentName}`);
			assert.strictEqual(agent?.sessionMode, "lineage-only");
		}
	});
});
