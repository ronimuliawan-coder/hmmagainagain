// Golden integration tests: a deterministic repository (fixed dates, fixed
// authors) exercises the whole GitAdapter read surface. The expected status
// entries, log records, and diff numbers are asserted exactly — this is the
// guard against porcelain parsing drift. Edge cases covered: staged rename
// with orig path, MM combination, unstaged delete, binary file, CRLF content,
// spaces + unicode in paths, untracked separation.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LogRecordParser } from "./git/log";
import { createGitAdapter, GitError } from "./git-adapter";
import { spawnGit } from "./git-spawn";

const base = mkdtempSync(join(tmpdir(), "hmmagainagain-u2-"));
const repo = join(base, "golden");
const FIXTURE_ENV = {
	GIT_AUTHOR_DATE: "2026-01-01T00:00:00 +0000",
	GIT_COMMITTER_DATE: "2026-01-01T00:00:00 +0000",
	GIT_AUTHOR_NAME: "Golden Fixture",
	GIT_AUTHOR_EMAIL: "golden@fixture.test",
	GIT_COMMITTER_NAME: "Golden Fixture",
	GIT_COMMITTER_EMAIL: "golden@fixture.test",
	// Hermetic goldens: ignore the machine's global/system git config
	// (autocrlf, hooksPath, renames…), which would change asserted output.
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_SYSTEM: "/dev/null",
};

async function git(...args: string[]): Promise<void> {
	const result = await spawnGit(repo, args, { env: FIXTURE_ENV });
	if (result.code !== 0)
		throw new Error(`fixture git ${args.join(" ")}: ${result.stderr}`);
}

beforeAll(async () => {
	mkdirSync(join(repo, "src"), { recursive: true });
	writeFileSync(join(repo, "src", "app.txt"), "app v1\n");
	writeFileSync(join(repo, "readme.md"), "# readme\r\nline2\r\n");
	writeFileSync(join(repo, "old name.txt"), "rename me\n");
	writeFileSync(join(repo, "ünïcode näme.txt"), "unicode\n");
	writeFileSync(join(repo, "crlf.txt"), "a\r\nb\r\n");
	writeFileSync(join(repo, "bin.dat"), Buffer.from([1, 0, 2, 0, 3, 0]));
	await git("init", "-q", "-b", "main");
	await git("add", ".");
	await git("commit", "-q", "-m", "golden: first");

	// Second commit: app v2 (so diff HEAD~1..HEAD is deterministic).
	writeFileSync(join(repo, "src", "app.txt"), "app v2\n");
	await git("add", ".");
	await git("commit", "-q", "-m", "golden: second");

	// Working-tree state for the status golden:
	await git("mv", "old name.txt", "renamed new.txt"); // staged rename → R.
	writeFileSync(join(repo, "staged new file.txt"), "staged\n");
	await git("add", "staged new file.txt"); // → A.
	writeFileSync(join(repo, "readme.md"), "# readme staged\r\nline2\r\n");
	await git("add", "readme.md"); // staged → M.
	writeFileSync(
		join(repo, "readme.md"),
		"# readme staged+worktree\r\nline2\r\n",
	); // → MM
	writeFileSync(join(repo, "src", "app.txt"), "app v2 worktree\n"); // → .M
	rmSync(join(repo, "ünïcode näme.txt")); // → .D
	writeFileSync(join(repo, "bin.dat"), Buffer.from([9, 0, 8, 0])); // staged binary → M. + numstat "-"
	await git("add", "bin.dat");
	writeFileSync(join(repo, "untracked file.txt"), "?\n");
	mkdirSync(join(repo, "untracked dir"), { recursive: true });
	writeFileSync(join(repo, "untracked dir", "nested.txt"), "?\n");
});

afterAll(() => {
	rmSync(base, { recursive: true, force: true });
});

const adapter = createGitAdapter();

describe("GitAdapter.status (golden)", () => {
	test("parses the fixture worktree exactly", async () => {
		const status = await adapter.status(repo);
		expect(status.branch.head).toBe("main");
		expect(status.entries).toEqual([
			{
				path: "bin.dat",
				indexStatus: "M",
				worktreeStatus: ".",
				origin: "changed",
			},
			{
				path: "readme.md",
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
			{
				path: "src/app.txt",
				indexStatus: ".",
				worktreeStatus: "M",
				origin: "changed",
			},
			{
				path: "staged new file.txt",
				indexStatus: "A",
				worktreeStatus: ".",
				origin: "changed",
			},
			{
				path: "ünïcode näme.txt",
				indexStatus: ".",
				worktreeStatus: "D",
				origin: "changed",
			},
			{
				path: "untracked dir/nested.txt",
				indexStatus: "?",
				worktreeStatus: "?",
				origin: "untracked",
			},
			{
				path: "untracked file.txt",
				indexStatus: "?",
				worktreeStatus: "?",
				origin: "untracked",
			},
		]);
	});

	test("rejects a non-repository with GitError", async () => {
		const plain = join(base, "plain");
		mkdirSync(plain, { recursive: true });
		await expect(adapter.status(plain)).rejects.toBeInstanceOf(GitError);
	});
});

describe("GitAdapter.log (golden)", () => {
	test("returns both commits, newest first, with fixed metadata", async () => {
		const commits = await adapter.log(repo, { limit: 10 });
		expect(commits).toHaveLength(2);
		const [second, first] = commits;
		expect(second.subject).toBe("golden: second");
		expect(first.subject).toBe("golden: first");
		expect(second.date).toBe("2026-01-01T00:00:00Z");
		expect(first.date).toBe("2026-01-01T00:00:00Z");
		expect(first.authorName).toBe("Golden Fixture");
		expect(first.authorEmail).toBe("golden@fixture.test");
		expect(second.oid).toMatch(/^[0-9a-f]{40}$/);
		expect(second.shortOid).toHaveLength(7);
		expect(second.refs).toContain("HEAD");
	});

	test("feedLog streams commits incrementally", async () => {
		const seen: string[] = [];
		const { count } = await adapter.feedLog(repo, (c) => seen.push(c.subject));
		expect(count).toBe(2);
		expect(seen).toEqual(["golden: second", "golden: first"]);
	});

	test("LogRecordParser handles records split across chunk boundaries", () => {
		const parser = new LogRecordParser();
		const record = [
			"a".repeat(40),
			"abc1234",
			"Name",
			"n@t",
			"2026-01-01T00:00:00+00:00",
			"subject",
			"",
		].join("\x1f");
		// Split mid-record AND mid-chunk to exercise the remainder buffer.
		const firstHalf = new Uint8Array(Buffer.from(record.slice(0, 20)));
		const secondHalf = new Uint8Array(Buffer.from(`${record.slice(20)}\0`));
		expect(parser.feed(firstHalf)).toEqual([]);
		const out = parser.feed(secondHalf);
		expect(out).toHaveLength(1);
		expect(out[0]?.subject).toBe("subject");
		expect(parser.flush()).toEqual([]);
	});
});

describe("GitAdapter.diff (golden)", () => {
	test("worktree diff: numstat with binary + rename, full patch", async () => {
		const result = await adapter.diff(repo, { from: "HEAD" });
		const byPath = new Map(result.files.map((f) => [f.path, f]));
		const bin = byPath.get("bin.dat");
		expect(bin?.binary).toBe(true);
		expect(bin?.additions).toBe(-1);
		const rename = byPath.get("renamed new.txt");
		expect(rename?.renamedFrom).toBe("old name.txt");
		const app = byPath.get("src/app.txt");
		expect(app?.additions).toBe(1);
		expect(app?.deletions).toBe(1);
		expect(result.patch).toContain("diff --git");
		expect(result.patch).toContain("@@");
	});

	test("commit-to-commit diff is deterministic", async () => {
		const commits = await adapter.log(repo, { limit: 2 });
		const result = await adapter.diff(repo, {
			from: commits[1]?.oid ?? "",
			to: commits[0]?.oid ?? "",
		});
		expect(result.files).toHaveLength(1);
		expect(result.files[0]?.path).toBe("src/app.txt");
		expect(result.files[0]?.additions).toBe(1);
		expect(result.files[0]?.deletions).toBe(1);
		expect(result.patch).toContain("app v2");
	});

	test("staged diff (--cached) sees staged files", async () => {
		const result = await adapter.diff(repo, { staged: true });
		const paths = result.files.map((f) => f.path);
		expect(paths).toContain("staged new file.txt");
	});
});

describe("GitAdapter.catFile (golden)", () => {
	test("reads blobs without respawning, handles missing specs, preserves CRLF", async () => {
		const session = adapter.openCatFile(repo);
		try {
			const blob = await session.read("HEAD:src/app.txt");
			expect(blob?.type).toBe("blob");
			expect(new TextDecoder().decode(blob?.data ?? new Uint8Array())).toBe(
				"app v2\n",
			);

			const crlf = await session.read("HEAD:crlf.txt");
			expect(new TextDecoder().decode(crlf?.data ?? new Uint8Array())).toBe(
				"a\r\nb\r\n",
			);

			const missing = await session.read("HEAD:does/not/exist");
			expect(missing).toBeNull();
		} finally {
			session.close();
		}
	});
});

describe("GitAdapter failure paths", () => {
	test("status on a missing directory rejects with GitError", async () => {
		await expect(adapter.status(join(base, "nope"))).rejects.toBeInstanceOf(
			GitError,
		);
	});
});
