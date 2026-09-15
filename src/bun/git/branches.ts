// Branch read/write paths. Switching branches MUTATES the worktree — the
// dirty-worktree refusal below is the safety centerpiece of U6: we refuse
// before git runs, so no flow in the app can discard or stash user changes
// implicitly. Untracked-file conflicts (target branch has the same path) are
// git's own error, surfaced verbatim.

import { assertSafeRef, decodeChunks, spawnGit } from "../git-spawn";
import { GitError } from "./git-error";
import { parseStatusV2 } from "./status-parser";
import { enqueueWrite } from "./write-queue";

export interface BranchInfo {
	name: string;
	oid: string;
	current: boolean;
	upstream?: string;
}

async function runWrite(root: string, args: string[]): Promise<void> {
	const result = await spawnGit(root, args);
	if (result.code !== 0) {
		throw new GitError(`git ${args[0]} failed`, result.stderr, result.code);
	}
}

/** Refuses when the worktree or index holds ANY change — nothing is stashed,
 * nothing is discarded. The user cleans up (or commits) first. */
export async function assertCleanWorktree(root: string): Promise<void> {
	const chunks: Uint8Array[] = [];
	const result = await spawnGit(
		root,
		["status", "--porcelain=v2", "-z", "-uall"],
		{
			onStdout: (c) => chunks.push(c),
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
	const status = parseStatusV2(decodeChunks(chunks));
	if (status.entries.length > 0) {
		throw new GitError(
			`refusing to switch branches: the worktree has ${status.entries.length} change(s) (commit them first — nothing is auto-discarded)`,
			"",
			null,
		);
	}
}

export async function branches(root: string): Promise<BranchInfo[]> {
	// NUL-separated fields, newline-terminated records: refnames cannot contain
	// newlines, and NUL fields avoid the same quoting problems as paths.
	const chunks: Uint8Array[] = [];
	const result = await spawnGit(
		root,
		[
			"for-each-ref",
			"--format=%(objectname)%00%(refname:short)%00%(HEAD)%00%(upstream:short)",
			"refs/heads",
		],
		{ onStdout: (c) => chunks.push(c) },
	);
	if (result.code !== 0) {
		throw new GitError(
			`git for-each-ref failed in ${root}`,
			result.stderr,
			result.code,
		);
	}
	const raw = decodeChunks(chunks);
	const out: BranchInfo[] = [];
	for (const line of raw.split("\n")) {
		if (line.length === 0) continue;
		const [oid, name, head, upstream] = line.split("\0");
		if (!name) continue;
		out.push({
			oid: oid ?? "",
			name,
			current: head === "*",
			upstream: upstream && upstream.length > 0 ? upstream : undefined,
		});
	}
	return out;
}

export async function createBranch(
	root: string,
	name: string,
	options: { switchTo?: boolean; startPoint?: string } = {},
): Promise<void> {
	if (name.trim().length === 0) {
		throw new GitError("branch name is empty", "", null);
	}
	// Refuse leading-dash names/points before argv construction (CWE-88):
	// they sit in flag-parsable positions (`switch -c <name>`, refspecs).
	assertSafeRef(name, "branch name");
	if (options.startPoint !== undefined) {
		assertSafeRef(options.startPoint, "start point");
	}
	await enqueueWrite(async () => {
		if (options.switchTo) {
			await assertCleanWorktree(root);
			const startPoint = options.startPoint ? [options.startPoint] : [];
			await runWrite(root, ["switch", "-c", name, ...startPoint]);
			return;
		}
		const startPoint = options.startPoint ? [options.startPoint] : [];
		await runWrite(root, ["branch", name, ...startPoint]);
	});
}

export async function switchBranch(root: string, name: string): Promise<void> {
	assertSafeRef(name, "branch name");
	await enqueueWrite(async () => {
		await assertCleanWorktree(root);
		await runWrite(root, ["switch", name]);
	});
}
