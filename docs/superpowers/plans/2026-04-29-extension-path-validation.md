# Extension Path Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Report missing configured subagent extension paths clearly before child Pi startup fails.

**Architecture:** Add a small runtime validator in `src/execution/superagents-config.ts` because relative extension paths must resolve against the subagent runtime working directory. Call it from `runSync()` before `buildPiArgs()`, returning a failed `SingleResult` with a source-specific message when a configured global or agent extension is missing. Update docs to document resolution and failure behavior.

**Tech Stack:** TypeScript, Node `fs`/`path`, Node test runner, existing Pi mock integration tests.

---

## Context Map

### Files to Modify
| File | Purpose | Changes Needed |
|------|---------|----------------|
| `src/execution/superagents-config.ts` | Superagents config helpers | Add documented extension path validation helper. |
| `src/execution/execution.ts` | Subagent process launcher | Validate global and agent extensions before spawning Pi; return clear error result. |
| `test/integration/single-execution.test.ts` | RunSync integration tests | Add missing/global/agent and existing combined extension tests. |
| `docs/configuration.md` | Config reference | Document extension path resolution and missing-path failure. |
| `docs/skills.md` | Agent frontmatter reference | Document frontmatter extension path resolution and missing-path failure. |
| `docs/parameters.md` | Tool behavior reference | Mention invalid configured extension paths fail the subagent before spawn. |

### Dependencies
| File | Relationship |
|------|--------------|
| `src/execution/pi-args.ts` | Receives only validated configured extensions; path-like tool extension handling remains unchanged. |
| `src/shared/types.ts` | Provides `SingleResult`, `Usage`, and config types; no new public type required unless useful. |

### Test Files
| Test | Coverage |
|------|----------|
| `test/integration/single-execution.test.ts` | Missing configured extensions and successful pass-through with existing files. |
| `test/unit/superagents-config.test.ts` | Optional unit coverage for pure-ish helper if implementer chooses to expose it. |

### Risk Assessment
- [ ] Breaking changes to public API: no API signature changes expected.
- [ ] Database migrations needed: no.
- [ ] Configuration changes required: no; invalid paths now fail earlier with clearer messages.

---

### Task 1: Runtime Validation and Tests

**Files:**
- Modify: `src/execution/superagents-config.ts`
- Modify: `src/execution/execution.ts`
- Modify: `test/integration/single-execution.test.ts`

- [x] **Step 1: Write failing integration tests**

Add tests near the existing extension tests in `test/integration/single-execution.test.ts`:

```typescript
	void it("fails before spawning when a global subagent extension path is missing", async () => {
		const agents = makeAgentConfigs(["echo"]);

		const result = await runSync(tempDir, agents, "echo", "Task", {
			config: { superagents: { extensions: ["./missing-global-extension.ts"] } },
		});

		assert.equal(result.exitCode, 1);
		assert.equal(mockPi.calls.length, 0);
		assert.match(result.error ?? "", /superagents\.extensions\[0\]/);
		assert.match(result.error ?? "", /missing-global-extension\.ts/);
	});

	void it("fails before spawning when an agent extension path is missing", async () => {
		const agents = [makeAgent("echo", { extensions: ["./missing-agent-extension.ts"] })];

		const result = await runSync(tempDir, agents, "echo", "Task", {});

		assert.equal(result.exitCode, 1);
		assert.equal(mockPi.calls.length, 0);
		assert.match(result.error ?? "", /agent\.extensions\[0\]/);
		assert.match(result.error ?? "", /missing-agent-extension\.ts/);
	});

	void it("passes existing global and agent extensions through in order", async () => {
		const globalExtensionPath = path.join(tempDir, "global-extension.ts");
		const agentExtensionPath = path.join(tempDir, "agent-extension.ts");
		fs.writeFileSync(globalExtensionPath, "export default function () {}\n", "utf-8");
		fs.writeFileSync(agentExtensionPath, "export default function () {}\n", "utf-8");
		mockPi.onCall({ echoArgs: true });
		const agents = [makeAgent("echo", { extensions: [agentExtensionPath] })];

		const result = await runSync(tempDir, agents, "echo", "Task", {
			config: { superagents: { extensions: [globalExtensionPath] } },
		});

		assert.equal(result.exitCode, 0);
		const output = getFinalOutput(result.messages);
		const args = JSON.parse(output) as string[];
		const firstExtension = args.indexOf("--extension");
		const secondExtension = args.indexOf("--extension", firstExtension + 1);
		assert.equal(args[firstExtension + 1], globalExtensionPath);
		assert.equal(args[secondExtension + 1], agentExtensionPath);
	});
```

- [x] **Step 2: Run tests and verify red**

Run:

```bash
npm run test:integration -- test/integration/single-execution.test.ts
```

Expected: missing-path tests fail because `runSync()` currently spawns Pi and the mock call count is not zero, or error text lacks the source-specific diagnostic.

- [x] **Step 3: Add validation helper**

Add this to `src/execution/superagents-config.ts` with `node:fs` and `node:path` imports:

```typescript
export interface MissingSubagentExtensionPath {
	source: string;
	configuredPath: string;
	resolvedPath: string;
}

/**
 * Find the first configured subagent extension path that does not exist.
 *
 * @param runtimeCwd Runtime working directory used to resolve relative paths.
 * @param globalExtensions Extensions from `superagents.extensions`.
 * @param agentExtensions Extensions from agent frontmatter.
 * @returns The first missing extension path, or undefined when all configured paths exist.
 */
export function findMissingSubagentExtensionPath(
	runtimeCwd: string,
	globalExtensions: string[] | undefined,
	agentExtensions: string[] | undefined,
): MissingSubagentExtensionPath | undefined {
	const entries = [
		...(globalExtensions ?? []).map((configuredPath, index) => ({ source: `superagents.extensions[${index}]`, configuredPath })),
		...(agentExtensions ?? []).map((configuredPath, index) => ({ source: `agent.extensions[${index}]`, configuredPath })),
	];
	for (const entry of entries) {
		const resolvedPath = path.isAbsolute(entry.configuredPath) ? entry.configuredPath : path.resolve(runtimeCwd, entry.configuredPath);
		if (!fs.existsSync(resolvedPath)) {
			return { ...entry, resolvedPath };
		}
	}
	return undefined;
}
```

- [x] **Step 4: Wire validation into `runSync()`**

In `src/execution/execution.ts`, import `findMissingSubagentExtensionPath` with `resolveSubagentExtensions`. After `const config = options.config ?? {};` and after the agent is known, before `buildPiArgs()`, add:

```typescript
	const missingExtension = findMissingSubagentExtensionPath(runtimeCwd, config.superagents?.extensions, agent.extensions);
	if (missingExtension) {
		return {
			agent: agentName,
			task,
			exitCode: 1,
			messages: [],
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
			error: `Extension path from ${missingExtension.source} does not exist: ${missingExtension.configuredPath} (resolved to ${missingExtension.resolvedPath})`,
		};
	}
```

Keep `effectiveExtensions = resolveSubagentExtensions(config, agent.extensions)` after this validation.

- [x] **Step 5: Run tests and verify green**

Run:

```bash
npm run test:integration -- test/integration/single-execution.test.ts
npm run typecheck
```

Expected: integration tests pass and TypeScript passes.

- [x] **Step 6: Commit runtime validation**

Run:

```bash
git add src/execution/superagents-config.ts src/execution/execution.ts test/integration/single-execution.test.ts
git commit -m "fix: validate configured subagent extensions"
```

Expected: commit succeeds.

---

### Task 2: Documentation and Final Verification

**Files:**
- Modify: `docs/configuration.md`
- Modify: `docs/skills.md`
- Modify: `docs/parameters.md`

- [x] **Step 1: Update configuration docs**

In `docs/configuration.md`, add this note near the `superagents.extensions` example:

```markdown
Configured extension entries must point to existing files or directories when the subagent starts. Relative paths are resolved from the subagent runtime working directory; use absolute paths for extensions outside the project. Missing paths fail the subagent before Pi starts and include the config source in the error message.
```

- [x] **Step 2: Update skills docs**

In `docs/skills.md`, extend the `extensions` frontmatter description with:

```markdown
Relative entries resolve from the subagent runtime working directory. Missing entries fail that agent before Pi starts.
```

- [x] **Step 3: Update parameters docs**

In `docs/parameters.md`, extend the extension-loading paragraph with:

```markdown
If any configured global or agent extension path is missing, the subagent returns a clear error and does not spawn the child Pi process.
```

- [x] **Step 4: Run final verification**

Run:

```bash
npm run qa
```

Expected: Biome, TypeScript, unit, integration, and e2e tests pass.

- [x] **Step 5: Commit docs and any formatter changes**

Run:

```bash
git add docs/configuration.md docs/skills.md docs/parameters.md
git commit -m "docs: describe extension path validation"
```

If `npm run qa` formats source/test files, include those formatter-only changes in the same commit.

---

## Self-Review

- Spec coverage: runtime missing-path behavior, source-specific error messages, successful existing paths, docs, and final QA are all covered.
- Placeholder scan: no placeholders remain.
- Type consistency: helper names, return shape, and error message fields are consistent across tasks.
