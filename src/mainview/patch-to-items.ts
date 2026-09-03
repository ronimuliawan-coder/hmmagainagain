// Pure mapping: unified patch text (U2's gitDiff) → CodeView diff items, one
// per changed file, in patch order. Renames key the item by the NEW path —
// the tree/status surfaces address files by what exists on disk now.

import { type CodeViewItem, parsePatchFiles } from "@pierre/diffs";

export interface PatchToItemsResult {
	items: CodeViewItem[];
	paths: string[];
}

export function patchToItems(patch: string): PatchToItemsResult {
	if (patch.length === 0) return { items: [], paths: [] };
	const items: CodeViewItem[] = [];
	const paths: string[] = [];
	// parsePatchFiles supports multi-commit patches; a git diff carries one.
	// Hunk-less entries (binary markers) are kept only with an identifiable
	// path so the file list never shows a bogus row.
	for (const parsed of parsePatchFiles(patch)) {
		for (const fileDiff of parsed.files) {
			if (!fileDiff.name) continue;
			items.push({
				id: `diff:${fileDiff.name}`,
				type: "diff",
				fileDiff,
				version: 0,
			});
			paths.push(fileDiff.name);
		}
	}
	return { items, paths };
}
