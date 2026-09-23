// Tests for the Tauri bridge (RON-400, M1). window.__TAURI__ is stubbed:
// invoke answers from fixtures so parsing + arg mapping are proven without
// a webview. The Rust side is covered by cargo tests in git.rs.

import { describe, expect, test } from "bun:test";
import { createTauriPlatform, isTauri } from "./platform-tauri";

const calls: { command: string; args?: Record<string, unknown> }[] = [];

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
						case "git_diff":
							return Promise.resolve(PATCH);
						case "git_worktree_paths":
							return Promise.resolve("b.txt\0a.txt\0");
						default:
							return Promise.reject(new Error(`unexpected: ${command}`));
					}
				},
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
		expect(calls.at(-1)?.args).toMatchObject({ staged: true });
		expect(diff.patch).toBe(PATCH);
		expect(diff.files.map((f) => f.path)).toEqual(["f.txt"]);
		expect(diff.files[0]).toMatchObject({ additions: 1, deletions: 1 });

		const paths = await platform.gitWorktreePaths("/r");
		expect(paths).toEqual(["a.txt", "b.txt"]);
	});

	test("unowned units reject with a pointer", async () => {
		stubBridge();
		const platform = createTauriPlatform();
		await expect(platform.gitLog("/r", {}, () => {})).rejects.toThrow(
			/later migration unit/,
		);
		await expect(platform.commit("/r", "x")).rejects.toThrow(
			/later migration unit/,
		);
	});
});
