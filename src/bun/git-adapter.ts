// GitAdapter — the typed semantic layer over the git binary. Everything above
// this file speaks domain objects (GitStatus, LogCommit, DiffResult); nothing
// above it knows git's CLI surface. Mutations do not exist here (U5 owns
// staging/commit behind explicit user actions).

import type { GitRunOptions } from "../shared/platform";
import { CatFileSession } from "./git/cat-file";
import { type DiffOptions, type DiffResult, diff } from "./git/diff";
import { GitError } from "./git/git-error";
import { feedLog, type LogCommit, type LogOptions, log } from "./git/log";
import { type GitStatus, parseStatusV2 } from "./git/status-parser";
import { spawnGit } from "./git-spawn";

export { GitError };

export interface GitAdapter {
	status(root: string): Promise<GitStatus>;
	log(root: string, options?: LogOptions): Promise<LogCommit[]>;
	feedLog(
		root: string,
		onCommit: (commit: LogCommit) => void,
		options?: LogOptions,
		opts?: GitRunOptions,
	): Promise<{ count: number }>;
	diff(root: string, options?: DiffOptions): Promise<DiffResult>;
	openCatFile(root: string): CatFileSession;
}

async function status(root: string): Promise<GitStatus> {
	const chunks: Uint8Array[] = [];
	const result = await spawnGit(
		root,
		["status", "--porcelain=v2", "--branch", "-z", "-uall"],
		{
			onStdout: (c) => chunks.push(c),
			// Read-only status must not fight the user's own git for index.lock.
			env: { GIT_OPTIONAL_LOCKS: "0" },
		},
	);
	if (result.code !== 0) {
		throw new GitError(
			`git status failed in ${root}`,
			result.stderr,
			result.code,
		);
	}
	const raw = chunks.map((c) => new TextDecoder().decode(c)).join("");
	return parseStatusV2(raw);
}

export function createGitAdapter(): GitAdapter {
	return {
		status,
		log,
		feedLog,
		diff,
		openCatFile: (root: string) => CatFileSession.start(root),
	};
}
