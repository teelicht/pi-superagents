/**
 * Module: JSONL Stream Writer
 *
 * Purpose: Provides a safe, backpressure-aware writer for appending JSON Lines to a file.
 * Key responsibilities:
 * - Appends JSONL strings to a file stream.
 * - Handles Node.js stream backpressure by pausing/resuming a `DrainableSource` to prevent unbounded memory usage.
 * - Enforces a maximum file size limit (default 50MB) to prevent run-away log files.
 * Important dependencies or side effects:
 * - Uses `node:fs` to create write streams on the file system.
 */

import * as fs from "node:fs";

export interface DrainableSource {
	pause(): void;
	resume(): void;
}

export interface JsonlWriteStream {
	write(chunk: string): boolean;
	once(event: "drain", listener: () => void): JsonlWriteStream;
	end(callback?: () => void): void;
}

const DEFAULT_MAX_JSONL_BYTES = 50 * 1024 * 1024;

export interface JsonlWriterDeps {
	createWriteStream?: (filePath: string) => JsonlWriteStream;
	maxBytes?: number;
}

export interface JsonlWriter {
	writeLine(line: string): void;
	close(): Promise<void>;
}

export function createJsonlWriter(
	filePath: string | undefined,
	source: DrainableSource,
	deps: JsonlWriterDeps = { /* empty */ },
): JsonlWriter {
	if (!filePath) {
		return {
			writeLine() { /* empty */ },
			async close() { /* empty */ },
		};
	}

	const createWriteStream = deps.createWriteStream ?? ((targetPath: string) => fs.createWriteStream(targetPath, { flags: "a" }));
	let stream: JsonlWriteStream | undefined;
	try {
		stream = createWriteStream(filePath);
	} catch {
		return {
			writeLine() { /* empty */ },
			async close() { /* empty */ },
		};
	}

	let backpressured = false;
	let closed = false;
	let bytesWritten = 0;
	const maxBytes = deps.maxBytes ?? DEFAULT_MAX_JSONL_BYTES;

	return {
		writeLine(line: string) {
			if (!stream || closed || !line.trim()) return;
			const chunk = `${line}\n`;
			const chunkBytes = Buffer.byteLength(chunk, "utf-8");
			if (bytesWritten + chunkBytes > maxBytes) return;
			try {
				const ok = stream.write(chunk);
				bytesWritten += chunkBytes;
				if (!ok && !backpressured) {
					backpressured = true;
					source.pause();
					stream.once("drain", () => {
						backpressured = false;
						if (!closed) source.resume();
					});
				}
			} catch { /* empty */ }
		},
		async close() {
			if (!stream || closed) return;
			closed = true;
			const current = stream;
			stream = undefined;
			await new Promise<void>((resolve) => current.end(() => resolve()));
		},
	};
}
