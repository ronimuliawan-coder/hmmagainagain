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
/** Opt-in scroll-stress root (RON-343): thousands of files, hundreds of
 * commits. Not part of the conformance contract — the default fixture and
 * its tests are untouched. Open it in a browser harness to compare scroll
 * fps against real hardware. Writes resolve without state tracking. */
export const FAKE_BIG_REPO = "/virtual/big";
const BIG_FILES = 3000;
const BIG_COMMITS = 300;
const TRACKED_FILE = "hello.txt";
const TRACKED_CONTENT = "hello from the fake fixture\n";
const LONG_RUN_ARGS = ["log", "--all", "--oneline", "--graph"];
const LONG_RUN_MARKER = "commit-42-marker";

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
	// Per-fixture mutable state (CodeRabbit U0–U8 review): module globals
	// leaked branch/staged/commit state across fixtures in one process.
	let fakeBranch = "main";

	// Index simulation for the U5 write paths. hello.txt starts staged
	// (matching the gitDiff fixture); unstaging flips it to a worktree-only
	// modification so the stage action has something to act on — a UI-dev
	// fiction, kept local.
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

	// Pre-generated scroll-stress datasets for FAKE_BIG_REPO. Statuses cycle
	// staged-modified / worktree-modified / untracked so both Changes groups
	// fill; commits are newest-first with the head ref on the first.
	const bigPaths = Array.from(
		{ length: BIG_FILES },
		(_, i) => `src/module-${String(i % 200).padStart(3, "0")}/file-${i}.ts`,
	).sort();
	const bigStatusEntries = (): GitStatus["entries"] =>
		bigPaths.map((path, i) =>
			i % 3 === 0
				? { path, indexStatus: "M", worktreeStatus: ".", origin: "changed" }
				: i % 3 === 1
					? { path, indexStatus: ".", worktreeStatus: "M", origin: "changed" }
					: {
							path,
							indexStatus: "?",
							worktreeStatus: "?",
							origin: "untracked",
						},
		);
	const bigOid = (i: number): string =>
		`b16c0mm1t${String(i).padStart(28, "0")}`;
	const isBigRoot = (root: string): boolean => root === FAKE_BIG_REPO;

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
		pickDirectory: () => {
			// A plain browser has no native folder dialog (and must never
			// learn absolute paths) — the UI hides Browse outside Electrobun.
			return Promise.resolve(null);
		},
		readRepo: (root) => {
			if (root !== FAKE_REPO && !isBigRoot(root)) {
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
			if (root !== FAKE_REPO && !isBigRoot(root)) {
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
			if (root !== FAKE_REPO && !isBigRoot(root)) {
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
			if (root !== FAKE_REPO && !isBigRoot(root)) {
				return Promise.reject(new Error(`not a git repository: ${root}`));
			}
			if (isBigRoot(root)) {
				const status: GitStatus = {
					branch: { oid: bigOid(0), head: "main" },
					entries: bigStatusEntries(),
				};
				return Promise.resolve(status);
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
			if (root !== FAKE_REPO && !isBigRoot(root)) {
				return Promise.reject(new Error(`not a git repository: ${root}`));
			}
			if (isBigRoot(root)) return Promise.resolve(bigPaths);
			return Promise.resolve(
				["hello.txt", "src/nested.txt", "untracked file.txt"].sort(),
			);
		},
		gitLog: (root, options, onCommit) => {
			if (root !== FAKE_REPO && !isBigRoot(root)) {
				return Promise.reject(new Error(`not a git repository: ${root}`));
			}
			const commits = isBigRoot(root)
				? Array.from({ length: BIG_COMMITS }, (_, i) => ({
						oid: bigOid(i),
						shortOid: `b16c${String(i).padStart(3, "0")}`,
						authorName: "Fake",
						authorEmail: "fake@fixture.test",
						date: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString(),
						subject: `fake: big commit ${BIG_COMMITS - i}`,
						refs: i === 0 ? "HEAD -> main" : "",
					}))
				: [
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
			let seen = 0;
			const skip = options.skip ?? 0;
			const limit = options.limit ?? commits.length;
			for (const commit of commits) {
				// Count every record toward the skip window, not just
				// delivered ones, and honor the page size (CodeRabbit U0–U8).
				if (seen < skip) {
					seen += 1;
					continue;
				}
				seen += 1;
				if (delivered >= limit) break;
				delivered += 1;
				onCommit(commit);
			}
			return Promise.resolve({ count: delivered });
		},
		gitBranches: (root) => {
			if (root !== FAKE_REPO && !isBigRoot(root)) {
				return Promise.reject(new Error(`not a git repository: ${root}`));
			}
			return Promise.resolve([
				{ name: fakeBranch, oid: "f4k3c02", current: true },
			]);
		},
		gitCreateBranch: (root, name, switchTo) => {
			if (root !== FAKE_REPO && !isBigRoot(root)) {
				return Promise.reject(new Error(`not a git repository: ${root}`));
			}
			if (switchTo) fakeBranch = name;
			return Promise.resolve();
		},
		gitSwitchBranch: (root, name) => {
			if (root !== FAKE_REPO && !isBigRoot(root)) {
				return Promise.reject(new Error(`not a git repository: ${root}`));
			}
			fakeBranch = name;
			return Promise.resolve();
		},
		gitRemote: (root, op, _options, onLine) => {
			if (root !== FAKE_REPO && !isBigRoot(root)) {
				return Promise.reject(new Error(`not a git repository: ${root}`));
			}
			onLine?.(`fake ${op}: everything up-to-date\n`);
			return Promise.resolve({ ok: true, stderr: "" });
		},
		// ---- Write paths (U5): minimal index simulation for browser dev ----
		stagePaths: (root, paths) => {
			if (root !== FAKE_REPO && !isBigRoot(root)) {
				return Promise.reject(new Error(`not a git repository: ${root}`));
			}
			if (isBigRoot(root)) return Promise.resolve();
			for (const path of paths) staged.add(path);
			return Promise.resolve();
		},
		unstagePaths: (root, paths) => {
			if (root !== FAKE_REPO && !isBigRoot(root)) {
				return Promise.reject(new Error(`not a git repository: ${root}`));
			}
			if (isBigRoot(root)) return Promise.resolve();
			for (const path of paths) staged.delete(path);
			return Promise.resolve();
		},
		applyIndexPatch: (root) => {
			if (root !== FAKE_REPO && !isBigRoot(root)) {
				return Promise.reject(new Error(`not a git repository: ${root}`));
			}
			// The fake has no real index to patch; the staged state is untouched.
			return Promise.resolve();
		},
		commit: (root, message) => {
			if (root !== FAKE_REPO && !isBigRoot(root)) {
				return Promise.reject(new Error(`not a git repository: ${root}`));
			}
			if (isBigRoot(root)) return Promise.resolve();
			if (message.trim().length === 0 || staged.size === 0) {
				return Promise.reject(new Error("no changes added to commit (fake)"));
			}
			commitCount += 1;
			staged.clear();
			return Promise.resolve();
		},
		watchRepo: (root, onEvents) => {
			if (root !== FAKE_REPO && !isBigRoot(root)) {
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
		remoteName: "origin",
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
