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
		gitStatus: (root) => {
			if (root !== FAKE_REPO) {
				return Promise.reject(new Error(`not a git repository: ${root}`));
			}
			const status: GitStatus = {
				branch: {
					oid: "f4k3h34d00000000000000000000000000000001",
					head: "main",
				},
				entries: [
					{
						path: "hello.txt",
						indexStatus: "M",
						worktreeStatus: ".",
						origin: "changed",
					},
					{
						path: "untracked file.txt",
						indexStatus: "?",
						worktreeStatus: "?",
						origin: "untracked",
					},
				],
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
