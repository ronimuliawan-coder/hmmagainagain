// Golden tests for the porcelain v2 -z parser: literal NUL-separated records
// with every edge case we care about — spaces/unicode paths, renames (with
// orig-path record), unmerged, untracked, branch header variants.

import { describe, expect, test } from "bun:test";
import { parseStatusV2 } from "./status-parser";

const NUL = "\0";

describe("parseStatusV2", () => {
	test("clean repo: branch info only", () => {
		const raw =
			[
				"# branch.oid 1234567890abcdef1234567890abcdef12345678",
				"# branch.head main",
			].join(NUL) + NUL;
		const status = parseStatusV2(raw);
		expect(status.branch).toEqual({
			oid: "1234567890abcdef1234567890abcdef12345678",
			head: "main",
		});
		expect(status.entries).toEqual([]);
	});

	test("changed, added, deleted, untracked — including spaces and unicode in paths", () => {
		const raw =
			[
				"# branch.oid abc0000000000000000000000000000000000001",
				"# branch.head feature/ünïcode",
				"1 M. N... 000000 100644 100644 1111111 2222222 src/modified file.txt",
				"1 A. N... 000000 000000 100644 0000000 3333333 staged new file.txt",
				"1 .D N... 100644 100644 0000000 4444444 0000000 deleted file.txt",
				"? untracked dir/nested — ünïcode.txt",
			].join(NUL) + NUL;
		const status = parseStatusV2(raw);
		expect(status.branch.head).toBe("feature/ünïcode");
		expect(status.entries).toEqual([
			{
				path: "src/modified file.txt",
				indexStatus: "M",
				worktreeStatus: ".",
				origin: "changed",
			},
			{
				path: "staged new file.txt",
				indexStatus: "A",
				worktreeStatus: ".",
				origin: "changed",
			},
			{
				path: "deleted file.txt",
				indexStatus: ".",
				worktreeStatus: "D",
				origin: "changed",
			},
			{
				path: "untracked dir/nested — ünïcode.txt",
				indexStatus: "?",
				worktreeStatus: "?",
				origin: "untracked",
			},
		]);
	});

	test("staged+unstaged combination (MM) and rename record with orig path", () => {
		const raw =
			[
				"# branch.oid abc0000000000000000000000000000000000002",
				"# branch.head main",
				"1 MM N... 100644 100644 100644 1111111 2222222 both changed.txt",
				`2 R. N... 100644 100644 100644 3333333 3333333 R100 renamed new.txt${NUL}old name.txt`,
			].join(NUL) + NUL;
		const status = parseStatusV2(raw);
		expect(status.entries).toEqual([
			{
				path: "both changed.txt",
				indexStatus: "M",
				worktreeStatus: "M",
				origin: "changed",
			},
			{
				path: "renamed new.txt",
				indexStatus: "R",
				worktreeStatus: ".",
				renamedFrom: "old name.txt",
				origin: "changed",
			},
		]);
	});

	test("unmerged record and upstream ahead/behind", () => {
		const raw =
			[
				"# branch.oid abc0000000000000000000000000000000000003",
				"# branch.head main",
				"# branch.upstream origin/main",
				"# branch.ab +3 -7",
				"u U. N... 000000 000000 000000 1111111 2222222 3333333 conflicted file.txt",
			].join(NUL) + NUL;
		const status = parseStatusV2(raw);
		expect(status.branch.upstream).toBe("origin/main");
		expect(status.branch.ahead).toBe(3);
		expect(status.branch.behind).toBe(7);
		expect(status.entries).toEqual([
			{
				path: "conflicted file.txt",
				indexStatus: "U",
				worktreeStatus: ".",
				origin: "unmerged",
			},
		]);
	});

	test("detached head and empty input tolerance", () => {
		expect(parseStatusV2("").entries).toEqual([]);
		const detached =
			[
				"# branch.oid abc0000000000000000000000000000000000004",
				"# branch.head (detached)",
			].join(NUL) + NUL;
		expect(parseStatusV2(detached).branch.head).toBe("(detached)");
	});
});
