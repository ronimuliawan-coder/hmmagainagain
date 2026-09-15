// Remote read/write paths (U7): fetch, push, pull.
//
// Safety model: everything goes through the serialized write queue — remotes
// mutate refs on BOTH sides, so local ops must not race them. Push/pull run
// hooks/credentials exactly as git does (system credential helpers only; the
// app stores nothing). Pull is `--ff-only` by design: v1 has no conflict UI,
// so a diverged state fails with git's verbatim message instead of an
// implicit merge. No force-push exists anywhere in this module.

import { assertSafeRef, spawnGit } from "../git-spawn";
import { GitError } from "./git-error";
import { enqueueWrite } from "./write-queue";

export type RemoteOp = "fetch" | "push" | "pull";

export interface RemoteOptions {
	remote: string;
	/** Branch for push/pull refspecs; defaults to the current branch's upstream behaviour. */
	branch?: string;
	/** First push sets upstream tracking (-u). */
	setUpstream?: boolean;
	signal?: AbortSignal;
	/** Progress/diagnostic lines (git --progress writes these to stderr). */
	onLine?: (line: string) => void;
}

function argsFor(op: RemoteOp, options: RemoteOptions): string[] {
	const args = [op, "--progress"];
	if (op === "push") {
		if (options.setUpstream) args.push("-u");
		args.push(options.remote);
		args.push(options.branch ?? "HEAD");
	} else if (op === "fetch") {
		args.push(options.remote);
	} else {
		// pull: fast-forward only — a diverged state must fail loudly, not merge.
		args.push("--ff-only");
		args.push(options.remote);
		if (options.branch) args.push(options.branch);
	}
	return args;
}

export async function remoteOp(
	root: string,
	op: RemoteOp,
	options: RemoteOptions,
): Promise<{ code: number | null }> {
	// Refuse leading-dash values before argv construction (CWE-88): remote
	// and branch sit in flag-parsable positions with no `--` separator.
	assertSafeRef(options.remote, "remote");
	if (options.branch !== undefined) assertSafeRef(options.branch, "branch");
	return enqueueWrite(async () => {
		// Line-buffer progress: decode streaming (multi-byte sequences may
		// split across pipe reads) and emit whole lines so consumers never
		// see half a line or a split character (CodeRabbit U0–U8 review).
		const lineDecoder = new TextDecoder();
		let lineRest = "";
		const emitLines = (text: string): void => {
			lineRest += text;
			// Git progress uses \r as well as \n over pipes; split on both
			// so \r-delimited updates never arrive glued together.
			const parts = lineRest.split(/\r\n|\r|\n/);
			lineRest = parts.pop() ?? "";
			for (const line of parts) options.onLine?.(`${line}\n`);
		};
		const result = await spawnGit(root, argsFor(op, options), {
			signal: options.signal,
			onStderr: (c) => {
				emitLines(lineDecoder.decode(c, { stream: true }));
			},
		});
		emitLines(lineDecoder.decode());
		if (lineRest.length > 0) options.onLine?.(lineRest);
		if (result.code !== 0) {
			throw new GitError(`git ${op} failed`, result.stderr, result.code);
		}
		return { code: result.code };
	});
}
