/**
 * Superpowers root-session prompt construction.
 *
 * Responsibilities:
 * - bootstrap the root session through using-superpowers
 * - express resolved workflow settings in model-readable form
 * - constrain subagent and worktree behavior from resolved config
 * - keep Superpowers skill selection authoritative instead of forcing recon first
 *
 * Important side effects:
 * - none; callers resolve skill file content before invoking this module
 */

export interface SuperpowersRootPromptSkill {
	name: string;
	path: string;
	content: string;
}

export interface SuperpowersRootPromptInput {
	task: string;
	useSubagents: boolean;
	useTestDrivenDevelopment: boolean;
	worktreesEnabled: boolean;
	fork: boolean;
	usingSuperpowersSkill?: SuperpowersRootPromptSkill;
}

/**
 * Build metadata lines for the root prompt.
 *
 * @param input Resolved Superpowers run profile.
 * @returns Human-readable metadata block.
 */
function buildMetadata(input: SuperpowersRootPromptInput): string {
	const lines = [
		'workflow: "superpowers"',
		`useSubagents: ${input.useSubagents}`,
		`useTestDrivenDevelopment: ${input.useTestDrivenDevelopment}`,
		`worktrees.enabled: ${input.worktreesEnabled}`,
	];

	if (input.fork) {
		lines.push('context: "fork"');
	}
	return lines.join("\n");
}

/**
 * Build the skill bootstrap block.
 *
 * @param skill Runtime-resolved using-superpowers skill content.
 * @returns Prompt block containing skill body or a warning.
 */
function buildSkillBootstrap(skill: SuperpowersRootPromptSkill | undefined): string {
	if (!skill) {
		return [
			"Required bootstrap skill warning:",
			"using-superpowers could not be resolved. State this limitation briefly, then proceed with best-effort Superpowers behavior.",
		].join("\n");
	}
	return [
		"Required bootstrap skill:",
		`Name: ${skill.name}`,
		`Path: ${skill.path}`,
		"",
		"Skill content:",
		"```markdown",
		skill.content,
		"```",
	].join("\n");
}

/**
 * Build the delegation contract block.
 *
 * @param useSubagents Whether subagent delegation is enabled.
 * @returns Prompt block for delegation policy.
 */
function buildDelegationContract(useSubagents: boolean): string {
	if (useSubagents) {
		return [
			"Subagent delegation is ENABLED by config.",
			"When a selected Superpowers skill calls for delegated work, you must use the `subagent` tool rather than doing that delegated work inline.",
			"This applies especially to implementation-plan execution, independent parallel investigations, bounded implementation, review, focused research, and debugging workflows.",
			"Do not skip subagent delegation merely because you can do the work yourself.",
			"Stay inline only for clarification, tiny answer-only tasks, unavailable tools, or when delegation is genuinely inappropriate.",
			"If you do not use a subagent for a non-trivial workflow step, state the concrete reason.",
		].join("\n");
	}
	return [
		"Subagent delegation is DISABLED by config.",
		"Do not call `subagent` or `subagent_status`.",
		"When a selected Superpowers skill would normally dispatch delegated agents, adapt that workflow inline in the root session and briefly note that delegation is disabled by config.",
	].join("\n");
}

/**
 * Build the worktree policy block for the root session.
 *
 * @param worktreesEnabled Whether Superpowers worktree isolation is enabled.
 * @returns Prompt block that constrains root-session and delegated worktree use.
 */
function buildWorktreeContract(worktreesEnabled: boolean): string {
	if (worktreesEnabled) {
		return [
			"Worktree isolation is ENABLED by config.",
			"Parallel Superpowers subagent runs may use the configured git worktree isolation.",
			"Use the `using-git-worktrees` skill only when the active skill workflow explicitly requires root-session worktree setup.",
		].join("\n");
	}
	return [
		"Worktree isolation is DISABLED by config.",
		"Treat this as an explicit user instruction that overrides any skill workflow that would normally create a worktree.",
		"Do not use the `using-git-worktrees` skill.",
		"Do not create, switch to, or request git worktrees.",
		"Do not pass or request `worktree: true` for Superpowers subagent runs.",
	].join("\n");
}

/**
 * Build the complete root-session prompt for a Superpowers slash command.
 *
 * @param input Resolved run profile plus optional skill content.
 * @returns Prompt text to send through `pi.sendUserMessage`.
 */
export function buildSuperpowersRootPrompt(input: SuperpowersRootPromptInput): string {
	return [
		"This is a Superpowers session. The `using-superpowers` skill is the workflow bootstrap for this turn.",
		"",
		"Before doing substantive work or asking clarifying questions, follow `using-superpowers` exactly and identify every relevant Superpowers skill for the task.",
		"",
		"Resolved run metadata:",
		buildMetadata(input),
		"",
		buildSkillBootstrap(input.usingSuperpowersSkill),
		"",
		buildDelegationContract(input.useSubagents),
		"",
		buildWorktreeContract(input.worktreesEnabled),
		"",
		"User task:",
		input.task,
	].join("\n");
}
