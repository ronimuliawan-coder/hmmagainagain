// Tests for the Tauri bridge (RON-400, M1). window.__TAURI__ is stubbed:
// invoke answers from fixtures so parsing + arg mapping are proven without
// a webview. The Rust side is covered by cargo tests in git.rs.

import { describe, expect, test } from "bun:test";
import { createTauriPlatform, isTauri } from "./platform-tauri";

const calls: { command: string; args?: Record<string, unknown> }[] = [];
let remoteFail = false;

const PORCELAIN =
	[
		"# branch.oid abc123",
		"# branch.head main",
		"1 M. N... 100644 100644 100644 abc def f.txt",
	].join("\0") + "\0";

const PATCH = [
	"diff --git a/f.txt b/f.txt",
	"index 1111111..2222222 100644",
	"--- a/f.txt",
	"+++ b/f.txt",
	"@@ -1 +1 @@",
	"-old",
	"+new",
	"",
].join("\n");

function stubBridge(): void {
	const g = globalThis as unknown as {
		window?: { __TAURI__?: unknown };
	};
	let nextId = 1;
	const live = new Set<number>();
	const listeners = new Map<
		string,
		((payload: { payload: unknown }) => void)[]
	>();
	const emit = (event: string, payload: unknown): void => {
		for (const handler of listeners.get(event) ?? []) handler({ payload });
	};
	g.window = {
		__TAURI__: {
			core: {
				invoke: (command: string, args?: Record<string, unknown>) => {
					calls.push({ command, args });
					switch (command) {
						case "read_repo":
							return Promise.resolve({ branch: "main", head: "abc123" });
						case "git_status":
							return Promise.resolve(PORCELAIN);
						case "git_diff_start": {
							const id = nextId++;
							live.add(id);
							return Promise.resolve(id);
						}
						case "git_diff_result": {
							const id = args?.id as number;
							if (!live.delete(id)) {
								return Promise.reject(new Error("unknown or aborted diff"));
							}
							return Promise.resolve(PATCH);
						}
						case "git_diff_abort": {
							live.delete(args?.id as number);
							return Promise.resolve(undefined);
						}
						case "git_log_stream": {
							const runId = args?.runId as string;
							emit("git-log-commit", {
								run_id: runId,
								commit: {
									oid: "o1",
									shortOid: "o1",
									authorName: "A",
									authorEmail: "a@x",
									date: "2026-01-01T00:00:00Z",
									subject: "one",
									refs: "HEAD -> main",
								},
							});
							emit("git-log-commit", {
								run_id: runId,
								commit: {
									oid: "o2",
									shortOid: "o2",
									authorName: "A",
									authorEmail: "a@x",
									date: "2026-01-01T00:00:00Z",
									subject: "two",
									refs: "",
								},
							});
							emit("git-log-done", { run_id: runId, count: 2 });
							return Promise.resolve(2);
						}
						case "git_branches":
							return Promise.resolve([
								{ name: "main", oid: "o1", current: true },
							]);
						case "git_create_branch":
						case "git_switch_branch":
						case "stage_paths":
						case "unstage_paths":
						case "apply_index_patch":
						case "commit":
							return Promise.resolve(undefined);
						case "git_remote_start": {
							const id = nextId++;
							emit("git-remote-line", {
								op_id: id,
								client_token: args?.clientToken,
								line: "fetching\n",
							});
							return Promise.resolve(id);
						}
						case "git_remote_result": {
							if (remoteFail) {
								return Promise.resolve({ ok: false, stderr: "nope" });
							}
							return Promise.resolve({ ok: true, stderr: "done" });
						}
						case "git_remote_abort":
							return Promise.resolve(undefined);
						case "watch_start": {
							const watchId = args?.watchId as string;
							emit("fs-events", { watch_id: watchId, paths: ["a.txt"] });
							return Promise.resolve(undefined);
						}
						case "watch_stop":
							return Promise.resolve(undefined);
						case "plugin:dialog|open":
							return Promise.resolve({ Folder: "/picked" });
						case "git_worktree_paths":
							return Promise.resolve("b.txt\0a.txt\0");
						default:
							return Promise.reject(new Error(`unexpected: ${command}`));
					}
				},
			},
			event: {
				// Registrations settle asynchronously (like Tauri's IPC):
				// the bridge must await them before invoking, or a short
				// stream's done event lands with nobody listening.
				listen: (
					event: string,
					handler: (payload: { payload: unknown }) => void,
				) =>
					new Promise<() => void>((resolve) => {
						setTimeout(() => {
							const list = listeners.get(event) ?? [];
							list.push(handler);
							listeners.set(event, list);
							resolve(() => {
								listeners.set(
									event,
									(listeners.get(event) ?? []).filter((h) => h !== handler),
								);
							});
						}, 10);
					}),
			},
		},
	};
}

describe("platform-tauri (M1 bridge)", () => {
	test("detects the bridge and reads a repo", async () => {
		stubBridge();
		calls.length = 0;
		expect(isTauri()).toBe(true);
		const platform = createTauriPlatform();
		expect(platform.kind).toBe("tauri");
		const info = await platform.readRepo("/r");
		expect(info).toEqual({
			root: "/r",
			isRepo: true,
			branch: "main",
			head: "abc123",
		});
		expect(calls[0]).toEqual({ command: "read_repo", args: { root: "/r" } });
	});

	test("parses status and maps diff options", async () => {
		stubBridge();
		calls.length = 0;
		const platform = createTauriPlatform();
		const status = await platform.gitStatus("/r");
		expect(status.entries.map((e) => e.path)).toEqual(["f.txt"]);
		expect(status.entries[0]).toMatchObject({
			indexStatus: "M",
			worktreeStatus: ".",
		});

		const diff = await platform.gitDiff("/r", { staged: true });
		expect(
			calls.find((c) => c.command === "git_diff_start")?.args,
		).toMatchObject({ staged: true });
		expect(diff.patch).toBe(PATCH);
		expect(diff.files.map((f) => f.path)).toEqual(["f.txt"]);
		expect(diff.files[0]).toMatchObject({ additions: 1, deletions: 1 });

		const paths = await platform.gitWorktreePaths("/r");
		expect(paths).toEqual(["a.txt", "b.txt"]);
	});

	test("aborting the signal kills the run and rejects", async () => {
		stubBridge();
		calls.length = 0;
		const platform = createTauriPlatform();
		const controller = new AbortController();
		const pending = platform.gitDiff("/r", { signal: controller.signal });
		// NOTE: the rejects assertion must be created after the abort —
		// bun:test hangs when expect().rejects is attached to a promise
		// that settles later (reproduced on bare promises, 1.4.2).
		controller.abort();
		await expect(pending).rejects.toThrow("diff aborted");
		expect(calls.some((c) => c.command === "git_diff_abort")).toBe(true);
		await expect(platform.gitDiff("/r")).resolves.toMatchObject({
			patch: PATCH,
		});
	});

	test("streams history and maps branch ops", async () => {
		stubBridge();
		calls.length = 0;
		const platform = createTauriPlatform();
		const subjects: string[] = [];
		const result = await platform.gitLog(
			"/r",
			{ limit: 50, skip: 0 },
			(commit) => subjects.push(commit.subject),
		);
		expect(result).toEqual({ count: 2 });
		expect(subjects).toEqual(["one", "two"]);
		expect(
			calls.find((c) => c.command === "git_log_stream")?.args,
		).toMatchObject({ root: "/r", limit: 50, skip: 0 });

		const branches = await platform.gitBranches("/r");
		expect(branches).toEqual([{ name: "main", oid: "o1", current: true }]);

		await platform.gitCreateBranch("/r", "feature", true);
		expect(
			calls.find((c) => c.command === "git_create_branch")?.args,
		).toMatchObject({ root: "/r", name: "feature", switchTo: true });
		await platform.gitSwitchBranch("/r", "main");
		expect(
			calls.find((c) => c.command === "git_switch_branch")?.args,
		).toMatchObject({ root: "/r", name: "main" });
	});

	test("streams remote progress and maps watch + picker", async () => {
		stubBridge();
		calls.length = 0;
		remoteFail = false;
		const platform = createTauriPlatform();
		const lines: string[] = [];
		const result = await platform.gitRemote(
			"/r",
			"fetch",
			{ remote: "origin" },
			(line) => lines.push(line),
		);
		expect(result).toEqual({ ok: true, stderr: "done" });
		expect(lines).toEqual(["fetching\n"]);
		expect(
			calls.find((c) => c.command === "git_remote_start")?.args,
		).toMatchObject({ root: "/r", op: "fetch", remote: "origin" });

		remoteFail = true;
		try {
			await expect(
				platform.gitRemote("/r", "push", { remote: "origin" }),
			).rejects.toThrow("nope");
		} finally {
			remoteFail = false;
		}

		const batches: string[][] = [];
		const watcher = await platform.watchRepo("/r", (batch) =>
			batches.push(batch.paths),
		);
		expect(batches).toEqual([["a.txt"]]);
		expect(calls.find((c) => c.command === "watch_start")?.args).toMatchObject({
			root: "/r",
		});
		await watcher.stop();
		expect(calls.some((c) => c.command === "watch_stop")).toBe(true);

		await expect(platform.pickDirectory()).resolves.toBe("/picked");
	});

	test("unowned units reject with a pointer", async () => {
		stubBridge();
		const platform = createTauriPlatform();
		// gitRemote graduated to owned in M4; runGit stays unowned until M6.
		await expect(platform.runGit("/r", ["status"])).rejects.toThrow(
			/later migration unit/,
		);
		await expect(platform.runGit("/r", ["status"])).rejects.toThrow(
			/later migration unit/,
		);
	});

	test("maps write ops to commands", async () => {
		stubBridge();
		calls.length = 0;
		const platform = createTauriPlatform();
		await platform.stagePaths("/r", ["a.txt"]);
		await platform.unstagePaths("/r", ["a.txt"]);
		await platform.applyIndexPatch("/r", "patch");
		await platform.commit("/r", "msg");
		expect(calls.map((c) => c.command)).toEqual([
			"stage_paths",
			"unstage_paths",
			"apply_index_patch",
			"commit",
		]);
		expect(calls[0].args).toMatchObject({ root: "/r", paths: ["a.txt"] });
		expect(calls[2].args).toMatchObject({ root: "/r", patch: "patch" });
		expect(calls[3].args).toMatchObject({ root: "/r", message: "msg" });
	});
});
