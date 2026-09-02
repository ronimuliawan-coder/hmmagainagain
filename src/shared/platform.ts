// Platform contract — the seam between the UI and everything OS-specific.
// Both platform implementations (fake, Bun main-process, and the RPC client used
// by the webview) must satisfy `Platform` and pass the shared conformance suite.
// See docs/GOVERNANCE.md invariants: argv-only git, cwd pinned to the repo root.

import type { RPCSchema } from "electrobun/main";

export interface RepoInfo {
	root: string;
	isRepo: true;
	branch: string;
	head: string;
}

/** Coalesced filesystem change batch. Paths are repo-relative when derivable. */
export interface FsEventBatch {
	paths: string[];
}

export interface GitRunOptions {
	/** Aborting kills the child git process; the run resolves with `signal` set. */
	signal?: AbortSignal;
	/** Chunk callbacks fire in emit order, before the run resolves. */
	onStdout?: (chunk: Uint8Array) => void;
	onStderr?: (chunk: Uint8Array) => void;
}

export interface GitRunResult {
	code: number | null;
	signal: string | null;
	/** Full stderr, captured verbatim regardless of chunk callbacks. */
	stderr: string;
}

/**
 * The UI never touches Node/Bun/Electron APIs directly — only this interface.
 * `openRepo` is intentionally absent: Electrobun 2.0.1 ships no native
 * open-directory dialog (devkit audit, RON-294). Until one exists upstream or a
 * custom picker lands (U3), the webview supplies a path to `readRepo`.
 */
export interface Platform {
	readonly kind: "fake" | "bun" | "rpc";
	/** Validates the path is a git worktree; rejects (throws) otherwise. */
	readRepo(root: string): Promise<RepoInfo>;
	/**
	 * Runs git in the repo. args must NOT include the git binary name.
	 * Implementations enforce argv-array spawning (no shell), cwd = root.
	 */
	runGit(
		root: string,
		args: string[],
		opts?: GitRunOptions,
	): Promise<GitRunResult>;
	/**
	 * Subscribes to debounced filesystem changes under root (recursive).
	 * Returns a stopper; after it resolves, no further callbacks fire.
	 */
	watchRepo(
		root: string,
		onEvents: (batch: FsEventBatch) => void,
	): Promise<{ stop: () => Promise<void> }>;
}

// ---- RPC transport schema (Electrobun typed RPC, used by the webview client) ----
// Contract semantics: `bun.requests` are answered by the main process;
// `webview.messages` are sent main → webview (stream chunks / fs events).
// Streaming runs use a start / chunk / exit + abort protocol because Electrobun
// RPC requests are single-response.

export interface RpcRunStartParams {
	root: string;
	args: string[];
}

export type PlatformRPCSchema = {
	bun: RPCSchema<{
		requests: {
			readRepo: { params: { root: string }; response: RepoInfo };
			watchStart: { params: { root: string }; response: { watchId: number } };
			watchStop: { params: { watchId: number }; response: { ok: boolean } };
			runGitStart: { params: RpcRunStartParams; response: { runId: number } };
			runGitAbort: { params: { runId: number }; response: { ok: boolean } };
		};
		messages: {
			/** Webview → main: result payload of the SMOKE self-test (SMOKE=1). */
			selfTestResult: { ok: boolean; detail: string };
		};
	}>;
	webview: RPCSchema<{
		requests: {};
		messages: {
			fsEvents: { watchId: number; batch: FsEventBatch };
			/** data is base64-encoded chunk bytes. */
			gitChunk: { runId: number; stream: "stdout" | "stderr"; data: string };
			gitExit: {
				runId: number;
				code: number | null;
				signal: string | null;
				stderr: string;
			};
		};
	}>;
};
