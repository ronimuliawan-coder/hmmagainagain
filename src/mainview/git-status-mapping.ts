// Pure mapping from GitAdapter status entries to @pierre/trees decoration
// entries. Trees only decorate paths that exist in the worktree, so deleted
// files (which have no worktree path) surface in the status list instead.

import type { GitStatusEntry } from "@pierre/trees";
import type { StatusEntry } from "../bun/git/status-parser";

const LETTER_TO_STATUS: Record<string, GitStatusEntry["status"]> = {
	M: "modified",
	A: "added",
	D: "deleted",
	R: "renamed",
	C: "renamed",
	U: "modified", // trees has no unmerged value; conflicts show as modified in the tree
	"?": "untracked",
	"!": "ignored",
};

export function statusToTreeEntry(entry: StatusEntry): GitStatusEntry | null {
	// Prefer the worktree status (what the user sees on disk), then the index.
	const letter =
		entry.worktreeStatus !== "." ? entry.worktreeStatus : entry.indexStatus;
	if (letter === "." || letter === "!") return null;
	const status = LETTER_TO_STATUS[letter];
	if (!status) return null;
	return { path: entry.path, status };
}

export function statusToTreeEntries(
	entries: readonly StatusEntry[],
): GitStatusEntry[] {
	const result: GitStatusEntry[] = [];
	for (const entry of entries) {
		const mapped = statusToTreeEntry(entry);
		if (mapped) result.push(mapped);
	}
	return result;
}
