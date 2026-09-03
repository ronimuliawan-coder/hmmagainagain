// GitAdapter — the typed semantic layer over the git binary. Everything above
// this file speaks domain objects (GitStatus, LogCommit, DiffResult); nothing
// above it knows git's CLI surface. Mutations (U5 staging/commit) live in
// git/staging.ts behind explicit user actions and the serialized write queue.

import type { GitRunOptions } from "../shared/platform";
import {
	type BranchInfo,
	createBranch,
	branches as listBranches,
	switchBranch,
} from "./git/branches";
import { CatFileSession } from "./git/cat-file";
import { type DiffOptions, type DiffResult, diff } from "./git/diff";
import { GitError } from "./git/git-error";
import { feedLog, type LogCommit, type LogOptions, log } from "./git/log";
import * as staging from "./git/staging";
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
	/** Local head branches with the current marker (U6). */
	branches(root: string): Promise<BranchInfo[]>;
	/** Refuses on a dirty worktree before git runs — nothing is auto-discarded. */
	createBranch(
		root: string,
		name: string,
		options?: { switchTo?: boolean; startPoint?: string },
	): Promise<void>;
	switchBranch(root: string, name: string): Promise<void>;
	openCatFile(root: string): CatFileSession;
	/** Index/commit writes (U5). Serialized queue; staging touches only the
	 * index; commits run hooks and never bypass them. */
	stagePaths(root: string, paths: string[]): Promise<void>;
	unstagePaths(root: string, paths: string[]): Promise<void>;
	applyIndexPatch(root: string, patch: string): Promise<void>;
	commit(root: string, message: string): Promise<void>;
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
		branches: listBranches,
		createBranch,
		switchBranch,
		openCatFile: (root: string) => CatFileSession.start(root),
		stagePaths: staging.stagePaths,
		unstagePaths: staging.unstagePaths,
		applyIndexPatch: staging.applyIndexPatch,
		commit: staging.commit,
	};
}
