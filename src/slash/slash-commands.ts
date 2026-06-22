/**
 * Lean slash command registration for Superpowers workflows.
 *
 * Responsibilities:
 * - register Superpowers entrypoint commands from interactive entrypoint agent files
 * - parse workflow arguments and resolve run profiles from config defaults
 * - send root-session prompts via `sendUserMessage`
 * - send skill-entry prompts for supported entry skills (e.g. brainstorming)
 *
 * Custom commands require entrypoint agent markdown files (not config-only definitions).
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

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

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

import type { AgentConfig } from "../agents/agents.ts";
import { discoverAgents } from "../agents/agents.ts";
import { resolveAvailableSkill, resolveSkills } from "../shared/skills.ts";
import type { ExtensionConfig, SubagentState } from "../shared/types.ts";
import { createSuperpowersPromptDispatcher } from "../superpowers/prompt-dispatch.ts";
import { buildSuperpowersVisiblePromptSummary } from "../superpowers/root-prompt.ts";
import { buildResolvedSkillEntryPrompt } from "../superpowers/skill-entry.ts";
import { parseSuperpowersWorkflowArgs, type ResolvedSuperpowersRunProfile, resolveSuperpowersRunProfile } from "../superpowers/workflow-profile.ts";
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
 * @param state Shared extension state; mutated to arm the compaction-durability opt-in flag.
 */
function sendSkillEntryPrompt(
	dispatcher: ReturnType<typeof createSuperpowersPromptDispatcher>,
	ctx: ExtensionContext,
	profile: ResolvedSuperpowersRunProfile,
	state: SubagentState,
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

	// Arm the compaction-durability opt-in flag at dispatch time so the
	// session_compact/context re-injection handlers can re-arm the root
	// contract after compaction.
	state.superpowersActive = true;
	state.compactionSizing = null;
	state.rootLifecycleSkillNames = profile.rootLifecycleSkillNames ?? [];
	state.rootPromptProfile = profile;

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
async function openSuperpowersSettingsOverlay(ctx: ExtensionContext, state: SubagentState, configSource: ConfigSource, reloadConfig?: () => void): Promise<void> {
	if (!ctx.hasUI) return;
	// Get model options from the model registry
	let modelOptions: SettingsModelOption[] = [];
	let modelRegistryError: string | undefined;

	// Access modelRegistry from ExtensionContext (available in Pi 0.72+)
	const registry = ctx.modelRegistry;
	if (registry) {
		try {
			// getAvailable() returns Model<Api>[], map to SettingsModelOption[]
			const models = registry.getAvailable?.() ?? [];
			modelOptions = models.map((m) => ({
				provider: m.provider,
				id: m.id,
				name: m.name,
			}));
		} catch {
			modelRegistryError = "Failed to load models";
		}
		// Check for models.json load errors
		modelRegistryError = registry.getError?.() ?? modelRegistryError;
	}

	await ctx.ui.custom<void>((tui, theme, _kb, done) => {
		return new SuperpowersSettingsComponent(tui, theme, state, () => readConfig(configSource), {
			models: modelOptions,
			modelRegistryError,
			reloadConfig,
			onClose: () => done(undefined),
		});
	});
}

/**
 * Register a single Superpowers slash command from an interactive entrypoint agent.
 *
 * @param pi Extension API for command registration and message sending.
 * @param dispatcher Prompt dispatcher used to hide strict contracts from chat.
 * @param state Shared extension state for config gate checks.
 * @param configSource Effective extension config for default resolution.
 * @param entrypointAgent The interactive entrypoint agent providing command metadata.
 */
function registerSuperpowersCommand(
	pi: ExtensionAPI,
	dispatcher: ReturnType<typeof createSuperpowersPromptDispatcher>,
	state: SubagentState,
	configSource: ConfigSource,
	entrypointAgent: AgentConfig,
): void {
	const commandName = entrypointAgent.command ?? entrypointAgent.name;
	pi.registerCommand(commandName, {
		description: entrypointAgent.description,
		handler: (rawArgs, ctx) => {
			if (notifyIfConfigBlocked(state, ctx)) return Promise.resolve();
			const config = readConfig(configSource);
			const parsed = parseSuperpowersWorkflowArgs(rawArgs);
			if (!parsed?.task) {
				if (ctx.hasUI) {
					ctx.ui.notify(`Usage: /${commandName} [lean|full|tdd|direct|subagents|no-subagents] <task> [--fork]`, "error");
				}
				return Promise.resolve();
			}
			const profile = resolveSuperpowersRunProfile({
				config,
				commandName,
				parsed,
				entrypointAgent,
			});
			sendSkillEntryPrompt(dispatcher, ctx, profile, state);
			return Promise.resolve();
		},
	});
}

/**
 * Register all Superpowers slash commands with the Pi extension API.
 *
 * Registers:
 * - Superpowers entrypoint commands from discovered interactive entrypoint agent files
 * - `/subagents-status` — subagent run status overlay
 * - `/sp-settings` — Superpowers and subagent workflow settings overlay
 * - `Ctrl+Alt+S` — keyboard shortcut for subagents status
 *
 * Custom commands require entrypoint agent markdown files (not config-only definitions).
 *
 * @param pi Extension API for command registration.
 * @param state Shared extension state for config gate checks.
 * @param configSource Effective extension config for default resolution.
 * @param reloadConfig Optional callback to reload config after settings changes.
 * @param projectTrusted Whether project-local entrypoint agents should be loaded. Defaults to true.
 */

export function registerSlashCommands(pi: ExtensionAPI, state: SubagentState, configSource: ConfigSource, reloadConfig?: () => void, projectTrusted: boolean = true): void {
	const dispatcher = createSuperpowersPromptDispatcher(pi);

	// Register commands from discovered interactive entrypoint agents
	const entrypointAgents = discoverAgents(state.baseCwd, { includeProject: projectTrusted }).agents.filter(
		(agent) => agent.kind === "entrypoint" && agent.execution === "interactive" && (agent.command ?? agent.name),
	);
	for (const entrypointAgent of entrypointAgents) {
		registerSuperpowersCommand(pi, dispatcher, state, configSource, entrypointAgent);
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
