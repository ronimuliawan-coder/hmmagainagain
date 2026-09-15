// Golden tests for U7 remote ops against a local bare origin (host-agnostic:
// file-path remotes exercise the exact same transport code as network ones,
// minus credentials). Proven: push advances the remote ref, pull fast-forwards
// a behind clone, diverged pull fails verbatim without moving anything, first
// push -u sets upstream tracking.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGitAdapter, GitError } from "./git-adapter";
import { spawnGit } from "./git-spawn";

const base = mkdtempSync(join(tmpdir(), "hmmagainagain-u7-"));
const originPath = join(base, "origin.git");
const workPath = join(base, "work");
const secondPath = join(base, "second");
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

const adapter = createGitAdapter();

async function gitIn(dir: string, ...args: string[]): Promise<string> {
	const result = await spawnGit(dir, args, {
		env: FIXTURE_ENV,
		collectStdout: true,
	});
	if (result.code !== 0)
		throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
	return result.stdout ?? "";
}

async function remoteHeadOid(): Promise<string> {
	const result = await spawnGit(originPath, ["rev-parse", "HEAD"], {
		collectStdout: true,
	});
	// Fail loudly: an empty string would silently poison oid comparisons.
	if (result.code !== 0) {
		throw new Error(`fixture rev-parse failed: ${result.stderr}`);
	}
	return result.stdout?.toString().trim() ?? "";
}

beforeAll(async () => {
	mkdirSync(base, { recursive: true });
	await gitIn(base, "init", "-q", "--bare", "-b", "main", "origin.git");
	await gitIn(base, "clone", "-q", "origin.git", "work");
	writeFileSync(join(workPath, "hello.txt"), "v1\n");
	await gitIn(workPath, "add", ".");
	await gitIn(workPath, "commit", "-q", "-m", "base");
	await gitIn(workPath, "push", "-u", "origin", "main");
	await gitIn(base, "clone", "-q", "origin.git", "second");
});

afterAll(() => {
	rmSync(base, { recursive: true, force: true });
});

describe("GitAdapter remote ops (golden)", () => {
	test("push advances the bare origin ref", async () => {
		const before = await remoteHeadOid();
		writeFileSync(join(workPath, "hello.txt"), "v2\n");
		await gitIn(workPath, "add", ".");
		await gitIn(workPath, "commit", "-q", "-m", "work v2");
		const localOid = (await gitIn(workPath, "rev-parse", "HEAD")).trim();
		expect(localOid).not.toBe(before);

		await adapter.remoteOp(workPath, "push", {
			remote: "origin",
			branch: "main",
		});
		expect(await remoteHeadOid()).toBe(localOid);
	});

	test("pull fast-forwards a behind clone", async () => {
		// second clone is behind origin (work pushed v2); pull in second.
		const before = (await gitIn(secondPath, "rev-parse", "HEAD")).trim();
		await adapter.remoteOp(secondPath, "pull", {
			remote: "origin",
			branch: "main",
		});
		const after = (await gitIn(secondPath, "rev-parse", "HEAD")).trim();
		expect(after).not.toBe(before);
		expect(after).toBe(await remoteHeadOid());
	});

	test("diverged pull fails verbatim and moves nothing", async () => {
		// Local commit in work…
		writeFileSync(join(workPath, "local.txt"), "local\n");
		await gitIn(workPath, "add", ".");
		await gitIn(workPath, "commit", "-q", "-m", "local side");
		// …and an independent commit pushed from second → history diverged.
		writeFileSync(join(secondPath, "remote.txt"), "remote\n");
		await gitIn(secondPath, "add", ".");
		await gitIn(secondPath, "commit", "-q", "-m", "remote side");
		await gitIn(secondPath, "push", "origin", "main");
		const remoteBefore = await remoteHeadOid();
		const localBefore = (await gitIn(workPath, "rev-parse", "HEAD")).trim();

		const error = await adapter
			.remoteOp(workPath, "pull", { remote: "origin", branch: "main" })
			.then(() => null)
			.catch((e: unknown) => e as GitError);
		expect(error).toBeInstanceOf(GitError);
		// Verbatim git wording — the UI shows this as-is.
		expect(error?.stderr).toContain("Not possible to fast-forward");

		// Nothing moved anywhere.
		expect(await remoteHeadOid()).toBe(remoteBefore);
		expect((await gitIn(workPath, "rev-parse", "HEAD")).trim()).toBe(
			localBefore,
		);
	});

	test("fetch reports a newer remote without touching the local ref", async () => {
		const localBefore = (await gitIn(workPath, "rev-parse", "HEAD")).trim();
		// second pushes again; work only fetches.
		writeFileSync(join(secondPath, "more.txt"), "more\n");
		await gitIn(secondPath, "add", ".");
		await gitIn(secondPath, "commit", "-q", "-m", "remote more");
		await gitIn(secondPath, "push", "origin", "main");

		await adapter.remoteOp(workPath, "fetch", { remote: "origin" });
		expect((await gitIn(workPath, "rev-parse", "HEAD")).trim()).toBe(
			localBefore,
		);
		// Behind by 2: the diverged 'remote side' commit (never fetched) plus
		// the fresh 'remote more' commit — fetch only updates remote-tracking.
		const behind = await gitIn(
			workPath,
			"rev-list",
			"--count",
			"HEAD..origin/main",
		);
		expect(Number(behind.trim())).toBe(2);
	});

	test("an aborted signal kills the op instead of running it", async () => {
		const controller = new AbortController();
		controller.abort();
		const error = await adapter
			.remoteOp(workPath, "fetch", {
				remote: "origin",
				signal: controller.signal,
			})
			.then(() => null)
			.catch((e: unknown) => e);
		// spawnGit SIGTERMs on abort; the nonzero exit surfaces as GitError.
		expect(error).toBeInstanceOf(GitError);
	});

	test("push -u sets upstream tracking", async () => {
		await gitIn(workPath, "checkout", "-q", "-b", "feature/tracked");
		await adapter.remoteOp(workPath, "push", {
			remote: "origin",
			branch: "feature/tracked",
			setUpstream: true,
		});
		const upstream = await gitIn(
			workPath,
			"for-each-ref",
			"--format=%(upstream:short)",
			"refs/heads/feature/tracked",
		);
		expect(upstream.trim()).toBe("origin/feature/tracked");
	});

	test("leading-dash remote/branch are rejected before git runs (CWE-88)", async () => {
		await expect(
			adapter.remoteOp(workPath, "push", { remote: "--upload-pack=evil" }),
		).rejects.toThrow(/must not start with/);
		await expect(
			adapter.remoteOp(workPath, "fetch", {
				remote: "origin",
				branch: "--help",
			}),
		).rejects.toThrow(/must not start with/);
	});

	test("unknown remote name fails verbatim and moves nothing", async () => {
		const localBefore = await gitIn(workPath, "rev-parse", "main");
		const remoteBefore = await remoteHeadOid();
		const error = await adapter
			.remoteOp(workPath, "push", { remote: "no-such-remote", branch: "main" })
			.then(() => null)
			.catch((e: unknown) => e as GitError);
		expect(error).toBeInstanceOf(GitError);
		expect(error?.stderr).toContain("no-such-remote");
		expect(await gitIn(workPath, "rev-parse", "main")).toBe(localBefore);
		expect(await remoteHeadOid()).toBe(remoteBefore);
	});

	test("pull of a nonexistent remote branch fails verbatim", async () => {
		const secondBefore = await gitIn(secondPath, "rev-parse", "HEAD");
		const error = await adapter
			.remoteOp(secondPath, "pull", {
				remote: "origin",
				branch: "no-such-branch",
			})
			.then(() => null)
			.catch((e: unknown) => e as GitError);
		expect(error).toBeInstanceOf(GitError);
		expect(error?.stderr).toContain("couldn't find remote ref");
		expect(await gitIn(secondPath, "rev-parse", "HEAD")).toBe(secondBefore);
	});
});
