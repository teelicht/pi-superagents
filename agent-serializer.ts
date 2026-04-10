/**
 * Agent frontmatter serialization helpers.
 *
 * Responsibilities:
 * - serialize agent configs into canonical markdown frontmatter
 * - update individual frontmatter fields in-place
 * - enforce the supported frontmatter field contract
 */

import * as fs from "node:fs";
import type { AgentConfig } from "./agents.ts";

export const KNOWN_FIELDS = new Set([
	"name",
	"description",
	"tools",
	"model",
	"thinking",
	"skills",
	"extensions",
	"output",
	"defaultReads",
	"defaultProgress",
	"interactive",
	"maxSubagentDepth",
]);

/**
 * Join an optional string list into the canonical frontmatter CSV representation.
 *
 * @param values Optional ordered values to serialize.
 * @returns A comma-separated string, or `undefined` when no values are present.
 */
function joinComma(values: string[] | undefined): string | undefined {
	if (!values || values.length === 0) return undefined;
	return values.join(", ");
}

/**
 * Serialize one agent config into canonical markdown frontmatter.
 *
 * @param config Agent configuration to persist.
 * @returns Markdown contents ready to write to an agent definition file.
 */
export function serializeAgent(config: AgentConfig): string {
	const lines: string[] = [];
	lines.push("---");
	lines.push(`name: ${config.name}`);
	lines.push(`description: ${config.description}`);

	const tools = [
		...(config.tools ?? []),
		...(config.mcpDirectTools ?? []).map((tool) => `mcp:${tool}`),
	];
	const toolsValue = joinComma(tools);
	if (toolsValue) lines.push(`tools: ${toolsValue}`);

	if (config.model) lines.push(`model: ${config.model}`);
	if (config.thinking && config.thinking !== "off") lines.push(`thinking: ${config.thinking}`);

	const skillsValue = joinComma(config.skills);
	if (skillsValue) lines.push(`skills: ${skillsValue}`);

	if (config.extensions !== undefined) {
		const extensionsValue = joinComma(config.extensions);
		lines.push(`extensions: ${extensionsValue ?? ""}`);
	}

	if (config.output) lines.push(`output: ${config.output}`);

	const readsValue = joinComma(config.defaultReads);
	if (readsValue) lines.push(`defaultReads: ${readsValue}`);

	if (config.defaultProgress) lines.push("defaultProgress: true");
	if (config.interactive) lines.push("interactive: true");
	if (Number.isInteger(config.maxSubagentDepth) && config.maxSubagentDepth >= 0) {
		lines.push(`maxSubagentDepth: ${config.maxSubagentDepth}`);
	}

	if (config.extraFields) {
		for (const [key, value] of Object.entries(config.extraFields)) {
			if (KNOWN_FIELDS.has(key)) continue;
			lines.push(`${key}: ${value}`);
		}
	}

	lines.push("---");

	const body = config.systemPrompt ?? "";
	return `${lines.join("\n")}\n\n${body}\n`;
}

/**
 * Update one supported frontmatter field inside an existing agent definition file.
 *
 * @param filePath Absolute or workspace-relative path to the markdown file.
 * @param field Canonical frontmatter field name to update.
 * @param value Replacement value, or `undefined` to remove the field.
 * @throws When the file has no frontmatter block.
 * @throws When callers try to write the removed legacy `skill` alias.
 */
export function updateFrontmatterField(filePath: string, field: string, value: string | undefined): void {
	if (field === "skill") {
		throw new Error("Legacy 'skill' field is not supported. Use 'skills' instead.");
	}

	const raw = fs.readFileSync(filePath, "utf-8");
	const normalized = raw.replace(/\r\n/g, "\n");
	if (!normalized.startsWith("---")) {
		throw new Error("Frontmatter not found");
	}

	const endIndex = normalized.indexOf("\n---", 3);
	if (endIndex === -1) {
		throw new Error("Frontmatter not found");
	}

	const frontmatterBlock = normalized.slice(4, endIndex);
	const rest = normalized.slice(endIndex + 4);
	const lines = frontmatterBlock.split("\n");

	let found = false;
	const updated: string[] = [];

	for (const line of lines) {
		const match = line.match(/^([\w-]+):\s*(.*)$/);
		if (match && match[1] === field) {
			if (value !== undefined) {
				if (!found) updated.push(`${field}: ${value}`);
				found = true;
			}
			continue;
		}
		updated.push(line);
	}

	if (value !== undefined && !found) {
		updated.push(`${field}: ${value}`);
	}

	const frontmatter = `---\n${updated.join("\n")}\n---`;
	fs.writeFileSync(filePath, frontmatter + rest, "utf-8");
}
