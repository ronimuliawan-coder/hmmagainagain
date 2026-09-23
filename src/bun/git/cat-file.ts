// Persistent `git cat-file --batch` session: one long-lived child per open
// repository, so object reads (blob contents, tree listings) cost no process
// spawn per object. Requests are serialized — the batch protocol allows
// pipelining, but strict ordering keeps the reader trivially correct.

import { spawn } from "bun";

/** Minimal stdin-sink surface shared by Bun's FileSink and Cottontail's
 * ProcessWritable. FileSink is absent under Cottontail (RON-315), so the
 * session depends on this structural shape instead of either brand. */
interface StdinSink {
	write(chunk: string | Uint8Array): void;
	flush(): void;
	end(): void;
}

// Deliberate exception to the "spawnGit is the only spawner" invariant:
// the batch protocol needs one LONG-LIVED process with an interactive
// stdin/stdout dialogue, which one-shot spawnGit cannot express. Flag
// injection does not apply here: the argv is a constant and lookup specs
// travel over stdin, where git parses them as object names (unknown specs
// surface as missing/error, never as flags).

export interface CatFileObject {
	oid: string;
	type: string;
	size: number;
	data: Uint8Array;
}

interface PendingRequest {
	spec: string;
	resolve: (value: CatFileObject | null) => void;
	reject: (error: Error) => void;
}

export class CatFileSession {
	private proc: ReturnType<typeof spawn>;
	private reader: ReadableStreamDefaultReader<Uint8Array>;
	private buffer = new Uint8Array(0);
	private queue: PendingRequest[] = [];
	private closed = false;

	private stdinSink: StdinSink | null;

	private constructor(proc: ReturnType<typeof spawn>) {
		this.proc = proc;
		this.stdinSink =
			typeof proc.stdin === "object" && proc.stdin !== null ? proc.stdin : null;
		this.reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
		void this.readLoop();
	}

	static start(root: string): CatFileSession {
		return new CatFileSession(
			spawn(["git", "cat-file", "--batch"], {
				cwd: root,
				stdin: "pipe",
				stdout: "pipe",
				stderr: "pipe",
			}),
		);
	}

	read(spec: string): Promise<CatFileObject | null> {
		if (this.closed)
			return Promise.reject(new Error("cat-file session closed"));
		return new Promise<CatFileObject | null>((resolve, reject) => {
			const request: PendingRequest = { spec, resolve, reject };
			this.queue.push(request);
			if (this.queue.length === 1) {
				this.writeSpec(request);
			}
		});
	}

	close(): void {
		this.closed = true;
		try {
			this.stdinSink?.end();
			this.proc.kill();
		} catch {
			// already dead
		}
		for (const request of this.queue) {
			request.reject(new Error("cat-file session closed"));
		}
		this.queue = [];
	}

	private writeSpec(request: PendingRequest): void {
		if (this.closed || !this.stdinSink) return;
		this.stdinSink.write(`${request.spec}\n`);
		this.stdinSink.flush();
	}

	private advance(): void {
		this.queue.shift();
		const next = this.queue[0];
		if (next) this.writeSpec(next);
	}

	private async readLoop(): Promise<void> {
		try {
			while (true) {
				const header = await this.readLine();
				if (header === null) break;
				const parts = header.trim().split(" ");
				if (parts.length === 2 && parts[1] === "missing") {
					const request = this.queue[0];
					this.advance();
					request?.resolve(null);
					continue;
				}
				const [oid, type, sizeRaw] = parts;
				const size = Number(sizeRaw);
				// A malformed batch header must fail just this request, not
				// resolve a bogus object or poison the whole queue (CodeRabbit
				// U0–U8 review). The batch protocol is stable, so any deviation
				// is a bug worth surfacing verbatim.
				if (parts.length !== 3 || !Number.isInteger(size) || size < 0) {
					const request = this.queue[0];
					this.advance();
					request?.reject(new Error(`malformed cat-file header: ${header}`));
					continue;
				}
				const data = await this.readExact(size);
				await this.readExact(1); // trailing newline after the object body
				const request = this.queue[0];
				this.advance();
				request?.resolve({ oid, type, size, data });
				if (this.closed && this.queue.length === 0) break;
			}
		} catch (error) {
			for (const request of this.queue) {
				request.reject(
					error instanceof Error ? error : new Error(String(error)),
				);
			}
			this.queue = [];
		}
	}

	private async readLine(): Promise<string | null> {
		while (true) {
			const newline = this.buffer.indexOf(0x0a);
			if (newline !== -1) {
				const line = new TextDecoder().decode(this.buffer.slice(0, newline));
				this.buffer = this.buffer.slice(newline + 1);
				return line;
			}
			const { done, value } = await this.reader.read();
			if (done) {
				return this.buffer.length > 0
					? new TextDecoder().decode(this.buffer)
					: null;
			}
			this.append(value);
		}
	}

	private async readExact(count: number): Promise<Uint8Array> {
		while (this.buffer.length < count) {
			const { done, value } = await this.reader.read();
			if (done) {
				throw new Error(
					`cat-file: stream ended after ${this.buffer.length}/${count} bytes`,
				);
			}
			this.append(value);
		}
		const out = this.buffer.slice(0, count);
		this.buffer = this.buffer.slice(count);
		return out;
	}

	private append(value: Uint8Array): void {
		const merged = new Uint8Array(this.buffer.length + value.length);
		merged.set(this.buffer);
		merged.set(value, this.buffer.length);
		this.buffer = merged;
	}
}
