/**
 * TypeBox schemas for subagent tool parameters and status inspection.
 *
 * Responsibilities:
 * - describe the public tool contract for Superpowers role execution
 * - keep user-facing parameter descriptions aligned with runtime behavior
 * - expose command-scoped Superpowers metadata without changing default semantics
 */

import { Type } from "@sinclair/typebox";

// Note: Using Type.Any() for Google API compatibility (doesn't support anyOf)
const SkillOverride = Type.Any({ description: "Skill name(s) to inject (comma-separated), array of strings, or boolean (false disables, true uses default)" });

export const SuperpowersRoleNameSchema = Type.String({
	description: "Superpowers role agent name: sp-recon, sp-research, sp-implementer, sp-spec-review, sp-code-review, or sp-debug.",
});

export const TaskItem = Type.Object({
	agent: SuperpowersRoleNameSchema,
	task: Type.String(),
	cwd: Type.Optional(Type.String()),
	model: Type.Optional(Type.String({ description: "Override model for this Superpowers role task." })),
	skill: Type.Optional(SkillOverride),
});

export const SubagentParams = Type.Object({
	agent: Type.Optional(SuperpowersRoleNameSchema),
	task: Type.Optional(Type.String({ description: "Task for a single Superpowers role agent." })),
	workflow: Type.Optional(Type.String({
		enum: ["superpowers"],
		description: "Superpowers role execution. Generic subagent workflows are not part of this package.",
	})),
	useTestDrivenDevelopment: Type.Optional(Type.Boolean({
		description: "Whether sp-implementer should receive test-driven-development guidance when available.",
	})),
	tasks: Type.Optional(Type.Array(TaskItem, {
		description: "Parallel Superpowers role tasks selected by the root Superpowers workflow.",
	})),
	context: Type.Optional(Type.String({
		enum: ["fresh", "fork"],
		description: "'fresh' or 'fork' to branch from parent session.",
	})),
	cwd: Type.Optional(Type.String()),
	async: Type.Optional(Type.Boolean({ description: "Run in background when supported by the runtime." })),
	artifacts: Type.Optional(Type.Boolean({ description: "Write debug artifacts." })),
	includeProgress: Type.Optional(Type.Boolean({ description: "Include full progress in result." })),
	sessionDir: Type.Optional(Type.String({ description: "Directory to store session logs." })),
	skill: Type.Optional(SkillOverride),
	model: Type.Optional(Type.String({ description: "Override model for single Superpowers role execution." })),
});

export const StatusParams = Type.Object({
	action: Type.Optional(Type.String({ description: "Action: 'list' to show active async runs, 'config' to inspect config diagnostics, 'migrate-config' to apply safe config migrations, or omit to inspect one run by id/dir" })),
	id: Type.Optional(Type.String({ description: "Async run id or prefix" })),
	dir: Type.Optional(Type.String({ description: "Async run directory (overrides id search)" })),
});
