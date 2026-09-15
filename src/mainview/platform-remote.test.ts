// Regression proof for the U7a settling bug: webview `gitRemote` must settle
// when its `gitRemoteDone` packet arrives. Before the fix the executor never
// inserted {resolve, reject} into `remoteDone`, so the done handler dropped the
// packet and the returned promise hung forever (UI stuck at "<op> …").
//
// Pattern mirrors file-tree-wrapper.test.ts: browser globals + module mock are
// installed before the module under test is imported.

import { describe, expect, mock, test } from "bun:test";

type MsgHandler = (msg: Record<string, unknown>) => void;

const harness = {
	messages: {} as Record<string, MsgHandler>,
	nextOpId: 0,
	nextLogId: 0,
	abortCalls: [] as number[],
	/** When set, start requests wait for this gate (early-packet tests). */
	startGate: null as Promise<void> | null,
	/** When true, the next start request rejects (start-failure tests). */
	failNextStart: false,
};

// Function object: `new`-able for `new Electrobun.Electroview(...)` in
// ensureRpc, with defineRPC attached as a static (avoids noStaticOnlyClass).
const FakeElectroview = Object.assign(
	function FakeElectroview(_opts: unknown) {},
	{
		defineRPC(config: { handlers: { messages: Record<string, MsgHandler> } }) {
			harness.messages = config.handlers.messages;
			return {
				request: {
					gitRemoteStart: async () => {
						if (harness.failNextStart) {
							harness.failNextStart = false;
							throw new Error("transport down");
						}
						const opId = ++harness.nextOpId;
						await harness.startGate;
						return { opId };
					},
					gitRemoteAbort: async (params: { opId: number }) => {
						harness.abortCalls.push(params.opId);
						return { ok: true };
					},
					gitLogStart: async () => ({ logId: ++harness.nextLogId }),
				},
				send: {},
			};
		},
	},
);

mock.module("electrobun/view", () => ({
	default: { Electroview: FakeElectroview },
}));

// isElectrobun() requires a window with a numeric __electrobunWebviewId.
(globalThis as unknown as { window: unknown }).window = {
	__electrobunWebviewId: 1,
};

const { getPlatform } = await import("./platform");

/** Settles only via timeout — a never-settling promise fails the test fast
 * instead of hanging the suite. Generous margin: post-fix settles in
 * microtasks; pre-fix never settles, so any timeout fails deterministically. */
function withHangGuard<T>(promise: Promise<T>, label: string): Promise<T> {
	const hang = new Promise<never>((_resolve, reject) => {
		setTimeout(
			() => reject(new Error(`timed out waiting for ${label} to settle`)),
			2000,
		);
	});
	return Promise.race([promise, hang]);
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe("rpc platform gitRemote settling (U7a)", () => {
	test("resolves when gitRemoteDone arrives after the start response", async () => {
		const platform = getPlatform();
		const pending = platform.gitRemote("root", "fetch", { remote: "origin" });
		await flush();
		const opId = harness.nextOpId;
		expect(opId).toBeGreaterThan(0);
		harness.messages.gitRemoteDone({ opId, ok: true, stderr: "done" });
		await expect(withHangGuard(pending, "gitRemote")).resolves.toEqual({
			ok: true,
			stderr: "done",
		});
	});

	test("rejects with verbatim stderr when the op fails", async () => {
		const platform = getPlatform();
		const pending = platform.gitRemote("root", "push", {
			remote: "origin",
			branch: "main",
		});
		await flush();
		harness.messages.gitRemoteDone({
			opId: harness.nextOpId,
			ok: false,
			stderr: "fatal: Authentication failed",
		});
		await expect(withHangGuard(pending, "gitRemote")).rejects.toThrow(
			"fatal: Authentication failed",
		);
	});

	test("progress lines reach onLine before done", async () => {
		const platform = getPlatform();
		const lines: string[] = [];
		const pending = platform.gitRemote(
			"root",
			"fetch",
			{ remote: "origin" },
			(line) => lines.push(line),
		);
		await flush();
		const opId = harness.nextOpId;
		harness.messages.gitRemoteLine({ opId, line: "remote: counting\n" });
		harness.messages.gitRemoteDone({ opId, ok: true, stderr: "" });
		await expect(withHangGuard(pending, "gitRemote")).resolves.toEqual({
			ok: true,
			stderr: "",
		});
		expect(lines).toEqual(["remote: counting\n"]);
	});

	test("aborting the passed signal requests gitRemoteAbort (U7b)", async () => {
		const platform = getPlatform();
		const controller = new AbortController();
		const pending = platform.gitRemote(
			"root",
			"pull",
			{ remote: "origin", signal: controller.signal },
			() => {},
		);
		// Swallow the settlement: this test observes the abort request only;
		// the done packet arrives below.
		void pending.catch(() => {});
		await flush();
		const opId = harness.nextOpId;
		controller.abort();
		await flush();
		expect(harness.abortCalls).toContain(opId);
		harness.messages.gitRemoteDone({ opId, ok: false, stderr: "killed" });
		await flush();
	});

	test("sibling class: gitLog settles when gitLogDone arrives", async () => {
		// Same defect shape as U7a lived in the U6 history path: the done
		// handler reads logDone, so the executor must register the settler
		// there or only rows stream and the promise never settles.
		const platform = getPlatform();
		const seen: unknown[] = [];
		const pending = platform.gitLog("root", { limit: 50 }, (commit) => {
			seen.push(commit);
		});
		await flush();
		const logId = harness.nextLogId;
		expect(logId).toBeGreaterThan(0);
		harness.messages.gitLogCommit({ logId, commit: { oid: "a" } });
		harness.messages.gitLogCommit({ logId, commit: { oid: "b" } });
		harness.messages.gitLogDone({ logId, ok: true, count: 2 });
		await expect(withHangGuard(pending, "gitLog")).resolves.toEqual({
			count: 2,
		});
		expect(seen).toHaveLength(2);
	});

	test("done packet that beats the start response still settles", async () => {
		// The start request parks on a gate; the done packet arrives first
		// and must buffer by op id instead of being dropped.
		let release!: () => void;
		harness.startGate = new Promise<void>((r) => {
			release = r;
		});
		try {
			const platform = getPlatform();
			const pending = platform.gitRemote("root", "fetch", {
				remote: "origin",
			});
			void pending.catch(() => {});
			await flush();
			const opId = harness.nextOpId;
			harness.messages.gitRemoteDone({ opId, ok: true, stderr: "early" });
			release();
			await expect(withHangGuard(pending, "gitRemote")).resolves.toEqual({
				ok: true,
				stderr: "early",
			});
		} finally {
			harness.startGate = null;
		}
	});

	test("rejected start settles instead of hanging", async () => {
		harness.failNextStart = true;
		const platform = getPlatform();
		const pending = platform.gitRemote("root", "fetch", {
			remote: "origin",
		});
		await expect(withHangGuard(pending, "gitRemote")).rejects.toThrow(
			"transport down",
		);
	});

	test("early done skips abort wiring for the finished op", async () => {
		let release!: () => void;
		harness.startGate = new Promise<void>((r) => {
			release = r;
		});
		try {
			const platform = getPlatform();
			const controller = new AbortController();
			const pending = platform.gitRemote(
				"root",
				"fetch",
				{ remote: "origin", signal: controller.signal },
				() => {},
			);
			void pending.catch(() => {});
			await flush();
			const opId = harness.nextOpId;
			const abortsBefore = harness.abortCalls.length;
			harness.messages.gitRemoteDone({ opId, ok: true, stderr: "early" });
			release();
			await expect(withHangGuard(pending, "gitRemote")).resolves.toEqual({
				ok: true,
				stderr: "early",
			});
			// A later abort must not ping the finished op.
			controller.abort();
			await flush();
			expect(harness.abortCalls.length).toBe(abortsBefore);
		} finally {
			harness.startGate = null;
		}
	});
});
