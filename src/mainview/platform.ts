// Webview-side Platform: implements the same contract as the Bun platform, but
// every call crosses the Electrobun typed-RPC bridge to the main process.
// Streaming runs and fs events arrive as messages; because a bridge reply and
// the first message of a run may race, early packets are buffered per id and
// drained when the start response assigns it.

import Electrobun from "electrobun/view";
import type {
	FsEventBatch,
	GitRunOptions,
	GitRunResult,
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

async function runSelfTest(root: string): Promise<void> {
	try {
		const platform = getPlatform();
		const info = await platform.readRepo(root);
		let chunkCount = 0;
		let firstLine = "";
		const run = await platform.runGit(root, ["log", "--oneline", "-3"], {
			onStdout: (chunk) => {
				chunkCount += 1;
				if (!firstLine) {
					firstLine = new TextDecoder().decode(chunk).split("\n")[0];
				}
			},
		});
		const watcher = await platform.watchRepo(root, () => {});
		await watcher.stop();
		const ok = run.code === 0 && chunkCount > 0;
		const detail = `branch=${info.branch} head=${info.head.slice(0, 7)} logChunks=${chunkCount} exit=${run.code} first=${firstLine}`;
		notifySelfTestResult({ ok, detail });
	} catch (error) {
		notifySelfTestResult({ ok: false, detail: String(error) });
	}
}

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
				selfTestRun: ({ root }) => {
					void runSelfTest(root);
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
			new Promise<GitRunResult>((resolve) => {
				// The server runId attaches the buffered/remote state to this promise.
				const state: RunState = { resolve, opts: opts ?? {}, stderr: "" };
				void (async () => {
					const { runId } = await rpc.request.runGitStart({ root, args });
					attachRun(runId, state);
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
	};
}

const rpcPlatform = isElectrobun() ? createRpcPlatform() : null;

/** The single Platform instance the UI consumes; fake when not in Electrobun. */
export function getPlatform(): Platform {
	if (rpcPlatform) return rpcPlatform;
	return buildFakeFixture().platform;
}
