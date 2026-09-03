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
	/** Every file in the worktree (tracked + untracked, ignored excluded),
	 * sorted — resetPaths input for U3. preparePresortedFileTreeInput remains
	 * available if large-repo profiling (U8) shows prep cost matters. */
	worktreePaths(root: string): Promise<string[]>;
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

async function worktreePaths(root: string): Promise<string[]> {
	const chunks: Uint8Array[] = [];
	const result = await spawnGit(
		root,
		["ls-files", "-co", "--exclude-standard", "-z"],
		{ onStdout: (c) => chunks.push(c), env: { GIT_OPTIONAL_LOCKS: "0" } },
	);
	if (result.code !== 0) {
		throw new GitError(
			`git ls-files failed in ${root}`,
			result.stderr,
			result.code,
		);
	}
	return chunks
		.map((c) => new TextDecoder().decode(c))
		.join("")
		.split("\0")
		.filter((p) => p.length > 0)
		.sort();
}

export function createGitAdapter(): GitAdapter {
	return {
		status,
		log,
		feedLog,
		diff,
		worktreePaths,
		openCatFile: (root: string) => CatFileSession.start(root),
	};
}
