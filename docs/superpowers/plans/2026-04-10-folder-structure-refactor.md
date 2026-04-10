# Folder Structure Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize `pi-superagents` into a domain-oriented `src/` layout, keep package metadata aligned with the new file tree, and preserve both npm-package and local-install workflows.

**Architecture:** The refactor keeps runtime behavior unchanged and moves code by responsibility into `src/extension`, `src/agents`, `src/execution`, `src/slash`, `src/ui`, and `src/shared`. Packaging remains explicit through `package.json`, with tests updated to validate the new entrypoint and package file layout.

**Tech Stack:** TypeScript, Node.js test runner, npm packaging, Pi extension manifest

---

## File Structure

### Files to Create

- `src/extension/index.ts`
- `src/extension/notify.ts`
- `src/agents/agents.ts`
- `src/agents/agent-management.ts`
- `src/agents/agent-manager.ts`
- `src/agents/agent-manager-chain-detail.ts`
- `src/agents/agent-manager-detail.ts`
- `src/agents/agent-manager-edit.ts`
- `src/agents/agent-manager-list.ts`
- `src/agents/agent-manager-parallel.ts`
- `src/agents/agent-scope.ts`
- `src/agents/agent-selection.ts`
- `src/agents/agent-serializer.ts`
- `src/agents/agent-templates.ts`
- `src/agents/chain-serializer.ts`
- `src/agents/frontmatter.ts`
- `src/execution/async-execution.ts`
- `src/execution/execution.ts`
- `src/execution/chain-execution.ts`
- `src/execution/subagent-executor.ts`
- `src/execution/subagent-runner.ts`
- `src/execution/parallel-utils.ts`
- `src/execution/fork-context.ts`
- `src/execution/single-output.ts`
- `src/execution/pi-args.ts`
- `src/execution/pi-spawn.ts`
- `src/execution/run-history.ts`
- `src/execution/settings.ts`
- `src/execution/superagents-config.ts`
- `src/execution/superpowers-packets.ts`
- `src/execution/superpowers-policy.ts`
- `src/execution/worktree.ts`
- `src/slash/prompt-template-bridge.ts`
- `src/slash/slash-bridge.ts`
- `src/slash/slash-commands.ts`
- `src/slash/slash-live-state.ts`
- `src/ui/async-job-tracker.ts`
- `src/ui/async-status.ts`
- `src/ui/chain-clarify.ts`
- `src/ui/completion-dedupe.ts`
- `src/ui/file-coalescer.ts`
- `src/ui/render.ts`
- `src/ui/render-helpers.ts`
- `src/ui/result-watcher.ts`
- `src/ui/subagents-status.ts`
- `src/ui/text-editor.ts`
- `src/shared/artifacts.ts`
- `src/shared/formatters.ts`
- `src/shared/schemas.ts`
- `src/shared/skills.ts`
- `src/shared/types.ts`
- `src/shared/utils.ts`
- `test/unit/package-manifest.test.ts`
- `test/unit/path-resolution.test.ts`

### Files to Modify

- `package.json`
- `scripts/local-extension-install.ts`
- `test/unit/local-extension-install.test.ts`
- `test/e2e/e2e-sandbox-install.test.ts`

### Files to Delete

- `index.ts`
- `notify.ts`
- `agent-management.ts`
- `agent-manager.ts`
- `agent-manager-chain-detail.ts`
- `agent-manager-detail.ts`
- `agent-manager-edit.ts`
- `agent-manager-list.ts`
- `agent-manager-parallel.ts`
- `agent-scope.ts`
- `agent-selection.ts`
- `agent-serializer.ts`
- `agent-templates.ts`
- `agents.ts`
- `chain-serializer.ts`
- `frontmatter.ts`
- `async-execution.ts`
- `execution.ts`
- `chain-execution.ts`
- `subagent-executor.ts`
- `subagent-runner.ts`
- `parallel-utils.ts`
- `fork-context.ts`
- `single-output.ts`
- `pi-args.ts`
- `pi-spawn.ts`
- `run-history.ts`
- `settings.ts`
- `superagents-config.ts`
- `superpowers-packets.ts`
- `superpowers-policy.ts`
- `worktree.ts`
- `prompt-template-bridge.ts`
- `slash-bridge.ts`
- `slash-commands.ts`
- `slash-live-state.ts`
- `async-job-tracker.ts`
- `async-status.ts`
- `chain-clarify.ts`
- `completion-dedupe.ts`
- `file-coalescer.ts`
- `render.ts`
- `render-helpers.ts`
- `result-watcher.ts`
- `subagents-status.ts`
- `text-editor.ts`
- `artifacts.ts`
- `formatters.ts`
- `schemas.ts`
- `skills.ts`
- `types.ts`
- `utils.ts`
- `path-resolution.test.ts`

## Task 1: Lock the new package contract with failing tests

**Files:**
- Create: `test/unit/package-manifest.test.ts`
- Modify: `test/unit/local-extension-install.test.ts`
- Modify: `test/e2e/e2e-sandbox-install.test.ts`
- Create: `test/unit/path-resolution.test.ts`
- Delete: `path-resolution.test.ts`

- [ ] **Step 1: Write the failing manifest contract test**

```ts
/**
 * Unit coverage for the published package manifest.
 *
 * Responsibilities:
 * - verify Pi entrypoints point at the new `src/extension` files
 * - verify npm package publishing includes the directory-based layout
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";

/**
 * Read and parse the repository package manifest.
 *
 * @returns Parsed `package.json` contents.
 */
function readPackageJson(): Record<string, unknown> {
	const packagePath = path.resolve("package.json");
	return JSON.parse(fs.readFileSync(packagePath, "utf-8")) as Record<string, unknown>;
}

describe("package.json manifest", () => {
	it("publishes the src-based Pi extension entrypoints and files", () => {
		const packageJson = readPackageJson();
		assert.deepEqual(packageJson.pi, {
			extensions: ["./src/extension/index.ts", "./src/extension/notify.ts"],
		});
		assert.deepEqual(packageJson.files, [
			"src/",
			"scripts/",
			"agents/",
			"default-config.json",
			"*.mjs",
			"README.md",
			"CHANGELOG.md",
		]);
	});
});
```

- [ ] **Step 2: Update the local installer unit test to expect `src/` entrypoints**

```ts
fs.mkdirSync(path.join(sourceRoot, "src", "extension"), { recursive: true });
fs.writeFileSync(path.join(sourceRoot, "src", "extension", "index.ts"), "export default {};\n", "utf-8");
fs.writeFileSync(path.join(sourceRoot, "src", "extension", "notify.ts"), "export default {};\n", "utf-8");

const copied = installLocalExtensionFiles({
	sourceRoot,
	targetRoot,
	relativePaths: [
		"src/extension/index.ts",
		"src/extension/notify.ts",
		"package.json",
		"README.md",
		"agents/worker.md",
	],
});

assert.deepEqual(copied, [
	"README.md",
	"agents/worker.md",
	"package.json",
	"src/extension/index.ts",
	"src/extension/notify.ts",
]);
```

- [ ] **Step 3: Move the stray path-resolution test into `test/unit/` and update imports**

```ts
import { discoverAgents, discoverAgentsAll } from "../../src/agents/agents.js";
import { resolveSkillPath, clearSkillCache, discoverAvailableSkills } from "../../src/shared/skills.js";
```

- [ ] **Step 4: Run the focused red-phase tests**

Run:

```bash
node --experimental-strip-types --test test/unit/package-manifest.test.ts test/unit/local-extension-install.test.ts test/unit/path-resolution.test.ts
```

Expected:

```text
FAIL test/unit/package-manifest.test.ts
FAIL test/unit/local-extension-install.test.ts
FAIL test/unit/path-resolution.test.ts
```

- [ ] **Step 5: Commit the red-phase test changes**

```bash
git add test/unit/package-manifest.test.ts test/unit/local-extension-install.test.ts test/unit/path-resolution.test.ts path-resolution.test.ts test/e2e/e2e-sandbox-install.test.ts
git commit -m "test: lock src-based package layout"
```

## Task 2: Move shared and agent-domain modules into `src/`

**Files:**
- Create: `src/shared/*.ts`
- Create: `src/agents/*.ts`
- Delete: root-level shared and agent modules
- Modify: imports in moved files
- Modify: tests that import `agents`, `skills`, or agent serializers

- [ ] **Step 1: Move the shared and agent files into the new directories**

```bash
mkdir -p src/shared src/agents
git mv artifacts.ts formatters.ts schemas.ts skills.ts types.ts utils.ts src/shared/
git mv agent-management.ts agent-manager.ts agent-manager-chain-detail.ts agent-manager-detail.ts agent-manager-edit.ts agent-manager-list.ts agent-manager-parallel.ts agent-scope.ts agent-selection.ts agent-serializer.ts agent-templates.ts agents.ts chain-serializer.ts frontmatter.ts src/agents/
```

- [ ] **Step 2: Rewrite relative imports inside the moved files**

```ts
// Example: src/agents/agents.ts
import { KNOWN_FIELDS } from "./agent-serializer.ts";
import { parseChain } from "./chain-serializer.ts";
import { mergeAgentsForScope } from "./agent-selection.ts";
import { parseFrontmatter } from "./frontmatter.ts";

// Example: src/agents/agent-management.ts
import { serializeAgent } from "./agent-serializer.ts";
import { serializeChain } from "./chain-serializer.ts";
import { discoverAvailableSkills } from "../shared/skills.ts";
import type { Details } from "../shared/types.ts";
```

- [ ] **Step 3: Update tests to import the new module paths**

```ts
import { mergeAgentsForScope } from "../../src/agents/agent-selection.ts";
import { serializeAgent, updateFrontmatterField } from "../../src/agents/agent-serializer.ts";
import { discoverAgents, type AgentConfig } from "../../src/agents/agents.ts";
import { DEFAULT_FORK_PREAMBLE, wrapForkTask } from "../../src/shared/types.ts";
```

- [ ] **Step 4: Run the affected unit tests and make them pass**

Run:

```bash
node --experimental-strip-types --test \
  test/unit/agent-selection.test.ts \
  test/unit/agent-frontmatter.test.ts \
  test/unit/types-fork-preamble.test.ts \
  test/unit/package-manifest.test.ts \
  test/unit/path-resolution.test.ts
```

Expected:

```text
# pass 5
# fail 0
```

- [ ] **Step 5: Commit the shared/agent move**

```bash
git add src/shared src/agents test/unit
git commit -m "refactor: move shared and agent modules into src"
```

## Task 3: Move execution, slash, and UI modules into `src/`

**Files:**
- Create: `src/execution/*.ts`
- Create: `src/slash/*.ts`
- Create: `src/ui/*.ts`
- Delete: root-level execution, slash, and UI modules
- Modify: imports across runtime files and tests

- [ ] **Step 1: Move the runtime files into their domain directories**

```bash
mkdir -p src/execution src/slash src/ui
git mv async-execution.ts execution.ts chain-execution.ts subagent-executor.ts subagent-runner.ts parallel-utils.ts fork-context.ts single-output.ts pi-args.ts pi-spawn.ts run-history.ts settings.ts superagents-config.ts superpowers-packets.ts superpowers-policy.ts worktree.ts src/execution/
git mv prompt-template-bridge.ts slash-bridge.ts slash-commands.ts slash-live-state.ts src/slash/
git mv async-job-tracker.ts async-status.ts chain-clarify.ts completion-dedupe.ts file-coalescer.ts render.ts render-helpers.ts result-watcher.ts subagents-status.ts text-editor.ts src/ui/
```

- [ ] **Step 2: Rewrite imports to point at the new folders**

```ts
// Example: src/execution/subagent-executor.ts
import { type AgentConfig, type AgentScope } from "../agents/agents.js";
import { getArtifactsDir } from "../shared/artifacts.js";
import { ChainClarifyComponent, type ChainClarifyResult, type ModelInfo } from "../ui/chain-clarify.js";
import { discoverAvailableSkills, normalizeSkillInput } from "../shared/skills.js";
import { getSingleResultOutput, mapConcurrent } from "../shared/utils.js";

// Example: src/ui/async-status.ts
import { formatDuration, formatTokens, shortenPath } from "../shared/formatters.js";
import { type AsyncStatus, type TokenUsage } from "../shared/types.js";
import { readStatus } from "../shared/utils.js";
```

- [ ] **Step 3: Update integration and unit tests that touch runtime modules**

```ts
import { formatAsyncRunList, listAsyncRuns, listAsyncRunsForOverlay } from "../../src/ui/async-status.ts";
import { createResultWatcher } from "../../src/ui/result-watcher.ts";
import { createForkContextResolver, resolveSubagentContext } from "../../src/execution/fork-context.ts";
import { buildPiArgs } from "../../src/execution/pi-args.ts";
import { buildSuperpowersPacketPlan } from "../../src/execution/superpowers-packets.ts";
```

- [ ] **Step 4: Run the focused runtime test set and make it pass**

Run:

```bash
node --experimental-transform-types --import ./test/support/register-loader.mjs --test \
  test/unit/pi-args.test.ts \
  test/unit/fork-context.test.ts \
  test/unit/parallel-utils.test.ts \
  test/unit/superpowers-policy.test.ts \
  test/unit/single-output.test.ts \
  test/integration/async-status.test.ts \
  test/integration/result-watcher.test.ts \
  test/integration/superpowers-packets.test.ts
```

Expected:

```text
# pass 8
# fail 0
```

- [ ] **Step 5: Commit the runtime move**

```bash
git add src/execution src/slash src/ui test/unit test/integration
git commit -m "refactor: move runtime modules into src"
```

## Task 4: Move the extension entrypoints and update packaging/install metadata

**Files:**
- Create: `src/extension/index.ts`
- Create: `src/extension/notify.ts`
- Delete: `index.ts`
- Delete: `notify.ts`
- Modify: `package.json`
- Modify: `scripts/local-extension-install.ts` only if path-sensitive assertions need updates
- Modify: packaging-related tests

- [ ] **Step 1: Move the extension entry files**

```bash
mkdir -p src/extension
git mv index.ts notify.ts src/extension/
```

- [ ] **Step 2: Update entrypoint imports and `package.json`**

```json
{
  "files": [
    "src/",
    "scripts/",
    "agents/",
    "default-config.json",
    "*.mjs",
    "README.md",
    "CHANGELOG.md"
  ],
  "pi": {
    "extensions": [
      "./src/extension/index.ts",
      "./src/extension/notify.ts"
    ]
  }
}
```

```ts
// Example: src/extension/index.ts
import { discoverAgents } from "../agents/agents.ts";
import { cleanupAllArtifactDirs, cleanupOldArtifacts, getArtifactsDir } from "../shared/artifacts.ts";
import { cleanupOldChainDirs } from "../execution/settings.ts";
import { renderWidget, renderSubagentResult } from "../ui/render.ts";
```

- [ ] **Step 3: Run the packaging-focused tests and make them pass**

Run:

```bash
node --experimental-strip-types --test \
  test/unit/package-manifest.test.ts \
  test/unit/local-extension-install.test.ts
```

Expected:

```text
# pass 2
# fail 0
```

- [ ] **Step 4: Verify the package contents and local install flow**

Run:

```bash
npm pack --dry-run --json
node --experimental-transform-types ./scripts/local-extension-install.ts --target "$(mktemp -d)"
```

Expected:

```text
"path":"src/extension/index.ts"
"path":"src/extension/notify.ts"
Installed local Pi extension refresh to ...
Copied ...
```

- [ ] **Step 5: Commit the entrypoint and manifest update**

```bash
git add src/extension package.json scripts/local-extension-install.ts test/unit
git commit -m "refactor: publish src-based extension layout"
```

## Task 5: Run full verification and fix any remaining path regressions

**Files:**
- Modify: any remaining test files or import paths needed to restore green

- [ ] **Step 1: Run the full unit suite**

Run:

```bash
npm run test:unit
```

Expected:

```text
# fail 0
```

- [ ] **Step 2: Run the full integration suite**

Run:

```bash
npm run test:integration
```

Expected:

```text
# fail 0
```

- [ ] **Step 3: Run the install-oriented end-to-end verification**

Run:

```bash
npm run test:e2e
```

Expected:

```text
# fail 0
```

- [ ] **Step 4: Run one final package dry-run after all tests pass**

Run:

```bash
npm pack --dry-run --json
```

Expected:

```text
"path":"src/extension/index.ts"
"path":"src/extension/notify.ts"
"path":"scripts/local-extension-install.ts"
```

- [ ] **Step 5: Commit the final verification fixes**

```bash
git add package.json src test
git commit -m "test: verify refactored package layout"
```

## Self-Review

### Spec coverage

- `src/` domain layout: covered by Tasks 2, 3, and 4
- `package.json` representation of the new structure: covered by Tasks 1 and 4
- npm package install compatibility: covered by Tasks 1, 4, and 5
- local install compatibility: covered by Tasks 1 and 4
- moving the stray root test: covered by Task 1

### Placeholder scan

- No `TODO`, `TBD`, or deferred implementation markers remain.
- Every task lists exact files and concrete commands.

### Type consistency

- All new imports reference the `src/...` structure consistently.
- Packaging expectations consistently use `src/extension/index.ts` and `src/extension/notify.ts`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-10-folder-structure-refactor.md`. Two execution options:

1. Subagent-Driven (recommended) - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. Inline Execution - Execute tasks in this session using executing-plans, batch execution with checkpoints

The user already selected Subagent-Driven execution for this refactor, so proceed with `superpowers:subagent-driven-development` after creating the isolated worktree.
