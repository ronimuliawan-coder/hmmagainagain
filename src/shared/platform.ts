// Platform contract — the seam between the UI and everything OS-specific.
// Both platform implementations (fake, Bun main-process, and the RPC client used
// by the webview) must satisfy `Platform` and pass the shared conformance suite.
// See docs/GOVERNANCE.md invariants: argv-only git, cwd pinned to the repo root.

import type { RPCSchema } from "electrobun/main";
import type { BranchInfo } from "../bun/git/branches";
import type { DiffResult } from "../bun/git/diff";
import type { LogCommit } from "../bun/git/log";
import type { GitStatus } from "../bun/git/status-parser";

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
	/** Present when the caller asked for stdout collection (SpawnGitOptions). */
	stdout?: string;
}

/** Range selection for a worktree diff; empty = index vs worktree. */
export interface GitDiffOptions {
	staged?: boolean;
	from?: string;
	to?: string;
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
	/** Porcelain-v2 status (branch + entries). Throws on non-repositories. */
	gitStatus(root: string): Promise<GitStatus>;
	/** Unified patch text + per-file numstat for the requested range.
	 * Throws on non-repositories. */
	gitDiff(root: string, options?: GitDiffOptions): Promise<DiffResult>;
	/** Sorted worktree file list (tracked + untracked, ignored excluded). */
	gitWorktreePaths(root: string): Promise<string[]>;
	/** Streamed commit history; onCommit fires per commit, in order. */
	gitLog(
		root: string,
		options: { limit?: number; skip?: number; range?: string },
		onCommit: (commit: LogCommit) => void,
	): Promise<{ count: number }>;
	/** Local head branches with the current marker. */
	gitBranches(root: string): Promise<BranchInfo[]>;
	/** Refuses on a dirty worktree when switching (never auto-discards). */
	gitCreateBranch(
		root: string,
		name: string,
		switchTo?: boolean,
	): Promise<void>;
	gitSwitchBranch(root: string, name: string): Promise<void>;
	/** Fetch/push/pull with streamed progress; system credentials only.
	 * Aborting `signal` kills the in-flight op (U7b); implementations that
	 * cannot cancel (fake) ignore it. */
	gitRemote(
		root: string,
		op: "fetch" | "push" | "pull",
		options: {
			remote: string;
			branch?: string;
			setUpstream?: boolean;
			signal?: AbortSignal;
		},
		onLine?: (line: string) => void,
	): Promise<{ ok: boolean; stderr: string }>;
	// ---- Write paths (U5). All are explicit user actions; staging touches
	// only the index; commits run hooks and never bypass them. Failures carry
	// git's stderr verbatim. ----
	/** Stages files (add -A): modifications, additions, and deletions. */
	stagePaths(root: string, paths: string[]): Promise<void>;
	/** Unstages files (restore --staged); the worktree is untouched. */
	unstagePaths(root: string, paths: string[]): Promise<void>;
	/** Applies a unified patch to the index only (apply --cached). Fails
	 * honestly when the patch no longer matches the index. */
	applyIndexPatch(root: string, patch: string): Promise<void>;
	/** Commits the index with the given message. Hook failures reject with
	 * the hook's output verbatim. */
	commit(root: string, message: string): Promise<void>;
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
			// GitAdapter read paths (U2). ok=false carries a user-facing error.
			gitStatus: {
				params: { root: string };
				response: { ok: boolean; status?: GitStatus; error?: string };
			};
			gitDiff: {
				params: { root: string; from?: string; to?: string; staged?: boolean };
				response: { ok: boolean; result?: DiffResult; error?: string };
			};
			gitLogStart: {
				params: { root: string; limit?: number; skip?: number; range?: string };
				response: { logId: number };
			};
			gitLogAbort: { params: { logId: number }; response: { ok: boolean } };
			gitWorktreePaths: {
				params: { root: string };
				response: { ok: boolean; paths?: string[]; error?: string };
			};
			gitBranches: {
				params: { root: string };
				response: { ok: boolean; branches?: BranchInfo[]; error?: string };
			};
			gitCreateBranch: {
				params: { root: string; name: string; switchTo?: boolean };
				response: { ok: boolean; error?: string };
			};
			gitSwitchBranch: {
				params: { root: string; name: string };
				response: { ok: boolean; error?: string };
			};
			gitRemoteStart: {
				params: {
					root: string;
					op: "fetch" | "push" | "pull";
					remote: string;
					branch?: string;
					setUpstream?: boolean;
				};
				response: { opId: number };
			};
			gitRemoteAbort: { params: { opId: number }; response: { ok: boolean } };
			// Write paths (U5). ok=false carries git's stderr verbatim.
			stagePaths: {
				params: { root: string; paths: string[] };
				response: { ok: boolean; error?: string };
			};
			unstagePaths: {
				params: { root: string; paths: string[] };
				response: { ok: boolean; error?: string };
			};
			applyIndexPatch: {
				params: { root: string; patch: string };
				response: { ok: boolean; error?: string };
			};
			commit: {
				params: { root: string; message: string };
				response: { ok: boolean; error?: string };
			};
		};
		messages: {
			/** Webview → main: result payload of the SMOKE self-test (SMOKE=1). */
			selfTestResult: { ok: boolean; detail: string };
		};
	}>;
	webview: RPCSchema<{
		// biome-ignore lint/complexity/noBannedTypes: empty side = answers no requests (upstream-idiomatic)
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
			/** Main → webview (SMOKE=1 only): run the platform self-test against root.
			 * `stage` (SMOKE_STAGE=1) adds the fixture-only staging/commit flow. */
			selfTestRun: { root: string; stage?: boolean; branch?: boolean };
			gitLogCommit: { logId: number; commit: LogCommit };
			gitLogDone: { logId: number; ok: boolean; count: number; error?: string };
			gitRemoteLine: { opId: number; line: string };
			gitRemoteDone: { opId: number; ok: boolean; stderr: string };
		};
	}>;
};

export type { BranchInfo } from "../bun/git/branches";
export type { DiffFile, DiffResult } from "../bun/git/diff";
export type { LogCommit } from "../bun/git/log";
export type {
	GitBranchInfo,
	GitStatus,
	StatusEntry,
} from "../bun/git/status-parser";
