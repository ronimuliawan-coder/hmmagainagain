// Tauri Platform (M1–M2): the Platform contract over Tauri invoke, beside
// the Electrobun RPC bridge. Reads + branch ops are live; parsing of the
// streamed log happens in Rust (the stream demands it), everything else
// reuses the existing pure TS parsers. Unowned units reject until they
// land. No Electrobun imports — this module loads in any webview where
// window.__TAURI__ exists.

import { parsePatchStats } from "../bun/git/diff";
import { parseStatusV2 } from "../bun/git/status-parser";
import type {
	BranchInfo,
	DiffResult,
	FsEventBatch,
	GitDiffOptions,
	GitStatus,
	LogCommit,
	Platform,
	RepoInfo,
} from "../shared/platform";

declare global {
	interface Window {
		__TAURI__?: {
			core: {
				invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
			};
			event: {
				listen<T>(
					event: string,
					handler: (payload: { payload: T }) => void,
				): Promise<() => void>;
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

interface TauriLogCommitEvent {
	run_id: string;
	commit: LogCommit;
}

interface TauriLogDoneEvent {
	run_id: string;
	count: number;
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

		gitLog: (
			root: string,
			options: { limit?: number; skip?: number; range?: string },
			onCommit: (commit: LogCommit) => void,
		): Promise<{ count: number }> => {
			const backend = window.__TAURI__?.event;
			if (!backend) {
				return Promise.reject(new Error("tauri: event bridge unavailable"));
			}
			const runId = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`;
			return (async () => {
				const offCommit = await backend.listen<TauriLogCommitEvent>(
					"git-log-commit",
					(event) => {
						if (event.payload.run_id === runId) onCommit(event.payload.commit);
					},
				);
				let offDone: (() => void) | null = null;
				const done = new Promise<{ count: number }>((resolve, reject) => {
					backend
						.listen<TauriLogDoneEvent>("git-log-done", (event) => {
							if (event.payload.run_id === runId) {
								resolve({ count: event.payload.count });
							}
						})
						.then(
							(off) => {
								offDone = off;
							},
							(error: unknown) => {
								reject(
									error instanceof Error ? error : new Error(String(error)),
								);
							},
						);
				});
				const cleanup = (): void => {
					offCommit();
					offDone?.();
				};
				try {
					await invoke<number>("git_log_stream", {
						root,
						runId,
						limit: options.limit ?? null,
						skip: options.skip ?? null,
						range: options.range ?? null,
					});
					return await done;
				} finally {
					cleanup();
				}
			})();
		},
		gitBranches: (root: string): Promise<BranchInfo[]> =>
			invoke<BranchInfo[]>("git_branches", { root }),
		gitCreateBranch: (
			root: string,
			name: string,
			switchTo?: boolean,
		): Promise<void> =>
			invoke<void>("git_create_branch", {
				root,
				name,
				switchTo: switchTo ?? false,
			}).then(() => undefined),
		gitSwitchBranch: (root: string, name: string): Promise<void> =>
			invoke<void>("git_switch_branch", { root, name }).then(() => undefined),
		gitRemote: () => notYet("gitRemote"),
		stagePaths: () => notYet("stagePaths"),
		unstagePaths: () => notYet("unstagePaths"),
		applyIndexPatch: () => notYet("applyIndexPatch"),
		commit: () => notYet("commit"),
	};
}
