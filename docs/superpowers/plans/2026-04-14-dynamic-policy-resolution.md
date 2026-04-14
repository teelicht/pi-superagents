# Dynamic Policy Resolution: Eliminate Hardcoded Role/Skill/Tool Maps

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace three hardcoded maps in `superpowers-policy.ts` with runtime-derived values from skill metadata and agent frontmatter, so that adding a new agent or skill never requires editing policy code.

**Architecture:** Skill SKILL.md files gain an optional `scope: root` frontmatter field. The skill discovery pipeline exposes this metadata. `resolveRoleSkillSet` reads `scope` at runtime instead of checking a hardcoded set. `NON_DELEGATING_ROLE_TOOLS` is replaced by a single `READ_ONLY_TOOLS` fallback constant, since agent frontmatter already carries per-role tool lists. `inferExecutionRole` derives from the `sp-` prefix convention instead of a switch statement. `DELEGATION_TOOLS` moves to a shared `tool-registry.ts`.

**Tech Stack:** TypeScript, Vitest, Node.js

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/shared/tool-registry.ts` | **New.** Shared constants: `DELEGATION_TOOLS`, `READ_ONLY_TOOLS` |
| `src/shared/types.ts` | Add `scope` field to `CachedSkillEntry`-equivalent type |
| `src/shared/skills.ts` | Add `scope` to `CachedSkillEntry`, expose root-skill detection |
| `src/execution/superpowers-policy.ts` | Remove hardcoded maps, simplify `inferExecutionRole`, use skill metadata |
| `src/execution/execution.ts` | Update import (DELEGATION_TOOLS moves to tool-registry) |
| ~11 skill `SKILL.md` files | Add `scope: root` frontmatter |
| `test/unit/superpowers-policy.test.ts` | Update tests for scope-based filtering, remove hardcoded-set tests |
| `test/unit/tool-registry.test.ts` | **New.** Test shared constants |

---

### Task 1: Create `src/shared/tool-registry.ts` with shared constants

**Files:**
- Create: `src/shared/tool-registry.ts`
- Test: `test/unit/tool-registry.test.ts`

- [x] **Step 1: Write the failing test**

```ts
// test/unit/tool-registry.test.ts
/**
 * Unit tests for shared tool registry constants.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DELEGATION_TOOLS, READ_ONLY_TOOLS } from "../../src/shared/tool-registry.ts";

void describe("tool-registry", () => {
	void describe("DELEGATION_TOOLS", () => {
		void it("contains subagent and subagent_status", () => {
			assert.ok(DELEGATION_TOOLS.has("subagent"));
			assert.ok(DELEGATION_TOOLS.has("subagent_status"));
		});

		void it("is a frozen set", () => {
			assert.throws(() => {
				(DELEGATION_TOOLS as Set<string>).add("should-fail");
			});
		});
	});

	void describe("READ_ONLY_TOOLS", () => {
		void it("contains the safe read-only tool baseline", () => {
			assert.deepEqual(READ_ONLY_TOOLS, ["read", "grep", "find", "ls"]);
		});

		void it("is a frozen array", () => {
			assert.throws(() => {
				(READ_ONLY_TOOLS as string[]).push("should-fail");
			});
		});
	});
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/tool-registry.test.ts`
Expected: FAIL — module not found

- [x] **Step 3: Create `src/shared/tool-registry.ts`**

```ts
/**
 * Shared tool registry constants for subagent policy enforcement.
 *
 * Responsibilities:
 * - define delegation tool names stripped from bounded role tool lists
 * - define the safe read-only tool baseline used for agents without explicit tool declarations
 *
 * These constants are consumed by superpowers-policy and any future
 * policy modules that need to reason about tool access.
 */

/** Tool names that enable agent delegation — stripped from bounded role tool lists. */
export const DELEGATION_TOOLS: ReadonlySet<string> = Object.freeze(
	new Set(["subagent", "subagent_status"]),
);

/**
 * Safe read-only tool baseline for bounded agents that declare no tools.
 *
 * This is a conservative fallback: agents that specify tools in their
 * frontmatter use those lists directly. This baseline only applies when
 * a bounded agent has no tool declaration at all.
 */
export const READ_ONLY_TOOLS: ReadonlyArray<string> = Object.freeze(
	["read", "grep", "find", "ls"],
);
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/tool-registry.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/shared/tool-registry.ts test/unit/tool-registry.test.ts
git commit -m "feat: add shared tool-registry constants for policy enforcement"
```

---

### Task 2: Add `scope` to skill metadata pipeline

**Files:**
- Modify: `src/shared/skills.ts`
- Modify: `src/agents/frontmatter.ts`

- [x] **Step 1: Add `scope` parsing to `parseFrontmatter`**

The frontmatter parser already returns `Record<string, string>`. It does not need changes — `scope` is just another string field. Skip this step; no changes needed.

- [x] **Step 2: Add `scope` to `CachedSkillEntry` in `src/shared/skills.ts`**

Add a `scope` field to `CachedSkillEntry`:

```ts
interface CachedSkillEntry {
	name: string;
	filePath: string;
	source: SkillSource;
	description?: string;
	order: number;
	scope?: "root" | "agent";
}
```

Update `getCachedSkills` to extract `scope` from the skill's frontmatter. The `loadSkills` function from `@mariozechner/pi-coding-agent` returns skill objects. We need to check what properties they carry:

Run: `grep -r "scope" node_modules/@mariozechner/pi-coding-agent --include="*.d.ts" -l` to find the Skill type.

If the pi SDK `loadSkills` result doesn't carry `scope`, we'll parse it ourselves from the skill file's frontmatter using our existing `parseFrontmatter` function.

- [x] **Step 3: Read the skill file's frontmatter to extract `scope`**

In `getCachedSkills`, after loading each skill, read its file and parse the frontmatter to get `scope`:

```ts
import { parseFrontmatter } from "../agents/frontmatter.ts";

// Inside getCachedSkills, after building the entry:
// Read the skill file for scope metadata
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
```

- [x] **Step 4: Add `getRootOnlySkillNames` export**

```ts
/**
 * Return the set of skill names that are scoped as root-only
 * (must not be delegated to bounded roles).
 */
export function getRootOnlySkillNames(cwd: string): Set<string> {
	const skills = getCachedSkills(cwd);
	return new Set(
		skills
			.filter((s) => s.scope === "root")
			.map((s) => s.name),
	);
}
```

- [x] **Step 5: Run existing tests to verify nothing breaks**

Run: `npx vitest run test/unit/superpowers-skill-entry.test.ts`
Expected: PASS (no changes to existing behavior yet)

- [x] **Step 6: Commit**

```bash
git add src/shared/skills.ts
git commit -m "feat: add scope metadata to skill discovery pipeline"
```

---

### Task 3: Add `scope: root` to root-only skill SKILL.md files

**Files:**
- Modify: 11 skill SKILL.md files

The following skills are currently in `ROOT_ONLY_WORKFLOW_SKILLS` and need `scope: root`:

1. `~/.pi/agent/skills/using-superpowers/SKILL.md`
2. `~/.pi/agent/skills/brainstorming/SKILL.md`
3. `~/.pi/agent/skills/writing-plans/SKILL.md`
4. `~/.pi/agent/skills/requesting-code-review/SKILL.md`
5. `~/.pi/agent/skills/receiving-code-review/SKILL.md`
6. `~/.pi/agent/skills/subagent-driven-development/SKILL.md`
7. `~/.pi/agent/skills/executing-plans/SKILL.md`
8. `~/.pi/agent/skills/verification-before-completion/SKILL.md`
9. `~/.pi/agent/skills/using-git-worktrees/SKILL.md`
10. `~/.pi/agent/skills/dispatching-parallel-agents/SKILL.md`
11. `~/.pi/agent/skills/finishing-a-development-branch/SKILL.md`

- [x] **Step 1: Add `scope: root` to each skill's frontmatter**

For each file, add `scope: root` after the `description` line in the YAML frontmatter. Example:

```yaml
---
name: brainstorming
description: "You MUST use this before any creative work..."
scope: root
---
```

Repeat for all 11 files.

- [x] **Step 2: Verify scope is discoverable**

Run a quick check:
```bash
for f in ~/.pi/agent/skills/*/SKILL.md; do
  name=$(head -5 "$f" | grep "^name:" | sed 's/name: //')
  scope=$(head -10 "$f" | grep "^scope:" | sed 's/scope: //')
  echo "$name: scope=${scope:-agent}"
done
```

Expected: All 11 root skills show `scope=root`, all other skills show `scope=agent` (default).

- [x] **Step 3: Commit**

```bash
git add -u
git commit -m "feat: add scope: root to orchestration-only skill frontmatter"
```

---

### Task 4: Refactor `superpowers-policy.ts` — remove hardcoded maps

**Files:**
- Modify: `src/execution/superpowers-policy.ts`
- Modify: `test/unit/superpowers-policy.test.ts`

- [x] **Step 1: Write failing tests for the new behavior**

Add these tests to `test/unit/superpowers-policy.test.ts`:

```ts
void it("rejects root-scoped skills for bounded roles", () => {
	// This test will fail until resolveRoleSkillSet reads scope from availableSkills
	assert.throws(() => {
		resolveRoleSkillSet({
			workflow: "superpowers",
			role: "sp-recon",
			config: {},
			agentSkills: [],
			stepSkills: ["brainstorming"],
			availableSkills: new Set(["brainstorming"]),
			rootOnlySkills: new Set(["brainstorming"]),
		});
	}, /cannot receive root-only workflow skill/);
});

void it("allows root-scoped skills for root-planning role", () => {
	const skills = resolveRoleSkillSet({
		workflow: "superpowers",
		role: "root-planning",
		config: {},
		agentSkills: ["brainstorming"],
		stepSkills: [],
		availableSkills: new Set(["brainstorming"]),
		rootOnlySkills: new Set(["brainstorming"]),
	});
	assert.deepEqual(skills, ["brainstorming"]);
});

void it("falls back to READ_ONLY_TOOLS for bounded agents without frontmatter tools", () => {
	assert.deepEqual(
		resolveRoleTools({
			workflow: "superpowers",
			role: "sp-recon",
			agentTools: undefined,
		}),
		["read", "grep", "find", "ls"],
	);
});

void it("does not fall back to per-role hardcoded maps", () => {
	// Previously sp-implementer had a hardcoded ["read","grep","find","ls","bash","write"]
	// With frontmatter, agentTools comes from the agent and the fallback is just READ_ONLY_TOOLS
	assert.deepEqual(
		resolveRoleTools({
			workflow: "superpowers",
			role: "sp-implementer",
			agentTools: ["read", "grep", "find", "ls", "bash", "write"],
		}),
		["read", "grep", "find", "ls", "bash", "write"],
	);
});

void it("infers sp-roles from sp- prefix", () => {
	assert.equal(inferExecutionRole("sp-recon"), "sp-recon");
	assert.equal(inferExecutionRole("sp-unknown-role"), "sp-unknown-role");
	assert.equal(inferExecutionRole("root"), "root-planning");
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/superpowers-policy.test.ts`
Expected: FAIL — `rootOnlySkills` parameter doesn't exist yet

- [x] **Step 3: Refactor `resolveRoleSkillSet` to accept `rootOnlySkills`**

Replace the internal `ROOT_ONLY_WORKFLOW_SKILLS` constant usage with an explicit `rootOnlySkills` parameter:

```ts
export function resolveRoleSkillSet(input: {
	workflow: WorkflowMode;
	role: ExecutionRole;
	config: ExtensionConfig;
	agentSkills: string[];
	stepSkills: string[];
	availableSkills: ReadonlySet<string>;
	rootOnlySkills?: ReadonlySet<string>;
}): string[] {
	if (input.workflow !== "superpowers") {
		return [...new Set([...input.agentSkills, ...input.stepSkills])];
	}

	const rootOnly = input.rootOnlySkills ?? new Set();
	const merged = [...new Set([...input.agentSkills, ...input.stepSkills])];
	for (const skill of merged) {
		if (!input.availableSkills.has(skill)) {
			throw new Error(`Unknown skill: ${skill}`);
		}
		if (input.role !== "root-planning" && rootOnly.has(skill)) {
			throw new Error(`Role ${input.role} cannot receive root-only workflow skill '${skill}'`);
		}
	}
	return merged;
}
```

- [x] **Step 4: Refactor `resolveRoleTools` to use shared constants**

Replace `NON_DELEGATING_ROLE_TOOLS` and `DELEGATION_TOOLS`:

```ts
import { DELEGATION_TOOLS, READ_ONLY_TOOLS } from "../shared/tool-registry.ts";

export function resolveRoleTools(input: {
	workflow: WorkflowMode;
	role: ExecutionRole;
	agentTools?: string[];
}): string[] | undefined {
	if (input.workflow !== "superpowers" || input.role === "root-planning") {
		return input.agentTools;
	}

	const explicitTools = input.agentTools?.filter((tool) => !DELEGATION_TOOLS.has(tool));
	if (explicitTools && explicitTools.length > 0) return explicitTools;
	// Safe read-only default for agents without explicit tool declarations
	return [...READ_ONLY_TOOLS];
}
```

- [x] **Step 5: Simplify `inferExecutionRole`**

```ts
export function inferExecutionRole(agentName: string): ExecutionRole {
	if (agentName.startsWith("sp-")) return agentName as ExecutionRole;
	return "root-planning";
}
```

- [x] **Step 6: Remove the three hardcoded maps**

Delete from `superpowers-policy.ts`:
- `ROOT_ONLY_WORKFLOW_SKILLS`
- `NON_DELEGATING_ROLE_TOOLS`
- `DELEGATION_TOOLS`

- [x] **Step 7: Update `resolveImplementerSkillSet` to pass `rootOnlySkills`**

```ts
export function resolveImplementerSkillSet(input: {
	workflow: WorkflowMode;
	useTestDrivenDevelopment: boolean;
	config: ExtensionConfig;
	agentSkills: string[];
	stepSkills: string[];
	availableSkills: ReadonlySet<string>;
	rootOnlySkills?: ReadonlySet<string>;
}): string[] {
	const base = resolveRoleSkillSet({
		workflow: input.workflow,
		role: "sp-implementer",
		config: input.config,
		agentSkills: input.agentSkills,
		stepSkills: input.stepSkills,
		availableSkills: input.availableSkills,
		rootOnlySkills: input.rootOnlySkills,
	});
	if (input.workflow !== "superpowers" || !input.useTestDrivenDevelopment) return base;
	if (!input.availableSkills.has("test-driven-development")) return base;
	return [...new Set([...base, "test-driven-development"])];
}
```

- [x] **Step 8: Update callers in `src/shared/skills.ts`**

In `resolveExecutionSkills`, pass `rootOnlySkills` from skill metadata:

```ts
import { getRootOnlySkillNames } from "./skills.ts"; // self-referential since this IS in skills.ts

// Inside resolveExecutionSkills:
const rootOnlySkills = getRootOnlySkillNames(input.cwd);
const skillNames = input.role === "sp-implementer"
	? resolveImplementerSkillSet({
		// ... existing fields ...
		rootOnlySkills,
	})
	: resolveRoleSkillSet({
		// ... existing fields ...
		rootOnlySkills,
	});
```

- [x] **Step 9: Run tests to verify they pass**

Run: `npx vitest run test/unit/superpowers-policy.test.ts test/unit/superpowers-skill-entry.test.ts`
Expected: PASS

- [x] **Step 10: Commit**

```bash
git add src/execution/superpowers-policy.ts src/shared/skills.ts test/unit/superpowers-policy.test.ts
git commit -m "refactor: replace hardcoded policy maps with runtime-derived values"
```

---

### Task 5: Update existing tests for new `resolveRoleTools` behavior

**Files:**
- Modify: `test/unit/superpowers-policy.test.ts`

- [x] **Step 1: Update the "non-delegating default tool set" test**

The existing test checks for `["read", "grep", "find", "ls"]` which matches `READ_ONLY_TOOLS`. Verify it still passes with the refactored code (it should, since `sp-recon` with no `agentTools` falls back to `READ_ONLY_TOOLS`):

```ts
void it("assigns a read-only default tool set to bounded superpowers roles without frontmatter tools", () => {
	assert.deepEqual(
		resolveRoleTools({
			workflow: "superpowers",
			role: "sp-recon",
		}),
		["read", "grep", "find", "ls"],
	);
});
```

- [x] **Step 2: Update the "strips subagent tools" test to import from tool-registry**

The test should still pass since we re-export `DELEGATION_TOOLS` from `tool-registry.ts`. Verify imports are updated.

- [x] **Step 3: Run all policy tests**

Run: `npx vitest run test/unit/superpowers-policy.test.ts`
Expected: PASS

- [x] **Step 4: Commit**

```bash
git add test/unit/superpowers-policy.test.ts
git commit -m "test: update policy tests for dynamic resolution"
```

---

### Task 6: Run full test suite and verify no regressions

**Files:**
- No changes — verification only

- [x] **Step 1: Run the full unit test suite**

Run: `npx vitest run test/unit/`
Expected: ALL PASS

- [x] **Step 2: Run the full integration test suite**

Run: `npx vitest run test/integration/`
Expected: ALL PASS (or pre-existing failures if any)

- [x] **Step 3: Verify agent frontmatter still works end-to-end**

Manually check that `resolveRoleTools` returns the correct tools for each built-in agent by running:

```bash
npx vitest run test/unit/superpowers-policy.test.ts -t "strips subagent tools"
npx vitest run test/unit/superpowers-policy.test.ts -t "assigns"
```

Expected: Both tests pass

- [x] **Step 4: Final commit if any test fixes needed**

```bash
git add -u
git commit -m "fix: any regression fixes from dynamic policy refactor"
```

---

### Task 7: Update user documentation

**Files:**
- Modify: `docs/reference/skills.md`
- Modify: `docs/guides/superpowers.md`
- Modify: `README.md` (if it references the hardcoded maps)

- [x] **Step 1: Add `scope` field documentation to `docs/reference/skills.md`**

Add a note that skills can declare `scope: root` in their frontmatter to restrict them to root-planning agents:

```markdown
### Skill frontmatter

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique skill identifier |
| `description` | Yes | Short description of when to use the skill |
| `scope` | No | `root` for orchestration-only skills, `agent` (default) for skills available to all roles |
```

- [x] **Step 2: Update `docs/guides/superpowers.md`** if it references the policy enforcement mechanism

Check for any mention of "root-only skills" or hardcoded skill lists and update to reflect that skill scoping is now metadata-driven.

- [x] **Step 3: Commit**

```bash
git add docs/reference/skills.md docs/guides/superpowers.md README.md
git commit -m "docs: document scope: root skill metadata field"
```