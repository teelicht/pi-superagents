# Pi-Subagents + Superpowers Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit Superpowers command to `pi-subagents` that activates the Superpowers workflow only when requested, while keeping the baseline `pi` harness plus generic `pi-subagents` extension behavior unchanged and supporting `tdd` vs `direct` implementer modes plus project-specific domain skill overlays.

**Architecture:** Treat `pi` as the base coding harness and `pi-subagents` as a generic delegation extension layered on top. Add a command-driven Superpowers path inside `pi-subagents` that passes explicit run-level workflow metadata into the existing executor, then resolves role policy, model tiers, domain skill overlays, packet conventions, and worktree behavior only when that metadata is present. Use one `sp-*` role library and one canonical per-task loop, with implementer behavior switching between `tdd` and `direct` by run option instead of global mode.

**Tech Stack:** TypeScript (Node ESM), Pi coding-agent extension APIs, markdown agent definitions, Node test runner, existing `pi-subagents` slash-command and execution pipeline.

---

## File Structure

### Files to Create

| File | Purpose |
|------|---------|
| `superpowers-policy.ts` | Resolve command-only workflow policy: roles, model tiers, role-based overlays, implementer mode |
| `superpowers-packets.ts` | Build run-local packet names and instruction defaults for the Superpowers command |
| `test/unit/superpowers-policy.test.ts` | Unit tests for command-scoped role/tier/overlay resolution and implementer mode selection |
| `test/integration/superpowers-packets.test.ts` | Integration tests for packet naming/instruction behavior in the Superpowers command path |
| `agents/sp-recon.md` | Superpowers recon role |
| `agents/sp-research.md` | Superpowers research role |
| `agents/sp-implementer.md` | Superpowers implementer role |
| `agents/sp-spec-review.md` | Superpowers spec-review role |
| `agents/sp-code-review.md` | Superpowers code-review role |
| `agents/sp-debug.md` | Superpowers debug role |
| `agents/sp-task-loop.chain.md` | Canonical per-task loop: implementer -> spec-review -> code-review |

### Files to Modify

| File | Purpose |
|------|---------|
| `types.ts` | Add run-level workflow metadata and Superpowers settings types |
| `schemas.ts` | Add direct-tool parameters for command-driven workflow metadata if needed |
| `index.ts` | Load Superpowers settings and keep them dormant unless command/run metadata activates them |
| `slash-commands.ts` | Register the new Superpowers command and parse `tdd` vs `direct` options |
| `subagent-executor.ts` | Thread workflow metadata through single/chain/parallel execution |
| `execution.ts` | Resolve effective model and skills only when Superpowers workflow metadata is present |
| `chain-execution.ts` | Apply role/tier/overlay/packet behavior in the Superpowers command path |
| `settings.ts` | Support command-scoped packet defaults instead of `context.md` / `progress.md` conventions |
| `skills.ts` | Support overlay resolution and compatibility checks for command-scoped runs |
| `worktree.ts` | Add Superpowers-compatible worktree root/ignore/baseline behavior without changing default runtime behavior |
| `agent-templates.ts` | Add Superpowers templates without removing generic ones |
| `README.md` | Document the new command, implementer modes, overlays, and examples |
| `test/integration/slash-commands.test.ts` | Cover command parsing and request payload construction |
| `test/integration/template-resolution.test.ts` | Extend chain/prompt behavior coverage for command-scoped packets |
| `test/unit/worktree.test.ts` | Add worktree tests for configured roots and ignore verification |
| `test/unit/agent-frontmatter.test.ts` | Cover new built-in `sp-*` agents |

### Reference Patterns

| File | Pattern |
|------|---------|
| `slash-commands.ts` | Existing slash-command registration and request emission |
| `subagent-executor.ts` | Central execution entry point for single/parallel/chain requests |
| `execution.ts` | Final model/skill injection before spawning Pi |
| `settings.ts` | Existing reads/output/progress instruction injection |
| `skills.ts` | Existing skill discovery and resolution |
| `worktree.ts` | Existing git/worktree safety checks |
| `test/integration/slash-commands.test.ts` | Good pattern for command-level tests without full runtime boot |
| `test/integration/template-resolution.test.ts` | Good pattern for pure behavior tests |
| `test/unit/worktree.test.ts` | Good pattern for git-backed worktree tests |

### Risk Assessment

- [x] Breaking changes to public API
- [ ] Database migrations needed
- [x] Configuration changes required

Notes:
- The plan intentionally keeps the baseline `pi` harness and generic `pi-subagents` extension behavior unchanged, and scopes new policy to the explicit Superpowers command.
- Generic built-ins should remain intact in this iteration.

## Task 1: Add The Superpowers Command And Run-Level Workflow Metadata

**Files:**
- Modify: `types.ts`
- Modify: `schemas.ts`
- Modify: `slash-commands.ts`
- Modify: `subagent-executor.ts`
- Test: `test/integration/slash-commands.test.ts`

- [x] **Step 1: Add a failing slash-command test for the new command**

```ts
it("/superpowers emits a request with workflow and implementer mode metadata", async () => {
	const sent: unknown[] = [];
	const commands = new Map<string, { handler(args: string, ctx: unknown): Promise<void> }>();
	const events = createEventBus();
	let capturedRequest: unknown;

	events.on(SLASH_SUBAGENT_REQUEST_EVENT, (data) => {
		capturedRequest = data;
		const requestId = (data as { requestId: string }).requestId;
		events.emit(SLASH_SUBAGENT_STARTED_EVENT, { requestId });
		events.emit(SLASH_SUBAGENT_RESPONSE_EVENT, {
			requestId,
			result: {
				content: [{ type: "text", text: "Superpowers started" }],
				details: { mode: "single", results: [] },
			},
			isError: false,
		});
	});

	const pi = {
		events,
		registerCommand(name: string, spec: { handler(args: string, ctx: unknown): Promise<void> }) {
			commands.set(name, spec);
		},
		registerShortcut() {},
		sendMessage(message: unknown) {
			sent.push(message);
		},
	};

	registerSlashCommands!(pi, createState(process.cwd()));
	await commands.get("superpowers")!.handler("tdd implement auth fix", createCommandContext());

	assert.equal((capturedRequest as { params: { workflow?: string } }).params.workflow, "superpowers");
	assert.equal((capturedRequest as { params: { implementerMode?: string } }).params.implementerMode, "tdd");
});
```

- [x] **Step 2: Run the slash-command integration test and verify it fails because the command does not exist yet**

Run:

```bash
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/slash-commands.test.ts
```

Expected:
- FAIL because `commands.get("superpowers")` is `undefined`

- [x] **Step 3: Add run-level workflow metadata types in `types.ts`**

```ts
export type WorkflowMode = "default" | "superpowers";

export type SuperpowersImplementerMode = "tdd" | "direct";

export interface SuperpowersSettings {
	commandName?: string;
	modelTiers?: Partial<Record<ModelTier, string>>;
	roleModelTiers?: Partial<Record<ExecutionRole, ModelTier>>;
	roleSkillOverlays?: Partial<Record<ExecutionRole, string[]>>;
	worktreeRoot?: string;
	worktreeBaselineCommand?: string;
	defaultImplementerMode?: SuperpowersImplementerMode;
}

export interface ExtensionConfig {
	asyncByDefault?: boolean;
	defaultSessionDir?: string;
	maxSubagentDepth?: number;
	worktreeSetupHook?: string;
	worktreeSetupHookTimeoutMs?: number;
	superpowers?: SuperpowersSettings;
}
```

- [x] **Step 4: Extend `SubagentParamsLike` and `schemas.ts` so workflow metadata can reach the executor**

```ts
export interface SubagentParamsLike {
	action?: string;
	agent?: string;
	task?: string;
	chain?: ChainStep[];
	tasks?: TaskParam[];
	workflow?: "default" | "superpowers";
	implementerMode?: "tdd" | "direct";
	// ...existing fields...
}
```

```ts
workflow: Type.Optional(Type.String({
	enum: ["default", "superpowers"],
	description: "Execution workflow. 'default' keeps the baseline pi harness plus generic pi-subagents behavior; 'superpowers' enables the explicit Superpowers command path.",
})),
implementerMode: Type.Optional(Type.String({
	enum: ["tdd", "direct"],
	description: "Superpowers implementer mode. 'tdd' is test-first; 'direct' allows code-first implementation.",
})),
```

- [x] **Step 5: Register the new command in `slash-commands.ts`**

```ts
pi.registerCommand("superpowers", {
	async handler(rawArgs, ctx) {
		const trimmed = rawArgs.trim();
		const implementerMode = trimmed.startsWith("direct ")
			? "direct"
			: "tdd";
		const task = trimmed.startsWith("direct ")
			? trimmed.slice("direct ".length)
			: trimmed.startsWith("tdd ")
				? trimmed.slice("tdd ".length)
				: trimmed;

		await runSlashSubagent(pi, ctx, {
			workflow: "superpowers",
			implementerMode,
			agent: "sp-recon",
			task,
			clarify: false,
		});
	},
});
```

- [x] **Step 6: Thread the new fields through `subagent-executor.ts`**

```ts
const workflow = params.workflow ?? "default";
const implementerMode =
	params.implementerMode
	?? deps.config.superpowers?.defaultImplementerMode
	?? "tdd";
```

Use these values later when resolving policy:

```ts
const result = await runSync(ctx.cwd, agents, params.agent!, task, {
	// existing fields...
	config: deps.config,
	workflow,
	implementerMode,
});
```

- [x] **Step 7: Re-run the slash-command integration test**

Run:

```bash
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/slash-commands.test.ts
```

Expected:
- new `/superpowers` test passes
- existing `/run` and `/subagents-status` tests still pass

- [x] **Step 8: Commit**

```bash
git add types.ts schemas.ts slash-commands.ts subagent-executor.ts test/integration/slash-commands.test.ts
git commit -m "feat: add explicit superpowers command entrypoint"
```

### Task 2: Add Command-Scoped Superpowers Policy And Skill Overlay Resolution

**Files:**
- Create: `superpowers-policy.ts`
- Modify: `skills.ts`
- Modify: `execution.ts`
- Modify: `chain-execution.ts`
- Test: `test/unit/superpowers-policy.test.ts`

- [x] **Step 1: Write failing unit tests for command-scoped policy**

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	resolveModelForRole,
	resolveRoleSkillSet,
	resolveImplementerSkillSet,
	type SuperpowersPolicyInput,
} from "../../superpowers-policy.ts";

describe("superpowers policy", () => {
	it("does nothing when workflow is default", () => {
		assert.equal(
			resolveModelForRole({
				workflow: "default",
				role: "sp-code-review",
				config: {},
			}),
			undefined,
		);
	});

	it("resolves overlays only for command-scoped superpowers runs", () => {
		const skills = resolveRoleSkillSet({
			workflow: "superpowers",
			role: "sp-spec-review",
			config: {
				superpowers: {
					roleSkillOverlays: {
						"sp-spec-review": ["vercel-react-native-skills"],
					},
				},
			},
			agentSkills: [],
			stepSkills: [],
			availableSkills: new Set(["vercel-react-native-skills"]),
		});

		assert.deepEqual(skills, ["vercel-react-native-skills"]);
	});

	it("adds test-driven-development only in tdd implementer mode", () => {
		assert.deepEqual(
			resolveImplementerSkillSet({
				workflow: "superpowers",
				implementerMode: "tdd",
				config: {},
				agentSkills: [],
				stepSkills: [],
				availableSkills: new Set(["test-driven-development"]),
			}),
			["test-driven-development"],
		);
	});
});
```

- [x] **Step 2: Run the new unit test and verify it fails because the policy layer does not exist yet**

Run:

```bash
node --experimental-strip-types --test test/unit/superpowers-policy.test.ts
```

Expected:
- FAIL with missing module or export errors

- [x] **Step 3: Implement `superpowers-policy.ts`**

```ts
import type {
	ExecutionRole,
	ExtensionConfig,
	SuperpowersImplementerMode,
	WorkflowMode,
} from "./types.ts";

const ROOT_ONLY_WORKFLOW_SKILLS = new Set([
	"using-superpowers",
	"brainstorming",
	"writing-plans",
	"requesting-code-review",
	"receiving-code-review",
	"subagent-driven-development",
	"executing-plans",
	"verification-before-completion",
	"using-git-worktrees",
	"dispatching-parallel-agents",
	"finishing-a-development-branch",
]);

const DEFAULT_ROLE_TIERS: Record<ExecutionRole, ModelTier> = {
	"root-planning": "max",
	"sp-recon": "cheap",
	"sp-research": "cheap",
	"sp-implementer": "cheap",
	"sp-spec-review": "strong",
	"sp-code-review": "strong",
	"sp-debug": "max",
};

export function resolveModelForRole(input: {
	workflow: WorkflowMode;
	role: ExecutionRole;
	config: ExtensionConfig;
}): string | undefined {
	if (input.workflow !== "superpowers") return undefined;
	const settings = input.config.superpowers;
	const tier = settings?.roleModelTiers?.[input.role] ?? DEFAULT_ROLE_TIERS[input.role];
	return settings?.modelTiers?.[tier];
}

export function resolveRoleSkillSet(input: {
	workflow: WorkflowMode;
	role: ExecutionRole;
	config: ExtensionConfig;
	agentSkills: string[];
	stepSkills: string[];
	availableSkills: ReadonlySet<string>;
}): string[] {
	if (input.workflow !== "superpowers") {
		return [...new Set([...input.agentSkills, ...input.stepSkills])];
	}

	const overlays = input.config.superpowers?.roleSkillOverlays?.[input.role] ?? [];
	const merged = [...new Set([...input.agentSkills, ...input.stepSkills, ...overlays])];
	for (const skill of merged) {
		if (!input.availableSkills.has(skill)) {
			throw new Error(`Unknown overlay skill: ${skill}`);
		}
		if (input.role !== "root-planning" && ROOT_ONLY_WORKFLOW_SKILLS.has(skill)) {
			throw new Error(`Role ${input.role} cannot receive root-only workflow skill '${skill}'`);
		}
	}
	return merged;
}

export function resolveImplementerSkillSet(input: {
	workflow: WorkflowMode;
	implementerMode: SuperpowersImplementerMode;
	config: ExtensionConfig;
	agentSkills: string[];
	stepSkills: string[];
	availableSkills: ReadonlySet<string>;
}): string[] {
	const base = resolveRoleSkillSet({
		workflow: input.workflow,
		role: "sp-implementer",
		config: input.config,
		agentSkills: input.agentSkills,
		stepSkills: input.stepSkills,
		availableSkills: input.availableSkills,
	});
	if (input.workflow !== "superpowers" || input.implementerMode !== "tdd") return base;
	if (!input.availableSkills.has("test-driven-development")) return base;
	return [...new Set([...base, "test-driven-development"])];
}
```

- [x] **Step 4: Add reusable available-skill helpers in `skills.ts`**

```ts
export function getAvailableSkillNames(cwd: string): Set<string> {
	return new Set(getCachedSkills(cwd).map((skill) => skill.name));
}
```

- [x] **Step 5: Apply the policy in `execution.ts` and `chain-execution.ts` only when `workflow === "superpowers"`**

```ts
const role = inferExecutionRole(agent.name);
const tierModel = resolveModelForRole({
	workflow: options.workflow ?? "default",
	role,
	config: options.config,
});
const effectiveModel = modelOverride ?? tierModel ?? agent.model;

const availableSkills = getAvailableSkillNames(runtimeCwd);
const effectiveSkills =
	role === "sp-implementer"
		? resolveImplementerSkillSet({
				workflow: options.workflow ?? "default",
				implementerMode: options.implementerMode ?? "tdd",
				config: options.config,
				agentSkills: agent.skills ?? [],
				stepSkills: options.skills ?? [],
				availableSkills,
			})
		: resolveRoleSkillSet({
				workflow: options.workflow ?? "default",
				role,
				config: options.config,
				agentSkills: agent.skills ?? [],
				stepSkills: options.skills ?? [],
				availableSkills,
			});
```

- [x] **Step 6: Re-run the unit tests**

Run:

```bash
node --experimental-strip-types --test test/unit/superpowers-policy.test.ts
```

Expected:
- all `superpowers policy` tests pass

- [ ] **Step 7: Commit**

```bash
git add superpowers-policy.ts skills.ts execution.ts chain-execution.ts test/unit/superpowers-policy.test.ts
git commit -m "feat: add command-scoped superpowers policy"
```

### Task 3: Add Packet Conventions And `sp-*` Role Library For The Command Path

**Files:**
- Create: `superpowers-packets.ts`
- Create: `agents/sp-recon.md`
- Create: `agents/sp-research.md`
- Create: `agents/sp-implementer.md`
- Create: `agents/sp-spec-review.md`
- Create: `agents/sp-code-review.md`
- Create: `agents/sp-debug.md`
- Create: `agents/sp-task-loop.chain.md`
- Modify: `settings.ts`
- Modify: `agent-templates.ts`
- Test: `test/integration/superpowers-packets.test.ts`
- Test: `test/unit/agent-frontmatter.test.ts`

- [ ] **Step 1: Add a failing packet-behavior test**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSuperpowersPacketPlan } from "../../superpowers-packets.ts";

describe("superpowers packets", () => {
	it("uses task and review packet names instead of context.md/plan.md/progress.md", () => {
		const packets = buildSuperpowersPacketPlan("sp-implementer");
		assert.deepEqual(packets.reads, ["task-brief.md"]);
		assert.equal(packets.output, "implementer-report.md");
		assert.equal(packets.progress, false);
	});
});
```

- [ ] **Step 2: Run the packet integration test and verify it fails**

Run:

```bash
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/superpowers-packets.test.ts
```

Expected:
- FAIL because the packet helper does not exist yet

- [ ] **Step 3: Implement `superpowers-packets.ts`**

```ts
import type { ExecutionRole } from "./types.ts";

export function buildSuperpowersPacketPlan(role: ExecutionRole): {
	reads: string[];
	output: string | false;
	progress: false;
} {
	switch (role) {
		case "sp-implementer":
			return { reads: ["task-brief.md"], output: "implementer-report.md", progress: false };
		case "sp-spec-review":
			return { reads: ["task-brief.md", "implementer-report.md"], output: "spec-review.md", progress: false };
		case "sp-code-review":
			return { reads: ["task-brief.md", "spec-review.md"], output: "code-review.md", progress: false };
		case "sp-debug":
			return { reads: ["debug-brief.md"], output: "debug-brief.md", progress: false };
		default:
			return { reads: [], output: false, progress: false };
	}
}
```

- [ ] **Step 4: Extend `settings.ts` to accept packet defaults for command-scoped Superpowers runs**

```ts
export function resolveStepBehavior(
	agentConfig: AgentConfig,
	stepOverrides: StepOverrides,
	chainSkills?: string[],
	packetDefaults?: { reads?: string[]; output?: string | false; progress?: boolean },
): ResolvedStepBehavior {
	const output =
		stepOverrides.output !== undefined
			? stepOverrides.output
			: packetDefaults?.output !== undefined
				? packetDefaults.output
				: agentConfig.output ?? false;

	const reads =
		stepOverrides.reads !== undefined
			? stepOverrides.reads
			: packetDefaults?.reads !== undefined
				? packetDefaults.reads
				: agentConfig.defaultReads ?? false;

	const progress =
		stepOverrides.progress !== undefined
			? stepOverrides.progress
			: packetDefaults?.progress !== undefined
				? packetDefaults.progress
				: agentConfig.defaultProgress ?? false;
```

- [ ] **Step 5: Add the new built-in agents and canonical chain**

`agents/sp-implementer.md`

```md
---
name: sp-implementer
description: Superpowers-native implementer for one bounded plan task
model: cheap
maxSubagentDepth: 0
---

You are a bounded implementer.

- Implement exactly one extracted plan task.
- Respect the provided implementer mode: `tdd` or `direct`.
- If requirements are unclear, report `NEEDS_CONTEXT`.
- If the task requires design judgment, report `BLOCKED`.
- Return status: `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, or `BLOCKED`.
```

`agents/sp-task-loop.chain.md`

```md
---
name: sp-task-loop
description: Superpowers per-task execution loop
---

## sp-implementer
reads: task-brief.md
output: implementer-report.md
progress: false

Implement the extracted task.

## sp-spec-review
reads: task-brief.md, implementer-report.md
output: spec-review.md
progress: false

Review the implementation for spec compliance.

## sp-code-review
reads: task-brief.md, spec-review.md
output: code-review.md
progress: false

Review the implementation for code quality.
```

- [ ] **Step 6: Add a discovery test for the new built-in agents**

```ts
it("discovers built-in superpowers agents", () => {
	const result = discoverAgents(process.cwd(), "both");
	const names = new Set(result.agents.map((agent) => agent.name));
	assert.ok(names.has("sp-implementer"));
	assert.ok(names.has("sp-spec-review"));
	assert.ok(names.has("sp-code-review"));
});
```

- [ ] **Step 7: Re-run packet and agent-discovery tests**

Run:

```bash
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/superpowers-packets.test.ts
node --experimental-strip-types --test test/unit/agent-frontmatter.test.ts
```

Expected:
- packet tests pass
- built-in `sp-*` discovery test passes

- [ ] **Step 8: Commit**

```bash
git add superpowers-packets.ts settings.ts agents/sp-recon.md agents/sp-research.md agents/sp-implementer.md agents/sp-spec-review.md agents/sp-code-review.md agents/sp-debug.md agents/sp-task-loop.chain.md agent-templates.ts test/integration/superpowers-packets.test.ts test/unit/agent-frontmatter.test.ts
git commit -m "feat: add superpowers role library and packet conventions"
```

### Task 4: Align Worktree And Parallel Behavior For The Command Path Only

**Files:**
- Modify: `worktree.ts`
- Modify: `subagent-executor.ts`
- Test: `test/unit/worktree.test.ts`

- [ ] **Step 1: Add a failing worktree test for configured command-scoped roots**

```ts
it("createWorktrees uses a configured project-local worktree root when provided", () => {
	const repoDir = createRepo("pi-worktree-configured-root-");
	let setup: WorktreeSetup | undefined;
	try {
		fs.mkdirSync(path.join(repoDir, ".worktrees"), { recursive: true });
		fs.writeFileSync(path.join(repoDir, ".gitignore"), ".worktrees/\nnode_modules/\n", "utf-8");
		git(repoDir, ["add", ".gitignore"]);
		git(repoDir, ["commit", "-m", "ignore worktrees"]);

		setup = createWorktrees(repoDir, "configured", 1, {
			rootDir: path.join(repoDir, ".worktrees"),
			requireIgnoredRoot: true,
		});
		assert.match(setup.worktrees[0]!.path, /\.worktrees/);
	} finally {
		if (setup) cleanupWorktrees(setup);
		cleanupRepo(repoDir);
	}
});
```

- [ ] **Step 2: Run the worktree unit test and verify it fails**

Run:

```bash
node --experimental-strip-types --test test/unit/worktree.test.ts
```

Expected:
- FAIL because `rootDir` / `requireIgnoredRoot` are not supported yet

- [ ] **Step 3: Extend `worktree.ts` with explicit root-dir and ignore checks**

```ts
export interface CreateWorktreesOptions {
	agents?: string[];
	setupHook?: WorktreeSetupHookConfig;
	rootDir?: string;
	requireIgnoredRoot?: boolean;
}

function assertProjectLocalRootIgnored(repoRoot: string, rootDir: string): void {
	const relativeRoot = path.relative(repoRoot, rootDir);
	if (!relativeRoot || relativeRoot.startsWith("..")) return;
	const result = runGit(repoRoot, ["check-ignore", "-q", relativeRoot]);
	if (result.status !== 0) {
		throw new Error(`Configured worktree root must be ignored by git: ${relativeRoot}`);
	}
}
```

- [ ] **Step 4: Only apply the configured worktree root when `workflow === "superpowers"`**

```ts
const superpowersRoot =
	params.workflow === "superpowers"
		? deps.config.superpowers?.worktreeRoot
		: undefined;
```

Then pass that into worktree setup:

```ts
createWorktrees(repoDir, runId, taskCount, {
	rootDir: superpowersRoot,
	requireIgnoredRoot: Boolean(superpowersRoot),
	agents,
	setupHook,
});
```

- [ ] **Step 5: Re-run the worktree tests**

Run:

```bash
node --experimental-strip-types --test test/unit/worktree.test.ts
```

Expected:
- all worktree tests pass

- [ ] **Step 6: Commit**

```bash
git add worktree.ts subagent-executor.ts test/unit/worktree.test.ts
git commit -m "feat: scope superpowers worktree behavior to command runs"
```

### Task 5: Document Command Usage, Implementer Modes, And Overlays

**Files:**
- Modify: `README.md`
- Modify: `schemas.ts`
- Test: `test/unit/schemas.test.ts`
- Test: `test/integration/slash-commands.test.ts`
- Test: `test/unit/superpowers-policy.test.ts`
- Test: `test/integration/superpowers-packets.test.ts`

- [ ] **Step 1: Add README documentation for the new command**

Add a section like:

```md
## Superpowers Command

Use `/superpowers` when you want the stricter Superpowers workflow for a run.

Examples:

```text
/superpowers fix the auth regression
/superpowers tdd implement the cache invalidation task
/superpowers direct update the Expo config
```

Behavior:

- the baseline `pi` harness plus generic `pi-subagents` behavior stays unchanged unless this command is used
- `tdd` is the default implementer mode
- `direct` keeps the same review and verification loop but allows code-first implementation
```

- [ ] **Step 2: Document role-based overlay config in `README.md`**

```json
{
  "superpowers": {
    "commandName": "superpowers",
    "defaultImplementerMode": "tdd",
    "modelTiers": {
      "cheap": "openai/gpt-5.3-mini",
      "standard": "openai/gpt-5.3-codex",
      "strong": "openai/gpt-5.4",
      "max": "anthropic/claude-opus-4-6"
    },
    "roleSkillOverlays": {
      "root-planning": ["vercel-react-native-skills"],
      "sp-implementer": ["vercel-react-native-skills"],
      "sp-spec-review": ["vercel-react-native-skills"],
      "sp-code-review": ["vercel-react-native-skills"],
      "sp-debug": ["vercel-react-native-skills"]
    }
  }
}
```

- [ ] **Step 3: Add a schema assertion that descriptions mention explicit command activation**

```ts
it("describes workflow as command-scoped superpowers behavior", () => {
	const workflowSchema = SubagentParams?.properties?.workflow;
	assert.ok(workflowSchema, "workflow schema should exist");
	assert.match(String(workflowSchema.description ?? ""), /superpowers/i);
	assert.match(String(workflowSchema.description ?? ""), /default/i);
});
```

- [ ] **Step 4: Run the focused regression set**

Run:

```bash
node --experimental-strip-types --test test/unit/schemas.test.ts test/unit/superpowers-policy.test.ts test/unit/agent-frontmatter.test.ts test/unit/worktree.test.ts
node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/slash-commands.test.ts test/integration/template-resolution.test.ts test/integration/superpowers-packets.test.ts
```

Expected:
- all targeted tests pass

- [ ] **Step 5: Run the full test suite**

Run:

```bash
npm run test:all
```

Expected:
- unit, integration, and e2e suites all pass

- [ ] **Step 6: Commit**

```bash
git add README.md schemas.ts test/unit/schemas.test.ts test/unit/superpowers-policy.test.ts test/integration/slash-commands.test.ts test/integration/superpowers-packets.test.ts test/unit/worktree.test.ts test/unit/agent-frontmatter.test.ts
git commit -m "docs: document explicit superpowers command workflow"
```

## Self-Review Notes

### Spec coverage

- Explicit command activation instead of ambient mode: covered by Tasks 1 and 5
- Default harness unchanged when command is not used: covered by Tasks 1 and 2
- TDD vs non-TDD as implementer-mode choice: covered by Tasks 1 and 2
- Project-specific role overlays like `vercel-react-native-skills`: covered by Tasks 2 and 5
- Temporary task packets instead of canonical `context.md` / `plan.md` / `progress.md`: covered by Task 3
- Superpowers-compatible worktree behavior only on command runs: covered by Task 4
- Built-in `sp-*` roles and canonical task loop: covered by Task 3
- Regression coverage and docs: covered by Task 5

### Placeholder scan

- No `TODO`, `TBD`, or “implement later” markers remain.
- Every task names exact files.
- Every verification step includes an explicit command.

### Type consistency

- Run activation consistently uses `workflow`
- Implementer behavior consistently uses `implementerMode`
- Project settings consistently hang under `superpowers`
