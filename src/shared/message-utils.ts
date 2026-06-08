/**
 * Message extraction and child-result error detection helpers.
 *
 * Responsibilities:
 * - derive displayable assistant output from Pi messages
 * - normalize nested message content into text
 * - detect unrecovered subagent tool failures from message streams
 *
 * Important dependencies/side effects:
 * - consumes Pi message shapes and shared result/error contracts
 * - performs no I/O and has no side effects
 */

import type { Message } from "@earendil-works/pi-ai";
import type { DisplayItem, ErrorInfo, SingleResult } from "./types.ts";

/**
 * Return the final assistant text output from a message list.
 *
 * @param messages Ordered Pi message stream.
 * @returns The first text part from the last assistant message, or an empty string.
 */
export function getFinalOutput(messages: Message[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") return part.text;
			}
		}
	}
	return "";
}

/**
 * Return a child result's cached final output or derive it from messages.
 *
 * @param result Result-like object with optional cached output and messages.
 * @returns Displayable final output string.
 */
export function getSingleResultOutput(result: Pick<SingleResult, "finalOutput" | "messages">): string {
	return result.finalOutput ?? getFinalOutput(result.messages);
}

/**
 * Extract display items from assistant message text and tool calls.
 *
 * @param messages Ordered Pi message stream.
 * @returns Display item list preserving message order.
 */
// fallow-ignore-next-line unused-export
export function getDisplayItems(messages: Message[]): DisplayItem[] {
	const items: DisplayItem[] = [];
	for (const msg of messages) {
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") items.push({ type: "text", text: part.text });
				else if (part.type === "toolCall") items.push({ type: "tool", name: part.name, args: part.arguments });
			}
		}
	}
	return items;
}

/**
 * Detect unrecovered subagent execution errors in a message stream.
 *
 * @param messages Ordered Pi message stream.
 * @returns Error metadata when a post-response tool failure is found; otherwise `{ hasError: false }`.
 */
export function detectSubagentError(messages: Message[]): ErrorInfo {
	// Step 1: Find the last assistant message with text content.
	// If the agent produced a text response after encountering errors,
	// it had a chance to recover — only errors AFTER this point matter.
	let lastAssistantTextIndex = -1;
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			const hasText = Array.isArray(msg.content) && msg.content.some((c) => c.type === "text" && "text" in c && c.text.trim().length > 0);
			if (hasText) {
				lastAssistantTextIndex = i;
				break;
			}
		}
	}

	// Step 2: Only scan tool results AFTER the last assistant text message.
	// Errors before the agent's final response are implicitly recovered.
	const scanStart = lastAssistantTextIndex >= 0 ? lastAssistantTextIndex + 1 : 0;

	// Step 3: Check tool results in the post-response window.
	for (let i = messages.length - 1; i >= scanStart; i--) {
		const msg = messages[i];
		if (msg.role !== "toolResult") continue;

		const explicitError = detectExplicitToolResultError(msg);
		if (explicitError) return explicitError;

		const bashError = detectBashToolResultError(msg);
		if (bashError) return bashError;
	}

	return { hasError: false };
}

/**
 * Extract text content from plain strings and nested Pi content arrays.
 *
 * @param content Unknown content payload from a message or tool result.
 * @returns Joined text content, or an empty string when no text exists.
 */
export function extractTextFromContent(content: unknown): string {
	if (!content) return "";
	// Handle string content directly.
	if (typeof content === "string") return content;
	// Handle array content.
	if (!Array.isArray(content)) return "";
	const texts: string[] = [];
	for (const part of content) {
		if (part && typeof part === "object") {
			const p = part as Record<string, unknown>;
			// Handle { type: "text", text: "..." }.
			if (p.type === "text" && "text" in p) {
				texts.push(String(p.text));
			}
			// Handle { type: "tool_result", content: "..." }.
			else if (p.type === "tool_result" && "content" in p) {
				const inner = extractTextFromContent(p.content);
				if (inner) texts.push(inner);
			}
			// Handle { text: "..." } without type.
			else if ("text" in p) {
				texts.push(String(p.text));
			}
		}
	}
	return texts.join("\n");
}

/**
 * Detect an explicit `isError` tool result.
 *
 * @param msg Tool-result message to inspect.
 * @returns Error info when the tool result explicitly reports failure.
 */
function detectExplicitToolResultError(msg: Message): ErrorInfo | undefined {
	const isError = "isError" in msg && Boolean((msg as { isError?: boolean }).isError);
	if (!isError) return undefined;

	const details = extractTextFromContent(msg.content) || undefined;
	const exitMatch = details?.match(/exit(?:ed)?\s*(?:with\s*)?(?:code|status)?\s*[:\s]?\s*(\d+)/i);
	return {
		hasError: true,
		exitCode: exitMatch ? parseInt(exitMatch[1], 10) : 1,
		errorType: ("toolName" in msg ? String((msg as { toolName?: unknown }).toolName) : undefined) || "tool",
		details: details?.slice(0, 200),
	};
}

/**
 * Detect fatal bash output patterns in a tool result.
 *
 * @param msg Tool-result message to inspect.
 * @returns Error info when bash output contains a non-zero exit or fatal pattern.
 */
function detectBashToolResultError(msg: Message): ErrorInfo | undefined {
	const toolName = "toolName" in msg ? String((msg as { toolName?: unknown }).toolName) : undefined;
	if (toolName !== "bash") return undefined;

	const output = extractTextFromContent(msg.content);
	if (!output) return undefined;

	const exitMatch = output.match(/exit(?:ed)?\s*(?:with\s*)?(?:code|status)?\s*[:\s]?\s*(\d+)/i);
	if (exitMatch) {
		const code = parseInt(exitMatch[1], 10);
		if (code !== 0) {
			return { hasError: true, exitCode: code, errorType: "bash", details: output.slice(0, 200) };
		}
	}

	// NOTE: These patterns can match legitimate output (grep results, logs,
	// testing). With the assistant-message check above, most false positives
	// are mitigated since the agent will have responded after routine errors.
	const fatalPatterns = [
		/command not found/i,
		/permission denied/i,
		/no such file or directory/i,
		/segmentation fault/i,
		/killed|terminated/i,
		/out of memory/i,
		/connection refused/i,
		/timeout/i,
	];
	for (const pattern of fatalPatterns) {
		if (pattern.test(output)) {
			return { hasError: true, exitCode: 1, errorType: "bash", details: output.slice(0, 200) };
		}
	}
	return undefined;
}
