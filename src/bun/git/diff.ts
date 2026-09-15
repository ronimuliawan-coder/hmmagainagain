// Diff read path: a SINGLE git traversal per request (post-v1 Unit A).
// File statistics derive from the patch text itself; the old --numstat
// second traversal was removed after differential proof (see diff.test.ts).
//
// Range semantics:
//   { staged: true }                 → git diff --cached          (index vs HEAD)
//   { from: "HEAD" }                 → git diff HEAD              (HEAD vs worktree)
//   { from: "a", to: "b" }           → git diff a b               (commit vs commit)
//   {}                               → git diff                   (index vs worktree)

import { decodeChunks, spawnGit } from "../git-spawn";

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
	return decodeChunks(chunks);
}

/** Undo git's C-style path quoting (core.quotePath): `"a/\303\251x"`
 * back to raw UTF-8. Unquoted paths pass through untouched. */
export function unquotePath(path: string): string {
	if (path.length < 2 || !path.startsWith('"') || !path.endsWith('"')) {
		return path;
	}
	const inner = path.slice(1, -1);
	const bytes: number[] = [];
	let out = "";
	const flush = (): void => {
		if (bytes.length > 0) {
			out += new TextDecoder().decode(new Uint8Array(bytes));
			bytes.length = 0;
		}
	};
	for (let i = 0; i < inner.length; i++) {
		const c = inner[i];
		if (c !== "\\" || i + 1 >= inner.length) {
			for (const b of new TextEncoder().encode(c)) bytes.push(b);
			continue;
		}
		const next = inner[i + 1];
		if (next === "n") {
			flush();
			out += "\n";
			i += 1;
		} else if (next === "t") {
			flush();
			out += "\t";
			i += 1;
		} else if (next === "\\" || next === '"') {
			for (const b of new TextEncoder().encode(next)) bytes.push(b);
			i += 1;
		} else if (/[0-7]/.test(next)) {
			const octal = inner.slice(i + 1, i + 4);
			if (/^[0-7]{3}$/.test(octal)) {
				bytes.push(parseInt(octal, 8));
				i += 3;
			} else {
				for (const b of new TextEncoder().encode(c)) bytes.push(b);
			}
		} else {
			for (const b of new TextEncoder().encode(c)) bytes.push(b);
		}
	}
	flush();
	return out;
}

interface PatchFile extends DiffFile {
	inHunk: boolean;
	/** Candidate paths from ---/+++ lines (space-safe; see below). */
	minusPath?: string;
	plusPath?: string;
}

/** Derive per-file statistics from unified patch text (single traversal).
 * Covers renames, binary, mode-only, new/deleted files, and quoted paths;
 * differential-proof against `git diff --numstat` lives in diff.test.ts. */
export function parsePatchStats(patch: string): DiffFile[] {
	const files: DiffFile[] = [];
	let current: PatchFile | null = null;
	const flush = (): void => {
		if (current) {
			// Prefer ---/+++ paths: b-side tokenizing of `diff --git` breaks
			// on spaces, while these lines carry one path each. Deleted files
			// have no +++ side (use ---); rename target still wins below.
			if (current.plusPath !== undefined) current.path = current.plusPath;
			else if (current.minusPath !== undefined)
				current.path = current.minusPath;
			const {
				inHunk: _dropped,
				minusPath: _m,
				plusPath: _p,
				...file
			} = current;
			files.push(file);
			current = null;
		}
	};
	// One token per side: `"quoted path"` or a bare non-space run. Bare
	// paths WITH spaces defeat this split — the ---/+++ lines repair them.
	const tokenize = (rest: string): string[] =>
		rest.match(/"(?:[^"\\]|\\.)*"|\S+/g) ?? [];
	for (const rawLine of patch.split("\n")) {
		if (rawLine.startsWith("diff --git ")) {
			flush();
			const tokens = tokenize(rawLine.slice("diff --git ".length));
			const bRaw = tokens[1] ?? tokens[0] ?? "";
			const bPath = unquotePath(bRaw).replace(/^[ab]\//, "");
			current = {
				path: bPath,
				additions: 0,
				deletions: 0,
				binary: false,
				inHunk: false,
			};
			continue;
		}
		if (!current) continue;
		if (rawLine.startsWith("rename from ")) {
			current.renamedFrom = unquotePath(
				rawLine.slice("rename from ".length).trim(),
			);
			continue;
		}
		if (rawLine.startsWith("rename to ")) {
			const toPath = unquotePath(rawLine.slice("rename to ".length).trim());
			if (toPath.length > 0) current.path = toPath;
			continue;
		}
		if (rawLine.startsWith("Binary files ")) {
			current.binary = true;
			current.additions = -1;
			current.deletions = -1;
			continue;
		}
		if (rawLine.startsWith("@@ ")) {
			current.inHunk = true;
			continue;
		}
		if (rawLine.startsWith("--- ") && !rawLine.startsWith("--- /dev/null")) {
			current.minusPath = unquotePath(
				rawLine.slice("--- ".length).trim(),
			).replace(/^[ab]\//, "");
			continue;
		}
		if (rawLine.startsWith("+++ ") && !rawLine.startsWith("+++ /dev/null")) {
			current.plusPath = unquotePath(
				rawLine.slice("+++ ".length).trim(),
			).replace(/^[ab]\//, "");
			continue;
		}
		if (!current.inHunk) continue;
		if (rawLine.startsWith("+") && !rawLine.startsWith("+++")) {
			current.additions += 1;
		} else if (rawLine.startsWith("-") && !rawLine.startsWith("---")) {
			current.deletions += 1;
		}
	}
	flush();
	return files;
}

export async function diff(
	root: string,
	options: DiffOptions = {},
): Promise<DiffResult> {
	const patch = await collectText(root, [
		"diff",
		"--no-color",
		...rangeArgs(options),
		...pathArgs(options),
	]);
	return { files: parsePatchStats(patch), patch };
}
