// Index/commit write paths — the ONLY sanctioned repository mutations
// (RON-298). Every op serializes through one queue so the main process stays
// the single writer and our own commands never contend for index.lock.
//
// Safety (prime invariant 1): staging/unstaging touch only the index
// (recoverable via `git reset`); commits only add objects and move a ref;
// hook failures abort with the hook's stderr carried verbatim — the app never
// bypasses hooks. Failures throw GitError whose stderr the UI displays as-is.

import { spawnGit } from "../git-spawn";
import { GitError } from "./git-error";
import { enqueueWrite } from "./write-queue";

async function runWrite(
	root: string,
	args: string[],
	stdin?: string,
): Promise<void> {
	const stdoutChunks: Uint8Array[] = [];
	const result = await spawnGit(root, args, {
		stdin,
		onStdout: (c) => stdoutChunks.push(c),
	});
	if (result.code !== 0) {
		// stderr verbatim (hook output, "patch does not apply", ...) — the UI
		// displays it as-is. Some git failures print on stdout instead ("no
		// changes added to commit"), so stdout rides along for diagnosability.
		const stdout = stdoutChunks
			.map((c) => new TextDecoder().decode(c))
			.join("");
		throw new GitError(
			`git ${args[0]} failed`,
			result.stderr,
			result.code,
			stdout,
		);
	}
}

export async function stagePaths(root: string, paths: string[]): Promise<void> {
	if (paths.length === 0) return;
	await enqueueWrite(() => runWrite(root, ["add", "-A", "--", ...paths]));
}

export async function unstagePaths(
	root: string,
	paths: string[],
): Promise<void> {
	if (paths.length === 0) return;
	await enqueueWrite(() =>
		runWrite(root, ["restore", "--staged", "--", ...paths]),
	);
}

export async function applyIndexPatch(
	root: string,
	patch: string,
): Promise<void> {
	if (patch.trim().length === 0) return;
	await enqueueWrite(() =>
		// The patch goes in via stdin; `-` reads it. A patch whose context no
		// longer matches the index fails here with git's own message.
		runWrite(root, ["apply", "--cached", "--whitespace=nowarn", "-"], patch),
	);
}

export async function commit(root: string, message: string): Promise<void> {
	await enqueueWrite(() => runWrite(root, ["commit", "-m", message]));
}
