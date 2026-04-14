/**
 * Lean slash command registration for Superpowers workflows.
 *
 * Responsibilities:
 * - register `/sp-implement`, `/sp-brainstorm`, `/subagents-status`, `/sp-settings`, and configured custom commands
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
 * - `ui/subagents-status` for the run status overlay
 * - `ui/sp-settings` for the settings overlay
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { ExtensionConfig, SubagentState } from "../shared/types.ts";
import { resolveAvailableSkill, resolveSkills } from "../shared/skills.ts";
import { SubagentsStatusComponent } from "../ui/subagents-status.ts";
import { SuperpowersSettingsComponent } from "../ui/sp-settings.ts";
import {
	parseSuperpowersWorkflowArgs,
	resolveSuperpowersRunProfile,
	type ResolvedSuperpowersRunProfile,
} from "../superpowers/workflow-profile.ts";
import { buildSuperpowersRootPrompt, buildSuperpowersVisiblePromptSummary } from "../superpowers/root-prompt.ts";
import { buildResolvedSkillEntryPrompt } from "../superpowers/skill-entry.ts";
import { createSuperpowersPromptDispatcher } from "../superpowers/prompt-dispatch.ts";

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
 * @param dispatcher Prompt dispatcher that pairs visible summaries with hidden contracts.
 * @param ctx Current extension command context.
 * @param profile Fully resolved run profile.
 */
function sendSuperpowersPrompt(
	dispatcher: ReturnType<typeof createSuperpowersPromptDispatcher>,
	ctx: ExtensionContext,
	profile: ResolvedSuperpowersRunProfile,
): void {
	const usingSuperpowersSkill = resolveAvailableSkill(ctx.cwd, "using-superpowers");
	const promptInput = {
		task: profile.task,
		useBranches: profile.useBranches,
		useSubagents: profile.useSubagents,
		useTestDrivenDevelopment: profile.useTestDrivenDevelopment,
		usePlannotatorReview: profile.usePlannotatorReview,
		worktreesEnabled: profile.worktreesEnabled,
		fork: profile.fork,
		usingSuperpowersSkill,
	};
	const wasIdle = ctx.isIdle();
	dispatcher.send(
		buildSuperpowersVisiblePromptSummary(promptInput),
		buildSuperpowersRootPrompt(promptInput),
		ctx,
	);
	if (!wasIdle && ctx.hasUI) ctx.ui.notify("Queued Superpowers workflow as a follow-up", "info");
}

/**
 * Send a Superpowers root-session prompt for a supported entry skill.
 *
 * @param dispatcher Prompt dispatcher that pairs visible summaries with hidden contracts.
 * @param ctx Current command context.
 * @param profile Resolved Superpowers run profile with entry-skill metadata.
 */
function sendSkillEntryPrompt(
	dispatcher: ReturnType<typeof createSuperpowersPromptDispatcher>,
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

	const wasIdle = ctx.isIdle();
	dispatcher.send(
		buildSuperpowersVisiblePromptSummary({
			task: profile.task,
			useBranches: profile.useBranches,
			useSubagents: profile.useSubagents,
			useTestDrivenDevelopment: profile.useTestDrivenDevelopment,
			usePlannotatorReview: profile.usePlannotatorReview,
			worktreesEnabled: profile.worktreesEnabled,
			fork: profile.fork,
		}),
		promptResult.prompt,
		ctx,
	);
	if (!wasIdle && ctx.hasUI) ctx.ui.notify("Queued Superpowers skill-entry workflow as a follow-up", "info");
}

/**
 * Open the Subagents status overlay when UI is available.
 *
 * @param ctx Current extension command or shortcut context.
 */
async function openSubagentsStatusOverlay(ctx: ExtensionContext): Promise<void> {
	if (!ctx.hasUI) return;
	await ctx.ui.custom<void>(
		(tui, theme, _kb, done) => new SubagentsStatusComponent(tui, theme, () => done(undefined)),
		{ overlay: true, overlayOptions: { anchor: "center", width: 92, maxHeight: "80%" } },
	);
}

/**
 * Open the Superpowers settings overlay when UI is available.
 *
 * @param ctx Current extension command context.
 * @param state Shared extension state for config gate checks.
 * @param config Effective extension config displayed in the overlay.
 */
async function openSuperpowersSettingsOverlay(
	ctx: ExtensionContext,
	state: SubagentState,
	config: ExtensionConfig,
): Promise<void> {
	if (!ctx.hasUI) return;
	await ctx.ui.custom<void>(
		(tui, theme, _kb, done) => new SuperpowersSettingsComponent(tui, theme, state, config, () => done(undefined)),
		{ overlay: true, overlayOptions: { anchor: "center", width: 92, maxHeight: "80%" } },
	);
}

/**
 * Register a single Superpowers slash command with argument parsing and prompt dispatch.
 *
 * @param pi Extension API for command registration and message sending.
 * @param dispatcher Prompt dispatcher used to hide strict contracts from chat.
 * @param state Shared extension state for config gate checks.
 * @param config Effective extension config for default resolution.
 * @param commandName Slash command name without leading slash.
 * @param description Command description shown in help.
 */
function registerSuperpowersCommand(
	pi: ExtensionAPI,
	dispatcher: ReturnType<typeof createSuperpowersPromptDispatcher>,
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
			sendSuperpowersPrompt(dispatcher, ctx, profile);
			return Promise.resolve();
		},
	});
}

/**
 * Register the explicit Superpowers-backed brainstorming command.
 *
 * @param pi Extension API for command registration and message sending.
 * @param dispatcher Prompt dispatcher used to hide strict contracts from chat.
 * @param state Shared extension state for config gate checks.
 * @param config Effective extension config for profile resolution.
 */
function registerBrainstormCommand(
	pi: ExtensionAPI,
	dispatcher: ReturnType<typeof createSuperpowersPromptDispatcher>,
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
			sendSkillEntryPrompt(dispatcher, ctx, profile);
			return Promise.resolve();
		},
	});
}

/**
 * Register all Superpowers slash commands with the Pi extension API.
 *
 * Registers:
 * - `/sp-implement` — primary workflow command
 * - `/sp-brainstorm` — Superpowers-backed brainstorming entry command
 * - `/subagents-status` — subagent run status overlay
 * - `/sp-settings` — Superpowers and subagent workflow settings overlay
 * - `Ctrl+Alt+S` — keyboard shortcut for subagents status
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
	const dispatcher = createSuperpowersPromptDispatcher(pi);

	registerSuperpowersCommand(
		pi,
		dispatcher,
		state,
		config,
		"sp-implement",
		"Run a Superpowers implementation workflow: /sp-implement [lean|full|tdd|direct|subagents|no-subagents] <task> [--fork]",
	);

	registerBrainstormCommand(pi, dispatcher, state, config);

	for (const [commandName, preset] of Object.entries(config.superagents?.commands ?? {})) {
		registerSuperpowersCommand(
			pi,
			dispatcher,
			state,
			config,
			commandName,
			preset.description ?? `Run Superpowers using the ${commandName} preset`,
		);
	}

	pi.registerCommand("subagents-status", {
		description: "Show active and recent subagent run status",
		handler: async (_args, ctx) => {
			await openSubagentsStatusOverlay(ctx);
		},
	});

	pi.registerShortcut("ctrl+alt+s", {
		description: "Open subagents status",
		handler: async (ctx) => {
			await openSubagentsStatusOverlay(ctx);
		},
	});

	pi.registerCommand("sp-settings", {
		description: "Show Superpowers and subagent workflow settings",
		handler: async (_args, ctx) => {
			await openSuperpowersSettingsOverlay(ctx, state, config);
		},
	});
}
