// Conformance suite for the Platform contract: fake and Bun main-process
// implementations must pass `runConformance` against their own fixture
// wiring. A new capability on Platform starts here. Deliberately NOT
// exhaustive: commit flows live in the dedicated golden suites (they move
// shared refs), and the RPC client is covered by its own mock suites —
// extending either here is a separate, heavier harness (post-v1 Unit B).

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Platform } from "./platform";

export interface ConformanceFixture {
	/** A valid git worktree with at least one commit containing `trackedFile`. */
	repoRoot: string;
	/** A directory that is NOT a git repository. */
	nonRepoRoot: string;
	trackedFile: string;
	trackedContent: string;
	/** Name of a remote that fetch/pull/push resolve against locally
	 * (file-path bare repo for Bun, anything for the fake). */
	remoteName: string;
	/** A long-streaming git command whose output mentions `longRunMarker`. */
	longRunArgs: string[];
	longRunMarker: string;
	/** Creates a file inside a subdirectory of repoRoot (proves recursive watch). */
	makeNestedChange(): Promise<string>;
}

const text = (chunks: Uint8Array[]) =>
	chunks.map((c) => new TextDecoder().decode(c)).join("");

export function runConformance(
	makePlatform: () => Platform,
	fixture: ConformanceFixture,
) {
	describe(`platform conformance: ${makePlatform().kind}`, () => {
		test("readRepo validates a git worktree", async () => {
			const info = await makePlatform().readRepo(fixture.repoRoot);
			expect(info.isRepo).toBe(true);
			expect(info.root).toBe(fixture.repoRoot);
		});

		test("readRepo rejects a non-repo", async () => {
			await expect(
				makePlatform().readRepo(fixture.nonRepoRoot),
			).rejects.toThrow();
		});

		test("gitDiff rejects a non-repo", async () => {
			await expect(
				makePlatform().gitDiff(fixture.nonRepoRoot),
			).rejects.toThrow();
		});

		test("gitStatus reports branch and entries; rejects a non-repo", async () => {
			const status = await makePlatform().gitStatus(fixture.repoRoot);
			expect(status.branch.head.length).toBeGreaterThan(0);
			expect(Array.isArray(status.entries)).toBe(true);
			await expect(
				makePlatform().gitStatus(fixture.nonRepoRoot),
			).rejects.toThrow();
		});

		test("gitBranches lists the current branch; rejects a non-repo", async () => {
			const branches = await makePlatform().gitBranches(fixture.repoRoot);
			expect(branches.filter((b) => b.current)).toHaveLength(1);
			await expect(
				makePlatform().gitBranches(fixture.nonRepoRoot),
			).rejects.toThrow();
		});

		test("create, switch, and switch-back round-trip", async () => {
			const platform = makePlatform();
			const home = (await platform.gitBranches(fixture.repoRoot)).find(
				(b) => b.current,
			)?.name;
			const name = `conformity-${Date.now()}`;
			await platform.gitCreateBranch(fixture.repoRoot, name, true);
			expect(
				(await platform.gitBranches(fixture.repoRoot)).find((b) => b.current)
					?.name,
			).toBe(name);
			if (home) await platform.gitSwitchBranch(fixture.repoRoot, home);
			expect(
				(await platform.gitBranches(fixture.repoRoot)).find((b) => b.current)
					?.name,
			).toBe(home ?? name);
		});

		test("stage then unstage round-trips the index", async () => {
			// Staging needs a real modification: touch the tracked file only
			// when it exists on disk (bun fixture), then restore it exactly.
			// The fake has no worktree and starts staged — both paths assert
			// the staged/unstaged transitions, not the starting state.
			const realPath = join(fixture.repoRoot, fixture.trackedFile);
			const saved = existsSync(realPath)
				? readFileSync(realPath, "utf8")
				: null;
			if (saved !== null) writeFileSync(realPath, `${saved}touch\n`);
			try {
				const platform = makePlatform();
				await platform.stagePaths(fixture.repoRoot, [fixture.trackedFile]);
				const staged = await platform.gitStatus(fixture.repoRoot);
				expect(
					staged.entries.some(
						(e) => e.path === fixture.trackedFile && e.indexStatus !== ".",
					),
				).toBe(true);
				await platform.unstagePaths(fixture.repoRoot, [fixture.trackedFile]);
				const clean = await platform.gitStatus(fixture.repoRoot);
				expect(
					clean.entries.some(
						(e) => e.path === fixture.trackedFile && e.indexStatus !== ".",
					),
				).toBe(false);
			} finally {
				if (saved !== null) writeFileSync(realPath, saved);
			}
		});

		test("gitLog honors limit and skip", async () => {
			const seen: string[] = [];
			const first = await makePlatform().gitLog(
				fixture.repoRoot,
				{ limit: 1 },
				(commit) => seen.push(commit.oid),
			);
			expect(first.count).toBe(1);
			expect(seen).toHaveLength(1);
			const rest = await makePlatform().gitLog(
				fixture.repoRoot,
				{ skip: 1, limit: 5 },
				() => {},
			);
			// Both fixtures hold exactly two commits (bun builder adds one).
			expect(rest.count).toBe(1);
		});

		test("gitRemote fetch resolves against the fixture remote", async () => {
			const result = await makePlatform().gitRemote(
				fixture.repoRoot,
				"fetch",
				{ remote: fixture.remoteName },
				() => {},
			);
			expect(result.ok).toBe(true);
		});

		test("runGit returns exit code and verbatim stdout", async () => {
			const chunks: Uint8Array[] = [];
			const result = await makePlatform().runGit(
				fixture.repoRoot,
				["show", `HEAD:${fixture.trackedFile}`],
				{ onStdout: (chunk) => chunks.push(chunk) },
			);
			expect(result.code).toBe(0);
			expect(text(chunks)).toContain(fixture.trackedContent);
		});

		test("runGit streams stdout chunks in order before resolving", async () => {
			const chunks: Uint8Array[] = [];
			let sawMarkerDuringStream = false;
			const result = await makePlatform().runGit(
				fixture.repoRoot,
				fixture.longRunArgs,
				{
					onStdout: (chunk) => {
						if (text([chunk]).includes(fixture.longRunMarker)) {
							sawMarkerDuringStream = true;
						}
						chunks.push(chunk);
					},
				},
			);
			expect(result.code).toBe(0);
			expect(sawMarkerDuringStream).toBe(true);
			expect(chunks.length).toBeGreaterThan(0);
		});

		test("abort kills the child git process (no orphans)", async () => {
			const controller = new AbortController();
			const chunks: Uint8Array[] = [];
			const result = await makePlatform().runGit(
				fixture.repoRoot,
				fixture.longRunArgs,
				{
					signal: controller.signal,
					onStdout: (chunk) => {
						chunks.push(chunk);
						controller.abort();
					},
				},
			);
			// Killed, not completed: either a signal is reported or git exited
			// non-zero because it was terminated mid-run.
			expect(result.signal === "SIGTERM" || result.code !== 0).toBe(true);
			await Bun.sleep(150);
			// No orphaned git still running our exact long command.
			const probe = Bun.spawnSync([
				"pgrep",
				"-f",
				fixture.longRunArgs.join(" "),
			]);
			expect(probe.stdout.toString().trim()).toBe("");
		});

		test("watchRepo fires debounced recursive events and stops cleanly", async () => {
			const platform = makePlatform();
			const received: string[][] = [];
			const watcher = await platform.watchRepo(fixture.repoRoot, (batch) => {
				received.push(batch.paths);
			});
			const changedPath = await fixture.makeNestedChange();
			await Bun.sleep(700); // debounce window (>= 100 ms) + watcher latency
			expect(received.flat().join("|")).toContain(changedPath);
			await watcher.stop();
			const countAfterStop = received.length;
			await Bun.sleep(300);
			expect(received.length).toBe(countAfterStop);
		});
	});
}
