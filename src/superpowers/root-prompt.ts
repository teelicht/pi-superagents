/**
 * Superpowers root-session prompt construction.
 *
 * Responsibilities:
 * - bootstrap the root session through using-superpowers
 * - express resolved workflow settings in model-readable form
 * - constrain subagent, plan-review, and worktree behavior from resolved config
 * - keep Superpowers skill selection authoritative instead of forcing recon first
 * - render entry skill and overlay skill content for brainstorming flows
 * - provide generic Plannotator contract for applicable workflows
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
	useBranches?: boolean;
	useSubagents?: boolean;
	useTestDrivenDevelopment?: boolean;
	usePlannotatorReview?: boolean;
	worktrees?: { enabled: boolean; root?: string | null };
	fork: boolean;
	usingSuperpowersSkill?: SuperpowersRootPromptSkill;
	entrySkill?: SuperpowersRootPromptSkill;
	overlaySkills?: SuperpowersRootPromptSkill[];
}

/**
 * Build metadata lines for the root prompt.
 *
 * @param input Resolved Superpowers run profile.
 * @returns Human-readable metadata block.
 */
function buildMetadata(input: SuperpowersRootPromptInput): string {
	const lines: string[] = ['workflow: "superpowers"'];
	if (input.useBranches !== undefined) lines.push(`useBranches: ${input.useBranches}`);
	if (input.useSubagents !== undefined) lines.push(`useSubagents: ${input.useSubagents}`);
	if (input.useTestDrivenDevelopment !== undefined) lines.push(`useTestDrivenDevelopment: ${input.useTestDrivenDevelopment}`);
	if (input.usePlannotatorReview !== undefined) lines.push(`usePlannotatorReview: ${input.usePlannotatorReview}`);
	if (input.worktrees !== undefined) lines.push(`worktrees.enabled: ${input.worktrees.enabled}`);
	if (input.fork) lines.push('context: "fork"');
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
 * Build the entry-skill prompt block for Superpowers skill-entry runs.
 *
 * @param input Resolved root prompt input.
 * @returns Prompt block, or an empty string when no entry skill is configured.
 */
function buildEntrySkillBlock(input: SuperpowersRootPromptInput): string {
	if (!input.entrySkill) return "";
	return [
		"Entry skill:",
		`Name: ${input.entrySkill.name}`,
		`Path: ${input.entrySkill.path}`,
		"",
		"This entry skill is the starting Superpowers skill for this run. Follow it after `using-superpowers` identifies relevant skills.",
		"",
		"Entry skill content:",
		"```markdown",
		input.entrySkill.content,
		"```",
	].join("\n");
}

/**
 * Build additional overlay skill content for root skill-entry runs.
 *
 * @param overlaySkills Resolved overlay skills.
 * @returns Prompt block, or an empty string when no overlays are configured.
 */
function buildOverlaySkillsBlock(overlaySkills: SuperpowersRootPromptSkill[] | undefined): string {
	if (!overlaySkills || overlaySkills.length === 0) return "";
	return [
		"Overlay skills:",
		...overlaySkills.flatMap((skill) => [
			"",
			`Name: ${skill.name}`,
			`Path: ${skill.path}`,
			"```markdown",
			skill.content,
			"```",
		]),
	].join("\n");
}

/**
 * Build the branch policy block for the root session.
 *
 * @param useBranches Whether dedicated git branch policy is enabled.
 * @returns Prompt block that constrains branch setup behavior.
 */
function buildBranchContract(useBranches: boolean): string {
	if (useBranches) {
		return [
			"Branch policy is ENABLED by config.",
			"Use a dedicated git branch for this implementation plan/spec before implementation work begins.",
			"Treat git branches and Pi session forks as separate concepts.",
			"Prefer one git branch per implementation plan/spec, not one branch per delegated subtask or follow-up prompt.",
			"Do not create a new git branch for every delegated subtask or follow-up prompt unless the active workflow explicitly requires it.",
			"If branch creation or switching is not possible, say so clearly and adapt the workflow without pretending the branch requirement was satisfied.",
		].join("\n");
	}
	return "Branch policy is DISABLED by config. Do not impose branch-specific workflow requirements beyond the user's existing repository practice.";
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
 * Build the Plannotator review contract for the root session.
 *
 * @param usePlannotatorReview Whether browser review is enabled by config.
 * @returns Prompt block describing the Plannotator review call site behavior.
 */
function buildPlannotatorReviewContract(usePlannotatorReview: boolean): string {
	if (!usePlannotatorReview) {
		return "Plannotator browser review is DISABLED by config. Use the normal Superpowers text-based approval flow.";
	}

	return [
		"Plannotator browser review is ENABLED by config.",
		"At the review gate for this workflow phase, call the appropriate Plannotator review tool with the saved artifact content and file path.",
		"Use `superpowers_plan_review` for implementation plans and `superpowers_spec_review` for brainstorming specs.",
		"If the review tool returns approved, continue the workflow.",
		"If the review tool returns rejected, treat the response as review feedback, revise the artifact, save it, and resubmit.",
		"If the tool returns unavailable, show one concise warning and continue with normal text-based approval.",
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
 * Build the task tracking policy block for the root session.
 *
 * @returns Prompt block that constrains task execution tracking behavior.
 */
function buildTaskTrackingContract(): string {
	return [
		"Task tracking is the responsibility of the root session.",
		"When you delegate work through the `subagent` tool, the subagent will execute the task and report back.",
		"After the subagent finishes a task successfully, YOU (the root session) MUST actively open the relevant plan file and check off the completed item (e.g. by changing [ ] to [x]).",
		"Do not expect subagents to modify the plan file metadata.",
	].join("\n");
}

/**
 * Build the complete root-session prompt for a Superpowers slash command.
 *
 * @param input Resolved run profile plus optional skill content.
 * @returns Prompt text to send through `pi.sendUserMessage`.
 */
export function buildSuperpowersRootPrompt(input: SuperpowersRootPromptInput): string {
	const sections: string[] = [
		"# Superpowers Root Session Contract",
		"",
		"This is a Superpowers session. This is a strict hidden instruction block for one Superpowers turn. Follow it as authoritative runtime policy. The user-visible command summary may be terse; do not ask the user to restate details that are present here.",
		"",
		"## User Task",
		input.task,
		"",
		"## Resolved Options",
		buildMetadata(input),
		"",
		"## Mandatory Startup",
		"Before doing substantive work or asking clarifying questions, follow `using-superpowers` exactly and identify every relevant Superpowers skill for the task.",
		"",
		"## Skill Bootstrap",
		buildSkillBootstrap(input.usingSuperpowersSkill),
		"",
		buildEntrySkillBlock(input),
		"",
		buildOverlaySkillsBlock(input.overlaySkills),
		"",
		"## Runtime Policy",
	];

	if (input.useBranches !== undefined) {
		sections.push(buildBranchContract(input.useBranches));
		sections.push("");
	}
	if (input.useSubagents !== undefined) {
		sections.push(buildDelegationContract(input.useSubagents));
		sections.push("");
	}
	if (input.worktrees !== undefined) {
		sections.push(buildWorktreeContract(input.worktrees.enabled));
		sections.push("");
	}
	if (input.useSubagents === true) {
		sections.push(buildTaskTrackingContract());
		sections.push("");
	}
	if (input.usePlannotatorReview !== undefined) {
		sections.push(buildPlannotatorReviewContract(input.usePlannotatorReview));
		sections.push("");
	}

	return sections.join("\n");
}

/**
 * Build the short user-visible message for a Superpowers command.
 *
 * The user's actual task is shown first and prominently. The resolved
 * Superpowers config flags appear below as informational context,
 * clearly separated so the user can always see what they asked for.
 *
 * @param input Resolved run profile plus optional skill metadata.
 * @returns Visible summary with the user task and config flags.
 */
export function buildSuperpowersVisiblePromptSummary(input: SuperpowersRootPromptInput): string {
	const configLines: string[] = [];
	if (input.useBranches !== undefined) configLines.push(`useBranches: ${input.useBranches}`);
	if (input.useSubagents !== undefined) configLines.push(`useSubagents: ${input.useSubagents}`);
	if (input.useTestDrivenDevelopment !== undefined) configLines.push(`useTestDrivenDevelopment: ${input.useTestDrivenDevelopment}`);
	if (input.usePlannotatorReview !== undefined) configLines.push(`usePlannotatorReview: ${input.usePlannotatorReview}`);
	if (input.worktrees !== undefined) configLines.push(`worktrees.enabled: ${input.worktrees.enabled}`);
	configLines.push(`context: ${input.fork ? "fork" : "fresh"}`);

	return [
		`Superpowers ▸ ${input.task}`,
		"",
		"Config:",
		configLines.join("\n"),
	].join("\n");
}
