// Conformance and state tests for the in-memory fake platform (browser dev
// adapter). The focused tests keep its UI-facing Git simulation honest beyond
// the smaller cross-platform contract exercised by runConformance.

import { describe, expect, test } from "bun:test";
import { runConformance } from "./platform.conformance";
import { buildFakeFixture } from "./platform-fake";

const { platform, fixture } = buildFakeFixture();
runConformance(() => platform, fixture);

describe("fake platform Git simulation", () => {
	test("exposes a consistent repository snapshot", async () => {
		const { platform, fixture } = buildFakeFixture();
		const status = await platform.gitStatus(fixture.repoRoot);
		const diff = await platform.gitDiff(fixture.repoRoot);

		expect(status.branch).toEqual({
			oid: "f4k3h34d00000000000000000000000000000001",
			head: "main",
		});
		expect(status.entries).toContainEqual({
			path: fixture.trackedFile,
			indexStatus: "M",
			worktreeStatus: ".",
			origin: "changed",
		});
		expect(diff.files).toEqual([
			{
				path: fixture.trackedFile,
				additions: 1,
				deletions: 0,
				binary: false,
			},
		]);
		expect(diff.patch).toContain("+staged in the fake fixture");
		expect(await platform.gitWorktreePaths(fixture.repoRoot)).toEqual([
			"hello.txt",
			"src/nested.txt",
			"untracked file.txt",
		]);
	});

	test("paginates streamed history and reports the delivered count", async () => {
		const { platform, fixture } = buildFakeFixture();
		const subjects: string[] = [];
		const result = await platform.gitLog(
			fixture.repoRoot,
			{ skip: 1, limit: 1 },
			(commit) => subjects.push(commit.subject),
		);

		expect(subjects).toEqual(["fake: first commit"]);
		expect(result).toEqual({ count: 1 });
	});
});
