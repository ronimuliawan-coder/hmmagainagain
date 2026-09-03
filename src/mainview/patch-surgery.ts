// Pure patch surgery for hunk staging (RON-298): splits a unified patch into
// per-file sections and hunks, then reassembles a patch containing only the
// hunks intersecting a new-file line selection. Whole-hunk selection keeps the
// original hunk headers byte-for-byte — counts are never recalculated, which
// is exactly what `git apply --cached` validates.
//
// Paths are taken from the `+++` line (the NEW side). Deleted files have no
// new side (`+++ /dev/null`) and therefore no hunk staging — whole-file
// staging covers them.

export interface SelectionRange {
	/** 1-based first selected line in the NEW file. */
	start: number;
	/** 1-based last selected line in the NEW file (inclusive). */
	end: number;
}

export interface FilePatchSection {
	path: string;
	/** File header: everything before the first hunk (or the whole section
	 * when there are no hunks — e.g. binary markers). */
	header: string;
	hunks: { start: number; end: number; text: string }[];
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

function pathFromSection(section: string): string | null {
	for (const line of section.split("\n")) {
		if (line.startsWith("+++ ")) {
			const target = line.slice(4);
			if (target === "/dev/null") return null;
			return target.startsWith("b/") ? target.slice(2) : target;
		}
	}
	return null;
}

/** Hunk-less sections (binary markers, pure renames) never reach a `+++` line,
 * so the `diff --git` b-side is the fallback path source. Diffs produced by
 * the adapter run with core.quotePath=false, so no quote unescaping is needed
 * here; quotes are merely stripped defensively. */
function pathFromDiffLine(line: string): string | null {
	const rest = line.slice("diff --git ".length);
	const marker = rest.lastIndexOf(" b/");
	if (marker < 0) return null;
	const path = rest.slice(marker + 3);
	if (path.startsWith('"') && path.endsWith('"')) return path.slice(1, -1);
	return path;
}

export function splitFilePatches(patch: string): FilePatchSection[] {
	if (patch.length === 0) return [];
	const sections: FilePatchSection[] = [];
	// Sections start at each "diff --git " line; everything between belongs
	// to the previous file section.
	const lines = patch.split("\n");
	let current: string[] = [];
	let currentPath: string | null = null;
	let currentHeader: string[] = [];
	let currentHunks: { start: number; end: number; text: string }[] = [];
	let currentHunkLines: string[] | null = null;
	let currentHunkStart = 0;
	let currentHunkEnd = 0;
	let headerDone = false;

	const flushHunk = () => {
		if (currentHunkLines === null) return;
		currentHunks.push({
			start: currentHunkStart,
			end: currentHunkEnd,
			text: currentHunkLines.join("\n"),
		});
		currentHunkLines = null;
	};

	const flushSection = () => {
		// The section's last hunk is still pending when the next "diff --git"
		// (or EOF) arrives — flush it BEFORE pushing the section.
		flushHunk();
		if (current.length === 0) return;
		if (currentPath === null) return;
		sections.push({
			path: currentPath,
			header: currentHeader.join("\n"),
			hunks: currentHunks,
		});
	};

	for (const line of lines) {
		if (line.startsWith("diff --git ")) {
			flushSection();
			current = [line];
			// The "diff --git" line is part of the file header — without it the
			// reassembled patch is not valid for `git apply --cached`.
			currentHeader = [line];
			currentPath = pathFromDiffLine(line);
			currentHunks = [];
			currentHunkLines = null;
			headerDone = false;
			continue;
		}
		if (current.length === 0) continue; // preamble before the first header
		current.push(line);
		if (!headerDone) {
			currentHeader.push(line);
			if (line.startsWith("+++ ")) {
				// The +++ line is authoritative for the new path; /dev/null (a
				// deleted file) keeps the diff-line path.
				const fromPlus = pathFromSection(line);
				if (fromPlus !== null) currentPath = fromPlus;
				headerDone = true;
			} else if (line.startsWith("Binary files ")) {
				// Hunk-less section: everything after the header is marker text.
				headerDone = true;
			}
			continue;
		}
		const match = HUNK_HEADER.exec(line);
		if (match) {
			flushHunk();
			const start = Number(match[1]);
			const count = match[2] === undefined ? 1 : Number(match[2]);
			currentHunkStart = start;
			// A 0-count new side (pure deletion) has no new-file lines.
			currentHunkEnd = count === 0 ? start - 1 : start + count - 1;
			currentHunkLines = [line];
			continue;
		}
		if (currentHunkLines !== null) {
			currentHunkLines.push(line);
		}
	}
	flushSection();
	return sections;
}

/** Builds the `git apply --cached` patch for the selected hunks of one file,
 * or null when nothing in the selection intersects a hunk. */
export function buildStagedPatch(
	patch: string,
	path: string,
	selection: SelectionRange,
): string | null {
	const section = splitFilePatches(patch).find((f) => f.path === path);
	if (!section || section.hunks.length === 0) return null;
	const selected = section.hunks.filter(
		(h) => h.start <= selection.end && h.end >= selection.start,
	);
	if (selected.length === 0) return null;
	return `${section.header}\n${selected.map((h) => h.text).join("\n")}\n`;
}
