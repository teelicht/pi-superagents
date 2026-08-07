/**
 * Superpowers root-session prompt construction.
 *
 * Responsibilities:
 * - bootstrap the root session through using-superpowers
 * - express resolved workflow settings in model-readable form
 * - constrain subagent, plan-review, and worktree behavior from resolved config
 * - keep Superpowers skill selection authoritative instead of forcing recon first
 * - render entry skill content for brainstorming flows
 * - provide generic Plannotator contract for applicable workflows
 * - build compaction-durability reminders so the workflow can be re-armed after compaction
 *
 * Important side effects:
 * - none; callers resolve skill file content before invoking this module
 */

import type { ReviewCadence } from "../shared/types.ts";

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
	taskScheduling?: "sequential" | "parallel";
	reviewCadence?: ReviewCadence;
	usingSuperpowersSkill?: SuperpowersRootPromptSkill;
	entrySkill?: SuperpowersRootPromptSkill;
	rootLifecycleSkills?: SuperpowersRootPromptSkill[];
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
	if (input.taskScheduling !== undefined) lines.push(`taskScheduling: ${input.taskScheduling}`);
	if (input.reviewCadence !== undefined) lines.push(`reviewCadence: ${input.reviewCadence}`);
	lines.push(`sessionMode: ${input.fork ? "fork" : "lineage-only"}`);
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
	return ["Required bootstrap skill:", `Name: ${skill.name}`, `Path: ${skill.path}`, "", "Skill content:", "```markdown", skill.content, "```"].join("\n");
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
 * Trigger-point descriptions for known root lifecycle skills.
 *
 * Used by both the initial root-prompt lifecycle block and the compaction
 * reminder so trigger wording stays consistent across both paths.
 */
const LIFECYCLE_TRIGGER_BY_SKILL: Record<string, string> = {
	"verification-before-completion": "Before claiming complete, fixed, passing, or ready: invoke `verification-before-completion`.",
	"receiving-code-review": "When receiving or acting on review feedback: invoke `receiving-code-review`.",
	"finishing-a-development-branch": "After implementation is complete and verification passes: invoke `finishing-a-development-branch`.",
};

/**
 * Build root lifecycle skill content and trigger hints for implementation entrypoints.
 *
 * @param rootLifecycleSkills Resolved root lifecycle skills from entrypoint agent frontmatter.
 * @returns Prompt block, or an empty string when no lifecycle skills are configured.
 */
function buildRootLifecycleSkillsBlock(rootLifecycleSkills: SuperpowersRootPromptSkill[] | undefined): string {
	if (!rootLifecycleSkills || rootLifecycleSkills.length === 0) return "";

	const triggerLines = rootLifecycleSkills.map(
		(skill) => `- ${LIFECYCLE_TRIGGER_BY_SKILL[skill.name] ?? `Invoke \`${skill.name}\` at the trigger point described in its skill content.`}`,
	);

	return [
		"Root lifecycle skills:",
		"These skills are assigned by the current interactive entrypoint agent. Invoke them at their trigger points; do not treat them as optional background context.",
		"",
		"Required lifecycle triggers:",
		...triggerLines,
		...rootLifecycleSkills.flatMap((skill) => ["", `Name: ${skill.name}`, `Path: ${skill.path}`, "```markdown", skill.content, "```"]),
	].join("\n");
}

/**
 * Build a compaction-durability reminder for trimmed or pointer sizing.
 *
 * Produces a hidden reminder containing lifecycle-skill trigger names so the
 * model can re-arm its workflow after compaction without the full root
 * contract. Used by the `context`-event re-injection handler for `overflow`
 * (trimmed) and `manual` (pointer) compaction reasons.
 *
 * @param skillNames Root lifecycle skill names from the active entrypoint.
 * @param sizing "trimmed" (overflow — full reminder) or "pointer" (manual — minimal one-liner).
 * @returns Reminder text wrapped in an EXTREMELY_IMPORTANT marker block.
 */
export function buildCompactionReminder(skillNames: string[], sizing: "trimmed" | "pointer"): string {
	const triggerLines = skillNames.map((name) => `- ${LIFECYCLE_TRIGGER_BY_SKILL[name] ?? `Invoke \`${name}\` at its trigger point.`}`);
	if (sizing === "pointer") {
		return [
			"<EXTREMELY_IMPORTANT>",
			"superpowers:compaction-reminder",
			"",
			"Superpowers workflow still active. Invoke lifecycle skills at their trigger points:",
			...triggerLines,
			"</EXTREMELY_IMPORTANT>",
		].join("\n");
	}
	return [
		"<EXTREMELY_IMPORTANT>",
		"superpowers:compaction-reminder",
		"",
		"You are mid-Superpowers-run. Context was compacted. Re-arm your workflow:",
		...triggerLines,
		"- Resume your current task using the kept context above.",
		"</EXTREMELY_IMPORTANT>",
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
function buildDelegationContract(useSubagents: boolean, useTestDrivenDevelopment?: boolean): string {
	if (useSubagents) {
		return [
			"Subagent delegation is ENABLED by config.",
			"When a selected Superpowers skill calls for delegated work, you must use the `subagent` tool rather than doing that delegated work inline.",
			"This applies especially to implementation-plan execution, independent parallel investigations, bounded implementation, review, focused research, and debugging workflows.",
			"During normal Superpowers dispatch, omit `model` and `tasks[].model`.",
			"Each built-in role's frontmatter model tier is resolved through the current `superagents.modelTiers` configuration.",
			"Pass a model override only when the user explicitly requests a one-off override; never infer or invent one.",
			"This extension runtime policy overrides conflicting generic skill guidance about always specifying a model.",
			...(useTestDrivenDevelopment !== undefined
				? [
						`When delegating, pass \`useTestDrivenDevelopment: ${useTestDrivenDevelopment}\` in every \`subagent\` call so child agents inherit the active command profile explicitly.`,
					]
				: []),
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
 * Build the task scheduling contract block for the root session.
 *
 * @param taskScheduling Configured scheduling mode for Superpowers task execution.
 * @param reviewCadence Configured review timing for the active command.
 * @returns Prompt block that constrains sequential versus parallel task execution.
 */
function buildTaskSchedulingContract(taskScheduling: "sequential" | "parallel", reviewCadence: ReviewCadence): string {
	if (taskScheduling === "sequential") {
		return [
			"Task scheduling is SEQUENTIAL by config; scheduling controls Task order only.",
			"Execute one complete Task at a time. A Task includes all of its Steps.",
			reviewCadence === "final-only"
				? "Do not dispatch reviewers between Tasks; continue through every successful Task before the final whole-plan review."
				: "For each Task and the final branch review, follow the selected upstream SDD workflow and apply the Pi SDD adapter's role and review-scope mapping.",
		].join("\n");
	}

	return [
		"Task scheduling is PARALLEL by config; scheduling controls Task order and isolation only.",
		"For implementation plans, compose subagent-driven-development, dispatching-parallel-agents, and using-git-worktrees.",
		"A Task includes all of its Steps. Never dispatch or review individual Steps.",
		"Build conservative dependency-ready waves of at most 8 Tasks; overlapping or ambiguous Tasks stay sequential.",
		"Parallel scheduling with worktrees enabled is approval to create Task worktrees; do not ask again for every wave.",
		"Before parallel writers start, create one persistent worktree per Task under the configured worktree root and pass each absolute path as that task's cwd.",
		reviewCadence === "final-only"
			? "Do not dispatch reviewers inside Task waves; wait until every successful Task commit is integrated."
			: "For each Task, follow the selected upstream SDD workflow and apply the Pi SDD adapter's role and review-scope mapping.",
		reviewCadence === "final-only"
			? "Integrate successful Task commits in Task-number order, then clean the Task worktrees."
			: "Integrate upstream-approved Task commits in Task-number order, then clean the Task worktrees.",
		"Never integrate a failed or blocked Task; its dependents wait even when safe sibling Tasks finish.",
		"If worktree creation fails, report the reason and run the affected Tasks sequentially.",
		"If cherry-pick conflicts, abort it and rerun that Task sequentially from the updated parent HEAD instead of inventing a merge.",
		"After all Tasks are integrated and verified, continue the selected upstream SDD workflow through final review using `Review scope: branch`.",
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
 * Build the Pi adapter for the upstream Superpowers SDD lifecycle.
 *
 * The installed upstream skill owns lifecycle mechanics except where the
 * configured review cadence explicitly narrows review timing. This block maps
 * the resulting flow to Pi role names, review scopes, and session continuation.
 *
 * @param reviewCadence Configured review timing for the active command.
 * @returns Prompt block for the local SDD adapter contract.
 */
function buildSddAdapterContract(reviewCadence: ReviewCadence): string {
	if (reviewCadence === "final-only") {
		return [
			"Superpowers SDD Adapter Contract:",
			"Review cadence is FINAL-ONLY by config and overrides the upstream per-task review and re-review instructions.",
			"The selected upstream `subagent-driven-development` skill remains authoritative for scripts, workspace and ledger paths, handoff files, implementation dispatch, and final plan-workspace cleanup.",
			"- Dispatch implementers through `sp-implementer`.",
			"- Before Task 1, record `git rev-parse HEAD` as the final review base.",
			"- Do not dispatch `Review scope: task` or `Review scope: re-review`; the runtime rejects both under this command profile.",
			"- After every Task is complete and integrated, generate the final review package from the recorded final review base through current HEAD and dispatch `sp-review` alone with exactly `Review scope: branch`.",
			"- `Review scope: branch` means the final whole-plan diff; it does not require a feature branch.",
			"- When implementation ran on `main`, do not use `git merge-base main HEAD`; it resolves to current HEAD and would produce an empty review diff.",
			"- If final review finds issues, dispatch a fix implementer and repeat `Review scope: branch` after the fix; stay in the final review phase.",
			"- After the final whole-plan review is clean, complete upstream's final cleanup step before invoking `finishing-a-development-branch`.",
		].join("\n");
	}

	return [
		"Superpowers SDD Adapter Contract:",
		"The selected upstream `subagent-driven-development` skill is authoritative for scripts, workspace and ledger paths, handoff files, review and fix loops, retry and adjudication rules, and final plan-workspace cleanup.",
		"Do not reconstruct those upstream mechanics from this Pi adapter.",
		"- Dispatch implementers through `sp-implementer`.",
		"- Initial task review: dispatch `sp-review` with exactly `Review scope: task`.",
		"- Scoped fix re-review: dispatch `sp-review` with exactly `Review scope: re-review`.",
		"- Final whole-branch review: dispatch `sp-review` with exactly `Review scope: branch`.",
		"- The upstream reviewer template in the dispatch controls review inputs, boundaries, and output format; the marker only selects the Pi role mode.",
		"- When upstream requests resuming the original implementer, pass its prior session file through `resumeSession`; otherwise follow upstream's implementer selection.",
		"- After the final branch review is clean, complete upstream's final cleanup step before invoking `finishing-a-development-branch`.",
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
		buildRootLifecycleSkillsBlock(input.rootLifecycleSkills),
		"",
		"## Runtime Policy",
	];

	if (input.useBranches !== undefined) {
		sections.push(buildBranchContract(input.useBranches));
		sections.push("");
	}
	if (input.useSubagents !== undefined) {
		sections.push(buildDelegationContract(input.useSubagents, input.useTestDrivenDevelopment));
		sections.push("");
	}
	if (input.taskScheduling !== undefined) {
		sections.push(buildTaskSchedulingContract(input.taskScheduling, input.reviewCadence ?? "per-task"));
		sections.push("");
	}
	if (input.worktrees !== undefined) {
		sections.push(buildWorktreeContract(input.worktrees.enabled));
		sections.push("");
	}
	if (input.useSubagents === true) {
		sections.push(buildTaskTrackingContract());
		sections.push("");
		sections.push(buildSddAdapterContract(input.reviewCadence ?? "per-task"));
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
	if (input.taskScheduling !== undefined) configLines.push(`taskScheduling: ${input.taskScheduling}`);
	if (input.reviewCadence !== undefined) configLines.push(`reviewCadence: ${input.reviewCadence}`);
	configLines.push(`sessionMode: ${input.fork ? "fork" : "lineage-only"}`);

	return [`Superpowers ▸ ${input.task}`, "", "Config:", configLines.join("\n")].join("\n");
}
