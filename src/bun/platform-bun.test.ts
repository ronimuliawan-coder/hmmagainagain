// Conformance tests for the real Bun platform against a real temporary
// git worktree (created and torn down per test run).

import { afterAll } from "bun:test";
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

	return {
		repoRoot,
		nonRepoRoot,
		trackedFile: "hello.txt",
		trackedContent: TRACKED_CONTENT,
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
