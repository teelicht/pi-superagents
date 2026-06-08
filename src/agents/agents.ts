/**
 * Agent discovery and configuration
 *
 * Key responsibilities:
 * - discover built-in, user, and project agent markdown definitions
 * - parse supported frontmatter fields into AgentConfig objects
 * - preserve unknown frontmatter keys in extraFields for compatibility
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { SessionMode } from "../shared/types.ts";
import { parseFrontmatter } from "./frontmatter.ts";

const KNOWN_FIELDS = new Set([
	"name",
	"description",
	"tools",
	"model",
	"thinking",
	"skills",
	"extensions",
	"interactive",
	"maxSubagentDepth",
	"session-mode",
	"kind",
	"execution",
	"command",
	"entrySkill",
]);

export type AgentSource = "builtin" | "user" | "project";
export type AgentScope = "project" | "user" | "both";
export type AgentKind = "entrypoint" | "role";
export type AgentExecution = "interactive" | "headless";

export interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	mcpDirectTools?: string[];
	model?: string;
	thinking?: string;
	systemPrompt: string;
	source: AgentSource;
	filePath: string;
	skills?: string[];
	extensions?: string[];
	interactive?: boolean;
	maxSubagentDepth?: number;
	sessionMode?: SessionMode;
	kind?: AgentKind;
	execution?: AgentExecution;
	command?: string;
	entrySkill?: string;
	extraFields?: Record<string, string>;
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	projectAgentsDir: string | null;
}

function loadAgentsFromDir(dir: string, source: AgentSource): AgentConfig[] {
	return findAgentSkillFiles(dir).flatMap((filePath) => {
		const parsed = readAgentFrontmatter(filePath);
		return parsed ? [normalizeAgentConfig(parsed, source, filePath)] : [];
	});
}

/**
 * Find readable agent markdown files in one agent directory.
 *
 * @param dir Directory to scan non-recursively.
 * @returns Absolute markdown file paths for file or symlink entries; empty when missing/unreadable.
 */
function findAgentSkillFiles(dir: string): string[] {
	if (!fs.existsSync(dir)) return [];

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}

	return entries
		.filter((entry) => entry.name.endsWith(".md"))
		.filter((entry) => entry.isFile() || entry.isSymbolicLink())
		.map((entry) => path.join(dir, entry.name));
}

/**
 * Read and parse an agent markdown file's frontmatter.
 *
 * @param filePath Agent markdown file path.
 * @returns Parsed frontmatter/body when required fields exist; otherwise undefined.
 */
function readAgentFrontmatter(filePath: string): { frontmatter: Record<string, string>; body: string } | undefined {
	let content: string;
	try {
		content = fs.readFileSync(filePath, "utf-8");
	} catch {
		return undefined;
	}

	const parsed = parseFrontmatter(content);
	if (!parsed.frontmatter.name || !parsed.frontmatter.description) return undefined;
	return parsed;
}

/**
 * Normalize parsed frontmatter into the runtime agent configuration shape.
 *
 * @param parsed Parsed frontmatter and markdown body.
 * @param source Source tier used for precedence and diagnostics.
 * @param filePath Source file path for traceability.
 * @returns Agent configuration equivalent to the legacy inline parser.
 */
function normalizeAgentConfig(parsed: { frontmatter: Record<string, string>; body: string }, source: AgentSource, filePath: string): AgentConfig {
	const { frontmatter, body } = parsed;
	const { tools, mcpDirectTools } = splitAgentTools(frontmatter.tools);
	const skills = parseCommaSeparatedField(frontmatter.skills);
	const extensions = frontmatter.extensions === undefined ? undefined : parseCommaSeparatedField(frontmatter.extensions);
	const extraFields = collectExtraAgentFields(frontmatter);
	const parsedMaxSubagentDepth = Number(frontmatter.maxSubagentDepth);
	const kind = frontmatter.kind === "entrypoint" || frontmatter.kind === "role" ? frontmatter.kind : undefined;
	const execution = frontmatter.execution === "interactive" || frontmatter.execution === "headless" ? frontmatter.execution : undefined;

	return {
		name: frontmatter.name,
		description: frontmatter.description,
		tools: tools.length > 0 ? tools : undefined,
		mcpDirectTools: mcpDirectTools.length > 0 ? mcpDirectTools : undefined,
		model: frontmatter.model,
		thinking: frontmatter.thinking,
		systemPrompt: body,
		source,
		filePath,
		skills: skills && skills.length > 0 ? skills : undefined,
		extensions,
		interactive: frontmatter.interactive === "true",
		maxSubagentDepth: Number.isInteger(parsedMaxSubagentDepth) && parsedMaxSubagentDepth >= 0 ? parsedMaxSubagentDepth : undefined,
		sessionMode: parseAgentSessionMode(frontmatter["session-mode"]),
		kind,
		execution,
		command: frontmatter.command,
		entrySkill: frontmatter.entrySkill,
		extraFields: Object.keys(extraFields).length > 0 ? extraFields : undefined,
	};
}

/**
 * Split a comma-separated tools field into Pi tool names and MCP-direct names.
 *
 * @param toolsField Optional frontmatter tools field.
 * @returns Separate normal and `mcp:`-prefixed tool arrays.
 */
function splitAgentTools(toolsField: string | undefined): { tools: string[]; mcpDirectTools: string[] } {
	const tools: string[] = [];
	const mcpDirectTools: string[] = [];
	for (const tool of parseCommaSeparatedField(toolsField) ?? []) {
		if (tool.startsWith("mcp:")) mcpDirectTools.push(tool.slice(4));
		else tools.push(tool);
	}
	return { tools, mcpDirectTools };
}

/**
 * Parse an optional comma-separated frontmatter field.
 *
 * @param value Raw comma-separated value.
 * @returns Trimmed non-empty entries, or undefined when absent.
 */
function parseCommaSeparatedField(value: string | undefined): string[] | undefined {
	return value
		?.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
}

/**
 * Preserve unrecognized frontmatter fields for compatibility.
 *
 * @param frontmatter Parsed frontmatter key/value map.
 * @returns Unknown fields not consumed by AgentConfig.
 */
function collectExtraAgentFields(frontmatter: Record<string, string>): Record<string, string> {
	const extraFields: Record<string, string> = {};
	for (const [key, value] of Object.entries(frontmatter)) {
		if (!KNOWN_FIELDS.has(key)) extraFields[key] = value;
	}
	return extraFields;
}

/**
 * Parse session-mode frontmatter while rejecting unsupported values.
 *
 * @param value Optional raw session-mode value.
 * @returns Supported session mode, or undefined for absent/invalid values.
 */
function parseAgentSessionMode(value: string | undefined): SessionMode | undefined {
	return value === "standalone" || value === "lineage-only" || value === "fork" ? value : undefined;
}

function isDirectory(p: string): boolean {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function findNearestProjectAgentsDir(cwd: string): string | null {
	let currentDir = cwd;
	while (true) {
		const candidateAlt = path.join(currentDir, ".agents");
		if (isDirectory(candidateAlt)) return candidateAlt;

		const candidate = path.join(currentDir, ".pi", "agents");
		if (isDirectory(candidate)) return candidate;

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

const BUILTIN_AGENTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../agents");

export function discoverAgents(cwd: string): AgentDiscoveryResult {
	const userDirOld = path.join(os.homedir(), ".pi", "agent", "agents");
	const userDirNew = path.join(os.homedir(), ".agents");
	const projectAgentsDir = findNearestProjectAgentsDir(cwd);

	const builtinAgents = loadAgentsFromDir(BUILTIN_AGENTS_DIR, "builtin");

	const userAgentsOld = loadAgentsFromDir(userDirOld, "user");
	const userAgentsNew = loadAgentsFromDir(userDirNew, "user");
	const userAgents = [...userAgentsOld, ...userAgentsNew];

	const projectAgents = projectAgentsDir ? loadAgentsFromDir(projectAgentsDir, "project") : [];

	const agentMap = new Map<string, AgentConfig>();
	for (const agent of builtinAgents) agentMap.set(agent.name, agent);
	for (const agent of userAgents) agentMap.set(agent.name, agent);
	for (const agent of projectAgents) agentMap.set(agent.name, agent);

	const agents = Array.from(agentMap.values());

	return { agents, projectAgentsDir };
}

export function discoverAgentsAll(cwd: string): {
	builtin: AgentConfig[];
	user: AgentConfig[];
	project: AgentConfig[];
	userDir: string;
	projectDir: string | null;
} {
	const userDirOld = path.join(os.homedir(), ".pi", "agent", "agents");
	const userDirNew = path.join(os.homedir(), ".agents");
	const projectDir = findNearestProjectAgentsDir(cwd);

	const builtin = loadAgentsFromDir(BUILTIN_AGENTS_DIR, "builtin");
	const user = [...loadAgentsFromDir(userDirOld, "user"), ...loadAgentsFromDir(userDirNew, "user")];
	const project = projectDir ? loadAgentsFromDir(projectDir, "project") : [];

	const userDir = fs.existsSync(userDirNew) ? userDirNew : userDirOld;

	return { builtin, user, project, userDir, projectDir };
}
