// Diff read path: per-file numstat (with binary detection) plus the full
// colorless patch text the diff view (U4, @pierre/diffs) renders.
//
// Range semantics:
//   { staged: true }                 → git diff --cached          (index vs HEAD)
//   { from: "HEAD" }                 → git diff HEAD              (HEAD vs worktree)
//   { from: "a", to: "b" }           → git diff a b               (commit vs commit)
//   {}                               → git diff                   (index vs worktree)

import { spawnGit } from "../git-spawn";

export interface DiffFile {
	path: string;
	renamedFrom?: string;
	additions: number;
	deletions: number;
	binary: boolean;
}

export interface DiffResult {
	files: DiffFile[];
	patch: string;
}

export interface DiffOptions {
	staged?: boolean;
	from?: string;
	to?: string;
	pathspecs?: string[];
}

function rangeArgs(options: DiffOptions): string[] {
	if (options.staged) return ["--cached"];
	if (options.from && options.to) return [options.from, options.to];
	if (options.from) return [options.from];
	return [];
}

function pathArgs(options: DiffOptions): string[] {
	return options.pathspecs?.length ? ["--", ...options.pathspecs] : [];
}

async function collectText(root: string, args: string[]): Promise<string> {
	const chunks: Uint8Array[] = [];
	const result = await spawnGit(root, args, {
		onStdout: (c) => chunks.push(c),
	});
	if (result.code !== 0) {
		throw new Error(`git ${args[0]} failed: ${result.stderr}`);
	}
	return chunks.map((c) => new TextDecoder().decode(c)).join("");
}

function parseNumstat(raw: string): DiffFile[] {
	const files: DiffFile[] = [];
	// -z: each record NUL-terminated; rename records carry the orig path as a
	// second NUL-separated field. Tab-separated columns inside the record.
	// Verified empirically (git 2.55): a rename/copy record is
	//   "add\tdel\t" NUL  origPath NUL  newPath NUL
	// — the destination path comes LAST. Regular records are
	//   "add\tdel\tpath" NUL with the path non-empty.
	const records = raw.split("\0");
	let i = 0;
	while (i < records.length) {
		const record = records[i];
		i += 1;
		if (record.length === 0) continue;
		const tabs = record.split("\t");
		if (tabs.length >= 3 && tabs[2] === "") {
			const orig = records[i];
			const newPath = records[i + 1];
			i += 2;
			if (orig === undefined || newPath === undefined) continue;
			files.push({
				path: newPath,
				renamedFrom: orig,
				additions: tabs[0] === "-" ? -1 : Number(tabs[0]),
				deletions: tabs[1] === "-" ? -1 : Number(tabs[1]),
				binary: tabs[0] === "-",
			});
			continue;
		}
		if (tabs.length < 3 || tabs[2].length === 0) continue;
		files.push({
			path: tabs[2],
			additions: tabs[0] === "-" ? -1 : Number(tabs[0]),
			deletions: tabs[1] === "-" ? -1 : Number(tabs[1]),
			binary: tabs[0] === "-",
		});
	}
	return files;
}

export async function diff(
	root: string,
	options: DiffOptions = {},
): Promise<DiffResult> {
	const numstatRaw = await collectText(root, [
		"diff",
		"--numstat",
		"-z",
		"--no-color",
		...rangeArgs(options),
		...pathArgs(options),
	]);
	const patch = await collectText(root, [
		"diff",
		"--no-color",
		...rangeArgs(options),
		...pathArgs(options),
	]);
	return { files: parseNumstat(numstatRaw), patch };
}
