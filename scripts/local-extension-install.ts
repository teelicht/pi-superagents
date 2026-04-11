/**
 * Local Pi extension installer for development workflows.
 *
 * Responsibilities:
 * - derive the installable file list from `npm pack --dry-run --json`
 * - copy the packaged extension files into a local Pi extensions directory
 * - provide a simple CLI for refreshing the local development install
 *
 * Important side effects:
 * - removes the target extension directory before copying the refreshed files
 * - shells out to `npm pack --dry-run --json` in the source repository
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export interface InstallLocalExtensionFilesOptions {
	sourceRoot: string;
	targetRoot: string;
	relativePaths: string[];
}

interface NpmPackDryRunFileEntry {
	path?: string;
}

interface NpmPackDryRunEntry {
	files?: NpmPackDryRunFileEntry[];
}

interface CliOptions {
	sourceRoot: string;
	targetRoot: string;
}

const DEFAULT_EXTENSION_NAME = "subagent";

/**
 * Normalize and validate one packaged file path before copying it.
 *
 * @param relativePath Relative file path reported by `npm pack --dry-run`.
 * @returns Safe normalized relative path.
 * @throws When the path is empty, absolute, or escapes the source root.
 */
function normalizeRelativePath(relativePath: string): string {
	const normalized = path.normalize(relativePath).replace(/\\/g, "/");
	if (!normalized || normalized === ".") {
		throw new Error("Pack file list contains an empty path.");
	}
	if (path.isAbsolute(normalized)) {
		throw new Error(`Pack file list contains an absolute path: ${relativePath}`);
	}
	if (normalized.startsWith("../") || normalized === "..") {
		throw new Error(`Pack file list contains an unsafe parent path: ${relativePath}`);
	}
	return normalized;
}

const USER_CONFIG_FILE = "config.json";

/**
 * Copy the installable files into the target Pi extension directory.
 *
 * Preserves the user-owned config.json across refreshes by saving and
 * restoring it around the destructive target directory removal.
 *
 * @param options Source root, target root, and packaged relative file paths.
 * @returns Sorted list of copied relative paths.
 * @throws When a packaged file is missing or is not a regular file.
 */
export function installLocalExtensionFiles(options: InstallLocalExtensionFilesOptions): string[] {
	const sourceRoot = path.resolve(options.sourceRoot);
	const targetRoot = path.resolve(options.targetRoot);
	const relativePaths = [...new Set(options.relativePaths.map(normalizeRelativePath))].sort();

	if (relativePaths.length === 0) {
		throw new Error("No packaged files were provided for local extension installation.");
	}

	const userConfigPath = path.join(targetRoot, USER_CONFIG_FILE);
	const existingUserConfig = fs.statSync(userConfigPath, { throwIfNoEntry: false })?.isFile()
		? fs.readFileSync(userConfigPath, "utf-8")
		: undefined;

	fs.rmSync(targetRoot, { recursive: true, force: true });
	fs.mkdirSync(targetRoot, { recursive: true });

	for (const relativePath of relativePaths) {
		const sourcePath = path.join(sourceRoot, relativePath);
		const sourceStat = fs.statSync(sourcePath, { throwIfNoEntry: false });
		if (!sourceStat) {
			throw new Error(`Packaged file is missing from the source tree: ${relativePath}`);
		}
		if (!sourceStat.isFile()) {
			throw new Error(`Packaged path is not a regular file: ${relativePath}`);
		}

		const targetPath = path.join(targetRoot, relativePath);
		fs.mkdirSync(path.dirname(targetPath), { recursive: true });
		fs.copyFileSync(sourcePath, targetPath);
		fs.chmodSync(targetPath, sourceStat.mode);
	}

	const finalUserConfigPath = path.join(targetRoot, USER_CONFIG_FILE);
	if (existingUserConfig !== undefined) {
		fs.writeFileSync(finalUserConfigPath, existingUserConfig, "utf-8");
	} else if (!fs.existsSync(finalUserConfigPath)) {
		fs.writeFileSync(finalUserConfigPath, "{}\n", "utf-8");
	}

	return relativePaths;
}

/**
 * Parse the JSON output produced by `npm pack --dry-run --json`.
 *
 * @param stdout Raw JSON text emitted by npm.
 * @returns Sorted packaged file paths.
 * @throws When the JSON shape does not include packaged files.
 */
function parsePackDryRunPaths(stdout: string): string[] {
	const parsed = JSON.parse(stdout) as NpmPackDryRunEntry[];
	if (!Array.isArray(parsed) || parsed.length === 0) {
		throw new Error("npm pack --dry-run returned no package entries.");
	}

	const files = parsed[0]?.files ?? [];
	const relativePaths = files
		.map((entry) => entry.path)
		.filter((value): value is string => typeof value === "string" && value.length > 0);

	if (relativePaths.length === 0) {
		throw new Error("npm pack --dry-run did not report any packaged files.");
	}

	return relativePaths;
}

/**
 * Resolve the package file list from npm without creating a tarball.
 *
 * @param sourceRoot Repository root to inspect.
 * @returns Relative file paths that would be included in the package.
 * @throws When npm is unavailable or the dry run fails.
 */
function resolvePackagedPaths(sourceRoot: string): string[] {
	const stdout = execFileSync("npm", ["pack", "--dry-run", "--json"], {
		cwd: sourceRoot,
		encoding: "utf-8",
	});
	return parsePackDryRunPaths(stdout);
}

/**
 * Parse supported CLI arguments for the local installer.
 *
 * @param argv Raw command-line arguments after the script path.
 * @param scriptDir Absolute path to the current script directory.
 * @returns Resolved source and target directories.
 * @throws When a flag is unknown or missing its required value.
 */
function parseCliArgs(argv: string[], scriptDir: string): CliOptions {
	let sourceRoot = path.resolve(scriptDir, "..");
	let targetRoot = path.join(os.homedir(), ".pi", "agent", "extensions", DEFAULT_EXTENSION_NAME);

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--source") {
			const value = argv[index + 1];
			if (!value) throw new Error("Missing value for --source.");
			sourceRoot = path.resolve(value);
			index += 1;
			continue;
		}
		if (arg === "--target") {
			const value = argv[index + 1];
			if (!value) throw new Error("Missing value for --target.");
			targetRoot = path.resolve(value);
			index += 1;
			continue;
		}
		if (arg === "--help" || arg === "-h") {
			printHelp();
			process.exit(0);
		}
		throw new Error(`Unknown argument: ${arg}`);
	}

	return { sourceRoot, targetRoot };
}

/**
 * Print CLI usage information for the local installer.
 */
function printHelp(): void {
	process.stdout.write(
		[
			"Local Pi extension installer",
			"",
			"Usage:",
			"  npm run debug:pi-local",
			"  npm run debug:pi-local -- --target ~/.pi/agent/extensions/subagent",
			"  npm run debug:pi-local -- --source /path/to/repo",
			"",
			"Options:",
			"  --source <path>  Source repository to package and copy",
			"  --target <path>  Target Pi extension directory",
			"  --help           Show this help",
			"",
		].join("\n"),
	);
}

/**
 * Run the local installer CLI end to end.
 *
 * @param argv Command-line arguments after the script path.
 * @returns Process exit code.
 */
function main(argv: string[]): number {
	const scriptPath = fileURLToPath(import.meta.url);
	const scriptDir = path.dirname(scriptPath);
	const { sourceRoot, targetRoot } = parseCliArgs(argv, scriptDir);
	const packagedPaths = resolvePackagedPaths(sourceRoot);
	const copiedPaths = installLocalExtensionFiles({
		sourceRoot,
		targetRoot,
		relativePaths: packagedPaths,
	});

	process.stdout.write(
		[
			`Installed local Pi extension refresh to ${targetRoot}`,
			`Copied ${copiedPaths.length} packaged files from ${sourceRoot}`,
			"",
			"Restart pi to load the refreshed extension.",
			"",
		].join("\n"),
	);
	return 0;
}

const isMainModule = process.argv[1] !== undefined
	&& path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
	try {
		process.exitCode = main(process.argv.slice(2));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`Failed to install local Pi extension: ${message}\n`);
		process.exitCode = 1;
	}
}
