import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const queueDir = process.env.MOCK_PI_QUEUE_DIR;

function fail(message, exitCode = 1) {
	process.stderr.write(`${message}\n`);
	process.exit(exitCode);
}

function listPendingFiles(dir) {
	return fs.readdirSync(dir)
		.filter((name) => name.startsWith("pending-") && name.endsWith(".json"))
		.sort();
}

function claimNextResponse(dir) {
	for (const fileName of listPendingFiles(dir)) {
		const sourcePath = path.join(dir, fileName);
		const targetPath = path.join(dir, fileName.replace(/^pending-/, "consumed-"));
		try {
			fs.renameSync(sourcePath, targetPath);
			return JSON.parse(fs.readFileSync(targetPath, "utf-8"));
		} catch (error) {
			if (error && typeof error === "object" && "code" in error) {
				const code = error.code;
				if (code === "ENOENT" || code === "EEXIST") continue;
			}
			throw error;
		}
	}

	const defaultPath = path.join(dir, "default-response.json");
	if (!fs.existsSync(defaultPath)) return undefined;
	return JSON.parse(fs.readFileSync(defaultPath, "utf-8"));
}

function defaultAssistantMessage(output) {
	return {
		type: "message_end",
		message: {
			role: "assistant",
			content: [{ type: "text", text: output }],
			model: "mock/test-model",
			usage: {
				input: 100,
				output: 50,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 0.001 },
			},
		},
	};
}

function defaultResponse() {
	return { output: "ok", exitCode: 0 };
}

function writeJsonlLine(entry) {
	const line = typeof entry === "string" ? entry : JSON.stringify(entry);
	process.stdout.write(`${line}\n`);
}

/**
 * Write a lifecycle signal atomically using temp-file-then-rename.
 */
function writeLifecycleSignalAtomic(sessionFile, signal) {
	const sidecar = `${sessionFile}.exit`;
	fs.mkdirSync(path.dirname(sidecar), { recursive: true });
	const tmp = `${sidecar}.tmp-${process.pid}-${crypto.randomUUID()}`;
	fs.writeFileSync(tmp, JSON.stringify(signal), "utf-8");
	fs.renameSync(tmp, sidecar);
}

async function main() {
	if (!queueDir) fail("MOCK_PI_QUEUE_DIR is required.");
	if (!fs.existsSync(queueDir)) fail(`Mock queue dir does not exist: ${queueDir}`);

	const response = claimNextResponse(queueDir) ?? defaultResponse();
	fs.writeFileSync(path.join(queueDir, `call-${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}.json`), "", "utf-8");

	if (typeof response.delay === "number" && response.delay > 0) {
		await new Promise((resolve) => setTimeout(resolve, response.delay));
	}

	// Write lifecycle sidecar before outputting JSONL
	if (response.writeLifecycleSignal) {
		const { sessionFile, signal } = response.writeLifecycleSignal;
		writeLifecycleSignalAtomic(sessionFile, signal);
	}

	if (Array.isArray(response.jsonl) && response.jsonl.length > 0) {
		for (const entry of response.jsonl) {
			writeJsonlLine(entry);
		}
	} else if (response.echoArgs === true) {
		writeJsonlLine(defaultAssistantMessage(JSON.stringify(process.argv.slice(2))));
	} else if (Array.isArray(response.echoEnv) && response.echoEnv.length > 0) {
		const envSnapshot = Object.fromEntries(response.echoEnv.map((key) => [key, process.env[key] ?? null]));
		writeJsonlLine(defaultAssistantMessage(JSON.stringify(envSnapshot)));
	} else if (typeof response.output === "string") {
		writeJsonlLine(defaultAssistantMessage(response.output));
	}

	if (typeof response.stderr === "string" && response.stderr.length > 0) {
		process.stderr.write(response.stderr);
	}

	process.exit(typeof response.exitCode === "number" ? response.exitCode : 0);
}

main().catch((error) => {
	fail(error instanceof Error ? error.message : String(error));
});
