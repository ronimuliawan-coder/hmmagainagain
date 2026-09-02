// Low-level git spawning: the ONLY place in the codebase that starts git.
// Invariants (docs/GOVERNANCE.md): argv arrays only (never a shell), cwd pinned
// to the opened repository root, verbatim stderr, abort kills the child.

import type { GitRunOptions, GitRunResult } from "../shared/platform";

export function assertSafeArgs(args: string[]): void {
	for (const arg of args) {
		if (typeof arg !== "string" || arg.includes("\0")) {
			throw new Error(`invalid git argument: ${String(arg)}`);
		}
	}
}

export async function spawnGit(
	root: string,
	args: string[],
	opts?: GitRunOptions,
): Promise<GitRunResult> {
	assertSafeArgs(args);
	const proc = Bun.spawn(["git", ...args], {
		cwd: root,
		stdout: "pipe",
		stderr: "pipe",
		stdin: "ignore",
	});

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
	const stderrDecoder = new TextDecoder();
	const stdoutDone = (async () => {
		if (!proc.stdout) return;
		for await (const chunk of proc.stdout) {
			opts?.onStdout?.(chunk);
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
	};
}
