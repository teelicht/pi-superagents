/**
 * Skill resolution and caching for subagent extension
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadSkills } from "@earendil-works/pi-coding-agent";
import { parseFrontmatter } from "../agents/frontmatter.ts";
import { resolveImplementerSkillSet, resolveRoleSkillSet } from "../execution/superpowers-policy.ts";
import type { ExecutionRole, ExtensionConfig, WorkflowMode } from "./types.ts";

export type SkillSource = "project" | "user" | "project-package" | "user-package" | "project-settings" | "user-settings" | "extension" | "builtin" | "unknown";

/**
 * Options controlling project-local skill input discovery.
 *
 * When `includeProject` is false, project-local `.pi/skills`, `.agents/skills`,
 * `.pi/settings.json` skill entries, and `.pi/npm/node_modules/*` package skills
 * are excluded. User/global skill paths remain available in both modes.
 */
export interface SkillDiscoveryOptions {
	/** Whether project-local .pi/.agents skill inputs should be loaded. Defaults to true for compatibility. */
	includeProject?: boolean;
}

export interface ResolvedSkill {
	name: string;
	path: string;
	content: string;
	source: SkillSource;
}

export interface ExecutionSkillResolution {
	skillNames: string[];
	resolvedSkills: ResolvedSkill[];
	missingSkills: string[];
}

/**
 * Convert resolved execution skills into the child-facing published skill list.
 *
 * @param resolvedSkills Skills whose contents were successfully loaded and injected.
 * @returns Skill names shown in `result.skills` / `progress.skills`, or `undefined` when none resolved.
 */
export function getPublishedExecutionSkills(resolvedSkills: ResolvedSkill[]): string[] | undefined {
	return resolvedSkills.length > 0 ? resolvedSkills.map((skill) => skill.name) : undefined;
}

interface SkillCacheEntry {
	mtime: number;
	skill: ResolvedSkill;
}

interface CachedSkillEntry {
	name: string;
	filePath: string;
	source: SkillSource;
	description?: string;
	order: number;
	/** Whether this skill is restricted to root-planning agents. "root" = root-only, undefined or "agent" = available to all. */
	scope?: "root" | "agent";
}

interface PiLoadSkillsCompatOptions {
	cwd: string;
	agentDir: string;
	skillPaths: string[];
	includeDefaults: boolean;
}

const skillCache = new Map<string, SkillCacheEntry>();
const MAX_CACHE_SIZE = 50;

let loadSkillsCache: { cwd: string; includeProject: boolean; skills: CachedSkillEntry[]; timestamp: number } | null = null;
const LOAD_SKILLS_CACHE_TTL_MS = 5000;

const CONFIG_DIR = ".pi";
const AGENT_DIR = path.join(os.homedir(), ".pi", "agent");

/**
 * Build PI skill-loader options with explicit cwd and agent-dir values.
 *
 * @param input Project cwd, optional Pi agent directory, and resolved skill paths.
 * @returns Options accepted by PI 0.68 while remaining safe to pass to older runtimes.
 */
export function buildLoadSkillsOptionsForPi(input: { cwd: string; agentDir?: string; skillPaths: string[] }): PiLoadSkillsCompatOptions {
	return {
		cwd: input.cwd,
		agentDir: input.agentDir ?? AGENT_DIR,
		skillPaths: input.skillPaths,
		includeDefaults: false,
	};
}

const SOURCE_PRIORITY: Record<SkillSource, number> = {
	project: 700,
	"project-settings": 650,
	"project-package": 600,
	user: 300,
	"user-settings": 250,
	"user-package": 200,
	extension: 150,
	builtin: 100,
	unknown: 0,
};

function stripSkillFrontmatter(content: string): string {
	const normalized = content.replace(/\r\n/g, "\n");
	if (!normalized.startsWith("---")) return normalized;

	const endIndex = normalized.indexOf("\n---", 3);
	if (endIndex === -1) return normalized;

	return normalized.slice(endIndex + 4).trim();
}

function isWithinPath(filePath: string, dir: string): boolean {
	const relative = path.relative(dir, filePath);
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function getPackageSkillPaths(packageRoot: string): string[] {
	const pkgJsonPath = path.join(packageRoot, "package.json");
	try {
		const content = fs.readFileSync(pkgJsonPath, "utf-8");
		const pkg = JSON.parse(content) as { pi?: { skills?: unknown } };
		const piSkills = pkg?.pi?.skills;
		if (!Array.isArray(piSkills)) return [];
		return piSkills.filter((s: unknown) => typeof s === "string").map((s: string) => path.resolve(packageRoot, s));
	} catch {
		return [];
	}
}

let cachedGlobalNpmRoot: string | null = null;

function getGlobalNpmRoot(): string | null {
	if (cachedGlobalNpmRoot !== null) return cachedGlobalNpmRoot;
	try {
		cachedGlobalNpmRoot = execSync("npm root -g", { encoding: "utf-8", timeout: 5000 }).trim();
		return cachedGlobalNpmRoot;
	} catch {
		cachedGlobalNpmRoot = ""; // Empty string means "tried but failed"
		return null;
	}
}

/**
 * Collect skill directories exposed by installed Pi packages.
 *
 * @param cwd Project working directory used for project-local package roots.
 * @returns De-duplicated absolute skill paths from configured package roots.
 */
function collectPackageSkillPaths(cwd: string, options: SkillDiscoveryOptions = {}): string[] {
	const roots = collectConfiguredPackageRoots(cwd, options);
	const packageRoots = collectPackageSkillDirectories(roots);
	const skillPaths = packageRoots.flatMap(resolvePackageSkillMetadata);
	return dedupeSkillPaths(skillPaths);
}

/**
 * Build package root directories searched for Pi skill packages.
 *
 * @param cwd Project working directory.
 * @returns Existing and potential node_modules roots in precedence order.
 */
function collectConfiguredPackageRoots(cwd: string, options: SkillDiscoveryOptions = {}): string[] {
	const includeProject = options.includeProject ?? true;
	const dirs = [
		...(includeProject ? [path.join(cwd, CONFIG_DIR, "npm", "node_modules")] : []),
		path.join(AGENT_DIR, "npm", "node_modules"),
	];
	const globalRoot = getGlobalNpmRoot();
	if (globalRoot) dirs.push(globalRoot);
	return dirs;
}

/**
 * Discover package directories beneath node_modules roots, including scoped packages.
 *
 * @param roots Node_modules roots to scan.
 * @returns Package root directories that may contain Pi skill metadata.
 */
function collectPackageSkillDirectories(roots: string[]): string[] {
	const packages: string[] = [];
	for (const root of roots) {
		for (const entry of readPackageDirectoryEntries(root)) {
			if (entry.name.startsWith("@")) {
				packages.push(...collectScopedPackageDirectories(root, entry.name));
				continue;
			}
			packages.push(path.join(root, entry.name));
		}
	}
	return packages;
}

/**
 * Read visible package-like entries from one directory.
 *
 * @param dir Directory to scan.
 * @returns Directory or symlink entries, excluding dot-prefixed names.
 */
function readPackageDirectoryEntries(dir: string): fs.Dirent[] {
	if (!fs.existsSync(dir)) return [];
	try {
		return fs
			.readdirSync(dir, { withFileTypes: true })
			.filter((entry) => !entry.name.startsWith("."))
			.filter((entry) => entry.isDirectory() || entry.isSymbolicLink());
	} catch {
		return [];
	}
}

/**
 * Discover package roots inside one scoped npm package directory.
 *
 * @param root Parent node_modules root.
 * @param scopeName Scope entry name such as `@scope`.
 * @returns Package roots within the scope.
 */
function collectScopedPackageDirectories(root: string, scopeName: string): string[] {
	const scopeDir = path.join(root, scopeName);
	return readPackageDirectoryEntries(scopeDir).map((entry) => path.join(scopeDir, entry.name));
}

/**
 * Resolve skill paths declared by one package's package.json metadata.
 *
 * @param packageRoot Package root directory.
 * @returns Absolute skill paths declared under `pi.skills`.
 */
function resolvePackageSkillMetadata(packageRoot: string): string[] {
	return getPackageSkillPaths(packageRoot);
}

/**
 * Remove duplicate skill paths while preserving first-seen order.
 *
 * @param skillPaths Candidate absolute skill paths.
 * @returns De-duplicated skill paths.
 */
function dedupeSkillPaths(skillPaths: string[]): string[] {
	return [...new Set(skillPaths)];
}

function collectSettingsSkillPaths(cwd: string, options: SkillDiscoveryOptions = {}): string[] {
	const includeProject = options.includeProject ?? true;
	const results: string[] = [];
	const settingsFiles = [
		...(includeProject
			? [{ file: path.join(cwd, CONFIG_DIR, "settings.json"), base: path.join(cwd, CONFIG_DIR) }]
			: []),
		{ file: path.join(AGENT_DIR, "settings.json"), base: AGENT_DIR },
	];

	for (const { file, base } of settingsFiles) {
		try {
			const content = fs.readFileSync(file, "utf-8");
			const settings = JSON.parse(content) as { skills?: unknown };
			const skills = settings?.skills;
			if (!Array.isArray(skills)) continue;
			for (const entry of skills) {
				if (typeof entry !== "string") continue;
				let resolved = entry;
				if (resolved.startsWith("~/")) {
					resolved = path.join(os.homedir(), resolved.slice(2));
				} else if (!path.isAbsolute(resolved)) {
					resolved = path.resolve(base, resolved);
				}
				results.push(resolved);
			}
		} catch {
			/* empty */
		}
	}

	return results;
}

function buildSkillPaths(cwd: string, options: SkillDiscoveryOptions = {}): string[] {
	const includeProject = options.includeProject ?? true;
	const defaultSkillPaths = [
		...(includeProject ? [path.join(cwd, CONFIG_DIR, "skills"), path.join(cwd, ".agents", "skills")] : []),
		path.join(AGENT_DIR, "skills"),
		path.join(os.homedir(), ".agents", "skills"),
	];
	const packagePaths = collectPackageSkillPaths(cwd, options);
	const settingsPaths = collectSettingsSkillPaths(cwd, options);
	return [...new Set([...defaultSkillPaths, ...packagePaths, ...settingsPaths])];
}

/**
 * Test-only helper that exposes the full skill path list for a workspace.
 *
 * @param cwd Project working directory.
 * @param options Discovery options (e.g. project trust flag).
 * @returns De-duplicated skill paths used by the loader, including user/global paths.
 */
export function buildSkillPathsForTest(cwd: string, options: SkillDiscoveryOptions = {}): string[] {
	return buildSkillPaths(cwd, options);
}

function inferSkillSource(sourceInfo: { source: string; scope: string }, filePath: string, cwd: string): SkillSource {
	const { scope, source } = sourceInfo;

	if (scope === "project" && source === "local") return "project";
	if (scope === "user" && source === "local") return "user";

	// Fallback: infer from file path when sourceInfo isn't specific enough
	// (e.g. scope === "temporary" for skills loaded via explicit skillPaths)
	const projectRoot = path.resolve(cwd, CONFIG_DIR);
	const altProjectRoot = path.resolve(cwd, ".agents");
	const isProjectScoped = isWithinPath(filePath, projectRoot) || isWithinPath(filePath, altProjectRoot);
	if (isProjectScoped) return "project";

	const isUserScoped = isWithinPath(filePath, AGENT_DIR) || isWithinPath(filePath, path.join(os.homedir(), ".agents"));
	if (isUserScoped) return "user";

	const globalRoot = getGlobalNpmRoot();
	if (globalRoot && isWithinPath(filePath, globalRoot)) return "user-package";

	return "unknown";
}

function chooseHigherPrioritySkill(existing: CachedSkillEntry | undefined, candidate: CachedSkillEntry): CachedSkillEntry {
	if (!existing) return candidate;
	const existingPriority = SOURCE_PRIORITY[existing.source] ?? 0;
	const candidatePriority = SOURCE_PRIORITY[candidate.source] ?? 0;
	if (candidatePriority > existingPriority) return candidate;
	if (candidatePriority < existingPriority) return existing;
	return candidate.order < existing.order ? candidate : existing;
}

function getCachedSkills(cwd: string, options: SkillDiscoveryOptions = {}): CachedSkillEntry[] {
	const includeProject = options.includeProject ?? true;
	const now = Date.now();
	if (
		loadSkillsCache &&
		loadSkillsCache.cwd === cwd &&
		loadSkillsCache.includeProject === includeProject &&
		now - loadSkillsCache.timestamp < LOAD_SKILLS_CACHE_TTL_MS
	) {
		return loadSkillsCache.skills;
	}

	const skillPaths = buildSkillPaths(cwd, { includeProject });
	const loadSkillsCompat = loadSkills as (options: PiLoadSkillsCompatOptions) => ReturnType<typeof loadSkills>;
	const loaded = loadSkillsCompat(buildLoadSkillsOptionsForPi({ cwd, skillPaths }));
	const dedupedByName = new Map<string, CachedSkillEntry>();

	for (let i = 0; i < loaded.skills.length; i++) {
		const skill = loaded.skills[i];

		// Read scope from skill file frontmatter
		let scope: "root" | "agent" | undefined;
		try {
			const raw = fs.readFileSync(skill.filePath, "utf-8");
			const { frontmatter } = parseFrontmatter(raw);
			if (frontmatter.scope === "root") {
				scope = "root";
			}
		} catch {
			// scope is optional; ignore read errors
		}

		const entry: CachedSkillEntry = {
			name: skill.name,
			filePath: skill.filePath,
			source: inferSkillSource(skill.sourceInfo, skill.filePath, cwd),
			description: skill.description,
			order: i,
			scope,
		};
		const current = dedupedByName.get(entry.name);
		dedupedByName.set(entry.name, chooseHigherPrioritySkill(current, entry));
	}

	const skills = [...dedupedByName.values()].sort((a, b) => a.order - b.order);
	loadSkillsCache = { cwd, includeProject, skills, timestamp: now };
	return skills;
}

export function resolveSkillPath(skillName: string, cwd: string, options: SkillDiscoveryOptions = {}): { path: string; source: SkillSource } | undefined {
	const skills = getCachedSkills(cwd, options);
	const skill = skills.find((s) => s.name === skillName);
	if (!skill) return undefined;
	return { path: skill.filePath, source: skill.source };
}

function readSkill(skillName: string, skillPath: string, source: SkillSource): ResolvedSkill | undefined {
	try {
		const stat = fs.statSync(skillPath);
		const cached = skillCache.get(skillPath);
		if (cached && cached.mtime === stat.mtimeMs) {
			return cached.skill;
		}

		const raw = fs.readFileSync(skillPath, "utf-8");
		const content = stripSkillFrontmatter(raw);
		const skill: ResolvedSkill = {
			name: skillName,
			path: skillPath,
			content,
			source,
		};

		skillCache.set(skillPath, { mtime: stat.mtimeMs, skill });
		if (skillCache.size > MAX_CACHE_SIZE) {
			const firstKey = skillCache.keys().next().value;
			if (firstKey) skillCache.delete(firstKey);
		}

		return skill;
	} catch {
		return undefined;
	}
}

export function resolveSkills(skillNames: string[], cwd: string, options: SkillDiscoveryOptions = {}): { resolved: ResolvedSkill[]; missing: string[] } {
	const resolved: ResolvedSkill[] = [];
	const missing: string[] = [];

	for (const name of skillNames) {
		const trimmed = name.trim();
		if (!trimmed) continue;

		const location = resolveSkillPath(trimmed, cwd, options);
		if (!location) {
			missing.push(trimmed);
			continue;
		}

		const skill = readSkill(trimmed, location.path, location.source);
		if (skill) {
			resolved.push(skill);
		} else {
			missing.push(trimmed);
		}
	}

	return { resolved, missing };
}

/**
 * Resolve the final skill list for one execution after caller-side overrides are applied.
 *
 * Inputs/outputs:
 * - accepts the already-selected skill set for a run, plus workflow/role policy inputs
 * - returns validated skill names, resolved skill contents, and any missing skills
 *
 * Invariants:
 * - `skills: false` disables all configured skills for this execution
 * - Superpowers roles reuse the same validation and implementer-mode injection in sync and async paths
 * - `includeProject` is the project-trust gate for skill inputs; it defaults to `true`
 *   for compatibility, so callers must pass `false` explicitly to suppress
 *   project-local `.pi/skills`, `.agents/skills`, `.pi/settings.json` skill entries,
 *   and project-local package skills when project inputs are not trusted
 *
 * Failure modes:
 * - throws when Superpowers policy rejects the selected skills for the role
 */
export function resolveExecutionSkills(input: {
	cwd: string;
	workflow: WorkflowMode;
	role: ExecutionRole;
	config?: ExtensionConfig;
	useTestDrivenDevelopment?: boolean;
	skills?: string[] | false;
	/** Whether project-local skill inputs should be loaded. Defaults to true for compatibility. */
	includeProject?: boolean;
}): ExecutionSkillResolution {
	const discoveryOptions: SkillDiscoveryOptions = { includeProject: input.includeProject ?? true };
	const configuredSkills = input.skills === false ? [] : (input.skills ?? []);
	const availableSkills = getAvailableSkillNames(input.cwd, discoveryOptions);
	const rootOnlySkills = getRootOnlySkillNames(input.cwd, discoveryOptions);
	const skillNames =
		input.role === "sp-implementer"
			? resolveImplementerSkillSet({
					workflow: input.workflow,
					useTestDrivenDevelopment: input.useTestDrivenDevelopment ?? true,
					config:
						input.config ??
						{
							/* empty */
						},
					agentSkills: [],
					stepSkills: configuredSkills,
					availableSkills,
					rootOnlySkills,
				})
			: resolveRoleSkillSet({
					workflow: input.workflow,
					role: input.role,
					config:
						input.config ??
						{
							/* empty */
						},
					agentSkills: [],
					stepSkills: configuredSkills,
					availableSkills,
					rootOnlySkills,
				});
	const { resolved, missing } = resolveSkills(skillNames, input.cwd, discoveryOptions);
	return {
		skillNames,
		resolvedSkills: resolved,
		missingSkills: missing,
	};
}

export function buildSkillInjection(skills: ResolvedSkill[]): string {
	if (skills.length === 0) return "";

	return skills.map((s) => `<skill name="${s.name}">\n${s.content}\n</skill>`).join("\n\n");
}

export function normalizeSkillInput(input: string | string[] | boolean | undefined): string[] | false | undefined {
	if (input === false) return false;
	if (input === true || input === undefined) return undefined;
	if (Array.isArray(input)) {
		return [...new Set(input.map((s) => s.trim()).filter((s) => s.length > 0))];
	}
	// Guard against JSON-encoded arrays arriving as strings (e.g. '["a","b"]').
	// Models sometimes serialise the skill parameter as a JSON string instead of
	// a native array, and naively splitting on "," would embed brackets/quotes
	// into the skill names, causing resolution to silently fail.
	const trimmed = input.trim();
	if (trimmed.startsWith("[")) {
		try {
			const parsed = JSON.parse(trimmed) as unknown;
			if (Array.isArray(parsed)) {
				return normalizeSkillInput(parsed);
			}
		} catch {
			// Not valid JSON – fall through to comma-split
		}
	}
	return [
		...new Set(
			input
				.split(",")
				.map((s) => s.trim())
				.filter((s) => s.length > 0),
		),
	];
}

export function discoverAvailableSkills(cwd: string, options: SkillDiscoveryOptions = {}): Array<{
	name: string;
	source: SkillSource;
	description?: string;
	scope?: "root" | "agent";
}> {
	const skills = getCachedSkills(cwd, options);
	return skills
		.map((s) => ({
			name: s.name,
			source: s.source,
			description: s.description,
			scope: s.scope,
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Resolve one available skill by exact name.
 *
 * @param cwd Current working directory used for project skill discovery.
 * @param name Skill name to resolve.
 * @returns Resolved skill or undefined when unavailable.
 */
export function resolveAvailableSkill(cwd: string, name: string, options: SkillDiscoveryOptions = {}): ResolvedSkill | undefined {
	const location = resolveSkillPath(name, cwd, options);
	if (!location) return undefined;
	return readSkill(name, location.path, location.source);
}

/**
 * Return the set of skill names currently discoverable for a workspace.
 *
 * Uses the shared cached discovery path so callers can validate overlays
 * without paying for repeated full skill resolution.
 */
export function getAvailableSkillNames(cwd: string, options: SkillDiscoveryOptions = {}): Set<string> {
	return new Set(getCachedSkills(cwd, options).map((skill) => skill.name));
}

/**
 * Return the set of skill names that are scoped as root-only
 * (must not be delegated to bounded roles).
 *
 * @param cwd Current working directory for skill discovery.
 * @returns Set of skill names with scope: root.
 */
function getRootOnlySkillNames(cwd: string, options: SkillDiscoveryOptions = {}): Set<string> {
	const skills = getCachedSkills(cwd, options);
	return new Set(skills.filter((s) => s.scope === "root").map((s) => s.name));
}

/**
 * Reset every in-memory skill cache so the next discovery call rebuilds from disk.
 *
 * Clears both the per-skill `skillCache` (file-mtime-keyed resolved skill content
 * cache) and the `loadSkillsCache` (cwd+`includeProject`-keyed loader result cache).
 * Use after trust, cwd, or filesystem state changes to force a fresh discovery pass.
 */
export function clearSkillCache(): void {
	skillCache.clear();
	loadSkillsCache = null;
}
