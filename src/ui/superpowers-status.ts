/**
 * Superpowers status and settings overlay.
 *
 * Responsibilities:
 * - display current Superpowers config defaults
 * - display config diagnostics
 * - provide a focused replacement for the generic Agents Manager
 *
 * Important side effects:
 * - none in the first pass; later tasks may add safe config writing
 */

import { Container, Text } from "@mariozechner/pi-tui";
import type { ExtensionConfig, SubagentState } from "../shared/types.ts";

/**
 * Focused Superpowers status/settings TUI component.
 *
 * Renders a read-only display of the current Superpowers configuration
 * and config gate status for quick diagnostics.
 */
export class SuperpowersStatusComponent extends Container {
	constructor(
		_tui: unknown,
		_theme: unknown,
		private readonly state: SubagentState,
		private readonly config: ExtensionConfig,
		private readonly done: () => void,
	) {
		super();
	}

	override render(width: number): string[] {
		this.clear();
		const settings = this.config.superagents ?? {};
		const lines = [
			"Superpowers",
			"",
			`useSubagents: ${settings.useSubagents ?? true}`,
			`useTestDrivenDevelopment: ${settings.useTestDrivenDevelopment ?? true}`,
			`customCommands: ${Object.keys(settings.commands ?? {}).length}`,
			`configStatus: ${this.state.configGate.blocked ? "blocked" : "valid"}`,
		];
		if (this.state.configGate.message) {
			lines.push("", this.state.configGate.message);
		}
		this.addChild(new Text(lines.join("\n"), 0, 0));
		return Container.prototype.render.call(this, width);
	}

	close(): void {
		this.done();
	}
}