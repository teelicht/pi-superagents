/**
 * Superpowers packet content for command-scoped role execution.
 *
 * Responsibilities:
 * - build the runtime-authored packet file content that carries a delegated task
 * - keep the packet a dispatch vehicle: the controller's task text (including any
 *   file-handoff paths from the subagent-driven-development skill) is embedded verbatim
 *
 * Important: the packet file is the dispatch prompt, not the requirements brief. Brief,
 * report, and review-package files are authored by the SDD skill's scripts and addressed
 * by path inside the embedded task text. The extension injects no `[Read from:]` /
 * `[Write to:]` references.
 */

import type { SessionMode } from "../shared/types.ts";

export function buildSuperpowersPacketContent(input: { agent: string; sessionMode: SessionMode; task: string; useTestDrivenDevelopment: boolean }): string {
	const modeLine = input.agent === "sp-implementer" ? `Implementer Mode: ${input.useTestDrivenDevelopment ? "tdd" : "direct"}` : null;

	return [
		"# Superpowers Work Packet",
		"",
		`Agent: ${input.agent}`,
		`Session Mode: ${input.sessionMode}`,
		"Use only the information in this packet. Do not rely on parent-session history that is not included here.",
		modeLine,
		"",
		input.task.trim(),
	]
		.filter((line): line is string => Boolean(line))
		.join("\n");
}
