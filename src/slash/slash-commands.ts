/**
 * Lean slash command registration for Superpowers workflows.
 *
 * Responsibilities:
 * - register `/superpowers`, `/sp-brainstorm`, `/superpowers-status`, and configured custom commands
 * - parse workflow arguments and resolve run profiles from config defaults
 * - send root-session prompts via `sendUserMessage`
 * - send skill-entry prompts for supported entry skills (e.g. brainstorming)
 *
 * Important dependencies:
 * - `superpowers/workflow-profile` for argument parsing and profile resolution
 * - `superpowers/root-prompt` for prompt construction
 * - `superpowers/skill-entry` for skill-entry prompt building
 * - `shared/types` for `ExtensionConfig`, `SubagentState`
 * - `shared/skills` for `resolveAvailableSkill` and `resolveSkills`
 * - `ui/superpowers-status` for the status overlay
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { ExtensionConfig, SubagentState } from "../shared/types.ts";
import { resolveAvailableSkill, resolveSkills } from "../shared/skills.ts";
import { SuperpowersStatusComponent } from "../ui/superpowers-status.ts";
import {
	parseSuperpowersWorkflowArgs,
	resolveSuperpowersRunProfile,
	type ResolvedSuperpowersRunProfile,
} from "../superpowers/workflow-profile.ts";
import { buildSuperpowersRootPrompt } from "../superpowers/root-prompt.ts";
import { buildResolvedSkillEntryPrompt } from "../superpowers/skill-entry.ts";

/**
 * Notify the user when config errors disable execution.
 *
 * @param state Shared extension state containing the config gate.
 * @param ctx Current extension context.
 * @returns True when execution should stop.
 */
function notifyIfConfigBlocked(state: SubagentState, ctx: ExtensionContext): boolean {
	if (!state.configGate.blocked) return false;
	if (ctx.hasUI) ctx.ui.notify(state.configGate.message, "error");
	return true;
}

/**
 * Send a Superpowers root-session prompt, either immediately or as a follow-up
 * when the agent is already streaming.
 *
 * @param pi Extension API for sending messages.
 * @param ctx Current extension command context.
 * @param profile Fully resolved run profile.
 */
function sendSuperpowersPrompt(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	profile: ResolvedSuperpowersRunProfile,
): void {
	const usingSuperpowersSkill = resolveAvailableSkill(ctx.cwd, "using-superpowers");
	const prompt = buildSuperpowersRootPrompt({
		task: profile.task,
		useSubagents: profile.useSubagents,
		useTestDrivenDevelopment: profile.useTestDrivenDevelopment,
		usePlannotatorReview: profile.usePlannotatorReview,
		worktreesEnabled: profile.worktreesEnabled,
		fork: profile.fork,
		usingSuperpowersSkill,
	});
	if (ctx.isIdle()) {
		pi.sendUserMessage(prompt);
		return;
	}
	pi.sendUserMessage(prompt, { deliverAs: "followUp" });
	if (ctx.hasUI) ctx.ui.notify("Queued Superpowers workflow as a follow-up", "info");
}

/**
 * Send a Superpowers root-session prompt for a supported entry skill.
 *
 * @param pi Extension API for sending messages.
 * @param ctx Current command context.
 * @param profile Resolved Superpowers run profile with entry-skill metadata.
 */
function sendSkillEntryPrompt(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	profile: ResolvedSuperpowersRunProfile,
): void {
	const promptResult = buildResolvedSkillEntryPrompt({
		cwd: ctx.cwd,
		profile,
		resolveSkill: resolveAvailableSkill,
		resolveSkillNames: resolveSkills,
	});
	if ("error" in promptResult) {
		if (ctx.hasUI) ctx.ui.notify(promptResult.error, "error");
		return;
	}

	if (ctx.isIdle()) {
		pi.sendUserMessage(promptResult.prompt);
		return;
	}
	pi.sendUserMessage(promptResult.prompt, { deliverAs: "followUp" });
	if (ctx.hasUI) ctx.ui.notify("Queued Superpowers skill-entry workflow as a follow-up", "info");
}

/**
 * Register a single Superpowers slash command with argument parsing and prompt dispatch.
 *
 * @param pi Extension API for command registration and message sending.
 * @param state Shared extension state for config gate checks.
 * @param config Effective extension config for default resolution.
 * @param commandName Slash command name without leading slash.
 * @param description Command description shown in help.
 */
function registerSuperpowersCommand(
	pi: ExtensionAPI,
	state: SubagentState,
	config: ExtensionConfig,
	commandName: string,
	description: string,
): void {
	pi.registerCommand(commandName, {
		description,
		handler: (rawArgs, ctx) => {
			if (notifyIfConfigBlocked(state, ctx)) return Promise.resolve();
			const parsed = parseSuperpowersWorkflowArgs(rawArgs);
			if (!parsed?.task) {
				if (ctx.hasUI) {
					ctx.ui.notify(`Usage: /${commandName} [lean|full|tdd|direct|subagents|no-subagents] <task> [--fork]`, "error");
				}
				return Promise.resolve();
			}
			const profile = resolveSuperpowersRunProfile({ config, commandName, parsed });
			sendSuperpowersPrompt(pi, ctx, profile);
			return Promise.resolve();
		},
	});
}

/**
 * Register the explicit Superpowers-backed brainstorming command.
 *
 * @param pi Extension API for command registration and message sending.
 * @param state Shared extension state for config gate checks.
 * @param config Effective extension config for profile resolution.
 */
function registerBrainstormCommand(
	pi: ExtensionAPI,
	state: SubagentState,
	config: ExtensionConfig,
): void {
	pi.registerCommand("sp-brainstorm", {
		description: "Run brainstorming through the Superpowers workflow profile",
		handler: (rawArgs, ctx) => {
			if (notifyIfConfigBlocked(state, ctx)) return Promise.resolve();
			const task = rawArgs.trim();
			if (!task) {
				if (ctx.hasUI) ctx.ui.notify("Usage: /sp-brainstorm <task>", "error");
				return Promise.resolve();
			}
			const parsed = parseSuperpowersWorkflowArgs(task);
			if (!parsed) {
				if (ctx.hasUI) ctx.ui.notify("Usage: /sp-brainstorm <task>", "error");
				return Promise.resolve();
			}
			const profile = resolveSuperpowersRunProfile({
				config,
				commandName: "sp-brainstorm",
				parsed,
				entrySkill: {
					name: "brainstorming",
					source: "command",
				},
			});
			sendSkillEntryPrompt(pi, ctx, profile);
			return Promise.resolve();
		},
	});
}

/**
 * Register all Superpowers slash commands with the Pi extension API.
 *
 * Registers:
 * - `/superpowers` — primary workflow command
 * - `/sp-brainstorm` — Superpowers-backed brainstorming entry command
 * - `/superpowers-status` — status and settings overlay
 * - Any configured custom command presets from `config.superagents.commands`
 *
 * @param pi Extension API for command registration.
 * @param state Shared extension state for config gate checks.
 * @param config Effective extension config for default resolution.
 */
export function registerSlashCommands(
	pi: ExtensionAPI,
	state: SubagentState,
	config: ExtensionConfig,
): void {
	registerSuperpowersCommand(
		pi,
		state,
		config,
		"superpowers",
		"Run a Superpowers workflow: /superpowers [lean|full|tdd|direct|subagents|no-subagents] <task> [--fork]",
	);

	registerBrainstormCommand(pi, state, config);

	for (const [commandName, preset] of Object.entries(config.superagents?.commands ?? {})) {
		registerSuperpowersCommand(
			pi,
			state,
			config,
			commandName,
			preset.description ?? `Run Superpowers using the ${commandName} preset`,
		);
	}

	pi.registerCommand("superpowers-status", {
		description: "Show Superpowers run status and settings",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;
			await ctx.ui.custom<void>(
				(tui, theme, _kb, done) => new SuperpowersStatusComponent(tui, theme, state, config, () => done(undefined)),
				{ overlay: true, overlayOptions: { anchor: "center", width: 92, maxHeight: "80%" } },
			);
		},
	});
}
