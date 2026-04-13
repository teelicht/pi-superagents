import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentConfig } from "./agents.ts";
import type { ExtensionConfig, IntercomBridgeConfig, IntercomBridgeMode } from "./types.ts";

const DEFAULT_INTERCOM_EXTENSION_DIR = path.join(os.homedir(), ".pi", "agent", "extensions", "pi-intercom");
const DEFAULT_INTERCOM_CONFIG_PATH = path.join(os.homedir(), ".pi", "agent", "intercom", "config.json");
const DEFAULT_SUBAGENT_CONFIG_DIR = path.join(os.homedir(), ".pi", "agent", "extensions", "subagent");
const DEFAULT_INTERCOM_TARGET_PREFIX = "subagent-chat";
const INTERCOM_BRIDGE_MARKER = "Intercom orchestration channel:";
const DEFAULT_INTERCOM_BRIDGE_TEMPLATE = `Use intercom only for coordination with the orchestrator session:
- Need a decision or blocked: intercom({ action: "ask", to: "{orchestratorTarget}", message: "<question>" })
- Completion/update: intercom({ action: "send", to: "{orchestratorTarget}", message: "DONE: <summary>" })
If intercom is unavailable in this run, continue the task normally.`;

export interface IntercomBridgeState {
	active: boolean;
	mode: IntercomBridgeMode;
	orchestratorTarget?: string;
	extensionDir: string;
	instruction: string;
}

interface ResolveIntercomBridgeInput {
	config: ExtensionConfig["intercomBridge"];
	context: "fresh" | "fork" | undefined;
	orchestratorTarget?: string;
	extensionDir?: string;
	configPath?: string;
	settingsDir?: string;
}

export function resolveIntercomSessionTarget(sessionName: string | undefined, sessionId: string): string {
	const trimmedName = sessionName?.trim();
	if (trimmedName) return trimmedName;
	const normalizedSessionId = sessionId.startsWith("session-") ? sessionId.slice("session-".length) : sessionId;
	return `${DEFAULT_INTERCOM_TARGET_PREFIX}-${normalizedSessionId.slice(0, 8)}`;
}

export function resolveIntercomBridgeMode(value: unknown): IntercomBridgeMode {
	if (value === "off" || value === "always" || value === "fork-only") return value;
	return "always";
}

function resolveIntercomBridgeConfig(value: ExtensionConfig["intercomBridge"]): Required<IntercomBridgeConfig> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return {
			mode: "always",
			instructionFile: "",
		};
	}
	return {
		mode: resolveIntercomBridgeMode(value.mode),
		instructionFile: typeof value.instructionFile === "string" ? value.instructionFile : "",
	};
}

function intercomEnabled(configPath: string): boolean {
	if (!fs.existsSync(configPath)) return true;
	try {
		const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8")) as { enabled?: unknown };
		return parsed.enabled !== false;
	} catch (error) {
		console.warn(`Failed to parse intercom config at '${configPath}'. Assuming enabled.`, error);
		return true;
	}
}

function extensionSandboxAllowsIntercom(extensions: string[] | undefined, extensionDir: string): boolean {
	if (extensions === undefined) return true;

	const intercomDir = path.resolve(extensionDir).replaceAll("\\", "/").toLowerCase();
	for (const entry of extensions) {
		const normalized = entry.trim().replaceAll("\\", "/").toLowerCase();
		if (normalized === "pi-intercom") return true;
		if (normalized === intercomDir) return true;
		if (normalized.startsWith(`${intercomDir}/`)) return true;
		if (normalized.endsWith("/pi-intercom")) return true;
		if (normalized.includes("/pi-intercom/")) return true;
	}
	return false;
}

function expandTilde(filePath: string): string {
	return filePath.startsWith("~/") ? path.join(os.homedir(), filePath.slice(2)) : filePath;
}

function resolveInstructionTemplate(instructionFile: string, settingsDir: string): string {
	if (!instructionFile) return DEFAULT_INTERCOM_BRIDGE_TEMPLATE;
	const expandedPath = expandTilde(instructionFile);
	const resolvedPath = path.isAbsolute(expandedPath)
		? expandedPath
		: path.resolve(settingsDir, expandedPath);
	try {
		return fs.readFileSync(resolvedPath, "utf-8");
	} catch (error) {
		console.warn(`Failed to read intercom bridge instructionFile at '${resolvedPath}'. Using default instructions.`, error);
		return DEFAULT_INTERCOM_BRIDGE_TEMPLATE;
	}
}

function buildIntercomBridgeInstruction(orchestratorTarget: string, template: string): string {
	const instruction = template.replaceAll("{orchestratorTarget}", orchestratorTarget).trim();
	if (instruction.startsWith(INTERCOM_BRIDGE_MARKER)) return instruction;
	return `${INTERCOM_BRIDGE_MARKER}
${instruction}`;
}

export function resolveIntercomBridge(input: ResolveIntercomBridgeInput): IntercomBridgeState {
	const config = resolveIntercomBridgeConfig(input.config);
	const mode = config.mode;
	const extensionDir = path.resolve(input.extensionDir ?? DEFAULT_INTERCOM_EXTENSION_DIR);
	const orchestratorTarget = input.orchestratorTarget?.trim();
	const settingsDir = path.resolve(input.settingsDir ?? DEFAULT_SUBAGENT_CONFIG_DIR);
	const defaultInstruction = buildIntercomBridgeInstruction(
		orchestratorTarget || "{orchestratorTarget}",
		DEFAULT_INTERCOM_BRIDGE_TEMPLATE,
	);

	if (mode === "off") {
		return { active: false, mode, extensionDir, instruction: defaultInstruction };
	}
	if (mode === "fork-only" && input.context !== "fork") {
		return { active: false, mode, extensionDir, instruction: defaultInstruction };
	}
	if (!orchestratorTarget) {
		return { active: false, mode, extensionDir, instruction: defaultInstruction };
	}
	if (!fs.existsSync(extensionDir)) {
		return { active: false, mode, extensionDir, instruction: defaultInstruction };
	}

	const configPath = path.resolve(input.configPath ?? DEFAULT_INTERCOM_CONFIG_PATH);
	if (!intercomEnabled(configPath)) {
		return { active: false, mode, extensionDir, instruction: defaultInstruction };
	}

	const instruction = buildIntercomBridgeInstruction(
		orchestratorTarget,
		resolveInstructionTemplate(config.instructionFile, settingsDir),
	);

	return {
		active: true,
		mode,
		orchestratorTarget,
		extensionDir,
		instruction,
	};
}

export function applyIntercomBridgeToAgent(agent: AgentConfig, bridge: IntercomBridgeState): AgentConfig {
	if (!bridge.active || !bridge.orchestratorTarget) return agent;
	if (!extensionSandboxAllowsIntercom(agent.extensions, bridge.extensionDir)) return agent;

	const tools = agent.tools && !agent.tools.includes("intercom")
		? [...agent.tools, "intercom"]
		: agent.tools;
	const instruction = bridge.instruction;
	const trimmedPrompt = agent.systemPrompt?.trim() || "";
	const systemPrompt = trimmedPrompt.includes(INTERCOM_BRIDGE_MARKER)
		? trimmedPrompt
		: trimmedPrompt
			? `${trimmedPrompt}\n\n${instruction}`
			: instruction;

	if (tools === agent.tools && systemPrompt === agent.systemPrompt) return agent;
	return {
		...agent,
		tools,
		systemPrompt,
	};
}
