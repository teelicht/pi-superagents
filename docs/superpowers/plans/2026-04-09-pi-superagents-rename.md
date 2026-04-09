# Pi-Superagents Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand the current public project surface from `pi-subagents` to `pi-superagents` while keeping operational `subagent` terminology intact and preserving explicit fork attribution in the README.

**Architecture:** Treat this as a documentation-and-metadata rename, not a runtime feature redesign. Update only current discovery/install/package surfaces plus tests that assert those names, while leaving historical specs/changelog references and runtime tool names such as `subagent`, `subagent_status`, and `/subagents-status` unchanged.

**Tech Stack:** TypeScript/Node ESM project metadata, npm package metadata, markdown documentation, Node test runner.

---

## File Structure

### Files to Modify

| File | Purpose |
| --- | --- |
| `package.json` | Rename the npm package and published bin, and point repository metadata at the renamed repo |
| `package-lock.json` | Keep lockfile package metadata aligned with `package.json` |
| `install.mjs` | Rename installer/help text and clone source to `pi-superagents` |
| `README.md` | Rebrand the public-facing docs, installation commands, and add fork attribution |
| `test/unit/single-output.test.ts` | Rename temp-path fixtures that encode the old public package name |
| `test/unit/path-handling.test.ts` | Rename Windows path fixtures that encode the old public package name |
| `test/unit/agent-frontmatter.test.ts` | Rename temp-dir fixtures that encode the old public package name |

### Files Intentionally Left Unchanged

| File/Area | Reason |
| --- | --- |
| `CHANGELOG.md` | Historical record should continue to show the original project name where accurate |
| `docs/superpowers/specs/**` | Historical design artifacts should preserve fork lineage |
| `docs/superpowers/plans/**` | Older planning artifacts should preserve the original project name |
| Runtime names like `subagent`, `subagent_status`, `/subagents-status` | These remain accurate feature terms, not brand terms |

## Task 1: Rename Package Metadata And Installer Surface

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `install.mjs`

- [ ] **Step 1: Update the package manifest to the new public name**

```json
{
  "name": "pi-superagents",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/nicobailon/pi-superagents.git"
  },
  "homepage": "https://github.com/nicobailon/pi-superagents#readme",
  "bugs": {
    "url": "https://github.com/nicobailon/pi-superagents/issues"
  },
  "bin": {
    "pi-superagents": "install.mjs"
  }
}
```

- [ ] **Step 2: Run a targeted diff check before touching the lockfile**

Run:

```bash
git diff -- package.json
```

Expected:

- The diff shows `pi-superagents` in package name, repo URLs, and `bin`

- [ ] **Step 3: Mirror the manifest rename in `package-lock.json`**

```json
{
  "name": "pi-superagents",
  "packages": {
    "": {
      "name": "pi-superagents",
      "bin": {
        "pi-superagents": "install.mjs"
      }
    }
  }
}
```

- [ ] **Step 4: Update installer/help strings and clone URL in `install.mjs`**

```js
/**
 * pi-superagents installer
 *
 * Usage:
 *   npx pi-superagents          # Install to ~/.pi/agent/extensions/subagent
 *   npx pi-superagents --remove # Remove the extension
 */

const REPO_URL = "https://github.com/nicobailon/pi-superagents.git";
```

```js
console.log(`
pi-superagents - Pi extension for delegating tasks to subagents

Usage:
  npx pi-superagents          Install the extension
  npx pi-superagents --remove Remove the extension
  npx pi-superagents --help   Show this help
`);
```

- [ ] **Step 5: Verify the installer help output reflects the rename**

Run:

```bash
node install.mjs --help
```

Expected:

- Help banner starts with `pi-superagents`
- Usage examples reference `npx pi-superagents`
- No `pi-subagents` string remains in the help output

- [ ] **Step 6: Commit the metadata/installer rename**

```bash
git add package.json package-lock.json install.mjs
git commit -m "chore: rename package metadata to pi-superagents"
```

## Task 2: Rebrand Current Docs And Preserve Fork Attribution

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Rewrite the current brand surface in the README**

````md
<p>
  <img src="banner.png" alt="pi-superagents" width="1100">
</p>

# pi-superagents

Pi extension for delegating tasks to subagents with chains, parallel execution, TUI clarification, and async support.
```

```md
## Installation

```bash
pi install npm:pi-superagents
```

To remove:

```bash
npx pi-superagents --remove
```
````

- [ ] **Step 2: Add explicit fork attribution near the top of the README**

```md
> `pi-superagents` is a fork of `pi-subagents`, rebranded to reflect the combination of Superpowers workflow ideas and subagent-based execution.
```

- [ ] **Step 3: Keep feature terminology accurate while rebranding prose**

```md
`pi-prompt-template-model` is entirely optional — `pi-superagents` works standalone through the `subagent` tool and slash commands.
```

```md
- The baseline `pi` harness plus generic `pi-superagents` behavior stays unchanged unless this command is used.
```

```md
`pi-superagents` reads optional JSON config from `~/.pi/agent/extensions/subagent/config.json`.
```

- [ ] **Step 4: Verify README rename boundaries**

Run:

```bash
rg -n "pi-subagents" README.md
```

Expected:

- Only the intentional fork-attribution mention remains

- [ ] **Step 5: Commit the README rebrand**

```bash
git add README.md
git commit -m "docs: rebrand README to pi-superagents"
```

## Task 3: Update Name-Coupled Tests And Run Verification

**Files:**

- Modify: `test/unit/single-output.test.ts`
- Modify: `test/unit/path-handling.test.ts`
- Modify: `test/unit/agent-frontmatter.test.ts`

- [ ] **Step 1: Rename test fixtures that embed the old package name**

```ts
const absolutePath = path.join(os.tmpdir(), "pi-superagents-abs", "report.md");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-superagents-output-test-"));
const windowsAbsolute = "C:\\dev\\pi-superagents\\output.md";
const windowsAbsoluteForward = "C:/dev/pi-superagents/output.md";
const dir = fs.mkdtempSync(
  path.join(os.tmpdir(), "pi-superagents-agent-frontmatter-"),
);
```

- [ ] **Step 2: Run the focused unit tests affected by the fixture rename**

Run:

```bash
node --experimental-strip-types --test test/unit/single-output.test.ts test/unit/path-handling.test.ts test/unit/agent-frontmatter.test.ts
```

Expected:

- PASS for all three test files

- [ ] **Step 3: Run a repo-wide rename boundary check**

Run:

```bash
rg -n "pi-subagents" . --glob '!node_modules' --glob '!.git' --glob '!CHANGELOG.md' --glob '!docs/superpowers/specs/**' --glob '!docs/superpowers/plans/**'
```

Expected:

- No matches in current package/installer/README/test surfaces
- Historical references remain only in excluded paths or any newly added intentional fork note outside exclusions

- [ ] **Step 4: Run the full unit suite to catch regressions**

Run:

```bash
npm run test:unit
```

Expected:

- PASS

- [ ] **Step 5: Commit the test fixture rename and verification pass**

```bash
git add test/unit/single-output.test.ts test/unit/path-handling.test.ts test/unit/agent-frontmatter.test.ts
git commit -m "test: update rename-coupled fixtures"
```

- [ ] **Step 6: Create the final integration commit**

```bash
git add README.md install.mjs package.json package-lock.json test/unit/single-output.test.ts test/unit/path-handling.test.ts test/unit/agent-frontmatter.test.ts
git commit -m "chore: rebrand project to pi-superagents"
```
