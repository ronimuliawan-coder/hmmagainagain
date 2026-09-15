// Low-level git spawning: the ONLY place in the codebase that starts git.
// Invariants (docs/GOVERNANCE.md): argv arrays only (never a shell), cwd pinned
// to the opened repository root, verbatim stderr, abort kills the child.

import type { Subprocess } from "bun";
import type { GitRunOptions, GitRunResult } from "../shared/platform";
import { GitError } from "./git/git-error";

export function assertSafeArgs(args: string[]): void {
	for (const arg of args) {
		if (typeof arg !== "string" || arg.includes("\0")) {
			throw new Error(`invalid git argument: ${String(arg)}`);
		}
	}
}

/** Reject leading-dash values before they become git arguments (CWE-88
 * argument injection: `--upload-pack=` etc. would parse as options, and no
 * `--` separator exists for refspecs/remotes). Applies to user-influenced
 * names that flow into argv positions git parses as flags: remotes,
 * branches, start points. CodeRabbit U0–U8 review. */
export function assertSafeRef(value: string, what: string): void {
	if (value.startsWith("-")) {
		throw new Error(`invalid ${what}: must not start with '-': ${value}`);
	}
}

/** Decode collected stdout/stderr chunks: concatenate bytes FIRST, decode
 * once — per-chunk decoding corrupts multi-byte sequences split across pipe
 * reads (CodeRabbit U0–U8 review). */
export function decodeChunks(chunks: Uint8Array[]): string {
	if (chunks.length === 0) return "";
	if (chunks.length === 1) return new TextDecoder().decode(chunks[0]);
	const total = chunks.reduce((n, c) => n + c.length, 0);
	const joined = new Uint8Array(total);
	let offset = 0;
	for (const c of chunks) {
		joined.set(c, offset);
		offset += c.length;
	}
	return new TextDecoder().decode(joined);
}

export interface SpawnGitOptions extends GitRunOptions {
	/** Extra environment for the child (fixtures use it for deterministic
	 * author/date). Values merge over the inherited process env. */
	env?: Record<string, string>;
	/** Text piped to the child's stdin (e.g. a patch for `git apply -`).
	 * Always closed immediately after writing so commands that never read
	 * stdin see a clean EOF. */
	stdin?: string;
	/** Collect stdout chunks into the result (remote ops print to stdout). */
	collectStdout?: boolean;
}

export async function spawnGit(
	root: string,
	args: string[],
	opts?: SpawnGitOptions,
): Promise<GitRunResult> {
	assertSafeArgs(args);
	let proc: Subprocess<"pipe", "pipe", "pipe">;
	try {
		proc = Bun.spawn(["git", ...args], {
			cwd: root,
			stdout: "pipe",
			stderr: "pipe",
			stdin: "pipe",
			env: opts?.env ? { ...process.env, ...opts.env } : undefined,
		});
	} catch (error) {
		// Missing git binary or a cwd that does not exist surface as ENOENT here.
		throw new GitError(`failed to spawn git: ${String(error)}`, "", null);
	}

	// Feed stdin before draining so `git apply -` never deadlocks; a child
	// that exits early makes the write fail, which its exit code reports.
	if (opts?.stdin !== undefined) {
		try {
			proc.stdin?.write(opts.stdin);
		} catch {
			// child already gone — exit code / stderr carry the real error
		}
	}
	try {
		proc.stdin?.end();
	} catch {
		// already closed
	}

	// Wire abort → SIGTERM manually (instead of spawn's `signal` option) so the
	// reported outcome distinguishes killed runs from completed ones.
	let aborted = false;
	const abort = () => {
		aborted = true;
		try {
			proc.kill("SIGTERM");
		} catch {
			// already exited
		}
	};
	if (opts?.signal?.aborted) abort();
	opts?.signal?.addEventListener("abort", abort, { once: true });

	// Both pipes are drained concurrently: stdout to the consumer, stderr to a
	// verbatim buffer. Skipping a drain risks the child blocking on a full pipe.
	let stderr = "";
	const stdoutChunks: Uint8Array[] = [];
	const stderrDecoder = new TextDecoder();
	const stdoutDone = (async () => {
		if (!proc.stdout) return;
		for await (const chunk of proc.stdout) {
			opts?.onStdout?.(chunk);
			if (opts?.collectStdout) stdoutChunks.push(chunk);
		}
	})().catch(() => {});
	const stderrDone = (async () => {
		if (!proc.stderr) return;
		for await (const chunk of proc.stderr) {
			stderr += stderrDecoder.decode(chunk, { stream: true });
			opts?.onStderr?.(chunk);
		}
	})().catch(() => {});

	const exitCode = await proc.exited;
	await Promise.all([stdoutDone, stderrDone]);
	opts?.signal?.removeEventListener("abort", abort);

	return {
		code: exitCode,
		// `aborted` disambiguates a kill we requested from git's own failure exit.
		signal: proc.signalCode ?? (aborted && exitCode !== 0 ? "SIGTERM" : null),
		stderr,
		stdout: opts?.collectStdout ? decodeChunks(stdoutChunks) : undefined,
	};
}
