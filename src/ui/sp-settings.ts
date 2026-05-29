/**
 * Superpowers workflow settings overlay.
 *
 * Responsibilities:
 * - display current Superpowers/subagent workflow settings
 * - expose safe toggle keybindings for supported boolean config values
 * - write config changes through config-writer helpers
 * - allow model tier selection from available models with reload support
 *
 * Important side effects:
 * - writes to the user's Pi extension config file when toggles are invoked
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { matchesKey } from "@earendil-works/pi-tui";
import { VALID_THINKING_LEVELS } from "../shared/thinking-levels.ts";
import type { ExtensionConfig, SubagentState, ThinkingLevel } from "../shared/types.ts";
import {
	setSuperpowersModelTierModel,
	setSuperpowersModelTierThinking,
	toggleSuperpowersBoolean,
	toggleSuperpowersWorktrees,
	updateSuperpowersConfigText,
} from "../superpowers/config-writer.ts";
import { renderFramedPanel } from "./render-helpers.ts";

/**
 * Type for config accessor - returns fresh config at render time.
 */
type ConfigAccessor = () => ExtensionConfig;

/**
 * Model option from the model registry.
 */
interface SettingsModelOption {
	provider: string;
	id: string;
	name?: string;
}

/**
 * Options for the settings component model picker.
 */
export interface SuperpowersSettingsModelPickerOptions {
	models?: SettingsModelOption[];
	modelRegistryError?: string;
	reloadConfig?: () => void;
	onClose?: () => void;
}

/**
 * Settings overlay mode for navigation.
 */
type SettingsMode = "settings" | "tier-picker" | "model-picker" | "thinking-picker";

/**
 * Default model tier names to display in the tier picker.
 */
const DEFAULT_MODEL_TIERS = ["cheap", "balanced", "max", "reasoning"];
const MAX_VISIBLE_MODELS = 15;

const THINKING_OPTIONS: readonly (ThinkingLevel | undefined)[] = [undefined, ...VALID_THINKING_LEVELS];
/**
 * Convert a model option to a value string for selection.
 *
 * @param model Model option to convert.
 * @returns Formatted model value string (e.g., "provider/id").
 */
export function modelToValue(model: SettingsModelOption): string {
	return `${model.provider}/${model.id}`;
}

export class SuperpowersSettingsComponent implements Component {
	private lastWriteMessage = "";
	private selectedTier: string | undefined;
	private selectedModelIndex = 0;
	private selectedThinkingIndex = 0;
	private selectedCommand: string | undefined;
	private mode: SettingsMode = "settings";
	private modelSearchQuery = "";
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly state: SubagentState;
	private readonly done: () => void;
	private readonly getConfig: ConfigAccessor;
	private readonly modelOptions: SettingsModelOption[];
	private readonly modelRegistryError: string | undefined;
	private readonly reloadConfig: () => void;

	/**
	 * Create a new settings component.
	 *
	 * @param tui TUI instance for requesting renders.
	 * @param theme Theme for panel styling.
	 * @param state Subagent state for config gate.
	 * @param getConfig Config accessor for fresh reads during render.
	 * @param options Model picker options including available models, reload callback, and close callback.
	 */
	constructor(tui: TUI, theme: Theme, state: SubagentState, getConfig: ConfigAccessor, options: SuperpowersSettingsModelPickerOptions = {}) {
		this.tui = tui;
		this.theme = theme;
		this.state = state;
		this.getConfig = getConfig;
		this.modelOptions = options.models ?? [];
		this.modelRegistryError = options.modelRegistryError;
		this.done = options.onClose ?? (() => {});
		this.reloadConfig = options.reloadConfig ?? (() => {});
	}

	render(width: number): string[] {
		const mode = this.mode;
		const title = mode === "settings" ? "Superpowers Settings" : mode === "tier-picker" ? "Select Model Tier" : mode === "model-picker" ? "Select Model" : "Select Thinking Level";
		const footer =
			mode === "settings"
				? "c command | p plannotator | s subagents | t tdd | m model tiers | w worktrees | q close"
				: mode === "tier-picker"
					? "↑↓ navigate | enter select | q back"
					: mode === "model-picker"
						? "type to search | ↑↓ navigate | enter select | esc clear/back"
						: "↑↓ navigate | enter select | q back";

		return renderFramedPanel(title, this.renderBody(), Math.min(width, 92), this.theme, footer);
	}

	handleInput(data: string): void {
		// Handle picker mode input
		if (this.mode !== "settings") {
			this.handlePickerInput(data);
			return;
		}

		// Settings mode input handling
		if (matchesKey(data, "escape") || matchesKey(data, "q") || matchesKey(data, "ctrl+c")) {
			this.done();
			return;
		}
		if (matchesKey(data, "c")) {
			this.selectNextCommand();
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "p")) {
			this.toggleUsePlannotator();
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "s")) {
			this.toggleUseSubagents();
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "t")) {
			this.toggleUseTestDrivenDevelopment();
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "m")) {
			this.mode = "tier-picker";
			this.selectedTier = this.firstModelTier();
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "w")) {
			this.toggleWorktrees();
			this.tui.requestRender();
		}
	}

	invalidate(): void {}

	toggleUsePlannotator(): void {
		this.writeConfig((config) => toggleSuperpowersBoolean(config, this.currentCommandName(), "usePlannotator"));
	}

	toggleUseSubagents(): void {
		this.writeConfig((config) => toggleSuperpowersBoolean(config, this.currentCommandName(), "useSubagents"));
	}

	toggleUseTestDrivenDevelopment(): void {
		this.writeConfig((config) => toggleSuperpowersBoolean(config, this.currentCommandName(), "useTestDrivenDevelopment"));
	}

	toggleWorktrees(): void {
		this.writeConfig((config) => toggleSuperpowersWorktrees(config, this.currentCommandName()));
	}

	/**
	 * Handle keyboard input in tier/model picker modes.
	 */
	private handlePickerInput(data: string): void {
		// q goes back in non-search picker modes. In model-picker mode it is searchable text.
		if (matchesKey(data, "q") && this.mode !== "model-picker") {
			if (this.mode === "thinking-picker") {
				this.mode = "tier-picker";
				this.selectedThinkingIndex = 0;
			} else {
				this.mode = "settings";
				this.selectedTier = undefined;
				this.selectedModelIndex = 0;
				this.selectedThinkingIndex = 0;
			}
			this.tui.requestRender();
			return;
		}

		// Escape in tier-picker goes to settings
		if (matchesKey(data, "escape") && this.mode === "tier-picker") {
			this.mode = "settings";
			this.selectedTier = undefined;
			this.selectedModelIndex = 0;
			this.selectedThinkingIndex = 0;
			this.tui.requestRender();
			return;
		}

		const tiers = this.modelTierEntries();
		if (tiers.length === 0) return;

		// Handle navigation based on current picker mode
		if (this.mode === "tier-picker") {
			const currentIndex = this.selectedTier ? tiers.indexOf(this.selectedTier) : -1;

			if (matchesKey(data, "up") || matchesKey(data, "k")) {
				const newIndex = currentIndex <= 0 ? tiers.length - 1 : currentIndex - 1;
				this.selectedTier = tiers[newIndex];
				this.tui.requestRender();
				return;
			}

			if (matchesKey(data, "down") || matchesKey(data, "j")) {
				const newIndex = currentIndex >= tiers.length - 1 ? 0 : currentIndex + 1;
				this.selectedTier = tiers[newIndex];
				this.tui.requestRender();
				return;
			}

			if (matchesKey(data, "enter") && this.selectedTier) {
				this.mode = "model-picker";
				this.selectedModelIndex = 0;
				this.tui.requestRender();
			}
		} else if (this.mode === "model-picker") {
			const filtered = this.getFilteredModels();
			if (filtered.length > 0 && this.selectedModelIndex >= filtered.length) {
				this.selectedModelIndex = filtered.length - 1;
			}

			if (matchesKey(data, "backspace")) {
				if (this.modelSearchQuery.length > 0) {
					this.modelSearchQuery = this.modelSearchQuery.slice(0, -1);
					this.selectedModelIndex = 0;
					this.tui.requestRender();
				}
				return;
			}

			if (matchesKey(data, "escape")) {
				if (this.modelSearchQuery) {
					this.modelSearchQuery = "";
					this.selectedModelIndex = 0;
				} else {
					this.mode = "tier-picker";
					this.selectedModelIndex = 0;
				}
				this.tui.requestRender();
				return;
			}

			if (matchesKey(data, "up") || matchesKey(data, "k")) {
				if (filtered.length === 0) return;
				this.selectedModelIndex = this.selectedModelIndex <= 0 ? filtered.length - 1 : this.selectedModelIndex - 1;
				this.tui.requestRender();
				return;
			}

			if (matchesKey(data, "down") || matchesKey(data, "j")) {
				if (filtered.length === 0) return;
				this.selectedModelIndex = this.selectedModelIndex >= filtered.length - 1 ? 0 : this.selectedModelIndex + 1;
				this.tui.requestRender();
				return;
			}

			if (matchesKey(data, "enter") && this.selectedTier && filtered.length > 0) {
				const editedTier = this.selectedTier;
				const selectedModel = filtered[this.selectedModelIndex];
				this.writeModelTier(editedTier, modelToValue(selectedModel));
				this.mode = "thinking-picker";
				this.selectedTier = this.modelTierEntries().includes(editedTier) ? editedTier : this.firstModelTier();
				this.selectedModelIndex = 0;
				this.selectedThinkingIndex = this.currentThinkingIndex(editedTier);
				this.modelSearchQuery = "";
				this.tui.requestRender();
				return;
			}

			if (data.length === 1 && data.charCodeAt(0) >= 32 && data.charCodeAt(0) < 127) {
				this.modelSearchQuery += data;
				this.selectedModelIndex = 0;
				this.tui.requestRender();
			}
		} else if (this.mode === "thinking-picker") {
			if (matchesKey(data, "up") || matchesKey(data, "k")) {
				this.selectedThinkingIndex = this.selectedThinkingIndex <= 0 ? THINKING_OPTIONS.length - 1 : this.selectedThinkingIndex - 1;
				this.tui.requestRender();
				return;
			}

			if (matchesKey(data, "down") || matchesKey(data, "j")) {
				this.selectedThinkingIndex = this.selectedThinkingIndex >= THINKING_OPTIONS.length - 1 ? 0 : this.selectedThinkingIndex + 1;
				this.tui.requestRender();
				return;
			}

			if (matchesKey(data, "enter") && this.selectedTier) {
				const editedTier = this.selectedTier;
				this.writeModelTierThinking(editedTier, THINKING_OPTIONS[this.selectedThinkingIndex]);
				this.mode = "tier-picker";
				this.selectedTier = this.modelTierEntries().includes(editedTier) ? editedTier : this.firstModelTier();
				this.selectedThinkingIndex = 0;
				this.tui.requestRender();
			}
		}
	}

	/**
	 * Get model tier entries to display.
	 * Returns configured tier names, falling back to defaults.
	 */
	private modelTierEntries(): string[] {
		const configuredTiers = this.getConfig().superagents?.modelTiers;
		if (configuredTiers) {
			return Object.keys(configuredTiers);
		}
		return DEFAULT_MODEL_TIERS;
	}

	/**
	 * Resolve the first selectable model tier.
	 *
	 * @returns First tier name or undefined when no tiers are available.
	 */
	private firstModelTier(): string | undefined {
		return this.modelTierEntries()[0];
	}

	/**
	 * Resolve command names displayed by the settings overlay.
	 *
	 * @returns Configured command names, or the built-in implementation command fallback.
	 */
	private commandNames(): string[] {
		const names = Object.keys(this.getConfig().superagents?.commands ?? {});
		return names.length > 0 ? names : ["sp-implement"];
	}

	/**
	 * Resolve the currently selected command, keeping it valid after config changes.
	 *
	 * @returns Selected command name used for command-scoped settings writes.
	 */
	private currentCommandName(): string {
		const names = this.commandNames();
		if (!this.selectedCommand || !names.includes(this.selectedCommand)) {
			this.selectedCommand = names[0];
		}
		return this.selectedCommand;
	}

	/**
	 * Advance the settings selection to the next configured command.
	 */
	private selectNextCommand(): void {
		const names = this.commandNames();
		const current = this.currentCommandName();
		const currentIndex = names.indexOf(current);
		this.selectedCommand = names[(currentIndex + 1) % names.length];
	}

	/**
	 * Get models filtered by current search query.
	 * Matches against provider, id, and name (case-insensitive).
	 */
	private getFilteredModels(): SettingsModelOption[] {
		if (!this.modelSearchQuery) return this.modelOptions;
		const query = this.modelSearchQuery.toLowerCase();
		return this.modelOptions.filter((m) => {
			const searchable = `${m.provider} ${m.id} ${m.name ?? ""}`.toLowerCase();
			return searchable.includes(query);
		});
	}

	/**
	 * Return the visible model window around the current full-list selection.
	 *
	 * @param models Filtered models available for the current query.
	 * @returns At most the visible models shown in the picker, sliding as selection moves.
	 */
	private getVisibleModels(models: SettingsModelOption[]): SettingsModelOption[] {
		const windowStart = Math.min(Math.max(this.selectedModelIndex - MAX_VISIBLE_MODELS + 1, 0), Math.max(models.length - MAX_VISIBLE_MODELS, 0));
		return models.slice(windowStart, windowStart + MAX_VISIBLE_MODELS);
	}

	/**
	 * Return the configured thinking option index for a model tier.
	 *
	 * @param tierName Tier to inspect in the current configuration.
	 * @returns Index into THINKING_OPTIONS, defaulting to the explicit default option.
	 */
	private currentThinkingIndex(tierName: string): number {
		const value = this.getConfig().superagents?.modelTiers?.[tierName];
		const thinking = value && typeof value === "object" && !Array.isArray(value) ? value.thinking : undefined;
		const index = THINKING_OPTIONS.indexOf(thinking);
		return index >= 0 ? index : 0;
	}

	/**
	 * Format one thinking option for picker display.
	 *
	 * @param thinking Thinking level value, or undefined for runtime default.
	 * @returns Human-readable thinking label.
	 */
	private thinkingLabel(thinking: ThinkingLevel | undefined): string {
		return thinking ?? "default";
	}

	/**
	 * Write a model tier selection to config and trigger reload.
	 */
	private writeModelTier(tierName: string, model: string): void {
		this.writeConfig((config) => setSuperpowersModelTierModel(config, tierName, model));
	}

	/**
	 * Write a model tier thinking selection to config and trigger reload.
	 *
	 * @param tierName Tier whose thinking override should change.
	 * @param thinking Thinking level to persist, or undefined to clear the override.
	 */
	private writeModelTierThinking(tierName: string, thinking: ThinkingLevel | undefined): void {
		this.writeConfig((config) => setSuperpowersModelTierThinking(config, tierName, thinking));
	}

	/**
	 * Render the body content based on current mode.
	 */
	private renderBody(): string[] {
		if (this.mode === "tier-picker") {
			return this.renderTierPickerBody();
		}
		if (this.mode === "model-picker") {
			return this.renderModelPickerBody();
		}
		if (this.mode === "thinking-picker") {
			return this.renderThinkingPickerBody();
		}
		return this.renderSettingsBody();
	}

	/**
	 * Render the settings body - original functionality.
	 */
	private renderSettingsBody(): string[] {
		const config = this.getConfig();
		const settings = config.superagents ?? {};
		const commands = Object.entries(settings.commands ?? {});
		const modelTiers = Object.entries(settings.modelTiers ?? {});
		const selectedCommand = this.currentCommandName();

		const lines: string[] = [
			`configStatus: ${this.state.configGate.blocked ? "blocked" : "valid"}`,
			`Selected command: ${selectedCommand}`,
			"",
			"Command behavior flags:",
			...(commands.length
				? commands.flatMap(([name, preset]) => {
						const configuredSettings: string[] = [];
						if ("usePlannotator" in preset) configuredSettings.push(`    usePlannotator: ${preset.usePlannotator}`);
						if ("useSubagents" in preset) configuredSettings.push(`    useSubagents: ${preset.useSubagents}`);
						if ("useTestDrivenDevelopment" in preset) configuredSettings.push(`    useTestDrivenDevelopment: ${preset.useTestDrivenDevelopment}`);
						if ("useBranches" in preset) configuredSettings.push(`    useBranches: ${preset.useBranches}`);
						if (preset.worktrees && "enabled" in preset.worktrees) configuredSettings.push(`    worktrees.enabled: ${preset.worktrees.enabled}`);
						if (preset.worktrees && "root" in preset.worktrees) configuredSettings.push(`    worktrees.root: ${preset.worktrees.root ?? "default"}`);

						const marker = name === selectedCommand ? "▸" : " ";
						return [` ${marker} ${name}:`, ...(configuredSettings.length ? configuredSettings : ["    (default settings)"])];
					})
				: ["  none"]),
			"",
			"Model tiers:",
			...(modelTiers.length ? modelTiers.map(([name, value]) => `  ${name}: ${tierModel(value)}`) : ["  none"]),
		];

		// Show model registry error if present
		if (this.modelRegistryError) {
			lines.push("", `modelRegistry: ${this.modelRegistryError}`);
		} else if (this.modelOptions.length === 0 && !this.modelRegistryError) {
			lines.push("", "No authenticated models available");
		}

		if (this.state.configGate.message) lines.push("", this.state.configGate.message);
		if (this.lastWriteMessage) lines.push("", this.lastWriteMessage);
		return lines;
	}

	/**
	 * Render the tier picker body.
	 */
	private renderTierPickerBody(): string[] {
		const tiers = this.modelTierEntries();
		const configured = this.getConfig().superagents?.modelTiers ?? {};

		if (tiers.length === 0) {
			return ["No model tiers configured"];
		}

		const lines: string[] = [];
		for (const tier of tiers) {
			const currentValue = configured[tier];
			const modelStr = tierModel(currentValue);
			const isSelected = tier === this.selectedTier;
			const marker = isSelected ? "▸ " : "  ";
			lines.push(`${marker}${tier}: ${modelStr}`);
		}

		lines.push("");
		lines.push("Press Enter to edit a tier");
		return lines;
	}

	/**
	 * Render the model picker body.
	 */
	private renderModelPickerBody(): string[] {
		const configured = this.getConfig().superagents?.modelTiers ?? {};
		const currentValue = this.selectedTier ? configured[this.selectedTier] : undefined;

		if (this.modelOptions.length === 0) {
			const errorMsg = this.modelRegistryError ?? "No authenticated models available";
			return [errorMsg];
		}

		const filtered = this.getFilteredModels();
		if (filtered.length > 0 && this.selectedModelIndex >= filtered.length) {
			this.selectedModelIndex = filtered.length - 1;
		}
		const hasMore = filtered.length > MAX_VISIBLE_MODELS;
		const windowStart = Math.min(Math.max(this.selectedModelIndex - MAX_VISIBLE_MODELS + 1, 0), Math.max(filtered.length - MAX_VISIBLE_MODELS, 0));
		const visibleModels = this.getVisibleModels(filtered);

		// Show search box
		const searchLine = this.modelSearchQuery ? `Search: ${this.modelSearchQuery}_` : "Type to search...";

		const lines: string[] = [
			`Editing tier: ${this.selectedTier}`,
			`Current: ${tierModel(currentValue)}`,
			"",
			searchLine,
			`Showing ${visibleModels.length} of ${filtered.length} models${hasMore ? ` (${windowStart + 1}-${windowStart + visibleModels.length})` : ""}`,
			"",
		];

		if (filtered.length === 0) {
			lines.push("No models match search");
			lines.push("", "Backspace to clear search");
			return lines;
		}

		for (let i = 0; i < visibleModels.length; i++) {
			const model = visibleModels[i];
			const modelValue = modelToValue(model);
			const label = model.name ?? modelValue;
			const isSelected = windowStart + i === this.selectedModelIndex;
			const marker = isSelected ? "▸ " : "  ";
			lines.push(`${marker}${modelValue} (${label})`);
		}

		lines.push("");
		lines.push("↑↓ navigate | Enter to select");
		lines.push("Esc to clear search or go back");
		return lines;
	}

	/**
	 * Render the thinking picker body for the selected model tier.
	 *
	 * @returns Lines displayed inside the framed settings panel.
	 */
	private renderThinkingPickerBody(): string[] {
		const configured = this.getConfig().superagents?.modelTiers ?? {};
		const currentValue = this.selectedTier ? configured[this.selectedTier] : undefined;
		const lines: string[] = [
			`Editing tier: ${this.selectedTier}`,
			`Selected model: ${tierModel(currentValue)}`,
			`Current thinking: ${tierThinking(currentValue)}`,
			"",
			"Choose thinking level:",
		];

		for (let i = 0; i < THINKING_OPTIONS.length; i++) {
			const option = THINKING_OPTIONS[i];
			const marker = i === this.selectedThinkingIndex ? "▸ " : "  ";
			lines.push(`${marker}${this.thinkingLabel(option)}`);
		}

		lines.push("", "Enter to save thinking level", "q to go back");
		return lines;
	}

	/**
	 * Write config updates to the config file.
	 */
	private writeConfig(update: Parameters<typeof updateSuperpowersConfigText>[1]): void {
		const configPath = this.state.configGate.configPath;
		if (!configPath) {
			this.lastWriteMessage = "Config path is unavailable. Restart Pi and try again.";
			return;
		}
		try {
			// Ensure parent directory exists
			const configDir = path.dirname(configPath);
			if (!fs.existsSync(configDir)) {
				fs.mkdirSync(configDir, { recursive: true });
			}
			const current = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf-8") : "{}\n";
			const next = updateSuperpowersConfigText(current, update);
			fs.writeFileSync(configPath, next, "utf-8");
			this.reloadConfig();
			this.lastWriteMessage = `Wrote ${configPath}. Restart or reload Pi to apply command registration changes.`;
		} catch (error) {
			this.lastWriteMessage = error instanceof Error ? error.message : String(error);
		}
	}
}

/**
 * Format a model tier setting for display.
 */
function tierModel(value: unknown): string {
	if (typeof value === "string") return value;
	if (value && typeof value === "object" && "model" in value) {
		const model = (value as { model?: unknown }).model;
		const thinking = tierThinking(value);
		return typeof model === "string" ? `${model}${thinking === "default" ? "" : ` (thinking: ${thinking})`}` : "unknown";
	}
	return "unknown";
}

/**
 * Format the thinking value of a model tier setting.
 *
 * @param value Model tier setting to inspect.
 * @returns The configured thinking level, or "default" when none is configured.
 */
function tierThinking(value: unknown): string {
	if (value && typeof value === "object" && "thinking" in value) {
		const thinking = (value as { thinking?: unknown }).thinking;
		return typeof thinking === "string" ? thinking : "default";
	}
	return "default";
}
