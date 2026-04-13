/**
 * Superpowers root-session prompt construction.
 *
 * Responsibilities:
 * - bootstrap the root session through using-superpowers
 * - express resolved workflow settings in model-readable form
 * - constrain subagent, plan-review, and worktree behavior from resolved config
 * - keep Superpowers skill selection authoritative instead of forcing recon first
 * - render entry skill and overlay skill content for brainstorming flows
 * - provide brainstorming-only saved-spec Plannotator contract
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
	usePlannotatorReview: boolean;
	worktreesEnabled: boolean;
	fork: boolean;
	usingSuperpowersSkill?: SuperpowersRootPromptSkill;
	entrySkill?: SuperpowersRootPromptSkill;
	overlaySkills?: SuperpowersRootPromptSkill[];
	entrySkillSource?: "command" | "intercepted-skill";
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
		`usePlannotatorReview: ${input.usePlannotatorReview}`,
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
 * Build the entry-skill prompt block for Superpowers skill-entry runs.
 *
 * @param input Resolved root prompt input.
 * @returns Prompt block, or an empty string for general Superpowers runs.
 */
function buildEntrySkillBlock(input: SuperpowersRootPromptInput): string {
	if (!input.entrySkill) return "";
	return [
		"Entry skill:",
		`Name: ${input.entrySkill.name}`,
		`Path: ${input.entrySkill.path}`,
		`Source: ${input.entrySkillSource ?? "command"}`,
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
 * Build the saved-spec Plannotator contract for brainstorming entry flows.
 *
 * @param input Resolved root prompt input.
 * @returns Prompt block for saved-spec review, or an empty string when not applicable.
 */
function buildBrainstormingSpecReviewContract(input: SuperpowersRootPromptInput): string {
	if (input.entrySkill?.name !== "brainstorming" || !input.usePlannotatorReview) return "";
	return [
		"Brainstorming saved brainstorming spec Plannotator review is ENABLED by config.",
		"Follow the normal brainstorming chat workflow first: ask clarifying questions, propose approaches, present design sections, and write the approved spec.",
		"After the approved brainstorming spec is saved, and before invoking or transitioning to `writing-plans`, call `superpowers_spec_review` with the saved spec content and file path.",
		"If `superpowers_spec_review` returns approved, continue the workflow.",
		"If it returns rejected, treat the response as spec-review feedback, revise the spec, save it, and resubmit through the same tool.",
		"If the tool returns unavailable, show one concise warning and continue with the normal text-based review gate.",
		"Only call Plannotator for the final approved spec, not intermediate design sections.",
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
 * Build the Plannotator review contract for the root session.
 *
 * @param usePlannotatorReview Whether browser review is enabled by config.
 * @returns Prompt block describing the exact plan-approval call site behavior.
 */
function buildPlannotatorReviewContract(usePlannotatorReview: boolean): string {
	if (!usePlannotatorReview) {
		return "Plannotator browser review is DISABLED by config. Use the normal Superpowers text-based plan approval flow.";
	}

	return [
		"Plannotator browser review is ENABLED by config.",
		"At the normal implementation-plan approval point, after final plan content and before plain-text approval, call `superpowers_plan_review` with the final plan content and saved plan file path when available.",
		"Use `superpowers_plan_review` only at the normal plan approval point, not during brainstorming, clarifying questions, implementation, code review, or subagent delegation.",
		"If `superpowers_plan_review` returns approved, continue the workflow.",
		"If `superpowers_plan_review` returns rejected, treat the response as plan-review feedback, revise the plan, and resubmit through the same tool at the same approval point.",
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
		buildEntrySkillBlock(input),
		"",
		buildOverlaySkillsBlock(input.overlaySkills),
		"",
		buildBrainstormingSpecReviewContract(input),
		"",
		buildDelegationContract(input.useSubagents),
		"",
		buildPlannotatorReviewContract(input.usePlannotatorReview),
		"",
		buildWorktreeContract(input.worktreesEnabled),
		"",
		buildTaskTrackingContract(),
		"",
		"User task:",
		input.task,
	].join("\n");
}
