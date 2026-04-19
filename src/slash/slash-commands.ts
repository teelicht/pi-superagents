/**
 * Lean slash command registration for Superpowers workflows.
 *
 * Responsibilities:
 * - register `/sp-implement`, `/sp-brainstorm`, `/sp-plan`, `/subagents-status`, `/sp-settings`, and configured custom commands
 * - parse workflow arguments and resolve run profiles from config defaults
 * - send root-session prompts via `sendUserMessage`
 * - send skill-entry prompts for supported entry skills (e.g. brainstorming)
 *
 * Important dependencies:
 * - `superpowers/workflow-profile` for argument parsing and profile resolution
 * - `superpowers/root-prompt` for prompt construction
 * - `superpowers/skill-entry` for skill-entry prompt building
 * - `shared/types` for `ExtensionConfig`, `SubagentState`, `SuperpowersCommandPreset`
 * - `shared/skills` for `resolveAvailableSkill` and `resolveSkills`
 * - `ui/subagents-status` for the run status overlay
 * - `ui/sp-settings` for the settings overlay
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

/**
 * Model option from the model registry.
 */
interface SettingsModelOption {
	provider: string;
	id: string;
	name?: string;
}

/**
 * Config source type: either a static config object or a config accessor function.
 * Allows slash commands to read fresh config values at execution time.
 */
export type ConfigSource = ExtensionConfig | (() => ExtensionConfig);

/**
 * Read config from a config source.
 *
 * @param source Either a static config object or a config accessor function.
 * @returns The effective config.
 */
function readConfig(source: ConfigSource): ExtensionConfig {
	return typeof source === "function" ? source() : source;
}

import { resolveAvailableSkill, resolveSkills } from "../shared/skills.ts";
import type { ExtensionConfig, SubagentState, SuperpowersCommandPreset } from "../shared/types.ts";
import { createSuperpowersPromptDispatcher } from "../superpowers/prompt-dispatch.ts";
import { buildSuperpowersVisiblePromptSummary } from "../superpowers/root-prompt.ts";
import { buildResolvedSkillEntryPrompt } from "../superpowers/skill-entry.ts";
import {
	parseSuperpowersWorkflowArgs,
	type ResolvedSuperpowersRunProfile,
	resolveSuperpowersRunProfile,
} from "../superpowers/workflow-profile.ts";
import { SuperpowersSettingsComponent } from "../ui/sp-settings.ts";
import { SubagentsStatusComponent } from "../ui/subagents-status.ts";

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
 * Send a Superpowers root-session prompt for a resolved profile.
 *
 * @param dispatcher Prompt dispatcher that pairs visible summaries with hidden contracts.
 * @param ctx Current extension context.
 * @param profile Resolved Superpowers run profile.
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
			worktrees: profile.worktrees,
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
	await ctx.ui.custom<void>((tui, theme, _kb, done) => {
		return new SubagentsStatusComponent(tui, theme, () => done(undefined));
	});
}

/**
 * Open the Superpowers settings overlay when UI is available.
 *
 * @param ctx Current extension command context.
 * @param state Shared extension state for config gate checks.
 * @param configSource Effective extension config displayed in the overlay.
 * @param reloadConfig Optional callback to reload config after changes.
 */
async function openSuperpowersSettingsOverlay(
	ctx: ExtensionContext,
	state: SubagentState,
	configSource: ConfigSource,
	reloadConfig?: () => void,
): Promise<void> {
	if (!ctx.hasUI) return;
	const config = readConfig(configSource);

	// Get model options from the model registry
	let modelOptions: SettingsModelOption[] = [];
	let modelRegistryError: string | undefined;

	// Try to get models from the context's model registry
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	if ("modelRegistry" in ctx && (ctx as any).modelRegistry) {
		const registry = ctx.modelRegistry as {
			getAvailable?: () => SettingsModelOption[];
			getError?: () => string | undefined;
		};
		if (registry.getAvailable) {
			try {
				modelOptions = registry.getAvailable() ?? [];
			} catch {
				modelRegistryError = "Failed to load models";
			}
		}
		if (registry.getError) {
			modelRegistryError = registry.getError();
		}
	}

	await ctx.ui.custom<void>((tui, theme, _kb, done) => {
		return new SuperpowersSettingsComponent(tui, theme, state, config, () => readConfig(configSource), {
			models: modelOptions,
			modelRegistryError,
			reloadConfig,
			onClose: () => done(undefined),
		});
	});
}

/**
 * Register a single Superpowers slash command with argument parsing and prompt dispatch.
 *
 * @param pi Extension API for command registration and message sending.
 * @param dispatcher Prompt dispatcher used to hide strict contracts from chat.
 * @param state Shared extension state for config gate checks.
 * @param configSource Effective extension config for default resolution.
 * @param commandName Slash command name without leading slash.
 * @param preset Command preset containing entrySkill and policy options.
 */
function registerSuperpowersCommand(
	pi: ExtensionAPI,
	dispatcher: ReturnType<typeof createSuperpowersPromptDispatcher>,
	state: SubagentState,
	configSource: ConfigSource,
	commandName: string,
	preset: SuperpowersCommandPreset,
): void {
	pi.registerCommand(commandName, {
		description: preset.description ?? `Run Superpowers using the ${commandName} preset`,
		handler: (rawArgs, ctx) => {
			if (notifyIfConfigBlocked(state, ctx)) return Promise.resolve();
			const config = readConfig(configSource);
			const parsed = parseSuperpowersWorkflowArgs(rawArgs);
			if (!parsed?.task) {
				if (ctx.hasUI) {
					ctx.ui.notify(
						`Usage: /${commandName} [lean|full|tdd|direct|subagents|no-subagents] <task> [--fork]`,
						"error",
					);
				}
				return Promise.resolve();
			}
			const profile = resolveSuperpowersRunProfile({
				config,
				commandName,
				parsed,
				entrySkill: preset.entrySkill,
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
 * - `/sp-implement` — primary implementation workflow command
 * - `/sp-brainstorm` — Superpowers-backed brainstorming entry command
 * - `/sp-plan` — Superpowers-backed planning entry command
 * - `/subagents-status` — subagent run status overlay
 * - `/sp-settings` — Superpowers and subagent workflow settings overlay
 * - `Ctrl+Alt+S` — keyboard shortcut for subagents status
 * - Any configured custom command presets from `config.superagents.commands`
 *
 * @param pi Extension API for command registration.
 * @param state Shared extension state for config gate checks.
 * @param configSource Effective extension config for default resolution.
 * @param reloadConfig Optional callback to reload config after settings changes.
 */
export function registerSlashCommands(
	pi: ExtensionAPI,
	state: SubagentState,
	configSource: ConfigSource,
	reloadConfig?: () => void,
): void {
	const config = readConfig(configSource);
	const dispatcher = createSuperpowersPromptDispatcher(pi);

	// Register all commands (built-in + custom) from current config
	for (const [commandName, preset] of Object.entries(config.superagents?.commands ?? {})) {
		registerSuperpowersCommand(pi, dispatcher, state, configSource, commandName, preset);
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
			await openSuperpowersSettingsOverlay(ctx, state, configSource, reloadConfig);
		},
	});
}
