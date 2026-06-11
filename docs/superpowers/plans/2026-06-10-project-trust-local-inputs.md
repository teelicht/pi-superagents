# Project Trust Local Inputs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make pi-superagents preserve Pi 0.79 project-trust decisions across extension-managed project agents, skills, settings, package skills, and child Pi launches.

**Architecture:** Thread a trusted/untrusted project-input policy through discovery and launch boundaries instead of automatically approving child runs. Parent extension code reads project-local inputs only when `ctx.isProjectTrusted()` is true, and child Pi receives `--approve` or `--no-approve` to mirror that resolved parent decision.

**Tech Stack:** TypeScript, Node test runner, Pi extension APIs from `@earendil-works/pi-coding-agent`, existing `discoverAgents`, `resolveExecutionSkills`, and `buildPiArgs` helpers.

---

## File Structure

| File | Responsibility | Planned change |
|---|---|---|
| `src/agents/agents.ts` | Built-in/user/project agent discovery | Add options to include or skip project-local agent directories. Keep default trusted for backwards-compatible direct unit callers, but call sites pass trust explicitly. |
| `src/shared/skills.ts` | Skill path discovery, settings/package skill collection, skill injection | Add options to include or skip project-local skill directories, `.pi/settings.json`, and `.pi/npm/node_modules` package skills. Keep user/global paths available. |
| `src/execution/pi-args.ts` | Child Pi CLI argument construction | Add `projectTrusted?: boolean`; emit `--approve` for true and `--no-approve` for false. |
| `src/execution/child-runner.ts` | Prepare child launch and resolve child skills | Accept parent trust from executor; pass trust into skill resolution and `buildPiArgs`. |
| `src/execution/subagent-executor.ts` | Entry point for subagent tool execution | Compute `const projectTrusted = ctx.isProjectTrusted()` and pass it to agent discovery and child launch preparation. |
| `src/extension/index.ts` | Register extension and discover slash commands/config command names | Use `ctx.isProjectTrusted()` at command registration/config-reload discovery points where available; default registration-time discovery should not load project agents unless trusted context exists. |
| `src/slash/slash-commands.ts` | Slash command registration from entrypoint agents | Accept a trust boolean and skip project entrypoint agents unless trusted. |
| `docs/skills.md`, `docs/configuration.md`, `README.md` | User docs | Document that project-local agents/skills/settings/packages are trust-gated and child runs mirror parent trust. |
| Tests under `test/unit` and `test/integration` | Regression coverage | Add failing tests first for trust-gated discovery and child CLI trust flags. |

## Task 1: Add child Pi trust-flag wiring

**Files:**
- Modify: `src/execution/pi-args.ts`
- Test: `test/unit/pi-args.test.ts`

- [x] **Step 1: Write failing tests for child trust flags**

Append these tests inside the existing `describe("buildPiArgs session wiring", ...)` block in `test/unit/pi-args.test.ts`:

```ts
	void it("emits --approve when the parent project is trusted", () => {
		const { args } = buildPiArgs({
			baseArgs: ["--mode", "json", "-p"],
			task: "hello",
			sessionEnabled: false,
			projectTrusted: true,
		});

		assert.ok(args.includes("--approve"));
		assert.equal(args.includes("--no-approve"), false);
	});

	void it("emits --no-approve when the parent project is not trusted", () => {
		const { args } = buildPiArgs({
			baseArgs: ["--mode", "json", "-p"],
			task: "hello",
			sessionEnabled: false,
			projectTrusted: false,
		});

		assert.ok(args.includes("--no-approve"));
		assert.equal(args.includes("--approve"), false);
	});

	void it("omits trust flags when project trust is unspecified", () => {
		const { args } = buildPiArgs({
			baseArgs: ["--mode", "json", "-p"],
			task: "hello",
			sessionEnabled: false,
		});

		assert.equal(args.includes("--approve"), false);
		assert.equal(args.includes("--no-approve"), false);
	});
```

- [x] **Step 2: Run the focused test and confirm failure**

Run:

```bash
npm run test:unit -- test/unit/pi-args.test.ts
```

Expected: TypeScript/runtime test failure because `projectTrusted` is not part of `BuildPiArgsInput`, or assertions fail because no trust flags are emitted.

- [x] **Step 3: Implement minimal `buildPiArgs` support**

In `src/execution/pi-args.ts`, add this property to `BuildPiArgsInput`:

```ts
	/**
	 * Mirrors the parent Pi project-trust decision into child non-interactive Pi runs.
	 * true emits --approve, false emits --no-approve, undefined leaves Pi defaults unchanged.
	 */
	projectTrusted?: boolean;
```

Then add this block in `buildPiArgs` after session handling and before model arguments:

```ts
	if (input.projectTrusted === true) {
		args.push("--approve");
	} else if (input.projectTrusted === false) {
		args.push("--no-approve");
	}
```

- [x] **Step 4: Run the focused test and confirm pass**

Run:

```bash
npm run test:unit -- test/unit/pi-args.test.ts
```

Expected: all `pi-args` tests pass.

- [x] **Step 5: Commit Task 1**

```bash
git add src/execution/pi-args.ts test/unit/pi-args.test.ts
git commit -m "feat: mirror project trust in child pi args"
```

## Task 2: Gate project-local agent discovery

**Files:**
- Modify: `src/agents/agents.ts`
- Modify: `src/slash/slash-commands.ts`
- Modify: `src/extension/index.ts`
- Modify: `src/execution/subagent-executor.ts`
- Test: `test/unit/path-resolution.test.ts`

- [x] **Step 1: Write failing tests for agent discovery trust policy**

In `test/unit/path-resolution.test.ts`, extend the function declarations near the top:

```ts
let discoverAgents: ((cwd: string, options?: { includeProject?: boolean }) => AgentDiscoveryResult) | undefined;
let discoverAgentsAll: ((cwd: string, options?: { includeProject?: boolean }) => AgentDiscoveryAllResult) | undefined;
```

Append these tests inside `describe("Path resolution for .agents and ~/.agents", ...)`:

```ts
	void test("skips project agents when project inputs are not trusted", () => {
		assertModulesLoaded();

		const isolatedCwd = fs.mkdtempSync(path.join(tempRoot, "untrusted-agents-"));
		const agentsDir = path.join(isolatedCwd, ".agents");
		fs.mkdirSync(agentsDir, { recursive: true });
		fs.writeFileSync(path.join(agentsDir, "untrusted-agent.md"), "---\nname: untrusted-agent\ndescription: Untrusted agent\n---\nAgent content");

		const result = discoverAgentsAll!(isolatedCwd, { includeProject: false });

		assert.equal(result.project.length, 0);
		assert.equal(result.builtin.length > 0, true);
	});

	void test("includes project agents when project inputs are trusted", () => {
		assertModulesLoaded();

		const isolatedCwd = fs.mkdtempSync(path.join(tempRoot, "trusted-agents-"));
		const agentsDir = path.join(isolatedCwd, ".agents");
		fs.mkdirSync(agentsDir, { recursive: true });
		fs.writeFileSync(path.join(agentsDir, "trusted-agent.md"), "---\nname: trusted-agent\ndescription: Trusted agent\n---\nAgent content");

		const result = discoverAgentsAll!(isolatedCwd, { includeProject: true });
		const agent = result.project.find((candidate) => candidate.name === "trusted-agent");

		assert.ok(agent);
		assert.strictEqual(agent?.filePath, path.join(agentsDir, "trusted-agent.md"));
	});
```

- [x] **Step 2: Run the focused test and confirm failure**

Run:

```bash
npm run test:unit -- test/unit/path-resolution.test.ts
```

Expected: compile/type failure or behavior failure because `includeProject` is not implemented.

- [x] **Step 3: Implement agent discovery options**

In `src/agents/agents.ts`, add this interface near `AgentDiscoveryResult`:

```ts
export interface AgentDiscoveryOptions {
	/** Whether project-local .agents and .pi/agents should be loaded. Defaults to true for compatibility. */
	includeProject?: boolean;
}
```

Change signatures:

```ts
export function discoverAgents(cwd: string, options: AgentDiscoveryOptions = {}): AgentDiscoveryResult {
```

```ts
export function discoverAgentsAll(cwd: string, options: AgentDiscoveryOptions = {}): {
```

Inside each function, compute:

```ts
	const includeProject = options.includeProject ?? true;
	const projectAgentsDir = includeProject ? findNearestProjectAgentsDir(cwd) : null;
```

For `discoverAgentsAll`, use:

```ts
	const projectDir = includeProject ? findNearestProjectAgentsDir(cwd) : null;
```

- [x] **Step 4: Thread trust into command registration and execution discovery**

In `src/slash/slash-commands.ts`, update `registerSlashCommands` to accept `projectTrusted: boolean` in its options/parameters. Where it currently calls:

```ts
const entrypointAgents = discoverAgents(state.baseCwd).agents.filter(
```

change to:

```ts
const entrypointAgents = discoverAgents(state.baseCwd, { includeProject: projectTrusted }).agents.filter(
```

In `src/extension/index.ts`, update `discoverEntrypointCommandNames` to accept a trust option:

```ts
function discoverEntrypointCommandNames(cwd: string, includeProject: boolean): string[] {
	return discoverAgents(cwd, { includeProject })
		.agents.filter((agent) => agent.kind === "entrypoint" && agent.execution === "interactive")
		.map((agent) => agent.command ?? agent.name)
		.filter((commandName): commandName is string => Boolean(commandName));
}
```

At registration-time paths that lack an `ExtensionContext`, pass `false` so startup does not silently load project entrypoints before trust is known. At command execution paths with `ctx`, pass `ctx.isProjectTrusted()`.

In `src/execution/subagent-executor.ts`, change the runtime agent discovery call from:

```ts
const agents = deps.discoverAgents(ctx.cwd, "both").agents;
```

or the equivalent direct call to pass project trust through the dependency boundary. If the dependency signature is custom, add a boolean option named `includeProject` and call with:

```ts
const projectTrusted = ctx.isProjectTrusted();
const agents = deps.discoverAgents(ctx.cwd, "both", { includeProject: projectTrusted }).agents;
```

If the dependency is `discoverAgents` directly, call:

```ts
const projectTrusted = ctx.isProjectTrusted();
const agents = deps.discoverAgents(ctx.cwd, { includeProject: projectTrusted }).agents;
```

- [x] **Step 5: Run focused tests**

Run:

```bash
npm run test:unit -- test/unit/path-resolution.test.ts test/unit/superpowers-workflow-profile.test.ts test/unit/superpowers-skill-entry.test.ts
```

Expected: all focused tests pass. If command-registration tests need mock updates, add `isProjectTrusted: () => true` to mocks that expect project entrypoints.

- [x] **Step 6: Commit Task 2**

```bash
git add src/agents/agents.ts src/slash/slash-commands.ts src/extension/index.ts src/execution/subagent-executor.ts test/unit/path-resolution.test.ts
git commit -m "feat: gate project agent discovery on trust"
```

## Task 3: Gate project-local skill, settings, and package skill inputs

**Files:**
- Modify: `src/shared/skills.ts`
- Modify: `src/execution/child-runner.ts`
- Modify: `src/execution/subagent-executor.ts`
- Test: `test/unit/path-resolution.test.ts`
- Test: `test/unit/skills-compat.test.ts`

- [x] **Step 1: Write failing tests for skill path policy options**

In `test/unit/skills-compat.test.ts`, add `buildSkillPathsForTest` to the import:

```ts
import { buildLoadSkillsOptionsForPi, buildSkillPathsForTest } from "../../src/shared/skills.ts";
```

Append these tests:

```ts
	void it("excludes project-local skill paths when project inputs are not trusted", () => {
		const paths = buildSkillPathsForTest("/repo", { includeProject: false });

		assert.equal(paths.includes("/repo/.pi/skills"), false);
		assert.equal(paths.includes("/repo/.agents/skills"), false);
		assert.ok(paths.some((entry) => entry.endsWith("/.pi/agent/skills")));
		assert.ok(paths.some((entry) => entry.endsWith("/.agents/skills")));
	});

	void it("includes project-local skill paths when project inputs are trusted", () => {
		const paths = buildSkillPathsForTest("/repo", { includeProject: true });

		assert.ok(paths.includes("/repo/.pi/skills"));
		assert.ok(paths.includes("/repo/.agents/skills"));
	});
```

- [x] **Step 2: Write failing tests for runtime skill resolution**

In `test/unit/path-resolution.test.ts`, change `resolveSkillPath` declaration to:

```ts
let resolveSkillPath: ((skillName: string, cwd: string, options?: { includeProject?: boolean }) => ResolvedSkill | null | undefined) | undefined;
```

Append this test:

```ts
	void test("skips project skills when project inputs are not trusted", () => {
		assertModulesLoaded();

		const isolatedCwd = fs.mkdtempSync(path.join(tempRoot, "untrusted-skills-"));
		const skillsDir = path.join(isolatedCwd, ".agents", "skills");
		fs.mkdirSync(skillsDir, { recursive: true });
		fs.writeFileSync(path.join(skillsDir, "untrusted-skill.md"), "---\nname: untrusted-skill\ndescription: test desc\n---\nSkill content");

		clearSkillCache!();
		const resolved = resolveSkillPath!("untrusted-skill", isolatedCwd, { includeProject: false });

		assert.equal(resolved, undefined);
	});
```

- [x] **Step 3: Run focused tests and confirm failure**

Run:

```bash
npm run test:unit -- test/unit/skills-compat.test.ts test/unit/path-resolution.test.ts
```

Expected: compile/type failure or behavior failure because skill trust options are not implemented.

- [x] **Step 4: Implement skill discovery options**

In `src/shared/skills.ts`, add:

```ts
export interface SkillDiscoveryOptions {
	/** Whether project-local .pi/.agents skill inputs should be loaded. Defaults to true for compatibility. */
	includeProject?: boolean;
}
```

Change `collectConfiguredPackageRoots`:

```ts
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
```

Change `collectPackageSkillPaths`:

```ts
function collectPackageSkillPaths(cwd: string, options: SkillDiscoveryOptions = {}): string[] {
	const roots = collectConfiguredPackageRoots(cwd, options);
	const packageRoots = collectPackageSkillDirectories(roots);
	const skillPaths = packageRoots.flatMap(resolvePackageSkillMetadata);
	return dedupeSkillPaths(skillPaths);
}
```

Change `collectSettingsSkillPaths` so it only includes project settings when trusted:

```ts
function collectSettingsSkillPaths(cwd: string, options: SkillDiscoveryOptions = {}): string[] {
	const includeProject = options.includeProject ?? true;
	const results: string[] = [];
	const settingsFiles = [
		...(includeProject ? [{ file: path.join(cwd, CONFIG_DIR, "settings.json"), base: path.join(cwd, CONFIG_DIR) }] : []),
		{ file: path.join(AGENT_DIR, "settings.json"), base: AGENT_DIR },
	];
	// keep existing loop unchanged
}
```

Change `buildSkillPaths`:

```ts
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
```

Export a test helper after `buildSkillPaths`:

```ts
export function buildSkillPathsForTest(cwd: string, options: SkillDiscoveryOptions = {}): string[] {
	return buildSkillPaths(cwd, options);
}
```

Update the skill cache key to include trust policy:

```ts
let loadSkillsCache: { cwd: string; includeProject: boolean; skills: CachedSkillEntry[]; timestamp: number } | null = null;
```

In `getCachedSkills`:

```ts
function getCachedSkills(cwd: string, options: SkillDiscoveryOptions = {}): CachedSkillEntry[] {
	const includeProject = options.includeProject ?? true;
	const now = Date.now();
	if (loadSkillsCache && loadSkillsCache.cwd === cwd && loadSkillsCache.includeProject === includeProject && now - loadSkillsCache.timestamp < LOAD_SKILLS_CACHE_TTL_MS) {
		return loadSkillsCache.skills;
	}

	const skillPaths = buildSkillPaths(cwd, { includeProject });
	// keep loadSkills call and loop unchanged
	loadSkillsCache = { cwd, includeProject, skills, timestamp: now };
	return skills;
}
```

Update public functions:

```ts
export function resolveSkillPath(skillName: string, cwd: string, options: SkillDiscoveryOptions = {}): { path: string; source: SkillSource } | undefined {
	const skills = getCachedSkills(cwd, options);
	const skill = skills.find((s) => s.name === skillName);
	if (!skill) return undefined;
	return { path: skill.filePath, source: skill.source };
}

export function resolveSkills(skillNames: string[], cwd: string, options: SkillDiscoveryOptions = {}): { resolved: ResolvedSkill[]; missing: string[] } {
	// call resolveSkillPath(trimmed, cwd, options)
}
```

Add `includeProject?: boolean` to `resolveExecutionSkills` input and pass it to `getAvailableSkillNames`, `getRootOnlySkillNames`, and `resolveSkills`. If those helper functions do not yet accept options, update them with the same `SkillDiscoveryOptions` argument and route to `getCachedSkills(cwd, options)`.

- [x] **Step 5: Thread project trust into child skill resolution**

In `src/execution/child-runner.ts`, add `projectTrusted?: boolean` to the launch/preparation options type used by `runPreparedChild` or `prepareChildLaunch`. Then change `resolveExecutionSkills` call to:

```ts
const { skillNames, resolvedSkills, missingSkills } = resolveExecutionSkills({
	cwd: runtimeCwd,
	workflow,
	role,
	config,
	useTestDrivenDevelopment: options.useTestDrivenDevelopment,
	skills: configuredSkills,
	includeProject: options.projectTrusted ?? true,
});
```

- [x] **Step 6: Pass trust from executor to child runner**

In `src/execution/subagent-executor.ts`, compute once near the top of execution:

```ts
const projectTrusted = ctx.isProjectTrusted();
```

Pass `projectTrusted` to every child launch/preparation call. For parallel preflight calls that compute skill summaries, pass `includeProject: projectTrusted` to `resolveExecutionSkills`.

- [x] **Step 7: Run focused tests**

Run:

```bash
npm run test:unit -- test/unit/skills-compat.test.ts test/unit/path-resolution.test.ts test/unit/skills-compat.test.ts
```

Expected: all focused tests pass.

- [x] **Step 8: Commit Task 3**

```bash
git add src/shared/skills.ts src/execution/child-runner.ts src/execution/subagent-executor.ts test/unit/path-resolution.test.ts test/unit/skills-compat.test.ts
git commit -m "feat: gate project skill inputs on trust"
```

## Task 4: Pass parent trust to child Pi and prevent project extension escalation

**Files:**
- Modify: `src/execution/child-runner.ts`
- Modify: `src/execution/subagent-executor.ts`
- Modify: `src/execution/superagents-config.ts` if extension resolution helpers need a source-aware filter
- Test: `test/unit/pi-args.test.ts`
- Test: `test/unit/superpowers-policy.test.ts` or a new focused test near existing extension-resolution tests

- [x] **Step 1: Write failing test for parent trust reaching prepared child args**

Add a focused unit test in the existing test file that covers child-runner preparation if one exists. If not, add to `test/unit/pi-args.test.ts` only after exposing or testing `prepareChildLaunch` is already public. Use this assertion shape:

```ts
assert.ok(prepared.args.includes("--approve"));
assert.equal(prepared.args.includes("--no-approve"), false);
```

and for untrusted:

```ts
assert.ok(prepared.args.includes("--no-approve"));
assert.equal(prepared.args.includes("--approve"), false);
```

- [x] **Step 2: Implement trust pass-through to `buildPiArgs`**

In `src/execution/child-runner.ts`, change the `buildPiArgs` call to include:

```ts
		projectTrusted: options.projectTrusted,
```

- [x] **Step 3: Block project agent frontmatter extensions when untrusted**

In `src/execution/child-runner.ts`, before `resolveSubagentExtensions(config, agent.extensions)`, compute agent extension inputs as:

```ts
const agentExtensions = agent.source === "project" && options.projectTrusted === false ? undefined : agent.extensions;
```

Then call:

```ts
const effectiveExtensions = includeLifecycleExtension(resolveSubagentExtensions(config, agentExtensions), options.sessionFile, options.lifecycleExtensionEntry);
```

This keeps user/global config extensions and the lifecycle extension, but prevents untrusted project agent frontmatter from injecting child Pi `--extension` entries.

- [x] **Step 4: Run focused tests**

Run:

```bash
npm run test:unit -- test/unit/pi-args.test.ts test/unit/superpowers-policy.test.ts
```

Expected: all focused tests pass.

- [x] **Step 5: Commit Task 4**

```bash
git add src/execution/child-runner.ts src/execution/subagent-executor.ts test/unit/pi-args.test.ts test/unit/superpowers-policy.test.ts
git commit -m "feat: mirror trust and block untrusted project extensions"
```

## Task 5: Update dependency versions and TypeScript surface for Pi 0.79.1

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `pnpm-workspace.yaml` only if kept as the pnpm strict-build policy file
- Test: `test/unit/package-manifest.test.ts`

- [x] **Step 1: Write or update manifest test for 0.79.1 baseline**

In `test/unit/package-manifest.test.ts`, add a test inside `describe("package.json manifest", ...)`:

```ts
	void it("uses Pi 0.79.1 or newer dev dependencies for project trust APIs", () => {
		const pkg = readJson("package.json") as {
			devDependencies?: Record<string, string>;
		};
		const deps = pkg.devDependencies ?? {};

		assert.match(deps["@earendil-works/pi-agent-core"] ?? "", /\^0\.79\.1|>=0\.79\.1/);
		assert.match(deps["@earendil-works/pi-ai"] ?? "", /\^0\.79\.1|>=0\.79\.1/);
		assert.match(deps["@earendil-works/pi-coding-agent"] ?? "", /\^0\.79\.1|>=0\.79\.1/);
		assert.match(deps["@earendil-works/pi-tui"] ?? "", /\^0\.79\.1|>=0\.79\.1/);
	});
```

If `package-manifest.test.ts` uses different helper names, reuse the existing package JSON reader already in that file rather than adding a duplicate.

- [x] **Step 2: Run test and confirm failure**

Run:

```bash
npm run test:unit -- test/unit/package-manifest.test.ts
```

Expected: failure because current Pi dev dependencies are `^0.75.3`.

- [x] **Step 3: Update dependencies**

Edit `package.json` devDependencies:

```json
"@earendil-works/pi-agent-core": "^0.79.1",
"@earendil-works/pi-ai": "^0.79.1",
"@earendil-works/pi-coding-agent": "^0.79.1",
"@earendil-works/pi-tui": "^0.79.1"
```

Keep peerDependencies as `"*"` unless the type surface requires a minimum. If TypeScript consumers need the newer `ExtensionContext.isProjectTrusted()` type, change peerDependencies to:

```json
"@earendil-works/pi-agent-core": ">=0.79.1",
"@earendil-works/pi-ai": ">=0.79.1",
"@earendil-works/pi-coding-agent": ">=0.79.1",
"@earendil-works/pi-tui": ">=0.79.1"
```

- [x] **Step 4: Regenerate npm lockfile**

Run:

```bash
npm install --package-lock-only
```

Expected: `package-lock.json` updates Pi packages to `0.79.1`-compatible versions.

- [x] **Step 5: Run focused manifest test**

Run:

```bash
npm run test:unit -- test/unit/package-manifest.test.ts
```

Expected: manifest tests pass.

- [x] **Step 6: Commit Task 5**

```bash
git add package.json package-lock.json test/unit/package-manifest.test.ts
git commit -m "chore: update pi dev dependencies for project trust api"
```

## Task 6: Document project-trust behavior

**Files:**
- Modify: `README.md`
- Modify: `docs/configuration.md`
- Modify: `docs/skills.md`

- [ ] **Step 1: Update README project trust note**

Add this paragraph after the installation/local development section in `README.md`:

```md
## Project Trust

On Pi 0.79+, `pi-superagents` mirrors Pi's project-trust decision. Project-local agents, skills, skill packages, `.pi/settings.json` skill entries, and project agent frontmatter extensions are loaded only when the current Pi context reports the project as trusted. Child subagent Pi processes receive `--approve` when the parent context is trusted and `--no-approve` when it is not, so non-interactive child runs do not silently escalate trust.
```

- [ ] **Step 2: Update skills docs**

In `docs/skills.md`, replace the project location bullets with trust-qualified text:

```md
- **Project, only when Pi project trust is active:** `.pi/skills/{name}/SKILL.md` and `.agents/skills/{name}/SKILL.md`
- **Project packages, only when Pi project trust is active:** `.pi/npm/node_modules/*` via `package.json -> pi.skills`
- **Project settings, only when Pi project trust is active:** `.pi/settings.json -> skills`
```

Keep user/global bullets unchanged.

- [ ] **Step 3: Update configuration docs**

In `docs/configuration.md`, after the local extension/tool configuration paragraphs around lines 86-90, add:

```md
Project-local agent frontmatter is trust-gated on Pi 0.79+. If the parent Pi context has not trusted the project, `pi-superagents` ignores project agent files and does not honor project agent `extensions:` entries. User-level agents and package-bundled agents continue to work before project trust.
```

Near the global tools/local extension section, add:

```md
Child subagent processes mirror the parent trust decision. Trusted parent contexts launch child Pi with `--approve`; untrusted parent contexts launch child Pi with `--no-approve`. Configure project-local Pi resources only for repositories you trust.
```

- [ ] **Step 4: Run docs-adjacent tests**

Run:

```bash
npm run test:unit -- test/unit/package-manifest.test.ts test/unit/config-validation.test.ts
```

Expected: tests pass.

- [ ] **Step 5: Commit Task 6**

```bash
git add README.md docs/configuration.md docs/skills.md
git commit -m "docs: describe project trust handling"
```

## Task 7: Full verification and cleanup

**Files:**
- Verify all modified files
- Remove unintended untracked `pnpm-lock.yaml` unless the project intentionally adopts pnpm lockfiles

- [ ] **Step 1: Check working tree**

Run:

```bash
git status --short
```

Expected: only intentional tracked changes after task commits, plus no unintended `pnpm-lock.yaml` unless explicitly accepted.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: TypeScript exits 0.

- [ ] **Step 3: Run full unit test suite**

Run:

```bash
npm run test:unit
```

Expected: all unit tests pass.

- [ ] **Step 4: Run full QA if time permits**

Run:

```bash
npm run qa
```

Expected: Biome, typecheck, and all tests pass. If `qa` reformats files, inspect the diff and keep only intentional formatting changes.

- [ ] **Step 5: Final diff review**

Run:

```bash
git diff --stat HEAD~7..HEAD
```

Then inspect changed source and docs:

```bash
git diff HEAD~7..HEAD -- src/agents/agents.ts src/shared/skills.ts src/execution/pi-args.ts src/execution/child-runner.ts src/execution/subagent-executor.ts src/extension/index.ts src/slash/slash-commands.ts README.md docs/configuration.md docs/skills.md
```

Expected: diff shows trust gating, child trust flag mirroring, tests, and docs only.

## Self-Review

- Spec coverage: The plan covers parent trust inspection, project-local agent/skill/settings/package gating, child `--approve`/`--no-approve` mirroring, project frontmatter extension blocking, dependency update for `ctx.isProjectTrusted()`, and docs.
- Placeholder scan: No `TBD`, `TODO`, or vague implementation-only instructions remain; each code-changing step includes concrete code or exact call-shape guidance.
- Type consistency: The plan consistently uses `includeProject?: boolean` for discovery and `projectTrusted?: boolean` for child launch mirroring.
