import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPiArgs } from "../../src/execution/pi-args.ts";

void describe("buildPiArgs session wiring", () => {
	void it("uses --session when sessionFile is provided", () => {
		const { args } = buildPiArgs({
			baseArgs: ["-p"],
			task: "hello",
			sessionEnabled: true,
			sessionFile: "/tmp/forked-session.jsonl",
		});

		assert.ok(args.includes("--session"));
		assert.ok(args.includes("/tmp/forked-session.jsonl"));
		assert.ok(!args.includes("--session-dir"), "--session-dir should not be emitted with --session");
		assert.ok(!args.includes("--no-session"), "--no-session should not be emitted with --session");
	});

	void it("keeps fresh mode behavior (no session file)", () => {
		const { args } = buildPiArgs({
			baseArgs: ["-p"],
			task: "hello",
			sessionEnabled: true,
		});

		assert.ok(!args.includes("--session"));
	});

	void it("preserves path-like tool extensions when extension discovery is disabled", () => {
		const { args } = buildPiArgs({
			baseArgs: ["-p"],
			task: "hello",
			sessionEnabled: true,
			tools: ["read", "./custom-tool.ts"],
			extensions: [],
		});

		assert.ok(args.includes("--no-extensions"));
		assert.ok(args.includes("--tools"));
		assert.ok(args.includes("read"));
		assert.deepEqual(args.slice(args.indexOf("--extension"), args.indexOf("--extension") + 2), [
			"--extension",
			"./custom-tool.ts",
		]);
	});
});
