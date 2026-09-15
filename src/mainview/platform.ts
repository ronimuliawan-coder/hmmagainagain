// Webview-side Platform: implements the same contract as the Bun platform, but
// every call crosses the Electrobun typed-RPC bridge to the main process.
// Streaming runs and fs events arrive as messages; because a bridge reply and
// the first message of a run may race, early packets are buffered per id and
// drained when the start response assigns it.

import Electrobun from "electrobun/view";
import type {
	FsEventBatch,
	GitDiffOptions,
	GitRunOptions,
	GitRunResult,
	LogCommit,
	Platform,
	PlatformRPCSchema,
	RepoInfo,
} from "../shared/platform";
import { buildFakeFixture } from "../shared/platform-fake";

export const isElectrobun = (): boolean =>
	typeof window !== "undefined" &&
	typeof window.__electrobunWebviewId === "number";

const b64decode = (data: string): Uint8Array =>
	Uint8Array.from(atob(data), (c) => c.charCodeAt(0));

interface RunState {
	resolve: (result: GitRunResult) => void;
	opts: GitRunOptions;
	stderr: string;
}

interface ChunkMsg {
	runId: number;
	stream: "stdout" | "stderr";
	data: string;
}

interface ExitMsg {
	runId: number;
	code: number | null;
	signal: string | null;
	stderr: string;
}

const watchers = new Map<number, (batch: FsEventBatch) => void>();
const pendingFsEvents = new Map<number, FsEventBatch[]>();
const runs = new Map<number, RunState>();
const pendingChunks = new Map<number, ChunkMsg[]>();
const pendingExits = new Map<number, ExitMsg>();
const logListeners = new Map<
	number,
	{
		onCommit: (commit: LogCommit) => void;
		resolve: (result: { count: number }) => void;
		reject: (error: Error) => void;
	}
>();
const pendingLogCommits = new Map<number, LogCommit[]>();
const logDone = new Map<
	number,
	{
		ok: boolean;
		count: number;
		error?: string;
		resolve: (r: { count: number }) => void;
		reject: (e: Error) => void;
	}
>();
const remoteListeners = new Map<number, { onLine: (line: string) => void }>();
const remoteDone = new Map<
	number,
	{
		ok: boolean;
		stderr: string;
		resolve: (r: { ok: boolean; stderr: string }) => void;
		reject: (e: Error) => void;
	}
>();
/** Early done packets, keyed by id (U7a residual, CodeRabbit U0–U8 review):
 * a done packet may beat its start response; buffer and drain on attach,
 * mirroring pendingExits. */
const pendingLogDone = new Map<
	number,
	{ ok: boolean; count: number; error?: string }
>();
const pendingRemoteDone = new Map<number, { ok: boolean; stderr: string }>();
/** Abort-listener cleanups, keyed by op id (U7b). */
const remoteAbortCleanups = new Map<number, () => void>();

function deliver(
	run: RunState,
	stream: "stdout" | "stderr",
	data: string,
): void {
	const bytes = b64decode(data);
	if (stream === "stdout") {
		run.opts.onStdout?.(bytes);
	} else {
		run.opts.onStderr?.(bytes);
		run.stderr += new TextDecoder().decode(bytes);
	}
}

function attachRun(runId: number, state: RunState): void {
	runs.set(runId, state);
	const early = pendingChunks.get(runId);
	if (early) {
		for (const c of early) deliver(state, c.stream, c.data);
		pendingChunks.delete(runId);
	}
	const exit = pendingExits.get(runId);
	if (exit) {
		pendingExits.delete(runId);
		state.resolve({
			code: exit.code,
			signal: exit.signal,
			stderr: exit.stderr || state.stderr,
		});
		runs.delete(runId);
	}
}

let notifySelfTestResult: (payload: { ok: boolean; detail: string }) => void =
	() => {};

type RpcInstance = ReturnType<
	typeof Electrobun.Electroview.defineRPC<PlatformRPCSchema>
>;
let rpcInstance: RpcInstance | null = null;

function ensureRpc(): RpcInstance {
	if (rpcInstance) return rpcInstance;
	rpcInstance = Electrobun.Electroview.defineRPC<PlatformRPCSchema>({
		maxRequestTime: 30_000,
		handlers: {
			requests: {},
			messages: {
				fsEvents: ({ watchId, batch }) => {
					const listener = watchers.get(watchId);
					if (listener) {
						listener(batch);
					} else {
						const list = pendingFsEvents.get(watchId) ?? [];
						list.push(batch);
						pendingFsEvents.set(watchId, list);
					}
				},
				gitChunk: (msg) => {
					const run = runs.get(msg.runId);
					if (run) {
						deliver(run, msg.stream, msg.data);
					} else {
						const list = pendingChunks.get(msg.runId) ?? [];
						list.push(msg);
						pendingChunks.set(msg.runId, list);
					}
				},
				gitExit: (msg) => {
					const run = runs.get(msg.runId);
					if (!run) {
						pendingExits.set(msg.runId, msg);
						return;
					}
					runs.delete(msg.runId);
					run.resolve({
						code: msg.code,
						signal: msg.signal,
						stderr: msg.stderr || run.stderr,
					});
				},
				gitLogCommit: (msg) => {
					const listener = logListeners.get(msg.logId);
					if (listener) {
						listener.onCommit(msg.commit);
					} else {
						const list = pendingLogCommits.get(msg.logId) ?? [];
						list.push(msg.commit);
						pendingLogCommits.set(msg.logId, list);
					}
				},
				gitLogDone: (msg) => {
					const pending = logDone.get(msg.logId);
					if (!pending) {
						pendingLogDone.set(msg.logId, msg);
						return;
					}
					logDone.delete(msg.logId);
					logListeners.delete(msg.logId);
					if (msg.ok) pending.resolve({ count: msg.count });
					else pending.reject(new Error(msg.error ?? "git log failed"));
				},
				gitRemoteLine: (msg) => {
					const listener = remoteListeners.get(msg.opId);
					if (listener) listener.onLine(msg.line);
				},
				gitRemoteDone: (msg) => {
					const pending = remoteDone.get(msg.opId);
					if (!pending) {
						pendingRemoteDone.set(msg.opId, msg);
						return;
					}
					remoteDone.delete(msg.opId);
					remoteListeners.delete(msg.opId);
					remoteAbortCleanups.get(msg.opId)?.();
					remoteAbortCleanups.delete(msg.opId);
					if (msg.ok) {
						pending.resolve({ ok: true, stderr: msg.stderr });
					} else {
						pending.reject(new Error(msg.stderr || "remote op failed"));
					}
				},
				selfTestRun: ({ root, stage, branch }) => {
					// The self-test itself is DOM-driven and lives in main.ts; the
					// message bridge hands off via the window event it listens for.
					window.dispatchEvent(
						new CustomEvent("hmmagainagain:self-test", {
							detail: { root, stage, branch },
						}),
					);
				},
			},
		},
	});
	// Constructing the Electroview connects the webview transport — without it
	// the RPC bridge never handshakes and no events flow (upstream pattern).
	notifySelfTestResult = (payload) => {
		rpcInstance?.send.selfTestResult(payload);
	};
	new Electrobun.Electroview({ rpc: rpcInstance });
	return rpcInstance;
}

function createRpcPlatform(): Platform {
	const rpc = ensureRpc();
	return {
		kind: "rpc",
		readRepo: (root: string): Promise<RepoInfo> =>
			rpc.request.readRepo({ root }),

		runGit: (
			root: string,
			args: string[],
			opts?: GitRunOptions,
		): Promise<GitRunResult> =>
			new Promise<GitRunResult>((resolve, reject) => {
				// The server runId attaches the buffered/remote state to this promise.
				const state: RunState = { resolve, opts: opts ?? {}, stderr: "" };
				void (async () => {
					try {
						const { runId } = await rpc.request.runGitStart({ root, args });
						attachRun(runId, state);
					} catch (error) {
						// A rejected start (timeout, transport, main-side throw)
						// must settle this promise, not hang it (CodeRabbit
						// U0–U8 review).
						reject(error instanceof Error ? error : new Error(String(error)));
					}
				})();
			}),

		watchRepo: (root: string, onEvents: (batch: FsEventBatch) => void) =>
			(async () => {
				const { watchId } = await rpc.request.watchStart({ root });
				const early = pendingFsEvents.get(watchId);
				if (early) {
					for (const batch of early) onEvents(batch);
					pendingFsEvents.delete(watchId);
				}
				watchers.set(watchId, onEvents);
				return {
					stop: async () => {
						watchers.delete(watchId);
						await rpc.request.watchStop({ watchId });
					},
				};
			})(),

		gitStatus: (root: string) =>
			rpc.request.gitStatus({ root }).then((r) => {
				if (!r.ok || !r.status) throw new Error(r.error ?? "gitStatus failed");
				return r.status;
			}),

		gitDiff: (root: string, options?: GitDiffOptions) =>
			rpc.request.gitDiff({ root, ...options }).then((r) => {
				if (!r.ok || !r.result) throw new Error(r.error ?? "gitDiff failed");
				return r.result;
			}),

		gitWorktreePaths: (root: string) =>
			rpc.request.gitWorktreePaths({ root }).then((r) => {
				if (!r.ok || !r.paths)
					throw new Error(r.error ?? "gitWorktreePaths failed");
				return r.paths;
			}),

		gitLog: (root, options, onCommit) =>
			new Promise<{ count: number }>((resolve, reject) => {
				void (async () => {
					try {
						const { logId } = await rpc.request.gitLogStart({
							root,
							limit: options?.limit,
							skip: options?.skip,
							range: options?.range,
						});
						// Attach after the start response; early commits buffer by id.
						const early = pendingLogCommits.get(logId);
						if (early) {
							for (const commit of early) onCommit(commit);
							pendingLogCommits.delete(logId);
						}
						logListeners.set(logId, { onCommit, resolve, reject });
						// Same defect class as U7a: the done handler reads logDone, so
						// the settler must be registered there — otherwise only rows
						// stream and the history promise never settles (Older-button
						// state never updates). A done packet that beat the start
						// response waits in pendingLogDone and drains here.
						logDone.set(logId, { ok: false, count: 0, resolve, reject });
						// Drain a done packet that beat the start response.
						const earlyDone = pendingLogDone.get(logId);
						if (earlyDone) {
							pendingLogDone.delete(logId);
							logDone.delete(logId);
							logListeners.delete(logId);
							if (earlyDone.ok) resolve({ count: earlyDone.count });
							else reject(new Error(earlyDone.error ?? "git log failed"));
						}
					} catch (error) {
						// A rejected start must settle this promise, not hang it.
						reject(error instanceof Error ? error : new Error(String(error)));
					}
				})();
			}),

		gitBranches: (root: string) =>
			rpc.request.gitBranches({ root }).then((r) => {
				if (!r.ok || !r.branches)
					throw new Error(r.error ?? "gitBranches failed");
				return r.branches;
			}),

		gitCreateBranch: (root: string, name: string, switchTo?: boolean) =>
			rpc.request.gitCreateBranch({ root, name, switchTo }).then((r) => {
				if (!r.ok) throw new Error(r.error ?? "gitCreateBranch failed");
			}),

		gitSwitchBranch: (root: string, name: string) =>
			rpc.request.gitSwitchBranch({ root, name }).then((r) => {
				if (!r.ok) throw new Error(r.error ?? "gitSwitchBranch failed");
			}),

		gitRemote: (root, op, options, onLine) =>
			new Promise<{ ok: boolean; stderr: string }>((resolve, reject) => {
				void (async () => {
					try {
						const { opId } = await rpc.request.gitRemoteStart({
							root,
							op,
							remote: options.remote,
							branch: options.branch,
							setUpstream: options.setUpstream,
						});
						remoteListeners.set(opId, { onLine: onLine ?? (() => {}) });
						// Register the settler in the map the done handler reads —
						// without this the packet is dropped and this promise hangs
						// forever (U7a). A done packet that beat the start response
						// waits in pendingRemoteDone and drains here.
						remoteDone.set(opId, { ok: false, stderr: "", resolve, reject });
						const earlyDone = pendingRemoteDone.get(opId);
						if (earlyDone) {
							pendingRemoteDone.delete(opId);
							remoteDone.delete(opId);
							remoteListeners.delete(opId);
							if (earlyDone.ok) resolve({ ok: true, stderr: earlyDone.stderr });
							else reject(new Error(earlyDone.stderr || "remote op failed"));
						}
						// Cancellation (U7b): forward the caller's abort to the
						// server, which kills the child via its own controller.
						if (options.signal) {
							const signal = options.signal;
							const onAbort = () => {
								remoteAbortCleanups.delete(opId);
								void rpc.request.gitRemoteAbort({ opId });
							};
							if (signal.aborted) {
								onAbort();
							} else {
								remoteAbortCleanups.set(opId, () =>
									signal.removeEventListener("abort", onAbort),
								);
								signal.addEventListener("abort", onAbort, { once: true });
							}
						}
					} catch (error) {
						// A rejected start must settle this promise: without it
						// runRemote's finally never runs and the remote buttons
						// stay disabled until reload.
						reject(error instanceof Error ? error : new Error(String(error)));
					}
				})();
			}),

		stagePaths: (root: string, paths: string[]) =>
			rpc.request.stagePaths({ root, paths }).then((r) => {
				if (!r.ok) throw new Error(r.error ?? "stagePaths failed");
			}),

		unstagePaths: (root: string, paths: string[]) =>
			rpc.request.unstagePaths({ root, paths }).then((r) => {
				if (!r.ok) throw new Error(r.error ?? "unstagePaths failed");
			}),

		applyIndexPatch: (root: string, patch: string) =>
			rpc.request.applyIndexPatch({ root, patch }).then((r) => {
				if (!r.ok) throw new Error(r.error ?? "applyIndexPatch failed");
			}),

		commit: (root: string, message: string) =>
			rpc.request.commit({ root, message }).then((r) => {
				if (!r.ok) throw new Error(r.error ?? "commit failed");
			}),
	};
}

/** SMOKE=1: main.ts listens for this event and reports via sendSelfTestResult. */
export function sendSelfTestResult(payload: {
	ok: boolean;
	detail: string;
}): void {
	notifySelfTestResult(payload);
}

let platformLoadError: string | null = null;
const rpcPlatform = (() => {
	try {
		return isElectrobun() ? createRpcPlatform() : null;
	} catch (error) {
		// A failed RPC setup must not die silently — surface it via the
		// SMOKE self-test and the fake fallback.
		platformLoadError = String(error);
		return null;
	}
})();

/** Non-null when the Electrobun RPC platform failed to initialize. */
export function getPlatformLoadError(): string | null {
	return platformLoadError;
}

/** The single Platform instance the UI consumes; fake when not in Electrobun. */
export function getPlatform(): Platform {
	if (rpcPlatform) return rpcPlatform;
	return buildFakeFixture().platform;
}
