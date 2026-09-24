// Tauri Platform (M1, RON-400): the Platform contract over Tauri invoke,
// beside the Electrobun RPC bridge. M1 covers the read slice that renders
// status/tree/diff; parsing reuses the existing pure TS parsers (M2 ports
// them to Rust with fixture oracles). Everything else rejects until its
// owning unit lands. No Electrobun imports — this module loads in any
// webview where window.__TAURI__ exists.

import { parsePatchStats } from "../bun/git/diff";
import { parseStatusV2 } from "../bun/git/status-parser";
import type {
	DiffResult,
	FsEventBatch,
	GitDiffOptions,
	GitStatus,
	Platform,
	RepoInfo,
} from "../shared/platform";

declare global {
	interface Window {
		__TAURI__?: {
			core: {
				invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
			};
		};
	}
}

export const isTauri = (): boolean =>
	typeof window !== "undefined" &&
	typeof window.__TAURI__?.core?.invoke === "function";

const notYet = (name: string): Promise<never> =>
	Promise.reject(new Error(`tauri: ${name} arrives in a later migration unit`));

function invoke<T>(
	command: string,
	args?: Record<string, unknown>,
): Promise<T> {
	const core = window.__TAURI__?.core;
	if (!core) return Promise.reject(new Error("tauri: bridge unavailable"));
	return core.invoke<T>(command, args);
}

interface TauriRepoInfo {
	branch: string;
	head: string;
}

function toDiffResult(patch: string): DiffResult {
	return { patch, files: parsePatchStats(patch) };
}

export function createTauriPlatform(): Platform {
	return {
		kind: "tauri",
		readRepo: (root: string): Promise<RepoInfo> =>
			invoke<TauriRepoInfo>("read_repo", { root }).then((info) => ({
				root,
				isRepo: true,
				branch: info.branch,
				head: info.head,
			})),

		pickDirectory: () =>
			Promise.reject(new Error("tauri: pickDirectory arrives in M4")),

		runGit: () => notYet("runGit"),

		// M1 has no watcher yet: resolve a no-op stopper so open flows work.
		// Live refresh arrives with the notify-crate watcher in M4.
		watchRepo: (_root: string, _onEvents: (batch: FsEventBatch) => void) =>
			Promise.resolve({ stop: () => Promise.resolve() }),

		gitStatus: (root: string): Promise<GitStatus> =>
			invoke<string>("git_status", { root }).then((raw) => parseStatusV2(raw)),

		gitDiff: (root: string, options?: GitDiffOptions): Promise<DiffResult> =>
			invoke<number>("git_diff_start", {
				root,
				staged: options?.staged ?? false,
				from: options?.from ?? null,
				to: options?.to ?? null,
			}).then((id) => {
				const signal = options?.signal;
				// Already dead on arrival: kill the just-started run.
				if (signal?.aborted) {
					void invoke("git_diff_abort", { id });
					return Promise.reject(new Error("diff aborted"));
				}
				const result = invoke<string>("git_diff_result", { id });
				if (!signal) return result.then(toDiffResult);
				return new Promise<DiffResult>((resolve, reject) => {
					const onAbort = (): void => {
						void invoke("git_diff_abort", { id });
						reject(new Error("diff aborted"));
					};
					signal.addEventListener("abort", onAbort, { once: true });
					result.then(
						(patch) => {
							signal.removeEventListener("abort", onAbort);
							resolve(toDiffResult(patch));
						},
						(error: unknown) => {
							signal.removeEventListener("abort", onAbort);
							reject(error instanceof Error ? error : new Error(String(error)));
						},
					);
				});
			}),

		gitWorktreePaths: (root: string): Promise<string[]> =>
			invoke<string>("git_worktree_paths", { root }).then((raw) =>
				raw
					.split("\0")
					.filter((p) => p.length > 0)
					.sort(),
			),

		gitLog: () => notYet("gitLog"),
		gitBranches: () => notYet("gitBranches"),
		gitCreateBranch: () => notYet("gitCreateBranch"),
		gitSwitchBranch: () => notYet("gitSwitchBranch"),
		gitRemote: () => notYet("gitRemote"),
		stagePaths: () => notYet("stagePaths"),
		unstagePaths: () => notYet("unstagePaths"),
		applyIndexPatch: () => notYet("applyIndexPatch"),
		commit: () => notYet("commit"),
	};
}
