# Pi Extension Source Allowlist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow subagent extension allowlists to use normal Pi `-e` source specs such as `npm:@scope/package` while preserving local path validation.

**Architecture:** Follow the `edxeth/pi-subagents` pattern: classify URI-scheme extension sources and pass them through unchanged, but resolve and validate local paths before spawning child Pi. Keep the child Pi process responsible for package and remote source resolution.

**Tech Stack:** TypeScript, Node `node:test`, Node filesystem/path modules, JSON config templates, Markdown docs.

---

## File Structure

| File | Responsibility | Planned Change |
|---|---|---|
| `src/execution/superagents-config.ts` | Superagents config helpers and extension validation | Add scheme-like source classifier and local path resolver; skip local existence checks for scheme sources. |
| `test/unit/superagents-config.test.ts` | Unit coverage for config helper behavior | Add TDD tests for package/remote pass-through and `~` local path resolution. |
| `config.example.json` | User-facing example configuration | Change package examples to `npm:` source specs. |
| `docs/configuration.md` | Main config reference | Document local path vs source spec behavior and package prefix requirement. |
| `docs/skills.md` | Agent frontmatter reference | Document source specs in agent `extensions` field. |
| `docs/worktrees.md` | Worktree interaction docs | Clarify extension source specs work independently of worktrees. |
| `docs/parameters.md` | Tool parameter docs | Clarify configured extensions may be local paths or source specs. |
| `README.md` | User overview | Mention `npm:` source specs in extension allowlist summary. |

---

### Task 1: Add failing tests for Pi-style extension sources

**Files:**
- Modify: `test/unit/superagents-config.test.ts`

- [x] **Step 1: Add scheme-source tests**

Add these test cases inside the existing `void describe("findMissingSubagentExtensionPath", () => { ... })` block, after the empty-array test:

```ts
	/**
	 * Verifies Pi package and remote extension sources are passed through without local path checks.
	 *
	 * @returns Nothing; asserts scheme-like sources do not produce missing path diagnostics.
	 */
	void it("does not path-check Pi package and remote extension sources", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-config-test-scheme-"));
		try {
			assert.equal(
				findMissingSubagentExtensionPath(
					tempDir,
					["npm:@sting8k/pi-vcc", "git:github.com/user/repo"],
					["https://example.com/ext.ts", "ssh://git@example.com/user/repo.git"],
				),
				undefined,
			);
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	/**
	 * Verifies Windows drive-letter paths are not mistaken for URI-scheme sources.
	 *
	 * @returns Nothing; asserts a drive-letter path is still validated as a local path.
	 */
	void it("treats Windows drive-letter entries as local paths, not scheme sources", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-config-test-drive-"));
		try {
			const result = findMissingSubagentExtensionPath(tempDir, ["C:\\missing\\extension.ts"], undefined);

			assert.ok(result !== undefined);
			assert.equal(result!.source, "superagents.extensions[0]");
			assert.equal(result!.configuredPath, "C:\\missing\\extension.ts");
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	/**
	 * Verifies home-relative local paths are expanded before validation.
	 *
	 * @returns Nothing; asserts an existing home-relative path passes validation.
	 */
	void it("expands home-relative local extension paths before validation", () => {
		const homeExtensionPath = path.join(os.homedir(), `.pi-superagents-test-${process.pid}.ts`);
		try {
			fs.writeFileSync(homeExtensionPath, "// extension");

			assert.equal(findMissingSubagentExtensionPath(process.cwd(), [`~/${path.basename(homeExtensionPath)}`], undefined), undefined);
		} finally {
			fs.rmSync(homeExtensionPath, { force: true });
		}
	});
```

- [x] **Step 2: Run tests and verify failure**

Run:

```bash
node --experimental-strip-types --test test/unit/superagents-config.test.ts
```

Expected: the first new test fails because `npm:@sting8k/pi-vcc` is resolved as a missing local path.

- [x] **Step 3: Commit failing tests**

Do not commit failing tests separately. Keep this step unchecked until Task 2 passes.

---

### Task 2: Implement Pi-style source classification and local path resolution

**Files:**
- Modify: `src/execution/superagents-config.ts`
- Test: `test/unit/superagents-config.test.ts`

- [x] **Step 1: Replace missing-path validation helpers**

In `src/execution/superagents-config.ts`, add these functions above `findMissingSubagentExtensionPath`:

```ts
/**
 * Determine whether an extension source starts with a URI-style scheme.
 *
 * Inputs/outputs:
 * - returns true for Pi source specs such as `npm:pkg`, `git:repo`, `https://...`, and `ssh://...`
 * - returns false for Windows drive-letter paths such as `C:\\ext.ts`
 *
 * @param value Configured extension source string.
 * @returns True when Pi should resolve the source as a scheme-like extension source.
 */
export function isSchemeLikeExtensionSource(value: string): boolean {
	return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value) && !/^[a-zA-Z]:[\\/]/.test(value);
}

/**
 * Resolve a local subagent extension path against runtime context.
 *
 * Inputs/outputs:
 * - expands `~`, `~/...`, and `~\\...` against the current user's home directory
 * - returns absolute paths unchanged
 * - resolves relative paths from the subagent runtime working directory
 *
 * @param runtimeCwd Runtime working directory used to resolve relative paths.
 * @param configuredPath Local path as written in config or agent frontmatter.
 * @returns Absolute local filesystem path used for existence checks.
 */
export function resolveLocalSubagentExtensionPath(runtimeCwd: string, configuredPath: string): string {
	if (configuredPath === "~") return os.homedir();
	if (configuredPath.startsWith("~/")) return path.join(os.homedir(), configuredPath.slice(2));
	if (configuredPath.startsWith("~\\")) return path.join(os.homedir(), configuredPath.slice(2));
	return path.isAbsolute(configuredPath) ? configuredPath : path.resolve(runtimeCwd, configuredPath);
}
```

Also add this import at the top:

```ts
import * as os from "node:os";
```

- [x] **Step 2: Update `findMissingSubagentExtensionPath`**

Replace the loop body in `findMissingSubagentExtensionPath` with:

```ts
	for (const entry of entries) {
		if (isSchemeLikeExtensionSource(entry.configuredPath)) continue;
		const resolvedPath = resolveLocalSubagentExtensionPath(runtimeCwd, entry.configuredPath);
		if (!fs.existsSync(resolvedPath)) {
			return { ...entry, resolvedPath };
		}
	}
```

- [x] **Step 3: Run focused tests**

Run:

```bash
node --experimental-strip-types --test test/unit/superagents-config.test.ts
```

Expected: all `superagents-config` tests pass.

- [x] **Step 4: Commit implementation and tests**

Run:

```bash
git add src/execution/superagents-config.ts test/unit/superagents-config.test.ts
git commit -m "feat: allow pi extension source specs for subagents"
```

---

### Task 3: Update config example and docs

**Files:**
- Modify: `config.example.json`
- Modify: `docs/configuration.md`
- Modify: `docs/skills.md`
- Modify: `docs/worktrees.md`
- Modify: `docs/parameters.md`
- Modify: `README.md`

- [x] **Step 1: Update config example package source specs**

In `config.example.json`, replace:

```json
    "extensions": [
      "@sting8k/pi-vcc",
      "@tomooshi/caveman-milk-pi",
      "@tomooshi/condensed-milk-pi"
    ],
```

with:

```json
    "extensions": [
      "npm:@sting8k/pi-vcc",
      "npm:@tomooshi/caveman-milk-pi",
      "npm:@tomooshi/condensed-milk-pi"
    ],
```

- [x] **Step 2: Update `docs/configuration.md` extension section**

Replace the `extensions` table description with:

```md
| `extensions` | Array of local extension paths or Pi extension source specs that every subagent receives. Implicit Pi extension discovery is disabled by default; add extensions here for child Pi processes. |
```

Replace the example block under `### Extension Allowlist` with:

```md
```json
{
  "superagents": {
    "extensions": [
      "./src/extension/custom-subagent-tools.ts",
      "npm:@sting8k/pi-vcc"
    ]
  }
}
```
```

Replace the paragraph beginning `Configured extension entries must point` with:

```md
Local extension entries must point to existing files or directories when the subagent starts. Relative paths resolve from the subagent runtime working directory; use absolute paths for local extensions outside the project. Missing local paths cause subagent launch to fail before Pi starts and include the config source in the error.

Package and remote entries should use normal Pi `-e` source prefixes such as `npm:`, `git:`, `https:`, or `ssh:`. These sources pass through to child Pi unchanged, and child Pi resolves, installs, and loads them through its normal extension resolver. Bare package names such as `@scope/package` are treated as local paths; use `npm:@scope/package` for npm packages.
```

- [x] **Step 3: Update `docs/skills.md` frontmatter description**

Replace the `extensions` row with:

```md
| `extensions` | No | Comma-separated Pi extension entrypoints to append for this agent. Use local paths for local extensions and source specs such as `npm:@scope/package` or `git:github.com/user/repo` for package/remote extensions. Global `superagents.extensions` entries are loaded first. Relative local entries resolve from the subagent runtime working directory; missing local entries fail that agent before Pi starts. |
```

- [x] **Step 4: Update `docs/worktrees.md` extension loading paragraph**

Replace the paragraph under `## Extension Loading` with:

```md
Extension loading for subagents is independent of worktree isolation. Even when running inside a git worktree, child Pi processes load extensions from `superagents.extensions` (global config) and the `extensions` field in agent frontmatter (additive to global). Implicit Pi extension discovery is disabled by default; only explicitly configured extensions are loaded. Configured entries may be local paths or normal Pi `-e` source specs such as `npm:@scope/package`; relative local paths resolve from the subagent runtime working directory.
```

- [x] **Step 5: Update `docs/parameters.md` note**

Replace the extension note with:

```md
> **Note:** The `subagent` tool does not accept ad-hoc extension paths at call time. Extension loading for child Pi processes is controlled through `superagents.extensions` in the global config and the `extensions` field in agent frontmatter (additive to the global list). Implicit Pi extension discovery is disabled by default; only configured extensions are loaded for subagents. Configured entries may be local paths or normal Pi `-e` source specs such as `npm:@scope/package`, `git:github.com/user/repo`, `https://...`, or `ssh://...`. Missing local paths return a clear error and do not spawn the child Pi process; package and remote specs are resolved by child Pi.
```

- [x] **Step 6: Update `README.md` feature bullet**

Replace the `Subagent Extension Allowlist` bullet with:

```md
- **Subagent Extension Allowlist**: Subagents run with implicit Pi extension discovery disabled by default; configure `superagents.extensions` with local paths or Pi `-e` source specs such as `npm:@scope/package` for extensions every subagent should receive.
```

- [x] **Step 7: Validate JSON and docs-adjacent tests**

Run:

```bash
node -e 'JSON.parse(require("node:fs").readFileSync("config.example.json", "utf8")); console.log("json ok")'
node --experimental-strip-types --test test/unit/default-config.test.ts
```

Expected: JSON parses and default-config tests pass.

- [x] **Step 8: Commit docs and example**

Run:

```bash
git add config.example.json docs/configuration.md docs/skills.md docs/worktrees.md docs/parameters.md README.md
git commit -m "docs: document pi extension source specs"
```

---

### Task 4: Run full relevant verification

**Files:**
- Test: `test/unit/superagents-config.test.ts`
- Test: `test/unit/config-validation.test.ts`
- Test: `test/unit/default-config.test.ts`

- [x] **Step 1: Run relevant unit tests**

Run:

```bash
node --experimental-strip-types --test test/unit/superagents-config.test.ts test/unit/config-validation.test.ts test/unit/default-config.test.ts
```

Expected: all tests pass.

- [x] **Step 2: Check final diff**

Run:

```bash
git status --short
git diff --stat
```

Expected: no unintended files changed beyond this feature. Existing pre-plan changes may remain if they were present before execution; do not revert unrelated user work.

- [x] **Step 3: Commit any missed verification-only fixes**

If Task 4 required any fixes, commit them:

```bash
git add src/execution/superagents-config.ts test/unit/superagents-config.test.ts config.example.json docs/configuration.md docs/skills.md docs/worktrees.md docs/parameters.md README.md
git commit -m "fix: align extension source allowlist verification"
```

If no files changed after Step 1, skip this commit.

---

## Self-Review

- Spec coverage: local path validation remains, scheme-like sources pass through, docs/examples require `npm:` package prefixes, bare package names are not package lookups.
- Placeholder scan: no TBD/TODO/fill-in steps remain.
- Type consistency: helper names are consistent across implementation and tests.
