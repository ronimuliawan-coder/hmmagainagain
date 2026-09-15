// The real main-process platform: local git via subprocess, recursive fs watch.
// Runs inside the Electrobun Bun main process; the webview reaches it only
// through the typed RPC layer (see the wiring in src/bun/index.ts).

import { type FSWatcher, watch } from "node:fs";
import type {
	FsEventBatch,
	GitDiffOptions,
	GitRunOptions,
	GitRunResult,
	Platform,
	RepoInfo,
} from "../shared/platform";
import { createGitAdapter } from "./git-adapter";
import { spawnGit } from "./git-spawn";

const WATCH_DEBOUNCE_MS = 100;
const git = createGitAdapter();

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

		gitStatus(root: string) {
			return git.status(root);
		},

		gitDiff(root: string, options?: GitDiffOptions) {
			return git.diff(root, options);
		},

		gitWorktreePaths(root: string) {
			return git.worktreePaths(root);
		},

		gitLog(root, options, onCommit) {
			return git.feedLog(root, onCommit, options);
		},

		gitBranches(root) {
			return git.branches(root);
		},

		gitCreateBranch(root, name, switchTo) {
			return git.createBranch(root, name, { switchTo });
		},

		gitSwitchBranch(root, name) {
			return git.switchBranch(root, name);
		},

		gitRemote(root, op, options, onLine) {
			return git.remoteOp(root, op, { ...options, onLine }).then(() => ({
				ok: true,
				stderr: "",
			}));
		},

		stagePaths(root: string, paths: string[]) {
			return git.stagePaths(root, paths);
		},

		unstagePaths(root: string, paths: string[]) {
			return git.unstagePaths(root, paths);
		},

		applyIndexPatch(root: string, patch: string) {
			return git.applyIndexPatch(root, patch);
		},

		commit(root: string, message: string) {
			return git.commit(root, message);
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
