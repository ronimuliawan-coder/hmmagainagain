// Parser for `git status --porcelain=v2 --branch -z`.
//
// Why -z: paths are NUL-terminated and never quoted, so spaces, unicode, and
// even newlines in filenames survive. Records are separated by NUL; rename
// records carry the ORIGINAL path in a second NUL-separated field.
//
// Record grammar (NUL-terminated each):
//   # branch.oid <sha> | # branch.head <name> | # branch.upstream <up> | # branch.ab +A -B
//   1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
//   2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path> NUL <origPath>
//   u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
//   ? <path>
//   ! <path>

export interface StatusEntry {
	path: string;
	/** Index (staged) status: "." means unmodified in the index. */
	indexStatus: string;
	/** Worktree status: "." means unmodified in the worktree. */
	worktreeStatus: string;
	/** Present for rename/copy records: where the file came from. */
	renamedFrom?: string;
	origin: "changed" | "untracked" | "unmerged" | "ignored";
}

export interface GitBranchInfo {
	oid: string;
	head: string;
	upstream?: string;
	ahead?: number;
	behind?: number;
}

export interface GitStatus {
	branch: GitBranchInfo;
	entries: StatusEntry[];
}

export function parseStatusV2(raw: string): GitStatus {
	const branch: GitBranchInfo = { oid: "", head: "" };
	const entries: StatusEntry[] = [];

	// Trailing NUL(s) produce empty tail records — filter them.
	const records = raw.split("\0").filter((r) => r.length > 0);

	for (let i = 0; i < records.length; i++) {
		const record = records[i];

		if (record.startsWith("# branch.oid ")) {
			branch.oid = record.slice("# branch.oid ".length);
			continue;
		}
		if (record.startsWith("# branch.head ")) {
			branch.head = record.slice("# branch.head ".length);
			continue;
		}
		if (record.startsWith("# branch.upstream ")) {
			branch.upstream = record.slice("# branch.upstream ".length);
			continue;
		}
		if (record.startsWith("# branch.ab ")) {
			// "+1 -2" — ahead/behind relative to upstream.
			const m = /\+(\d+) -(\d+)/.exec(record);
			if (m) {
				branch.ahead = Number(m[1]);
				branch.behind = Number(m[2]);
			}
			continue;
		}
		if (record.startsWith("#")) continue; // unknown future header — tolerate

		if (record.startsWith("? ")) {
			entries.push({
				path: record.slice(2),
				indexStatus: "?",
				worktreeStatus: "?",
				origin: "untracked",
			});
			continue;
		}
		if (record.startsWith("! ")) {
			entries.push({
				path: record.slice(2),
				indexStatus: "!",
				worktreeStatus: "!",
				origin: "ignored",
			});
			continue;
		}

		if (record.startsWith("1 ")) {
			// 1 XY sub mH mI mW hH hI path   → 8 spaces before the path.
			entries.push(changedEntry(record, spaceIndexAfter(record, 8), "changed"));
			continue;
		}

		if (record.startsWith("2 ")) {
			// 2 XY sub mH mI mW hH hI X<score> path NUL origPath
			const pathStart = spaceIndexAfter(record, 9);
			const entry = changedEntry(record, pathStart, "changed");
			// The original path is the next NUL-separated record.
			const orig = records[i + 1];
			if (
				orig !== undefined &&
				!orig.startsWith("#") &&
				!/^[12u] /.test(orig) &&
				!orig.startsWith("? ") &&
				!orig.startsWith("! ")
			) {
				entry.renamedFrom = orig;
				i += 1; // consume the origPath record
			}
			entries.push(entry);
			continue;
		}

		if (record.startsWith("u ")) {
			// u XY sub m1 m2 m3 mW h1 h2 h3 path → 9 spaces before the path.
			entries.push(
				changedEntry(record, spaceIndexAfter(record, 9), "unmerged"),
			);
		}

		// Unknown record type — tolerate (forward compatibility).
	}

	return { branch, entries };
}

function changedEntry(
	record: string,
	pathStart: number,
	origin: StatusEntry["origin"],
): StatusEntry {
	const head = record.slice(0, pathStart);
	const path = record.slice(pathStart);
	const tokens = head.split(" ");
	const xy = tokens[1] ?? "..";
	return {
		path,
		indexStatus: xy[0] ?? ".",
		worktreeStatus: xy[1] ?? ".",
		origin,
	};
}

/** Index of the space that follows the Nth space-separated field. */
function spaceIndexAfter(record: string, fieldCount: number): number {
	let seen = 0;
	for (let i = 0; i < record.length; i++) {
		if (record[i] === " ") {
			seen++;
			if (seen === fieldCount) return i + 1;
		}
	}
	return record.length;
}
