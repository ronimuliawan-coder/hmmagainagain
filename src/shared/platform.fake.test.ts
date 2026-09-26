// Conformance and state tests for the in-memory fake platform (browser dev
// adapter). The focused tests keep its UI-facing Git simulation honest beyond
// the smaller cross-platform contract exercised by runConformance.

import { describe, expect, test } from "bun:test";
import { runConformance } from "./platform.conformance";
import { buildFakeFixture, FAKE_BIG_REPO } from "./platform-fake";

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

	test("branch mutations update only their own fixture", async () => {
		const first = buildFakeFixture();
		const second = buildFakeFixture();

		await first.platform.gitCreateBranch(
			first.fixture.repoRoot,
			"feature/not-current",
			false,
		);
		expect(await first.platform.gitBranches(first.fixture.repoRoot)).toEqual([
			{ name: "main", oid: "f4k3c02", current: true },
		]);

		await first.platform.gitCreateBranch(
			first.fixture.repoRoot,
			"feature/current",
			true,
		);
		expect(await first.platform.gitBranches(first.fixture.repoRoot)).toEqual([
			{ name: "feature/current", oid: "f4k3c02", current: true },
		]);
		await first.platform.gitSwitchBranch(
			first.fixture.repoRoot,
			"fix/switched",
		);
		expect(await first.platform.gitBranches(first.fixture.repoRoot)).toEqual([
			{ name: "fix/switched", oid: "f4k3c02", current: true },
		]);
		expect(await second.platform.gitBranches(second.fixture.repoRoot)).toEqual([
			{ name: "main", oid: "f4k3c02", current: true },
		]);
	});

	test("stage, unstage, and commit keep index and head state coherent", async () => {
		const { platform, fixture } = buildFakeFixture();
		const originalHead = (await platform.gitStatus(fixture.repoRoot)).branch
			.oid;

		await platform.unstagePaths(fixture.repoRoot, [fixture.trackedFile]);
		expect(
			(await platform.gitStatus(fixture.repoRoot)).entries[0],
		).toMatchObject({ indexStatus: ".", worktreeStatus: "M" });
		await platform.applyIndexPatch(fixture.repoRoot, "fixture patch");
		expect(
			(await platform.gitStatus(fixture.repoRoot)).entries[0],
		).toMatchObject({ indexStatus: ".", worktreeStatus: "M" });
		await expect(
			platform.commit(fixture.repoRoot, "nothing staged"),
		).rejects.toThrow("no changes added to commit (fake)");

		await platform.stagePaths(fixture.repoRoot, [fixture.trackedFile]);
		expect(
			(await platform.gitStatus(fixture.repoRoot)).entries[0],
		).toMatchObject({ indexStatus: "M", worktreeStatus: "." });
		await platform.commit(fixture.repoRoot, "test commit");

		const committed = await platform.gitStatus(fixture.repoRoot);
		expect(committed.branch.oid).not.toBe(originalHead);
		expect(committed.entries[0]).toMatchObject({
			indexStatus: ".",
			worktreeStatus: "M",
		});
	});

	test("remote operations stream progress and reject non-repositories", async () => {
		const { platform, fixture } = buildFakeFixture();
		const lines: string[] = [];

		expect(
			await platform.gitRemote(
				fixture.repoRoot,
				"fetch",
				{ remote: "origin" },
				(line) => lines.push(line),
			),
		).toEqual({ ok: true, stderr: "" });
		expect(lines).toEqual(["fake fetch: everything up-to-date\n"]);
		await expect(
			platform.gitRemote(fixture.nonRepoRoot, "fetch", { remote: "origin" }),
		).rejects.toThrow(`not a git repository: ${fixture.nonRepoRoot}`);
	});

	test("unsupported commands return a diagnostic failure", async () => {
		const { platform, fixture } = buildFakeFixture();
		const result = await platform.runGit(fixture.repoRoot, ["unsupported"]);

		expect(result).toEqual({
			code: 1,
			signal: null,
			stderr: "fake: unsupported command",
		});
	});
});

describe("fake platform pickDirectory", () => {
	test("always resolves null (no native dialog in a browser)", async () => {
		const { platform } = buildFakeFixture();
		await expect(platform.pickDirectory()).resolves.toBeNull();
	});
});

describe("fake platform big root (scroll stress, RON-343)", () => {
	test("serves thousands of files and hundreds of commits", async () => {
		const { platform } = buildFakeFixture();
		const info = await platform.readRepo(FAKE_BIG_REPO);
		expect(info.branch).toBe("main");

		const status = await platform.gitStatus(FAKE_BIG_REPO);
		expect(status.entries.length).toBeGreaterThan(1000);
		const sides = new Set(
			status.entries.map((e) => `${e.indexStatus}/${e.worktreeStatus}`),
		);
		expect(sides.has("M/.")).toBe(true);
		expect(sides.has("./M")).toBe(true);
		expect(sides.has("?/?")).toBe(true);

		const paths = await platform.gitWorktreePaths(FAKE_BIG_REPO);
		expect(paths.length).toBe(status.entries.length);
		expect([...paths].sort()).toEqual(paths);
	});

	test("paginates big history across windows", async () => {
		const { platform } = buildFakeFixture();
		const first: string[] = [];
		const head = await platform.gitLog(
			FAKE_BIG_REPO,
			{ limit: 50, skip: 0 },
			(c) => first.push(c.subject),
		);
		expect(head).toEqual({ count: 50 });
		expect(first[0]).toContain("300");

		const tail: string[] = [];
		const rest = await platform.gitLog(
			FAKE_BIG_REPO,
			{ limit: 500, skip: 290 },
			(c) => tail.push(c.subject),
		);
		expect(rest.count).toBeLessThan(500);
		expect(rest.count).toBeGreaterThan(0);
		expect(tail.at(-1)).toContain("1");
	});

	test("writes resolve without state tracking", async () => {
		const { platform } = buildFakeFixture();
		await platform.stagePaths(FAKE_BIG_REPO, ["a.txt"]);
		await platform.unstagePaths(FAKE_BIG_REPO, ["a.txt"]);
		await platform.applyIndexPatch(FAKE_BIG_REPO, "patch");
		await platform.commit(FAKE_BIG_REPO, "big commit");
	});
});
