// The real main-process platform: local git via subprocess, recursive fs watch.
// Runs inside the Electrobun Bun main process; the webview reaches it only
// through the typed RPC layer (see the wiring in src/bun/index.ts).

import { type FSWatcher, watch } from "node:fs";
import type {
	FsEventBatch,
	GitRunOptions,
	GitRunResult,
	Platform,
	RepoInfo,
} from "../shared/platform";
import { spawnGit } from "./git-spawn";

const WATCH_DEBOUNCE_MS = 100;

async function gitOut(
	root: string,
	args: string[],
): Promise<{ code: number; out: string }> {
	const chunks: Uint8Array[] = [];
	const result = await spawnGit(root, args, {
		onStdout: (c) => chunks.push(c),
	});
	const out = chunks.map((c) => new TextDecoder().decode(c)).join("");
	return { code: result.code ?? 1, out };
}

export function createBunPlatform(): Platform {
	const platform: Platform = {
		kind: "bun",
		async readRepo(root: string): Promise<RepoInfo> {
			const inside = await gitOut(root, ["rev-parse", "--is-inside-work-tree"]);
			if (inside.out.trim() !== "true") {
				throw new Error(`not a git repository: ${root}`);
			}
			// An unborn branch (no commits yet) is still a valid worktree.
			const branch = await gitOut(root, ["branch", "--show-current"]);
			const head = await gitOut(root, ["rev-parse", "HEAD"]);
			return {
				root,
				isRepo: true,
				branch: branch.out.trim() || "(detached)",
				head: head.code === 0 ? head.out.trim() : "",
			};
		},

		runGit(
			root: string,
			args: string[],
			opts?: GitRunOptions,
		): Promise<GitRunResult> {
			return spawnGit(root, args, opts);
		},

		watchRepo(root: string, onEvents: (batch: FsEventBatch) => void) {
			return new Promise<{ stop: () => Promise<void> }>((resolve, reject) => {
				const pending = new Set<string>();
				let debounce: ReturnType<typeof setTimeout> | null = null;
				const flush = () => {
					debounce = null;
					const batch: FsEventBatch = { paths: [...pending] };
					pending.clear();
					onEvents(batch);
				};

				let watcher: FSWatcher;
				try {
					// Recursive watch on Linux comes from Bun's fs implementation
					// (verified empirically on Bun 1.4.0; RON-294 evidence).
					watcher = watch(root, { recursive: true }, (_event, path) => {
						if (path) pending.add(path);
						if (!debounce) {
							debounce = setTimeout(flush, WATCH_DEBOUNCE_MS);
						}
					});
				} catch (error) {
					reject(error instanceof Error ? error : new Error(String(error)));
					return;
				}

				resolve({
					stop: () =>
						new Promise<void>((resolveStop) => {
							watcher.close();
							if (debounce) clearTimeout(debounce);
							resolveStop();
						}),
				});
			});
		},
	};
	return platform;
}
