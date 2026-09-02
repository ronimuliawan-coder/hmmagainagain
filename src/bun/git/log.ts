// Streaming `git log` reader. Records are NUL-terminated; fields are
// US (\x1f) separated: oid, shortOid, authorName, authorEmail, date(ISO-8601),
// subject, refs (%D, may be empty). Chunks are fed incrementally so history
// can render before the command finishes (U6 virtualized list depends on it).

import type { GitRunOptions } from "../../shared/platform";
import { spawnGit } from "../git-spawn";

export interface LogCommit {
	oid: string;
	shortOid: string;
	authorName: string;
	authorEmail: string;
	date: string;
	subject: string;
	refs: string;
}

export interface LogOptions {
	limit?: number;
	skip?: number;
	/** Revision range, e.g. "main..HEAD" or a single ref. */
	range?: string;
	pathspecs?: string[];
}

export const LOG_FORMAT = "%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%D%x00";

export function logArgs(options: LogOptions = {}): string[] {
	const args = ["log", `--format=${LOG_FORMAT}`];
	if (options.limit !== undefined) args.push(`--max-count=${options.limit}`);
	if (options.skip !== undefined) args.push(`--skip=${options.skip}`);
	args.push("--no-color");
	if (options.range) args.push(options.range);
	if (options.pathspecs?.length) args.push("--", ...options.pathspecs);
	return args;
}

/**
 * Incremental parser: feed raw stdout chunks, receive complete commits in
 * order. Handles records split across chunk boundaries via a remainder buffer.
 */
export class LogRecordParser {
	private buffer = "";

	feed(chunk: Uint8Array): LogCommit[] {
		this.buffer += new TextDecoder().decode(chunk);
		const commits: LogCommit[] = [];
		let index = this.buffer.indexOf("\0");
		while (index !== -1) {
			// git log separates entries with a leading newline when the format
			// does not end with one — strip it (a record never starts with \n).
			let record = this.buffer.slice(0, index);
			this.buffer = this.buffer.slice(index + 1);
			record = record.replace(/^\n/, "");
			if (record.trim().length > 0) {
				commits.push(parseCommitRecord(record));
			}
			index = this.buffer.indexOf("\0");
		}
		return commits;
	}

	/** Flush a final (unterminated) record — git closes stdout at exit. */
	flush(): LogCommit[] {
		const rest = this.buffer;
		this.buffer = "";
		return rest.trim().length > 0 ? [parseCommitRecord(rest)] : [];
	}
}

function parseCommitRecord(record: string): LogCommit {
	const fields = record.split("\x1f");
	return {
		oid: fields[0] ?? "",
		shortOid: fields[1] ?? "",
		authorName: fields[2] ?? "",
		authorEmail: fields[3] ?? "",
		date: fields[4] ?? "",
		subject: fields[5] ?? "",
		refs: fields[6] ?? "",
	};
}

/** Collect the full log (bounded by opts). For UI streaming use feedLog. */
export async function log(
	root: string,
	options: LogOptions = {},
	opts?: GitRunOptions,
): Promise<LogCommit[]> {
	const parser = new LogRecordParser();
	const collected: LogCommit[] = [];
	const result = await spawnGit(root, logArgs(options), {
		...opts,
		onStdout: (chunk) => {
			collected.push(...parser.feed(chunk));
			opts?.onStdout?.(chunk);
		},
	});
	if (result.code !== 0) {
		throw new Error(`git log failed: ${result.stderr}`);
	}
	collected.push(...parser.flush());
	return collected;
}

/** Streamed variant: onCommit fires per parsed commit, in order. */
export async function feedLog(
	root: string,
	onCommit: (commit: LogCommit) => void,
	options: LogOptions = {},
	opts?: GitRunOptions,
): Promise<{ count: number }> {
	const parser = new LogRecordParser();
	let count = 0;
	const result = await spawnGit(root, logArgs(options), {
		...opts,
		onStdout: (chunk) => {
			for (const commit of parser.feed(chunk)) {
				count += 1;
				onCommit(commit);
			}
			opts?.onStdout?.(chunk);
		},
	});
	for (const commit of parser.flush()) {
		count += 1;
		onCommit(commit);
	}
	if (result.code !== 0) {
		throw new Error(`git log failed: ${result.stderr}`);
	}
	return { count };
}
