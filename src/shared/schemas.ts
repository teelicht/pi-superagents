/**
 * TypeBox schemas for subagent tool parameters and status inspection.
 *
 * Responsibilities:
 * - describe the public tool contract for Superpowers role execution
 * - keep user-facing parameter descriptions aligned with runtime behavior
 * - expose command-scoped Superpowers metadata without changing default semantics
 */

import { Type } from "typebox";

// Note: Using Type.Any() for Google API compatibility (doesn't support anyOf)
const SkillOverride = Type.Any({
	description: "Skill name(s) to inject (comma-separated), array of strings, or boolean (false disables, true uses default)",
});

export const SuperpowersRoleNameSchema = Type.String({
	description: "Discovered agent name to execute. Typical built-in Superpowers roles are sp-recon, sp-research, sp-implementer, sp-spec-review, sp-code-review, and sp-debug.",
});

export const TaskItem = Type.Object(
	{
		agent: SuperpowersRoleNameSchema,
		task: Type.String({ description: "Objective for this discovered agent task." }),
		cwd: Type.Optional(Type.String()),
		model: Type.Optional(Type.String({ description: "Override model for this discovered agent task." })),
		skill: Type.Optional(SkillOverride),
	},
	{ additionalProperties: false },
);

export const SubagentParams = Type.Object(
	{
		agent: Type.Optional(SuperpowersRoleNameSchema),
		task: Type.Optional(Type.String({ description: "The specific objective for the selected discovered agent." })),
		workflow: Type.Optional(
			Type.String({
				enum: ["superpowers"],
				description: "Superpowers role execution workflow. Only 'superpowers' is supported.",
			}),
		),
		useTestDrivenDevelopment: Type.Optional(
			Type.Boolean({
				description: "Whether sp-implementer should receive test-driven-development guidance.",
			}),
		),
		tasks: Type.Optional(
			Type.Array(TaskItem, {
				description: "Parallel discovered-agent tasks for coordinated execution. The common built-in choices are the Superpowers role agents.",
				minItems: 1,
			}),
		),
		sessionMode: Type.Optional(
			Type.String({
				enum: ["standalone", "lineage-only", "fork"],
				description:
					"Subagent session mode. 'standalone' has no parent link, 'lineage-only' links to the parent session without inheriting turns, and 'fork' inherits the parent session branch.",
			}),
		),

		cwd: Type.Optional(Type.String({ description: "Working directory for the Superpowers role task." })),
		artifacts: Type.Optional(Type.Boolean({ description: "Whether to preserve execution artifacts for debugging." })),
		includeProgress: Type.Optional(Type.Boolean({ description: "Include detailed step-by-step progress in the tool output." })),
		skill: Type.Optional(SkillOverride),
		model: Type.Optional(Type.String({ description: "Override the model for this discovered agent execution." })),
	},
	{
		additionalProperties: false,
	},
);
