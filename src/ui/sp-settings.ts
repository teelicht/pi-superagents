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
import type { Theme } from "@mariozechner/pi-coding-agent";
import type { Component, TUI } from "@mariozechner/pi-tui";
import { matchesKey } from "@mariozechner/pi-tui";
import type { ExtensionConfig, SubagentState } from "../shared/types.ts";
import {
	setSuperpowersModelTierModel,
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
type SettingsMode = "settings" | "tier-picker" | "model-picker";

/**
 * Default model tier names to display in the tier picker.
 */
const DEFAULT_MODEL_TIERS = ["cheap", "balanced", "max", "reasoning"];

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
	private mode: SettingsMode = "settings";
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
	 * @param config Extension config to display.
	 * @param getConfig Config accessor for fresh reads during render.
	 * @param options Model picker options including available models, reload callback, and close callback.
	 */
	constructor(
		tui: TUI,
		theme: Theme,
		state: SubagentState,
		config: ExtensionConfig,
		getConfig: ConfigAccessor,
		options: SuperpowersSettingsModelPickerOptions = {},
	) {
		this.tui = tui;
		this.theme = theme;
		this.state = state;
		this.config = config;
		this.getConfig = getConfig;
		this.modelOptions = options.models ?? [];
		this.modelRegistryError = options.modelRegistryError;
		this.done = options.onClose ?? (() => {});
		this.reloadConfig = options.reloadConfig ?? (() => {});
	}

	render(width: number): string[] {
		const mode = this.mode;
		const title =
			mode === "settings" ? "Superpowers Settings" : mode === "tier-picker" ? "Select Model Tier" : "Select Model";
		const footer =
			mode === "settings"
				? "p plannotator | s subagents | t tdd | m model tiers | w worktrees | q close"
				: mode === "tier-picker"
					? "↑↓ navigate | enter select | q back"
					: "↑↓ navigate | enter confirm | q back";

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
		this.writeConfig((config) => toggleSuperpowersBoolean(config, "usePlannotator"));
	}

	toggleUseSubagents(): void {
		this.writeConfig((config) => toggleSuperpowersBoolean(config, "useSubagents"));
	}

	toggleUseTestDrivenDevelopment(): void {
		this.writeConfig((config) => toggleSuperpowersBoolean(config, "useTestDrivenDevelopment"));
	}

	toggleWorktrees(): void {
		this.writeConfig((config) => toggleSuperpowersWorktrees(config));
	}

	/**
	 * Handle keyboard input in tier/model picker modes.
	 */
	private handlePickerInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "q")) {
			this.mode = "settings";
			this.selectedTier = undefined;
			this.selectedModelIndex = 0;
			this.tui.requestRender();
			return;
		}

		const tiers = this.modelTierEntries();
		if (tiers.length === 0) return;

		// Handle navigation based on current picker mode
		if (this.mode === "tier-picker") {
			// Tier picker navigation
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
			// Model picker navigation
			if (this.modelOptions.length === 0) return;

			if (matchesKey(data, "up") || matchesKey(data, "k")) {
				this.selectedModelIndex =
					this.selectedModelIndex <= 0 ? this.modelOptions.length - 1 : this.selectedModelIndex - 1;
				this.tui.requestRender();
				return;
			}

			if (matchesKey(data, "down") || matchesKey(data, "j")) {
				this.selectedModelIndex =
					this.selectedModelIndex >= this.modelOptions.length - 1 ? 0 : this.selectedModelIndex + 1;
				this.tui.requestRender();
				return;
			}

			if (matchesKey(data, "enter") && this.selectedTier && this.modelOptions.length > 0) {
				const editedTier = this.selectedTier;
				const selectedModel = this.modelOptions[this.selectedModelIndex];
				this.writeModelTier(editedTier, modelToValue(selectedModel));
				this.mode = "tier-picker";
				this.selectedTier = this.modelTierEntries().includes(editedTier) ? editedTier : this.firstModelTier();
				this.selectedModelIndex = 0;
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
	 * Write a model tier selection to config and trigger reload.
	 */
	private writeModelTier(tierName: string, model: string): void {
		this.writeConfig((config) => setSuperpowersModelTierModel(config, tierName, model));
		this.reloadConfig();
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

		const lines: string[] = [
			`configStatus: ${this.state.configGate.blocked ? "blocked" : "valid"}`,
			"",
			"Commands:",
			...(commands.length
				? commands.flatMap(([name, preset]) => {
						const configuredSettings: string[] = [];
						if ("usePlannotator" in preset) configuredSettings.push(`    usePlannotator: ${preset.usePlannotator}`);
						if ("useSubagents" in preset) configuredSettings.push(`    useSubagents: ${preset.useSubagents}`);
						if ("useTestDrivenDevelopment" in preset)
							configuredSettings.push(`    useTestDrivenDevelopment: ${preset.useTestDrivenDevelopment}`);
						if ("useBranches" in preset) configuredSettings.push(`    useBranches: ${preset.useBranches}`);
						if (preset.worktrees && "enabled" in preset.worktrees)
							configuredSettings.push(`    worktrees.enabled: ${preset.worktrees.enabled}`);
						if (preset.worktrees && "root" in preset.worktrees)
							configuredSettings.push(`    worktrees.root: ${preset.worktrees.root ?? "default"}`);

						return [`  ${name}:`, ...(configuredSettings.length ? configuredSettings : ["    (default settings)"])];
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

		const lines: string[] = [
			`Editing tier: ${this.selectedTier}`,
			`Current: ${tierModel(currentValue)}`,
			"",
			"Available models:",
		];

		for (let i = 0; i < this.modelOptions.length; i++) {
			const model = this.modelOptions[i];
			const modelValue = modelToValue(model);
			const label = model.name ?? modelValue;
			const isSelected = i === this.selectedModelIndex;
			const marker = isSelected ? "▸ " : "  ";
			lines.push(`${marker}${modelValue} (${label})`);
		}

		lines.push("");
		lines.push("↑↓ navigate | Enter to select");
		lines.push("q to go back");
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
			const current = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf-8") : "{}\n";
			const next = updateSuperpowersConfigText(current, update);
			fs.writeFileSync(configPath, next, "utf-8");
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
		return typeof model === "string" ? model : "unknown";
	}
	return "unknown";
}
