import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	captureSingleOutputSnapshot,
	finalizeSingleOutput,
	injectSingleOutputInstruction,
	resolveSingleOutput,
	resolveSingleOutputPath,
} from "../../single-output.ts";

const tempDirs: string[] = [];

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (!dir) continue;
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe("resolveSingleOutputPath", () => {
	it("keeps absolute paths unchanged", () => {
		const absolutePath = path.join(os.tmpdir(), "pi-superagents-abs", "report.md");
		const resolved = resolveSingleOutputPath(absolutePath, "/repo", "/override");
		assert.equal(resolved, absolutePath);
	});

	it("resolves relative paths against requested cwd", () => {
		const resolved = resolveSingleOutputPath("reviews/report.md", "/runtime", "/requested");
		assert.equal(resolved, path.resolve("/requested", "reviews/report.md"));
	});

	it("resolves relative paths against runtime cwd when requested cwd is absent", () => {
		const resolved = resolveSingleOutputPath("reviews/report.md", "/runtime");
		assert.equal(resolved, path.resolve("/runtime", "reviews/report.md"));
	});

	it("resolves relative requested cwd from runtime cwd before resolving output", () => {
		const resolved = resolveSingleOutputPath("reviews/report.md", "/runtime", "nested/work");
		assert.equal(resolved, path.resolve("/runtime", "nested/work", "reviews/report.md"));
	});
});

describe("injectSingleOutputInstruction", () => {
	it("appends output instruction with resolved path", () => {
		const output = injectSingleOutputInstruction("Analyze this", "/tmp/report.md");
		assert.match(output, /Write your findings to: \/tmp\/report.md/);
	});
});

describe("resolveSingleOutput", () => {
	it("keeps agent-written file content when the file changed during the run", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-superagents-output-test-"));
		tempDirs.push(dir);
		const outputPath = path.join(dir, "review.md");
		const before = captureSingleOutputSnapshot(outputPath);

		fs.writeFileSync(outputPath, "real file content", "utf-8");

		const result = resolveSingleOutput(outputPath, "receipt text", before);
		assert.equal(result.fullOutput, "real file content");
		assert.equal(result.savedPath, outputPath);
		assert.equal(fs.readFileSync(outputPath, "utf-8"), "real file content");
	});

	it("falls back to persisting the assistant output when the file was not changed", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-superagents-output-test-"));
		tempDirs.push(dir);
		const outputPath = path.join(dir, "review.md");

		fs.writeFileSync(outputPath, "stale content", "utf-8");
		const before = captureSingleOutputSnapshot(outputPath);
		const result = resolveSingleOutput(outputPath, "fresh assistant output", before);

		assert.equal(result.fullOutput, "fresh assistant output");
		assert.equal(result.savedPath, outputPath);
		assert.equal(fs.readFileSync(outputPath, "utf-8"), "fresh assistant output");
	});
});

describe("finalizeSingleOutput", () => {
	it("formats saved-path messaging around the already-resolved output", () => {
		const result = finalizeSingleOutput({
			fullOutput: "line 1\nline 2\nline 3",
			truncatedOutput: "[TRUNCATED]\nline 1",
			outputPath: "/tmp/review.md",
			savedPath: "/tmp/review.md",
			exitCode: 0,
		});

		assert.match(result.displayOutput, /^\[TRUNCATED\]\nline 1/);
		assert.match(result.displayOutput, /📄 Output saved to:/);
	});

	it("does not add save messaging on failed runs", () => {
		const result = finalizeSingleOutput({
			fullOutput: "full output",
			truncatedOutput: "truncated output",
			outputPath: "/tmp/review.md",
			savedPath: "/tmp/review.md",
			exitCode: 1,
		});

		assert.equal(result.displayOutput, "truncated output");
	});
});
