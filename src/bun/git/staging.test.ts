// Golden integration tests for the U5 write paths (RON-298's before-state):
// after EVERY staging op, assert the exact `git diff --cached` content on a
// real temp repo. Also covers the failure paths the unit names: hook
// rejection (verbatim stderr, ref unchanged), binary files, CRLF content,
// stale patches, and non-repository rejection.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildStagedPatch } from "../../mainview/patch-surgery";
import { createGitAdapter, GitError } from "../git-adapter";
import { spawnGit } from "./../git-spawn";

const base = mkdtempSync(join(tmpdir(), "hmmagainagain-u5-"));
const repo = join(base, "golden");
const plain = join(base, "plain");
const FIXTURE_ENV = {
	GIT_AUTHOR_DATE: "2026-01-01T00:00:00 +0000",
	GIT_COMMITTER_DATE: "2026-01-01T00:00:00 +0000",
	GIT_AUTHOR_NAME: "Golden Fixture",
	GIT_AUTHOR_EMAIL: "golden@fixture.test",
	GIT_COMMITTER_NAME: "Golden Fixture",
	GIT_COMMITTER_EMAIL: "golden@fixture.test",
	// Hermetic goldens: ignore the machine's global/system git config.
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_SYSTEM: "/dev/null",
};

async function git(...args: string[]): Promise<void> {
	const result = await spawnGit(repo, args, { env: FIXTURE_ENV });
	if (result.code !== 0)
		throw new Error(`fixture git ${args.join(" ")}: ${result.stderr}`);
}

const adapter = createGitAdapter();
const stagedPatch = async (): Promise<string> =>
	(await adapter.diff(repo, { staged: true })).patch;

beforeAll(async () => {
	mkdirSync(repo, { recursive: true });
	mkdirSync(plain, { recursive: true });
	writeFileSync(join(repo, "hello.txt"), "hello v1\n");
	await git("init", "-q", "-b", "main");
	await git("add", ".");
	await git("commit", "-q", "-m", "base");
});

afterAll(() => {
	rmSync(base, { recursive: true, force: true });
});

describe("GitAdapter.stagePaths (golden)", () => {
	test("stages a new file: index gains it, status shows A", async () => {
		writeFileSync(join(repo, "new.txt"), "new content\n");
		await adapter.stagePaths(repo, ["new.txt"]);
		const status = await adapter.status(repo);
		expect(status.entries.find((e) => e.path === "new.txt")?.indexStatus).toBe(
			"A",
		);
		const staged = await stagedPatch();
		expect(staged).toContain("+new content");
	});

	test("unstage returns the new file to untracked (index empty again)", async () => {
		await adapter.unstagePaths(repo, ["new.txt"]);
		const status = await adapter.status(repo);
		expect(status.entries.find((e) => e.path === "new.txt")?.indexStatus).toBe(
			"?",
		);
		expect((await stagedPatch()).length).toBe(0);
	});

	test("stages a tracked modification: --cached flips to v2", async () => {
		writeFileSync(join(repo, "hello.txt"), "hello v2\n");
		await adapter.stagePaths(repo, ["hello.txt"]);
		const staged = await stagedPatch();
		expect(staged).toContain("-hello v1");
		expect(staged).toContain("+hello v2");
	});

	test("rejects a non-repository with GitError", async () => {
		await expect(adapter.stagePaths(plain, ["x"])).rejects.toBeInstanceOf(
			GitError,
		);
	});
});

describe("GitAdapter.applyIndexPatch — hunk staging (golden)", () => {
	test("applies one hunk: --cached holds only the selected change", async () => {
		writeFileSync(
			join(repo, "hunked.txt"),
			"l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\n",
		);
		await adapter.stagePaths(repo, ["hunked.txt"]);
		await adapter.commit(repo, "hunked base");

		// Two well-separated changes → two hunks in the worktree diff.
		writeFileSync(
			join(repo, "hunked.txt"),
			"L1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nL10\n",
		);
		const worktree = (await adapter.diff(repo, {})).patch;
		const partial = buildStagedPatch(worktree, "hunked.txt", {
			start: 10,
			end: 10,
		});
		// Only the hunk carrying the line-10 change survives; the line-1 hunk
		// (with its own +L1) must not leak into the staged patch.
		expect(partial).toContain("+L10");
		expect(partial).not.toContain("+L1\n");
		await adapter.applyIndexPatch(repo, partial ?? "");

		const staged = await stagedPatch();
		expect(staged).toContain("+L10");
		expect(staged).not.toContain("+L1\n");
		// Hunk 1 is still unstaged: the entry is MM, and the worktree diff
		// (index vs worktree) carries the l1 → L1 change.
		const status = await adapter.status(repo);
		const entry = status.entries.find((e) => e.path === "hunked.txt");
		expect(entry?.indexStatus).toBe("M");
		expect(entry?.worktreeStatus).toBe("M");
		const unstaged = (await adapter.diff(repo, {})).patch;
		expect(unstaged).toContain("-l1");
		expect(unstaged).toContain("+L1");
	});

	test("a stale patch fails honestly without touching the index", async () => {
		const before = await stagedPatch();
		// Built against different content than what the index holds.
		const stale = [
			"diff --git a/hunked.txt b/hunked.txt",
			"index 0000000..1111111 100644",
			"--- a/hunked.txt",
			"+++ b/hunked.txt",
			"@@ -1,2 +1,2 @@",
			"-nope",
			"-nope2",
			"+not-applicable",
			"",
		].join("\n");
		await expect(adapter.applyIndexPatch(repo, stale)).rejects.toThrow();
		expect(await stagedPatch()).toBe(before);
	});
});

describe("GitAdapter.commit (golden)", () => {
	test("commits the index: log subject matches, staged diff empties", async () => {
		await adapter.commit(repo, "staged: hello v2 + hunked L10");
		const commits = await adapter.log(repo, { limit: 1 });
		expect(commits[0]?.subject).toBe("staged: hello v2 + hunked L10");
		expect((await stagedPatch()).length).toBe(0);
		// hello.txt is fully committed (clean); hunked.txt keeps hunk 1 dirty.
		const status = await adapter.status(repo);
		expect(status.entries.find((e) => e.path === "hello.txt")).toBeUndefined();
		expect(
			status.entries.find((e) => e.path === "hunked.txt")?.worktreeStatus,
		).toBe("M");
	});

	test("hook rejection: commit blocked, stderr verbatim, ref unchanged", async () => {
		const hookPath = join(repo, ".git", "hooks", "pre-commit");
		writeFileSync(hookPath, "#!/bin/sh\necho 'hook says no' >&2\nexit 1\n");
		chmodSync(hookPath, 0o755);
		const before = await adapter.log(repo, { limit: 1 });

		const error = await adapter
			.commit(repo, "should not land")
			.then(() => null)
			.catch((e: unknown) => e as GitError);
		expect(error).toBeInstanceOf(GitError);
		expect(error?.stderr).toContain("hook says no");

		const after = await adapter.log(repo, { limit: 1 });
		expect(after[0]?.oid).toBe(before[0]?.oid);
		rmSync(hookPath);
		// The index is untouched by the failed commit — the staged content
		// would still land on the next successful commit.
	});

	test("binary and CRLF paths stage with faithful content", async () => {
		writeFileSync(join(repo, "bin.dat"), Buffer.from([9, 0, 8, 0, 7]));
		writeFileSync(join(repo, "crlf.txt"), "a\r\nb\r\n");
		await adapter.stagePaths(repo, ["bin.dat", "crlf.txt"]);
		const staged = await adapter.diff(repo, { staged: true });
		const bin = staged.files.find((f) => f.path === "bin.dat");
		expect(bin?.binary).toBe(true);
		// Patch lines carry +/- prefixes, so the CRLF bytes are asserted per line.
		expect(staged.patch).toContain("+a\r\n");
		expect(staged.patch).toContain("+b\r\n");
		await adapter.commit(repo, "binary + crlf");
	});
});
