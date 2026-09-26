// Mapping tests run in bun (pure functions, no DOM).

import { describe, expect, test } from "bun:test";
import type { StatusEntry } from "../shared/git/status-parser";
import { statusToTreeEntries } from "./git-status-mapping";

const entry = (over: Partial<StatusEntry>): StatusEntry => ({
	path: "p",
	indexStatus: ".",
	worktreeStatus: ".",
	origin: "changed",
	...over,
});

describe("statusToTreeEntries", () => {
	test("maps worktree status preferentially and skips clean paths", () => {
		const result = statusToTreeEntries([
			entry({ path: "a.txt", indexStatus: "M", worktreeStatus: "M" }),
			entry({ path: "b.txt", indexStatus: "A", worktreeStatus: "." }),
			entry({ path: "c.txt", indexStatus: ".", worktreeStatus: "M" }),
			entry({ path: "d.txt", indexStatus: ".", worktreeStatus: "." }),
		]);
		expect(result).toEqual([
			{ path: "a.txt", status: "modified" },
			{ path: "b.txt", status: "added" },
			{ path: "c.txt", status: "modified" },
		]);
	});

	test("untracked, deleted, renamed, and unmerged letters map correctly", () => {
		const result = statusToTreeEntries([
			entry({
				path: "u.txt",
				indexStatus: "?",
				worktreeStatus: "?",
				origin: "untracked",
			}),
			entry({ path: "d.txt", indexStatus: ".", worktreeStatus: "D" }),
			entry({ path: "r.txt", indexStatus: "R", worktreeStatus: "." }),
			entry({
				path: "c.txt",
				indexStatus: "U",
				worktreeStatus: ".",
				origin: "unmerged",
			}),
		]);
		expect(result).toEqual([
			{ path: "u.txt", status: "untracked" },
			{ path: "d.txt", status: "deleted" },
			{ path: "r.txt", status: "renamed" },
			{ path: "c.txt", status: "modified" },
		]);
	});
});
