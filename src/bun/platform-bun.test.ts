// Conformance tests for the real Bun platform against a real temporary
// git worktree (created and torn down per test run).

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type ConformanceFixture,
	runConformance,
} from "../shared/platform.conformance";
import { spawnGit } from "./git-spawn";
import { createBunPlatform } from "./platform-bun";

const base = mkdtempSync(join(tmpdir(), "hmmagainagain-u1-"));
const TRACKED_CONTENT = "hello from the real fixture\n";
const MARKER = "marker-zebra-42";

async function buildFixture(): Promise<ConformanceFixture> {
	const repoRoot = join(base, "repo");
	const nonRepoRoot = join(base, "plain");
	mkdirSync(repoRoot, { recursive: true });
	mkdirSync(nonRepoRoot, { recursive: true });

	// Trivial tracked file for the verbatim-output check.
	writeFileSync(join(repoRoot, "hello.txt"), TRACKED_CONTENT);
	// 5 MB blob with the marker far past the first pipe read: guarantees the
	// streaming test sees multiple chunks and the abort test kills mid-run.
	const big = Buffer.alloc(5 * 1024 * 1024, 0x61);
	big.write(MARKER, 2 * 1024 * 1024);
	writeFileSync(join(repoRoot, "big.txt"), big);

	for (const args of [
		["init", "-q", "-b", "main"],
		["config", "user.email", "fixture@example.test"],
		["config", "user.name", "fixture"],
		["add", "."],
		["commit", "-q", "-m", "init"],
	]) {
		const result = await spawnGit(repoRoot, args);
		if (result.code !== 0) {
			throw new Error(`fixture git ${args[0]} failed: ${result.stderr}`);
		}
	}
	// Second commit (conformance paging needs two) + a local bare origin
	// (conformance fetch must resolve without network). Additive only:
	// no existing assertion reads refs beyond HEAD:trackedFile.
	writeFileSync(join(repoRoot, "second.txt"), "second\n");
	for (const args of [
		["add", "."],
		["commit", "-q", "-m", "second"],
		["init", "-q", "--bare", join(base, "origin.git")],
		["remote", "add", "origin", join(base, "origin.git")],
	]) {
		const result = await spawnGit(repoRoot, args);
		if (result.code !== 0) {
			throw new Error(`fixture git ${args[0]} failed: ${result.stderr}`);
		}
	}

	return {
		repoRoot,
		nonRepoRoot,
		trackedFile: "hello.txt",
		trackedContent: TRACKED_CONTENT,
		remoteName: "origin",
		longRunArgs: ["show", "HEAD:big.txt"],
		longRunMarker: MARKER,
		makeNestedChange: () => {
			mkdirSync(join(repoRoot, "sub"), { recursive: true });
			const rel = `sub/nested-${Date.now()}.txt`;
			writeFileSync(join(repoRoot, rel), "x");
			return Promise.resolve(rel);
		},
	};
}

// Top-level await so the fixture exists before tests are registered.
const fixture = await buildFixture();

afterAll(() => {
	rmSync(base, { recursive: true, force: true });
});

runConformance(() => createBunPlatform(), fixture);

describe("platform gitRemote failure forwarding", () => {
	test("unknown remote rejects instead of resolving ok:true", async () => {
		const platform = createBunPlatform();
		// Backs the MR !1 rebuttal in code: Bun-side failures must reject
		// so the RPC layer can forward them verbatim.
		await expect(
			platform.gitRemote(fixture.repoRoot, "fetch", {
				remote: "no-such-remote",
			}),
		).rejects.toThrow();
	});

	test("non-repository rejects", async () => {
		const platform = createBunPlatform();
		await expect(
			platform.gitRemote(fixture.nonRepoRoot, "fetch", { remote: "origin" }),
		).rejects.toThrow();
	});
});
