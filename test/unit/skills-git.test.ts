/**
 * Unit coverage for git-installed package skill discovery.
 *
 * Responsibilities:
 * - collect `pi.skills` paths declared by packages under `<agentDir>/git/<host>/<path>`
 * - stay consistent with npm package metadata resolution (pi.skills only, no root skills fallback)
 * - gate project-local git packages on project trust
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { buildGitPackageSkillPathsForTest, buildSkillPathsForTest } from "../../src/shared/skills.ts";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

function makeTempDir(prefix: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

/**
 * Create a git-installed package fixture. Pi clones git packages, so a
 * `.git` marker (directory for clones, file for worktrees) is always present
 * and the collector uses it to locate the repo root.
 */
function makeGitPackageDir(gitRoot: string, packagePath: string): string {
	const repoDir = path.join(gitRoot, ...packagePath.split("/"));
	fs.mkdirSync(repoDir, { recursive: true });
	fs.mkdirSync(path.join(repoDir, ".git"), { recursive: true });
	return repoDir;
}

function writePackageManifest(repoDir: string, manifest: unknown): void {
	fs.writeFileSync(path.join(repoDir, "package.json"), typeof manifest === "string" ? manifest : JSON.stringify(manifest), "utf-8");
}

void describe("git package skill path collection", () => {
	void it("collects skill paths declared by git packages under host/owner/repo", () => {
		const gitRoot = makeTempDir("pi-skills-git-root-");
		const repoDir = makeGitPackageDir(gitRoot, "github.com/obra/superpowers");
		writePackageManifest(repoDir, { pi: { skills: ["./skills"] } });

		assert.deepEqual(buildGitPackageSkillPathsForTest([gitRoot]), [path.join(repoDir, "skills")]);
	});

	void it("locates repos below multi-segment paths such as GitLab subgroups", () => {
		const gitRoot = makeTempDir("pi-skills-git-root-");
		const repoDir = makeGitPackageDir(gitRoot, "gitlab.com/group/subgroup/repo");
		writePackageManifest(repoDir, { pi: { skills: ["./skills"] } });

		assert.deepEqual(buildGitPackageSkillPathsForTest([gitRoot]), [path.join(repoDir, "skills")]);
	});

	void it("locates repositories with dot-prefixed names", () => {
		const gitRoot = makeTempDir("pi-skills-git-root-");
		const repoDir = makeGitPackageDir(gitRoot, "github.com/owner/.dotfiles");
		writePackageManifest(repoDir, { pi: { skills: ["./skills"] } });

		assert.deepEqual(buildGitPackageSkillPathsForTest([gitRoot]), [path.join(repoDir, "skills")]);
	});

	void it("skips entries without valid pi.skills metadata", () => {
		const gitRoot = makeTempDir("pi-skills-git-root-");

		// No package.json at the repo root
		makeGitPackageDir(gitRoot, "example.com/owner/no-manifest");

		// Package.json that is not valid JSON
		const badJson = makeGitPackageDir(gitRoot, "example.com/owner/bad-json");
		writePackageManifest(badJson, "{ not json");

		// pi.skills that is not an array
		const nonArray = makeGitPackageDir(gitRoot, "example.com/owner/non-array");
		writePackageManifest(nonArray, { pi: { skills: "skills-dir" } });

		// Mixed array keeps only string entries
		const mixed = makeGitPackageDir(gitRoot, "example.com/owner/mixed-entries");
		writePackageManifest(mixed, { pi: { skills: ["./skills", 42, null] } });

		assert.deepEqual(buildGitPackageSkillPathsForTest([gitRoot]), [path.join(mixed, "skills")]);
	});

	void it("returns an empty list when no git root exists", () => {
		const missing = path.join(makeTempDir("pi-skills-git-missing-"), "git");

		assert.deepEqual(buildGitPackageSkillPathsForTest([missing]), []);
	});

	void it("ignores dot-prefixed host directories and does not descend into repo content", () => {
		const gitRoot = makeTempDir("pi-skills-git-root-");

		// Dot-prefixed host-level directory
		const hiddenHost = makeGitPackageDir(gitRoot, ".github.com/owner/hidden");
		writePackageManifest(hiddenHost, { pi: { skills: ["./skills"] } });

		// Manifest nested below the .git marker must not be scanned
		const repoDir = makeGitPackageDir(gitRoot, "github.com/owner/repo");
		const nested = path.join(repoDir, "sub", "pkg");
		fs.mkdirSync(nested, { recursive: true });
		writePackageManifest(nested, { pi: { skills: ["./skills"] } });

		assert.deepEqual(buildGitPackageSkillPathsForTest([gitRoot]), []);
	});

	void it("discovers repositories deeper than 8 levels below the host", () => {
		const gitRoot = makeTempDir("pi-skills-git-root-");

		// 8 segments below the host.
		const eightLevels = makeGitPackageDir(gitRoot, "gitlab.com/g1/g2/g3/g4/g5/g6/g7/repo");
		writePackageManifest(eightLevels, { pi: { skills: ["./skills"] } });

		// 9 segments below the host: previously past the depth cap.
		const nineLevels = makeGitPackageDir(gitRoot, "example.com/g1/g2/g3/g4/g5/g6/g7/g8/repo");
		writePackageManifest(nineLevels, { pi: { skills: ["./skills"] } });

		const expected = [path.join(eightLevels, "skills"), path.join(nineLevels, "skills")].sort();
		assert.deepEqual(buildGitPackageSkillPathsForTest([gitRoot]).sort(), expected);
	});

	void it("terminates on symlink cycles and reports each real package once", () => {
		const gitRoot = makeTempDir("pi-skills-git-root-");

		const ancestor = path.join(gitRoot, "example.com", "a");
		fs.mkdirSync(ancestor, { recursive: true });
		fs.symlinkSync(ancestor, path.join(ancestor, "self"));

		// Package inside the cycle target: reachable as `a/repo` but also as
		// `a/self/repo`, `a/self/self/repo`, ... without cycle detection.
		const cycleRepo = makeGitPackageDir(gitRoot, "example.com/a/repo");
		writePackageManifest(cycleRepo, { pi: { skills: ["./skills"] } });

		const siblingRepo = makeGitPackageDir(gitRoot, "example.com/b/repo");
		writePackageManifest(siblingRepo, { pi: { skills: ["./skills"] } });

		const expected = [path.join(cycleRepo, "skills"), path.join(siblingRepo, "skills")].sort();
		assert.deepEqual(buildGitPackageSkillPathsForTest([gitRoot]).sort(), expected);
	});

	void it("does not follow symlinks outside the git install root", () => {
		const fixtureRoot = makeTempDir("pi-skills-git-boundary-");
		const gitRoot = path.join(fixtureRoot, "git");
		const outsideRepo = makeGitPackageDir(fixtureRoot, "outside-repo");
		writePackageManifest(outsideRepo, { pi: { skills: ["./skills"] } });

		const hostRoot = path.join(gitRoot, "example.com");
		fs.mkdirSync(hostRoot, { recursive: true });
		fs.symlinkSync(outsideRepo, path.join(hostRoot, "outside-link"));

		const inRootRepo = makeGitPackageDir(gitRoot, "example.com/owner/in-root-repo");
		writePackageManifest(inRootRepo, { pi: { skills: ["./skills"] } });

		assert.deepEqual(buildGitPackageSkillPathsForTest([gitRoot]), [path.join(inRootRepo, "skills")]);
	});

	void it("de-duplicates paths across repeated roots", () => {
		const gitRoot = makeTempDir("pi-skills-git-root-");
		const repoDir = makeGitPackageDir(gitRoot, "github.com/obra/superpowers");
		writePackageManifest(repoDir, { pi: { skills: ["./skills"] } });

		assert.deepEqual(buildGitPackageSkillPathsForTest([gitRoot, gitRoot]), [path.join(repoDir, "skills")]);
	});
});

void describe("buildSkillPathsForTest git package integration", () => {
	void it("gates project-local git packages on trust and orders them after npm, before settings", () => {
		const projectRoot = makeTempDir("pi-skills-git-proj-");

		const npmPackage = path.join(projectRoot, ".pi", "npm", "node_modules", "fixture-package");
		fs.mkdirSync(npmPackage, { recursive: true });
		writePackageManifest(npmPackage, { pi: { skills: ["./skills"] } });

		const gitPackage = makeGitPackageDir(path.join(projectRoot, ".pi", "git"), "github.com/obra/git-fixture");
		writePackageManifest(gitPackage, { pi: { skills: ["./skills"] } });

		const settingsDir = path.join(projectRoot, ".pi");
		fs.mkdirSync(settingsDir, { recursive: true });
		fs.writeFileSync(path.join(settingsDir, "settings.json"), JSON.stringify({ skills: ["./skills-from-settings"] }), "utf-8");

		const npmSkillPath = path.join(npmPackage, "skills");
		const gitSkillPath = path.join(gitPackage, "skills");
		const settingsSkillPath = path.join(settingsDir, "skills-from-settings");

		const trustedPaths = buildSkillPathsForTest(projectRoot, { includeProject: true });
		assert.ok(trustedPaths.includes(gitSkillPath), "git skill path should be included when trusted");
		assert.ok(trustedPaths.includes(npmSkillPath));
		assert.ok(trustedPaths.includes(settingsSkillPath));

		const gitIndex = trustedPaths.findIndex((entry) => entry === gitSkillPath);
		assert.ok(gitIndex > trustedPaths.findIndex((entry) => entry === npmSkillPath), "git paths come after npm paths");
		assert.ok(gitIndex < trustedPaths.findIndex((entry) => entry === settingsSkillPath), "git paths come before settings paths");

		const untrustedPaths = buildSkillPathsForTest(projectRoot, { includeProject: false });
		assert.equal(untrustedPaths.includes(gitSkillPath), false, "project git path should be excluded when untrusted");
		assert.equal(untrustedPaths.includes(npmSkillPath), false);
		assert.equal(untrustedPaths.includes(settingsSkillPath), false);
	});
});
