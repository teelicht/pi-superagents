/**
 * Unit tests for public TypeBox schema metadata.
 *
 * Responsibilities:
 * - verify user-visible descriptions stay aligned with supported execution modes
 * - guard parameter metadata used by tool callers and docs
 * - keep command-scoped Superpowers wording explicit
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

interface SubagentParamsSchema {
	properties?: {
		workflow?: {
			type?: string;
			enum?: string[];
			description?: string;
		};
		context?: {
			type?: string;
			enum?: string[];
			description?: string;
		};
		tasks?: {
			items?: {
				properties?: {
					count?: {
						minimum?: number;
						description?: string;
					};
				};
			};
		};
	};
}

interface StatusParamsSchema {
	properties?: {
		action?: {
			type?: string;
			description?: string;
		};
	};
}

let SubagentParams: SubagentParamsSchema | undefined;
let StatusParams: StatusParamsSchema | undefined;
let available = true;
try {
	({ SubagentParams, StatusParams } = await import("../../schemas.ts") as { SubagentParams: SubagentParamsSchema; StatusParams: StatusParamsSchema });
} catch {
	// Skip in environments that do not install typebox.
	available = false;
}

describe("SubagentParams schema", { skip: !available ? "typebox not available" : undefined }, () => {
	it("includes context field for fresh/fork execution mode", () => {
		const contextSchema = SubagentParams?.properties?.context;
		assert.ok(contextSchema, "context schema should exist");
		assert.equal(contextSchema.type, "string");
		assert.deepEqual(contextSchema.enum, ["fresh", "fork"]);
		assert.match(String(contextSchema.description ?? ""), /fresh/);
		assert.match(String(contextSchema.description ?? ""), /fork/);
	});

	it("describes workflow as command-scoped superpowers behavior", () => {
		const workflowSchema = SubagentParams?.properties?.workflow;
		assert.ok(workflowSchema, "workflow schema should exist");
		assert.equal(workflowSchema.type, "string");
		assert.deepEqual(workflowSchema.enum, ["default", "superpowers"]);
		assert.match(String(workflowSchema.description ?? ""), /superpowers/i);
		assert.match(String(workflowSchema.description ?? ""), /default/i);
		assert.match(String(workflowSchema.description ?? ""), /unchanged/i);
	});

	it("includes count on top-level parallel tasks", () => {
		const taskCountSchema = SubagentParams?.properties?.tasks?.items?.properties?.count;
		assert.ok(taskCountSchema, "tasks[].count schema should exist");
		assert.equal(taskCountSchema.minimum, 1);
		assert.match(String(taskCountSchema.description ?? ""), /repeat/i);
	});

	it("includes action on status params for list mode", () => {
		const actionSchema = StatusParams?.properties?.action;
		assert.ok(actionSchema, "status action schema should exist");
		assert.equal(actionSchema.type, "string");
		assert.match(String(actionSchema.description ?? ""), /list/i);
	});
});
