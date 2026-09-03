// Main process entry: window shell + the bun side of the platform RPC.
// Git is never spawned here directly — all calls delegate to the platform
// (src/bun/platform-bun.ts → git-spawn.ts), keeping the argv/cwd invariants in
// one place. The webview reaches this only through the typed RPC schema
// (src/shared/platform.ts).

import { BrowserView, BrowserWindow, Updater } from "electrobun/main";
import type { FsEventBatch, PlatformRPCSchema } from "../shared/platform";
import { createGitAdapter } from "./git-adapter";
import { createBunPlatform } from "./platform-bun";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

const platform = createBunPlatform();
const git = createGitAdapter();
let logSeq = 0;
const logRuns = new Map<number, AbortController>();

let mainWindow: BrowserWindow | null = null;
let watchSeq = 0;
const watchers = new Map<number, { stop: () => Promise<void> }>();
let runSeq = 0;
const runs = new Map<number, AbortController>();

function send<K extends keyof PlatformRPCSchema["webview"]["messages"]>(
	name: K,
	payload: PlatformRPCSchema["webview"]["messages"][K],
): void {
	// The typed rpc surface is on the window's webview; casts kept narrow until
	// upstream types expose send() non-optionally (matches upstream templates).
	const rpc = (
		mainWindow?.webview.rpc as unknown as {
			send?: Record<string, (payload: unknown) => void>;
		}
	)?.send;
	rpc?.[name]?.(payload);
}

const rpc = BrowserView.defineRPC<PlatformRPCSchema>({
	maxRequestTime: 30_000,
	handlers: {
		requests: {
			readRepo: ({ root }) => platform.readRepo(root),
			watchStart: ({ root }) => {
				const watchId = ++watchSeq;
				void platform
					.watchRepo(root, (batch: FsEventBatch) =>
						send("fsEvents", { watchId, batch }),
					)
					.then((watcher) => watchers.set(watchId, watcher));
				return { watchId };
			},
			watchStop: ({ watchId }) => {
				void watchers
					.get(watchId)
					?.stop()
					.then(() => watchers.delete(watchId));
				return { ok: true };
			},
			runGitStart: ({ root, args }) => {
				const runId = ++runSeq;
				const controller = new AbortController();
				runs.set(runId, controller);
				void platform
					.runGit(root, args, {
						signal: controller.signal,
						onStdout: (chunk) =>
							send("gitChunk", {
								runId,
								stream: "stdout",
								data: Buffer.from(chunk).toString("base64"),
							}),
						onStderr: (chunk) =>
							send("gitChunk", {
								runId,
								stream: "stderr",
								data: Buffer.from(chunk).toString("base64"),
							}),
					})
					.then((result) => {
						send("gitExit", {
							runId,
							code: result.code,
							signal: result.signal,
							stderr: result.stderr,
						});
						runs.delete(runId);
					});
				return { runId };
			},
			runGitAbort: ({ runId }) => {
				runs.get(runId)?.abort();
				return { ok: true };
			},
			gitStatus: ({ root }) => {
				try {
					// Adapter throws GitError on failure; bridge it into ok/error.
					return git
						.status(root)
						.then((status) => ({ ok: true as const, status }));
				} catch (error) {
					return Promise.resolve({ ok: false as const, error: String(error) });
				}
			},
			gitDiff: ({ root, from, to, staged }) => {
				try {
					return git
						.diff(root, { from, to, staged })
						.then((result) => ({ ok: true as const, result }));
				} catch (error) {
					return Promise.resolve({ ok: false as const, error: String(error) });
				}
			},
			gitLogStart: ({ root, limit, skip, range }) => {
				const logId = ++logSeq;
				const controller = new AbortController();
				logRuns.set(logId, controller);
				void git
					.feedLog(
						root,
						(commit) => send("gitLogCommit", { logId, commit }),
						{ limit, skip, range },
						{ signal: controller.signal },
					)
					.then(({ count }) => send("gitLogDone", { logId, ok: true, count }))
					.catch((error) =>
						send("gitLogDone", {
							logId,
							ok: false,
							count: 0,
							error: String(error),
						}),
					);
				return { logId };
			},
			gitLogAbort: ({ logId }) => {
				logRuns.get(logId)?.abort();
				return { ok: true };
			},
			gitWorktreePaths: ({ root }) => {
				try {
					return git
						.worktreePaths(root)
						.then((paths) => ({ ok: true as const, paths }));
				} catch (error) {
					return Promise.resolve({ ok: false as const, error: String(error) });
				}
			},
		},
		messages: {
			selfTestResult: ({ ok, detail }) => {
				console.log(`[SMOKE] ok=${ok} ${detail}`);
				if (process.env.SMOKE === "1") {
					// Automated proof run: settle, report via exit code, and close.
					setTimeout(() => process.exit(ok ? 0 : 1), 300);
				}
			},
		},
	},
});

async function getMainViewUrl(): Promise<string> {
	const channel = await Updater.localInfo.channel();
	if (channel === "dev") {
		try {
			await fetch(DEV_SERVER_URL, { method: "HEAD" });
			console.log(`HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`);
			return DEV_SERVER_URL;
		} catch {
			console.log(
				"Vite dev server not running. Run 'hutch run dev:hmr' for HMR support.",
			);
		}
	}
	return "views://mainview/index.html";
}

const url = await getMainViewUrl();

mainWindow = new BrowserWindow({
	title: "hmmagainagain",
	url,
	rpc,
	frame: {
		width: 900,
		height: 700,
		x: 200,
		y: 200,
	},
});

// SMOKE=1: drive the platform self-test through the real RPC bridge as soon as
// the webview is up, and report the result on stdout (RON-294 evidence).
// SMOKE_ROOT selects the repository (the extracted app's cwd is not a repo).
if (process.env.SMOKE === "1") {
	setTimeout(() => {
		console.log("[SMOKE] dispatching selfTestRun");
		send("selfTestRun", { root: process.env.SMOKE_ROOT ?? process.cwd() });
	}, 5000);
}

console.log("hmmagainagain started!");
