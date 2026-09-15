// Main process entry: window shell + the bun side of the platform RPC.
// Git is never spawned here directly — all calls delegate to the platform
// (src/bun/platform-bun.ts → git-spawn.ts), keeping the argv/cwd invariants in
// one place. The webview reaches this only through the typed RPC schema
// (src/shared/platform.ts).

import { BrowserView, BrowserWindow, Updater } from "electrobun/main";
import type { FsEventBatch, PlatformRPCSchema } from "../shared/platform";
import { createGitAdapter, GitError } from "./git-adapter";
import { createBunPlatform } from "./platform-bun";

// U8b cold-start proxy: wall-clock origin for the startup markers below
// ("started!" log and the webview first-frame marker share Date.now).
const STARTUP_T0 = Date.now();

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

const platform = createBunPlatform();
const git = createGitAdapter();
let logSeq = 0;
const logRuns = new Map<number, AbortController>();
let remoteOpSeq = 0;
const remoteOps = new Map<number, AbortController>();

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
			readRepo: ({ root }) => {
				console.log("[DBG] readRepo handler reached");
				return platform.readRepo(root);
			},
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
				console.log("[DBG] gitStatus handler reached");
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
					// Adapter throws GitError on failure; bridge it into ok/error.
					const startedAt = Date.now();
					return git
						.diff(root, { from, to, staged })
						.then((result) => {
							if (process.env.SMOKE === "1") {
								// Budget evidence: adapter-side diff+transfer cost.
								console.log(
									`[SMOKE] gitDiff adapter ${Date.now() - startedAt}ms files=${result.files.length} bytes=${result.patch.length}`,
								);
							}
							return { ok: true as const, result };
						})
						.catch((error: unknown) => ({
							ok: false as const,
							error: String(error),
						}));
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
			gitBranches: ({ root }) => {
				try {
					return git
						.branches(root)
						.then((branches) => ({ ok: true as const, branches }));
				} catch (error) {
					return Promise.resolve({ ok: false as const, error: String(error) });
				}
			},
			gitCreateBranch: ({ root, name, switchTo }) => {
				try {
					return git
						.createBranch(root, name, { switchTo })
						.then(() => ({ ok: true as const }));
				} catch (error) {
					return Promise.resolve({ ok: false as const, error: String(error) });
				}
			},
			gitSwitchBranch: ({ root, name }) => {
				try {
					return git
						.switchBranch(root, name)
						.then(() => ({ ok: true as const }));
				} catch (error) {
					return Promise.resolve({ ok: false as const, error: String(error) });
				}
			},
			gitRemoteStart: ({ root, op, remote, branch, setUpstream }) => {
				const opId = ++remoteOpSeq;
				const controller = new AbortController();
				remoteOps.set(opId, controller);
				void platform
					.gitRemote(
						root,
						op,
						{ remote, branch, setUpstream, signal: controller.signal },
						(line) => send("gitRemoteLine", { opId, line }),
					)
					.then(() => send("gitRemoteDone", { opId, ok: true, stderr: "" }))
					.catch((error) =>
						send("gitRemoteDone", { opId, ok: false, stderr: String(error) }),
					)
					.finally(() => {
						remoteOps.delete(opId);
					});
				return { opId };
			},
			gitRemoteAbort: ({ opId }) => {
				remoteOps.get(opId)?.abort();
				return { ok: true };
			},
			// Write paths (U5): ok=false carries git's stderr verbatim so the
			// webview can display hook failures as-is.
			stagePaths: ({ root, paths }) => {
				return git
					.stagePaths(root, paths)
					.then(() => ({ ok: true as const }))
					.catch((error: unknown) => ({
						ok: false as const,
						error: error instanceof GitError ? error.stderr : String(error),
					}));
			},
			unstagePaths: ({ root, paths }) => {
				return git
					.unstagePaths(root, paths)
					.then(() => ({ ok: true as const }))
					.catch((error: unknown) => ({
						ok: false as const,
						error: error instanceof GitError ? error.stderr : String(error),
					}));
			},
			applyIndexPatch: ({ root, patch }) => {
				return git
					.applyIndexPatch(root, patch)
					.then(() => ({ ok: true as const }))
					.catch((error: unknown) => ({
						ok: false as const,
						error: error instanceof GitError ? error.stderr : String(error),
					}));
			},
			commit: ({ root, message }) => {
				return git
					.commit(root, message)
					.then(() => ({ ok: true as const }))
					.catch((error: unknown) => ({
						ok: false as const,
						error: error instanceof GitError ? error.stderr : String(error),
					}));
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
		send("selfTestRun", {
			root: process.env.SMOKE_ROOT ?? process.cwd(),
			// SMOKE_STAGE=1 adds the staging/commit flow — ONLY ever point
			// SMOKE_ROOT at a throwaway fixture when staging/committing.
			stage: process.env.SMOKE_STAGE === "1",
			branch: process.env.SMOKE_BRANCH === "1",
		});
	}, 5000);
}

const STARTUP_WALL = Date.now();
console.log(
	`hmmagainagain started! wall=${STARTUP_WALL} +${STARTUP_WALL - STARTUP_T0}ms`,
);
