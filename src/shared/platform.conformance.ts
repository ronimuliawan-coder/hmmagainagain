// Conformance suite for the Platform contract. Every implementation (fake,
// Bun main-process, RPC client) must pass `runConformance` against its own
// fixture wiring. A new capability on Platform starts here.

import { describe, expect, test } from "bun:test";
import type { Platform } from "./platform";

export interface ConformanceFixture {
	/** A valid git worktree with at least one commit containing `trackedFile`. */
	repoRoot: string;
	/** A directory that is NOT a git repository. */
	nonRepoRoot: string;
	trackedFile: string;
	trackedContent: string;
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
