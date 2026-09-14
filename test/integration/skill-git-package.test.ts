/**
 * Integration coverage for git-installed package skill discovery.
 *
 * Responsibilities:
 * - verify skills under `<agentDir>/git/<host>/<owner>/<repo>` resolve through the real Pi skill loader
 * - verify project-local git packages follow the project-trust gate
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import path from "node:path";
import { after, afterEach, describe, it } from "node:test";

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-skills-git-home-"));

// Point every Node home-directory source at the temporary home *before* the
// first import of skills.ts, so its module-level AGENT_DIR constant resolves
// to the temporary layout. The redirection must stay in place for the entire
// file: skills.ts evaluates os.homedir() afresh on every discovery pass
// (default paths, `~/` setting expansion), and restoring HOME between tests
// would leak the real home directory into later tests.
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;

const skillsModule = await import("../../src/shared/skills.ts");

afterEach(() => {
	skillsModule.clearSkillCache();
});

after(() => {
	fs.rmSync(tempHome, { recursive: true, force: true });
	if (originalHome === undefined) delete process.env.HOME;
	else process.env.HOME = originalHome;
	if (originalUserProfile === undefined) delete process.env.USERPROFILE;
	else process.env.USERPROFILE = originalUserProfile;
});

function writeSkill(dir: string, name: string): void {
	fs.mkdirSync(path.join(dir, name), { recursive: true });
	fs.writeFileSync(
		path.join(dir, name, "SKILL.md"),
		`---
name: ${name}
description: Test skill installed from a git package
---
# ${name}

Test skill installed from a git package.`,
		"utf-8",
	);
}

function installGitPackage(gitRoot: string, packagePath: string, skillName: string): string {
	const repoDir = path.join(gitRoot, ...packagePath.split("/"));
	const skillsDir = path.join(repoDir, "skills");
	fs.mkdirSync(skillsDir, { recursive: true });
	// Pi clones git packages, so a `.git` marker is always present and the
	// collector uses it to locate the repo root.
	fs.mkdirSync(path.join(repoDir, ".git"), { recursive: true });
	fs.writeFileSync(path.join(repoDir, "package.json"), JSON.stringify({ pi: { skills: ["./skills"] } }), "utf-8");
	writeSkill(skillsDir, skillName);
	return skillsDir;
}

void describe("skill discovery from git packages", () => {
	void it("resolves skills installed under the user git package directory", () => {
		const userGitRoot = path.join(tempHome, ".pi", "agent", "git");
		installGitPackage(userGitRoot, "github.com/obra/superpowers", "git-brainstorming");

		const resolved = skillsModule.resolveSkillPath("git-brainstorming", path.join(tempHome, "project"));
		assert.ok(resolved, "expected the git-installed skill to resolve");
		assert.equal(resolved.source, "user");
		assert.ok(resolved.path.endsWith(path.join("skills", "git-brainstorming", "SKILL.md")));
	});

	void it("lists git package skills through the shared discovery path", () => {
		const userGitRoot = path.join(tempHome, ".pi", "agent", "git");
		installGitPackage(userGitRoot, "gitlab.com/example/team-toolkit", "git-recon");

		const names = skillsModule.getAvailableSkillNames(path.join(tempHome, "project"), { includeProject: true });
		assert.ok(names.has("git-recon"), "expected git package skills in the available set");
	});

	void it("excludes project-local git packages when project inputs are not trusted", () => {
		const projectRoot = path.join(tempHome, "project");
		installGitPackage(path.join(projectRoot, ".pi", "git"), "github.com/acme/project-toolkit", "project-skill");

		const trusted = skillsModule.resolveSkillPath("project-skill", projectRoot, { includeProject: true });
		assert.ok(trusted, "expected the project git skill to resolve when trusted");
		assert.equal(trusted.source, "project");

		assert.equal(skillsModule.resolveSkillPath("project-skill", projectRoot, { includeProject: false }), undefined);
	});
});
