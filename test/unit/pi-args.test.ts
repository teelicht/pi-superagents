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
});
