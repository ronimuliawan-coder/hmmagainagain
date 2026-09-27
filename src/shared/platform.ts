// Platform contract — the seam between the UI and everything OS-specific.
// Implementations (Tauri bridge, fake fixture for plain browsers) must
// satisfy `Platform` and pass the shared conformance suite.
// See docs/GOVERNANCE.md invariants: argv-only git, cwd pinned to the repo root.

import type { DiffResult } from "./git/diff-parse";
import type { LogCommit } from "./git/log-parse";
import type { GitStatus } from "./git/status-parser";

/** Branch listing entry (local or remote-tracking). */
export interface BranchInfo {
	name: string;
	oid: string;
	current: boolean;
	upstream?: string;
	/** Remote-tracking branches (origin/main) list for checkout; absent
	 * means local. The fake omits it (local-only fixture). */
	remote?: boolean;
}

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
	/** Aborts the in-flight diff (A2); implementations without cancel
	 * support (fake) ignore it. Never sent over RPC — stripped by the
	 * client before the request. */
	signal?: AbortSignal;
}

/**
 * The UI never touches Node/Bun/Electron APIs directly — only this interface.
 * `openRepo` is intentionally absent: Electrobun 2.0.1 ships no webview-side
 * open-directory dialog (devkit audit, RON-294). Folder picking crosses as
 * `pickDirectory` instead (native GtkFileChooserNative folder mode via the
 * main-process Utils, RON-324); the webview still supplies the path to
 * `readRepo`, which validates it.
 */
export interface Platform {
	readonly kind: "fake" | "bun" | "rpc" | "tauri";
	/** Validates the path is a git worktree; rejects (throws) otherwise. */
	readRepo(root: string): Promise<RepoInfo>;
	/** Native folder picker; resolves null when the user cancels. The fake
	 * (plain-browser dev) has no native dialog and always resolves null. */
	pickDirectory(): Promise<string | null>;
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
	/** Checks out a remote-tracking branch (origin/main): same-named local
	 * branch takes a plain switch, otherwise a tracking branch is created. */
	gitSwitchRemoteBranch(root: string, remoteRef: string): Promise<void>;
	/** Reads a worktree file's full text for the file viewer. Root-pinned,
	 * size-capped, binary-refusing on the native side. */
	readFileText(root: string, path: string): Promise<string>;
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

export type { DiffFile, DiffResult } from "./git/diff-parse";
export type { LogCommit } from "./git/log-parse";
export type {
	GitBranchInfo,
	GitStatus,
	StatusEntry,
} from "./git/status-parser";
