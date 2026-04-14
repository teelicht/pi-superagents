/**
 * Pi CLI spawn resolution.
 *
 * Determines how to invoke the Pi CLI process for subagent execution.
 * On Windows (and as a fallback) the `pi` binary may not be on PATH,
 * so this module resolves the actual Node entry-point script from the
 * installed `@mariozechner/pi-coding-agent` package and returns
 * `{ command: node, args: [cliScript, ...userArgs] }` instead of
 * `{ command: "pi", args: userArgs }`.
 *
 * Resolution order:
 * 1.  If `process.argv[1]` points to a runnable `.js/.mjs/.cjs` file, use it.
 * 2.  Otherwise, locate the package root and read its `package.json` `bin`
 *     field to find the CLI script.
 * 3.  If neither succeeds, fall back to `{ command: "pi", args }`.
 *
 * All resolution is dependency-injectable via `PiSpawnDeps` for testing.
 */

import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";

const require = createRequire(import.meta.url);

/**
 * Walk up from the current entry-point's directory to find the Pi package root.
 *
 * Resolves the real path of `process.argv[1]`, then walks parent directories
 * looking for a `package.json` whose `name` is `@mariozechner/pi-coding-agent`.
 *
 * @returns The absolute path to the Pi package root, or `undefined` if not found.
 */
export function resolvePiPackageRoot(): string | undefined {
	try {
		const entry = process.argv[1];
		if (!entry) return undefined;
		let dir = path.dirname(fs.realpathSync(entry));
		while (dir !== path.dirname(dir)) {
			try {
				const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf-8")) as { name?: unknown };
				if (pkg.name === "@mariozechner/pi-coding-agent") return dir;
			} catch { /* empty */ }
			dir = path.dirname(dir);
		}
	} catch { /* empty */ }
	return undefined;
}

/**
 * Dependency-injection surface for `getPiSpawnCommand` and `resolveWindowsPiCliScript`.
 *
 * Every field is optional; production calls fall back to `fs` / `process`
 * equivalents. Tests provide stubs to avoid touching the real filesystem
 * or depending on the local Pi installation.
 *
 * @field platform   — `process.platform`, used to decide Windows-specific paths
 * @field execPath   — `process.execPath`, the Node binary to invoke
 * @field argv1      — `process.argv[1]`, the main entry script path
 * @field existsSync  — `fs.existsSync` stub
 * @field readFileSync — `fs.readFileSync` stub
 * @field resolvePackageJson — custom resolver for the Pi `package.json` path
 * @field piPackageRoot — pre-resolved Pi package root, skips directory walk
 */
export interface PiSpawnDeps {
	platform?: NodeJS.Platform;
	execPath?: string;
	argv1?: string;
	existsSync?: (filePath: string) => boolean;
	readFileSync?: (filePath: string, encoding: "utf-8") => string;
	resolvePackageJson?: () => string;
	piPackageRoot?: string;
}

/**
 * Resolved spawn specification for a Pi CLI invocation.
 *
 * @field command — either `process.execPath` (when a JS entry script was found)
 *                  or `"pi"` (generic fallback)
 * @field args    — `[cliScript, ...userArgs]` when command is Node,
 *                  or just `userArgs` when command is `pi`
 */
export interface PiSpawnCommand {
	command: string;
	args: string[];
}

/**
 * Check whether a file path looks like a directly runnable Node script.
 *
 * @param filePath   — absolute or relative path to check
 * @param existsSync — `fs.existsSync` or stub
 * @returns `true` when the file exists and has a `.js`, `.mjs`, or `.cjs` extension
 */
function isRunnableNodeScript(filePath: string, existsSync: (filePath: string) => boolean): boolean {
	if (!existsSync(filePath)) return false;
	return /\.(?:mjs|cjs|js)$/i.test(filePath);
}

/**
 * Ensure a file path is absolute. Resolves relative paths against `process.cwd()`.
 *
 * @param filePath — path to normalise
 * @returns An absolute path
 */
function normalizePath(filePath: string): string {
	return path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
}

/**
 * Resolve the Pi CLI entry-point script path.
 *
 * Despite the name, this runs on **all** platforms — not just Windows.
 * The historical name reflects the original motivation (Windows lacks a
 * shebang-compatible `pi` binary), but the resolution logic is needed
 * whenever `process.argv[1]` is unavailable or not a runnable script.
 *
 * Resolution strategy:
 * 1. If `argv1` (i.e. `process.argv[1]`) points to an existing `.js/.mjs/.cjs`
 *    file, return that path — the current process *is* the Pi CLI.
 * 2. Otherwise, locate the Pi package's `package.json` (via directory walk or
 *    `require.resolve`), read its `bin` field, and derive the CLI script path.
 * 3. If the `bin` field is a string, use it directly; if it's an object,
 *    prefer the `pi` key, then fall back to the first value.
 * 4. If the resolved path is a runnable Node script, return it.
 * 5. If nothing works, return `undefined` (caller falls back to `pi` command).
 *
 * @param deps — optional dependency injection for testing
 * @returns Absolute path to the Pi CLI script, or `undefined` if not resolvable
 */
export function resolveWindowsPiCliScript(deps: PiSpawnDeps = { /* empty */ }): string | undefined {
	const existsSync = deps.existsSync ?? fs.existsSync;
	const readFileSync = deps.readFileSync ?? ((filePath, encoding) => fs.readFileSync(filePath, encoding));
	const argv1 = deps.argv1 ?? process.argv[1];

	// Strategy 1: use the current process entry point if it's a runnable script.
	if (argv1) {
		const argvPath = normalizePath(argv1);
		if (isRunnableNodeScript(argvPath, existsSync)) {
			return argvPath;
		}
	}

	// Strategy 2: resolve via the installed package's bin field.
	try {
		const resolvePackageJson = deps.resolvePackageJson ?? (() => {
			const root = deps.piPackageRoot ?? resolvePiPackageRoot();
			if (root) return path.join(root, "package.json");
			return require.resolve("@mariozechner/pi-coding-agent/package.json");
		});
		const packageJsonPath = resolvePackageJson();
		const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
			bin?: string | Record<string, string>;
		};
		const binField = packageJson.bin;
		const binPath = typeof binField === "string"
			? binField
			: binField?.pi ?? Object.values(binField ?? { /* empty */ })[0];
		if (!binPath) return undefined;
		const candidate = normalizePath(path.resolve(path.dirname(packageJsonPath), binPath));
		if (isRunnableNodeScript(candidate, existsSync)) {
			return candidate;
		}
	} catch {
		return undefined;
	}

	return undefined;
}

/**
 * Determine the spawn command and arguments for invoking the Pi CLI.
 *
 * Tries to find a concrete Node entry script via `resolveWindowsPiCliScript`.
 * If found, returns `{ command: node, args: [cliScript, ...args] }` so the
 * child process runs under the same Node binary as the parent.  Otherwise
 * falls back to `{ command: "pi", args }` and relies on `pi` being on PATH.
 *
 * @param args  — CLI arguments to forward (e.g. `["--mode", "json", "-p"]`)
 * @param deps  — optional dependency injection for testing
 * @returns A `{ command, args }` tuple suitable for `child_process.spawn`
 */
export function getPiSpawnCommand(args: string[], deps: PiSpawnDeps = { /* empty */ }): PiSpawnCommand {
	const piCliPath = resolveWindowsPiCliScript(deps);
	if (piCliPath) {
		return {
			command: deps.execPath ?? process.execPath,
			args: [piCliPath, ...args],
		};
	}

	return { command: "pi", args };
}
