/**
 * Unit tests for public TypeBox schema metadata.
 *
 * Responsibilities:
 * - verify user-visible descriptions stay aligned with supported execution modes
 * - guard parameter metadata used by tool callers and docs
 * - keep command-scoped Superpowers wording explicit
 * - enforce that the subagent schema exposes only Superpowers role execution fields
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
					agent?: {
						description?: string;
					};
					count?: {
						minimum?: number;
						description?: string;
					};
				};
			};
		};
		agent?: unknown;
		task?: unknown;
		useTestDrivenDevelopment?: unknown;
		action?: unknown;
		chainName?: unknown;
		config?: unknown;
		chain?: unknown;
		share?: unknown;
	};
}

let SubagentParams: SubagentParamsSchema | undefined;
let available = true;
try {
	({ SubagentParams } = (await import("../../src/shared/schemas.ts")) as { SubagentParams: SubagentParamsSchema });
} catch {
	// Skip in environments that do not install typebox.
	available = false;
}

void describe("SubagentParams schema", { skip: !available ? "typebox not available" : undefined }, () => {
	void it("includes context field for fresh/fork execution mode", () => {
		const contextSchema = SubagentParams?.properties?.context;
		assert.ok(contextSchema, "context schema should exist");
		assert.equal(contextSchema.type, "string");
		assert.deepEqual(contextSchema.enum, ["fresh", "fork"]);
		assert.match(String(contextSchema.description ?? ""), /fresh/);
		assert.match(String(contextSchema.description ?? ""), /fork/);
	});

	void it("describes workflow as superpowers-only role execution", () => {
		const workflowSchema = SubagentParams?.properties?.workflow;
		assert.ok(workflowSchema, "workflow schema should exist");
		assert.equal(workflowSchema.type, "string");
		assert.deepEqual(workflowSchema.enum, ["superpowers"]);
		assert.match(String(workflowSchema.description ?? ""), /superpowers/i);
		assert.match(String(workflowSchema.description ?? ""), /only 'superpowers' is supported/i);
	});

	void it("includes agent field with superpowers role description", () => {
		const agentSchema = SubagentParams?.properties?.agent;
		assert.ok(agentSchema, "agent schema should exist");
		assert.match(
			String((agentSchema as { description?: string })?.description ?? ""),
			/sp-recon|sp-implementer|superpowers role/i,
		);
	});

	void it("includes task field", () => {
		const taskSchema = SubagentParams?.properties?.task;
		assert.ok(taskSchema, "task schema should exist");
	});

	void it("includes useTestDrivenDevelopment field", () => {
		const schema = SubagentParams?.properties?.useTestDrivenDevelopment;
		assert.ok(schema, "useTestDrivenDevelopment schema should exist");
	});

	void it("includes tasks field for parallel role execution", () => {
		const tasksSchema = SubagentParams?.properties?.tasks;
		assert.ok(tasksSchema, "tasks schema should exist");
	});

	void it("does not expose generic management actions on the subagent schema", () => {
		const properties = (SubagentParams as { properties?: Record<string, unknown> }).properties ?? {};
		assert.equal("action" in properties, false);
		assert.equal("chainName" in properties, false);
		assert.equal("config" in properties, false);
	});

	void it("keeps only Superpowers role execution fields", () => {
		const properties = (SubagentParams as { properties?: Record<string, unknown> }).properties ?? {};
		assert.equal("agent" in properties, true);
		assert.equal("task" in properties, true);
		assert.equal("tasks" in properties, true);
		assert.equal("workflow" in properties, true);
		assert.equal("useTestDrivenDevelopment" in properties, true);
		assert.equal("implementerMode" in properties, false);
		assert.equal("chain" in properties, false);
		assert.equal("share" in properties, false);
	});

	void it("tasks items use SuperpowersRoleNameSchema for agent", () => {
		const tasksSchema = SubagentParams?.properties?.tasks;
		assert.ok(tasksSchema, "tasks schema should exist");
		const itemAgent = tasksSchema?.items?.properties?.agent;
		assert.ok(itemAgent, "tasks[].agent schema should exist");
		assert.match(String(itemAgent.description ?? ""), /sp-recon|superpowers role/i);
	});

	void it("tasks items do not include count field", () => {
		const tasksSchema = SubagentParams?.properties?.tasks;
		assert.ok(tasksSchema, "tasks schema should exist");
		const itemCount = tasksSchema?.items?.properties?.count;
		assert.equal(itemCount, undefined, "tasks[].count should not exist");
	});
});
