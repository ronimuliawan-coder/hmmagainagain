// In-memory fake Platform: fast UI development in a plain browser and a
// dependency-free conformance target. It emulates exactly the git commands the
// app issues (the real command surface is fixed by the GitAdapter in U2).

import type {
	FsEventBatch,
	GitRunResult,
	GitStatus,
	Platform,
	RepoInfo,
} from "./platform";
import type { ConformanceFixture } from "./platform.conformance";

const DEBOUNCE_MS = 100;
const FAKE_REPO = "/virtual/repo";
const FAKE_NON_REPO = "/virtual/plain";
const TRACKED_FILE = "hello.txt";
const TRACKED_CONTENT = "hello from the fake fixture\n";
const LONG_RUN_ARGS = ["log", "--all", "--oneline", "--graph"];
const LONG_RUN_MARKER = "commit-42-marker";
let fakeBranch = "main";

// Index simulation for the U5 write paths. hello.txt starts staged (matching
// the gitDiff fixture); unstaging flips it to a worktree-only modification so
// the stage action has something to act on — a UI-dev fiction, kept local.
const staged = new Set<string>([TRACKED_FILE]);
let commitCount = 0;
const headOid = () =>
	`f4k3h34d0000000000000000000000000000000${(1 + commitCount) % 10}`;

const fakeStatusEntries = (): GitStatus["entries"] => [
	staged.has(TRACKED_FILE)
		? {
				path: TRACKED_FILE,
				indexStatus: "M",
				worktreeStatus: ".",
				origin: "changed",
			}
		: {
				path: TRACKED_FILE,
				indexStatus: ".",
				worktreeStatus: "M",
				origin: "changed",
			},
	{
		path: "untracked file.txt",
		indexStatus: "?",
		worktreeStatus: "?",
		origin: "untracked",
	},
];

interface FakeCommand {
	match(args: string[]): boolean;
	run(
		emit: (chunk: string) => void,
		signal?: AbortSignal,
	): Promise<GitRunResult>;
}

/**
 * Builds the fake platform plus a conformance fixture wired to it.
 * The virtual FS map is shared so watch events and command output agree.
 */
export function buildFakeFixture() {
	const files = new Map<string, string>([
		[`${FAKE_REPO}/${TRACKED_FILE}`, TRACKED_CONTENT],
	]);
	const listeners = new Set<(batch: FsEventBatch) => void>();
	let debounce: ReturnType<typeof setTimeout> | null = null;
	const pending = new Set<string>();

	const flush = () => {
		debounce = null;
		const batch: FsEventBatch = { paths: [...pending] };
		pending.clear();
		for (const listener of listeners) listener(batch);
	};

	const commands: FakeCommand[] = [
		{
			match: (args) => args[0] === "show" && args[1] === `HEAD:${TRACKED_FILE}`,
			run: (emit) => {
				emit(files.get(`${FAKE_REPO}/${TRACKED_FILE}`) ?? "");
				return Promise.resolve({ code: 0, signal: null, stderr: "" });
			},
		},
		{
			// Streams in several chunks so ordering/marker/abort behaviour is real.
			match: (args) => args[0] === "log" && args.includes("--all"),
			run: async (emit, signal) => {
				for (let i = 1; i <= 3; i++) {
					if (signal?.aborted) {
						return { code: null, signal: "SIGTERM", stderr: "" };
					}
					emit(i === 2 ? `${LONG_RUN_MARKER}\n` : `fake log chunk ${i}\n`);
					await Bun.sleep(20);
				}
				return { code: 0, signal: null, stderr: "" };
			},
		},
	];

	const platform: Platform = {
		kind: "fake",
		readRepo: (root) => {
			if (root !== FAKE_REPO) {
				return Promise.reject(new Error(`not a git repository: ${root}`));
			}
			const info: RepoInfo = {
				root,
				isRepo: true,
				branch: "main",
				head: "f4k3h34d",
			};
			return Promise.resolve(info);
		},
		runGit: (root, args, opts) => {
			if (root !== FAKE_REPO) {
				return Promise.resolve({
					code: 128,
					signal: null,
					stderr: "not a repo",
				});
			}
			const command = commands.find((c) => c.match(args));
			if (!command) {
				return Promise.resolve({
					code: 1,
					signal: null,
					stderr: "fake: unsupported command",
				});
			}
			return command
				.run(
					(chunk) => opts?.onStdout?.(new TextEncoder().encode(chunk)),
					opts?.signal,
				)
				.then((result) => {
					opts?.onStderr?.(new TextEncoder().encode(result.stderr));
					return result;
				});
		},
		gitDiff: (root) => {
			if (root !== FAKE_REPO) {
				return Promise.reject(new Error(`not a git repository: ${root}`));
			}
			// The staged hello.txt change (see gitStatus) as the unified patch
			// the real adapter would emit for `--cached`.
			const patch = [
				"diff --git a/hello.txt b/hello.txt",
				"index 30d74d2..49ee2cb 100644",
				"--- a/hello.txt",
				"+++ b/hello.txt",
				"@@ -1 +1,2 @@",
				" hello from the fake fixture",
				"+staged in the fake fixture",
				"",
			].join("\n");
			return Promise.resolve({
				files: [
					{ path: TRACKED_FILE, additions: 1, deletions: 0, binary: false },
				],
				patch,
			});
		},
		gitStatus: (root) => {
			if (root !== FAKE_REPO) {
				return Promise.reject(new Error(`not a git repository: ${root}`));
			}
			const status: GitStatus = {
				branch: {
					oid: headOid(),
					head: "main",
				},
				entries: fakeStatusEntries(),
			};
			return Promise.resolve(status);
		},
		gitWorktreePaths: (root) => {
			if (root !== FAKE_REPO) {
				return Promise.reject(new Error(`not a git repository: ${root}`));
			}
			return Promise.resolve(
				["hello.txt", "src/nested.txt", "untracked file.txt"].sort(),
			);
		},
		gitLog: (root, options, onCommit) => {
			if (root !== FAKE_REPO) {
				return Promise.reject(new Error(`not a git repository: ${root}`));
			}
			const commits = [
				{
					oid: "f4k3c0mm1t000000000000000000000000000002",
					shortOid: "f4k3c02",
					authorName: "Fake",
					authorEmail: "fake@fixture.test",
					date: "2026-01-02T00:00:00Z",
					subject: "fake: second commit",
					refs: "HEAD -> main",
				},
				{
					oid: "f4k3c0mm1t000000000000000000000000000001",
					shortOid: "f4k3c01",
					authorName: "Fake",
					authorEmail: "fake@fixture.test",
					date: "2026-01-01T00:00:00Z",
					subject: "fake: first commit",
					refs: "",
				},
			];
			let delivered = 0;
			for (const commit of commits) {
				if ((options.skip ?? 0) > delivered) continue;
				delivered += 1;
				onCommit(commit);
			}
			return Promise.resolve({ count: delivered });
		},
		gitBranches: (root) => {
			if (root !== FAKE_REPO) {
				return Promise.reject(new Error(`not a git repository: ${root}`));
			}
			return Promise.resolve([
				{ name: fakeBranch, oid: "f4k3c02", current: true },
			]);
		},
		gitCreateBranch: (root, name, switchTo) => {
			if (root !== FAKE_REPO) {
				return Promise.reject(new Error(`not a git repository: ${root}`));
			}
			if (switchTo) fakeBranch = name;
			return Promise.resolve();
		},
		gitSwitchBranch: (root, name) => {
			if (root !== FAKE_REPO) {
				return Promise.reject(new Error(`not a git repository: ${root}`));
			}
			fakeBranch = name;
			return Promise.resolve();
		},
		gitRemote: (root, op, _options, onLine) => {
			if (root !== FAKE_REPO) {
				return Promise.reject(new Error(`not a git repository: ${root}`));
			}
			onLine?.(`fake ${op}: everything up-to-date\n`);
			return Promise.resolve({ ok: true, stderr: "" });
		},
		// ---- Write paths (U5): minimal index simulation for browser dev ----
		stagePaths: (root, paths) => {
			if (root !== FAKE_REPO) {
				return Promise.reject(new Error(`not a git repository: ${root}`));
			}
			for (const path of paths) staged.add(path);
			return Promise.resolve();
		},
		unstagePaths: (root, paths) => {
			if (root !== FAKE_REPO) {
				return Promise.reject(new Error(`not a git repository: ${root}`));
			}
			for (const path of paths) staged.delete(path);
			return Promise.resolve();
		},
		applyIndexPatch: (root) => {
			if (root !== FAKE_REPO) {
				return Promise.reject(new Error(`not a git repository: ${root}`));
			}
			// The fake has no real index to patch; the staged state is untouched.
			return Promise.resolve();
		},
		commit: (root, message) => {
			if (root !== FAKE_REPO) {
				return Promise.reject(new Error(`not a git repository: ${root}`));
			}
			if (message.trim().length === 0 || staged.size === 0) {
				return Promise.reject(new Error("no changes added to commit (fake)"));
			}
			commitCount += 1;
			staged.clear();
			return Promise.resolve();
		},
		watchRepo: (root, onEvents) => {
			if (root !== FAKE_REPO) {
				return Promise.reject(new Error(`not a git repository: ${root}`));
			}
			listeners.add(onEvents);
			return Promise.resolve({
				stop: () => {
					listeners.delete(onEvents);
					return Promise.resolve();
				},
			});
		},
	};

	const fixture: ConformanceFixture = {
		repoRoot: FAKE_REPO,
		nonRepoRoot: FAKE_NON_REPO,
		trackedFile: TRACKED_FILE,
		trackedContent: TRACKED_CONTENT,
		longRunArgs: LONG_RUN_ARGS,
		longRunMarker: LONG_RUN_MARKER,
		makeNestedChange: () => {
			const path = `sub/nested-${Date.now()}.txt`;
			files.set(`${FAKE_REPO}/${path}`, "x");
			pending.add(path);
			if (!debounce) debounce = setTimeout(flush, DEBOUNCE_MS);
			return Promise.resolve(path);
		},
	};

	return { platform, fixture };
}
