// Golden tests for U6 branch operations: listing with current marker, create
// with/without switch, the dirty-worktree refusal (no spawn, ref unchanged),
// and verbatim git errors for unknown branches.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGitAdapter, GitError } from "./git-adapter";
import { spawnGit } from "./git-spawn";

const base = mkdtempSync(join(tmpdir(), "hmmagainagain-u6-"));
const repo = join(base, "golden");
const FIXTURE_ENV = {
	GIT_AUTHOR_DATE: "2026-01-01T00:00:00 +0000",
	GIT_COMMITTER_DATE: "2026-01-01T00:00:00 +0000",
	GIT_AUTHOR_NAME: "Golden Fixture",
	GIT_AUTHOR_EMAIL: "golden@fixture.test",
	GIT_COMMITTER_NAME: "Golden Fixture",
	GIT_COMMITTER_EMAIL: "golden@fixture.test",
};

async function git(...args: string[]): Promise<void> {
	const result = await spawnGit(repo, args, { env: FIXTURE_ENV });
	if (result.code !== 0)
		throw new Error(`fixture git ${args.join(" ")}: ${result.stderr}`);
}

beforeAll(async () => {
	mkdirSync(repo, { recursive: true });
	writeFileSync(join(repo, "hello.txt"), "v1\n");
	await git("init", "-q", "-b", "main");
	await git("add", ".");
	await git("commit", "-q", "-m", "base");
});

afterAll(() => {
	rmSync(base, { recursive: true, force: true });
});

const adapter = createGitAdapter();

describe("GitAdapter.branches (golden)", () => {
	test("lists branches with the current marker", async () => {
		const list = await adapter.branches(repo);
		expect(list).toHaveLength(1);
		expect(list[0]?.name).toBe("main");
		expect(list[0]?.current).toBe(true);
		expect(list[0]?.oid).toMatch(/^[0-9a-f]{40}$/);
	});

	test("create without switching leaves main current", async () => {
		await adapter.createBranch(repo, "feature/idle", {});
		const list = await adapter.branches(repo);
		expect(list.map((b) => b.name).sort()).toEqual(["feature/idle", "main"]);
		expect(list.find((b) => b.current)?.name).toBe("main");
	});

	test("create with switchTo flips current to the new branch", async () => {
		await adapter.createBranch(repo, "feature/switched", { switchTo: true });
		const list = await adapter.branches(repo);
		expect(list.find((b) => b.current)?.name).toBe("feature/switched");
	});

	test("empty branch name is rejected before git runs", async () => {
		await expect(adapter.createBranch(repo, "   ")).rejects.toThrow(/empty/);
	});
});

describe("GitAdapter.switchBranch (golden)", () => {
	test("switches back when clean", async () => {
		await adapter.switchBranch(repo, "main");
		const list = await adapter.branches(repo);
		expect(list.find((b) => b.current)?.name).toBe("main");
	});

	test("refuses on a dirty worktree: nothing stashed, nothing discarded", async () => {
		writeFileSync(join(repo, "hello.txt"), "dirty\n");
		const before = await adapter.branches(repo);
		const currentBefore = before.find((b) => b.current)?.name;

		const error = await adapter
			.switchBranch(repo, "feature/switched")
			.then(() => null)
			.catch((e: unknown) => e as GitError);
		expect(error).toBeInstanceOf(GitError);
		expect(error?.message).toContain("refusing to switch branches");

		// The ref did not move and the dirty file is untouched.
		const after = await adapter.branches(repo);
		expect(after.find((b) => b.current)?.name).toBe(currentBefore);
		expect(readFileSync(join(repo, "hello.txt"), "utf8")).toBe("dirty\n");
		// Restore the clean state for later tests.
		writeFileSync(join(repo, "hello.txt"), "v1\n");
	});

	test("unknown branch surfaces git's verbatim error", async () => {
		const error = await adapter
			.switchBranch(repo, "no/such/branch")
			.then(() => null)
			.catch((e: unknown) => e as GitError);
		expect(error).toBeInstanceOf(GitError);
		expect(error?.stderr.length).toBeGreaterThan(0);
	});
});
