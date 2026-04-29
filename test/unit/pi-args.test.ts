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

	void it("emits --no-extensions when an explicit empty extension list is provided", () => {
		const { args } = buildPiArgs({
			baseArgs: ["--mode", "json", "-p"],
			task: "hello",
			sessionEnabled: false,
			extensions: [],
		});

		assert.ok(args.includes("--no-extensions"));
		assert.equal(args.includes("--extension"), false);
	});

	void it("keeps path-like tool extensions when explicit extensions are provided", () => {
		const { args } = buildPiArgs({
			baseArgs: ["--mode", "json", "-p"],
			task: "hello",
			sessionEnabled: false,
			tools: ["read", "./tools/custom-tool.ts"],
			extensions: ["./extensions/global.ts"],
		});

		assert.ok(args.includes("--no-extensions"));
		assert.deepEqual(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2), ["--tools", "read"]);
		assert.deepEqual(
			args.filter((arg, index) => arg === "--extension" || args[index - 1] === "--extension"),
			["--extension", "./extensions/global.ts", "--extension", "./tools/custom-tool.ts"],
		);
	});
});