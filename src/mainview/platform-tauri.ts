// Tauri Platform (M1–M2): the Platform contract over Tauri invoke, beside
// the Electrobun RPC bridge. Reads + branch ops are live; parsing of the
// streamed log happens in Rust (the stream demands it), everything else
// reuses the existing pure TS parsers. Unowned units reject until they
// land. No Electrobun imports — this module loads in any webview where
// window.__TAURI__ exists.

import { parsePatchStats } from "../shared/git/diff-parse";
import { parseStatusV2 } from "../shared/git/status-parser";
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

interface TauriRemoteLineEvent {
	op_id: number;
	client_token: string;
	line: string;
}

interface TauriRemoteOutcome {
	ok: boolean;
	stderr: string;
}

interface TauriFsEventsEvent {
	watch_id: string;
	paths: string[];
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

		// Directory pick via the dialog plugin. Its `open` command takes
		// options nested under `options` and returns the bare selection
		// (string | null for a single pick — the Rust OpenResponse is an
		// untagged enum, so there is no {Folder} wrapper on the wire).
		pickDirectory: (): Promise<string | null> =>
			invoke<string | null>("plugin:dialog|open", {
				options: {
					directory: true,
					multiple: false,
				},
			}),

		runGit: () => notYet("runGit"),

		watchRepo: (
			root: string,
			onEvents: (batch: FsEventBatch) => void,
		): Promise<{ stop: () => Promise<void> }> => {
			const backend = window.__TAURI__?.event;
			if (!backend) {
				return Promise.reject(new Error("tauri: event bridge unavailable"));
			}
			const watchId = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`;
			return (async () => {
				const off = await backend.listen<TauriFsEventsEvent>(
					"fs-events",
					(event) => {
						if (event.payload.watch_id === watchId) {
							onEvents({ paths: event.payload.paths });
						}
					},
				);
				try {
					await invoke("watch_start", { root, watchId });
				} catch (error) {
					off();
					throw error instanceof Error ? error : new Error(String(error));
				}
				return {
					stop: (): Promise<void> => {
						const stopped = invoke("watch_stop", { watchId });
						return stopped.then(
							(): void => {
								off();
							},
							(error: unknown): never => {
								off();
								throw error instanceof Error ? error : new Error(String(error));
							},
						);
					},
				};
			})();
		},

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
				// Both listeners register BEFORE the stream starts: Tauri
				// registration is async IPC, and a short stream could otherwise
				// emit done while registration is still pending (review catch).
				// The resolver is assigned synchronously so no event can land
				// in a gap between registration and invoke.
				let settleDone: ((count: number) => void) | null = null;
				const done = new Promise<{ count: number }>((resolve) => {
					settleDone = (count: number) => resolve({ count });
				});
				const offCommit = await backend.listen<TauriLogCommitEvent>(
					"git-log-commit",
					(event) => {
						if (event.payload.run_id === runId) onCommit(event.payload.commit);
					},
				);
				let offDone: (() => void) | null = null;
				try {
					offDone = await backend.listen<TauriLogDoneEvent>(
						"git-log-done",
						(event) => {
							if (event.payload.run_id === runId)
								settleDone?.(event.payload.count);
						},
					);
				} catch (error) {
					offCommit();
					throw error instanceof Error ? error : new Error(String(error));
				}
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
		gitSwitchRemoteBranch: (root: string, remoteRef: string): Promise<void> =>
			invoke<void>("git_switch_remote_branch", { root, remoteRef }).then(
				() => undefined,
			),
		gitRemote: (
			root: string,
			op: "fetch" | "push" | "pull",
			options: {
				remote: string;
				branch?: string;
				setUpstream?: boolean;
				signal?: AbortSignal;
			},
			onLine?: (line: string) => void,
		): Promise<{ ok: boolean; stderr: string }> => {
			const backend = window.__TAURI__?.event;
			if (!backend) {
				return Promise.reject(new Error("tauri: event bridge unavailable"));
			}
			// Progress listener first: lines can stream as soon as the run
			// starts. Routing uses the client token (known before start
			// resolves), never the numeric id — a fast first line must not
			// land unroutable.
			const token = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`;
			let opId: number | null = null;
			return (async () => {
				const off = await backend.listen<TauriRemoteLineEvent>(
					"git-remote-line",
					(event) => {
						if (event.payload.client_token === token) {
							onLine?.(event.payload.line);
						}
					},
				);
				try {
					opId = await invoke<number>("git_remote_start", {
						root,
						op,
						remote: options.remote,
						branch: options.branch ?? null,
						setUpstream: options.setUpstream ?? false,
						clientToken: token,
					});
				} catch (error) {
					off();
					throw error instanceof Error ? error : new Error(String(error));
				}
				const signal = options.signal;
				if (signal?.aborted) {
					const id = opId;
					off();
					void invoke("git_remote_abort", { opId: id });
					return Promise.reject(new Error("remote op aborted"));
				}
				const outcome = invoke<TauriRemoteOutcome>("git_remote_result", {
					opId,
				});
				if (!signal) {
					return outcome
						.then((result) => {
							if (!result.ok) {
								throw new Error(result.stderr || "remote op failed");
							}
							return result;
						})
						.finally(() => {
							off();
						});
				}
				return new Promise<{ ok: boolean; stderr: string }>(
					(resolve, reject) => {
						const onAbort = (): void => {
							void invoke("git_remote_abort", { opId });
							reject(new Error("remote op aborted"));
						};
						signal.addEventListener("abort", onAbort, { once: true });
						outcome.then(
							(result) => {
								signal.removeEventListener("abort", onAbort);
								off();
								if (!result.ok) {
									reject(new Error(result.stderr || "remote op failed"));
								} else {
									resolve(result);
								}
							},
							(error: unknown) => {
								signal.removeEventListener("abort", onAbort);
								off();
								reject(
									error instanceof Error ? error : new Error(String(error)),
								);
							},
						);
					},
				);
			})();
		},
		stagePaths: (root: string, paths: string[]): Promise<void> =>
			invoke<void>("stage_paths", { root, paths }).then(() => undefined),
		unstagePaths: (root: string, paths: string[]): Promise<void> =>
			invoke<void>("unstage_paths", { root, paths }).then(() => undefined),
		applyIndexPatch: (root: string, patch: string): Promise<void> =>
			invoke<void>("apply_index_patch", { root, patch }).then(() => undefined),
		commit: (root: string, message: string): Promise<void> =>
			invoke<void>("commit", { root, message }).then(() => undefined),
	};
}
