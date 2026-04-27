/**
 * Test helpers for integration tests.
 *
 * Provides:
 * - Local mock pi CLI via createMockPi()
 * - Dynamic module loading with graceful skip
 * - Temp directory management
 * - Minimal mock contexts for chain execution
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { MockPi } from "./mock-pi.ts";
import { createMockPi as _createMockPi } from "./mock-pi.ts";

export type { MockPi };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface HarnessCompatibleAgent {
	state?: {
		tools?: unknown[];
	};
	setTools?: (tools: unknown[]) => void;
}

interface HarnessCompatibleSession {
	session?: {
		_modelRegistry?: {
			hasConfiguredAuth?: (model: unknown) => boolean;
			getApiKeyAndHeaders?: (
				model: unknown,
			) => Promise<{ ok: boolean; apiKey?: string; headers?: Record<string, string> }>;
			getApiKeyForProvider?: (provider: string) => Promise<string | undefined>;
			getApiKey?: (provider: string) => Promise<string | undefined>;
		};
		agent?: HarnessCompatibleAgent;
	};
}

/**
 * Add a `setTools()` compatibility shim for newer Pi agent objects.
 *
 * The current pi-test-harness still calls `session.agent.setTools(...)`, while
 * newer Pi releases expose direct tool replacement through `session.agent.state.tools`.
 * This shim keeps the test harness working without changing production code paths.
 */
function ensureHarnessAgentCompatibility(testSession: HarnessCompatibleSession): HarnessCompatibleSession {
	const agent = testSession.session?.agent;
	if (!agent?.state || typeof agent.setTools === "function") return testSession;
	agent.setTools = (tools: unknown[]) => {
		agent.state!.tools = [...tools];
	};
	return testSession;
}

/**
 * Add auth-resolution compatibility for newer Pi model registry APIs.
 *
 * Recent Pi versions validate auth through `hasConfiguredAuth()` and
 * `getApiKeyAndHeaders()`. The current harness still patches older
 * `getApiKey*()` methods only, so playbook-backed tests fail before any
 * extension code runs. We provide stable in-memory auth for the synthetic
 * `openai/gpt-4o` test model here.
 */
function ensureHarnessAuthCompatibility(testSession: HarnessCompatibleSession): HarnessCompatibleSession {
	const modelRegistry = testSession.session?._modelRegistry;
	if (!modelRegistry) return testSession;
	modelRegistry.hasConfiguredAuth = () => true;
	modelRegistry.getApiKeyAndHeaders = async () => ({ ok: true, apiKey: "test-key" });
	modelRegistry.getApiKeyForProvider = async () => "test-key";
	modelRegistry.getApiKey = async () => "test-key";
	return testSession;
}

/**
 * Patch the pi-test-harness module for Pi agent API compatibility.
 *
 * Only wraps `createTestSession()` and leaves all other exports unchanged.
 */
function patchPiTestHarnessModule<T>(module: T): T {
	const harness = module as T & { createTestSession?: (...args: unknown[]) => Promise<HarnessCompatibleSession> };
	if (typeof harness.createTestSession !== "function") return module;
	return {
		...harness,
		async createTestSession(...args: unknown[]) {
			const testSession = await harness.createTestSession!(...args);
			return ensureHarnessAuthCompatibility(ensureHarnessAgentCompatibility(testSession));
		},
	};
}

// ---------------------------------------------------------------------------
// Mock Pi setup
// ---------------------------------------------------------------------------

/**
 * Create a mock pi CLI instance for integration tests.
 *
 * Uses the local file-based mock harness in `test/support/mock-pi.ts` and keeps the
 * current Windows-specific `process.argv[1]` / `MOCK_PI_QUEUE_DIR` behavior so
 * `pi-spawn.ts` can keep resolving a runnable script path on Windows.
 */
export function createMockPi(): MockPi {
	return _createMockPi();
}

// ---------------------------------------------------------------------------
// Temp directory management
// ---------------------------------------------------------------------------

/**
 * Create a temporary directory for test use.
 */
export function createTempDir(prefix = "pi-subagent-test-"): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Remove a directory tree, ignoring errors.
 */
export function removeTempDir(dir: string): void {
	try {
		fs.rmSync(dir, { recursive: true, force: true });
	} catch {
		/* empty */
	}
}

// ---------------------------------------------------------------------------
// Agent config factory
// ---------------------------------------------------------------------------

interface AgentConfig {
	name: string;
	description?: string;
	systemPrompt?: string;
	model?: string;
	tools?: string[];
	extensions?: string[];
	skills?: string[];
	thinking?: string;
	scope?: string;
	reads?: string[] | false;
	progress?: boolean;
	mcpDirectTools?: string[];
	maxSubagentDepth?: number;
	sessionMode?: "standalone" | "lineage-only" | "fork";
}

/**
 * Create minimal agent configs for testing.
 * Each name becomes an agent with no special config.
 */
export function makeAgentConfigs(names: string[]): AgentConfig[] {
	return names.map((name) => ({
		name,
		description: `Test agent: ${name}`,
	}));
}

/**
 * Create an agent config with specific settings.
 */
export function makeAgent(
	name: string,
	overrides: Partial<AgentConfig> = {
		/* empty */
	},
): AgentConfig {
	return {
		name,
		description: `Test agent: ${name}`,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Minimal mock context for chain execution
// ---------------------------------------------------------------------------

/**
 * Create a minimal ExtensionContext mock for chain execution.
 * Only provides what executeChain needs when clarify=false.
 */
export function makeMinimalCtx(cwd: string): any {
	return {
		cwd,
		hasUI: false,
		ui: {
			/* empty */
		},
		sessionManager: {
			getSessionFile: () => null,
		},
		modelRegistry: {
			getAvailable: () => [],
		},
	};
}

// ---------------------------------------------------------------------------
// Dynamic module loading with graceful skip
// ---------------------------------------------------------------------------

/**
 * Try to dynamically import a module.
 * - Bare specifiers (e.g., "@marcfargas/pi-test-harness") are imported as-is.
 * - Relative paths (e.g., "./utils.ts") are resolved from the project root.
 *
 * Only swallows MODULE_NOT_FOUND / ERR_MODULE_NOT_FOUND when the missing module
 * is exactly the requested bare specifier (expected optional dependency).
 * All other errors are rethrown to avoid hiding real breakage.
 */
export async function tryImport<T>(specifier: string): Promise<T | null> {
	const isBare = !(specifier.startsWith(".") || specifier.startsWith("/"));
	try {
		if (!isBare) {
			const projectRoot = path.resolve(__dirname, "..", "..");
			const abs = path.resolve(projectRoot, specifier);
			// Convert to file:// URL for cross-platform compatibility with dynamic import()
			const url = pathToFileURL(abs).href;
			return (await import(url)) as T;
		}
		// Bare specifier — import directly (node_modules resolution)
		const imported = (await import(specifier)) as T;
		if (specifier === "@marcfargas/pi-test-harness") {
			return patchPiTestHarnessModule(imported);
		}
		return imported;
	} catch (error: any) {
		const code = error?.code;
		const isModuleNotFound = code === "MODULE_NOT_FOUND" || code === "ERR_MODULE_NOT_FOUND";
		if (isBare && isModuleNotFound) {
			const msg = String(error?.message ?? "");
			const missing = msg.match(/Cannot find (?:package|module) ['"]([^'"]+)['"]/i)?.[1];
			if (missing === specifier || msg.includes(`'${specifier}'`) || msg.includes(`"${specifier}"`)) {
				return null;
			}
		}
		throw error;
	}
}

/**
 * JSONL event builders for mock pi configuration.
 */
export const events = {
	/** Build a message_end event with assistant text */
	assistantMessage(text: string, model = "mock/test-model"): object {
		return {
			type: "message_end",
			message: {
				role: "assistant",
				content: [{ type: "text", text }],
				model,
				usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: { total: 0.001 } },
			},
		};
	},

	/** Build a tool_execution_start event */
	toolStart(
		toolName: string,
		args: Record<string, unknown> = {
			/* empty */
		},
	): object {
		return { type: "tool_execution_start", toolName, args };
	},

	/** Build a tool_execution_end event */
	toolEnd(toolName: string): object {
		return { type: "tool_execution_end", toolName };
	},

	/** Build a tool_result_end event */
	toolResult(toolName: string, text: string, isError = false): object {
		return {
			type: "tool_result_end",
			message: {
				role: "toolResult",
				toolName,
				isError,
				content: [{ type: "text", text }],
			},
		};
	},
};
