import "./style.css";
import type {
	GitDiffOptions,
	GitStatus,
	LogCommit,
	RepoInfo,
} from "../shared/platform";
import {
	type DiffStyle,
	type DiffViewHandle,
	mountDiffView,
} from "./diff-view-wrapper";
import { mountFileTree, type TreeHandle } from "./file-tree-wrapper";
import { statusToTreeEntries } from "./git-status-mapping";
import { FALLBACK_ROW_HEIGHT, windowRows } from "./history-window";
import { buildStagedPatch } from "./patch-surgery";
import {
	getPlatform,
	getPlatformLoadError,
	sendSelfTestResult,
} from "./platform";
import { createStore } from "./store";

// U8b cold-start proxy: first compositor frame in the webview, on the shared
// Date.now wall clock. Surfaces in main-process output only if Electrobun
// forwards webview console output; its absence is itself a finding (proxy
// falls back to the main-ready marker with a stated limit).
requestAnimationFrame(() => {
	console.log(`[STARTUP] first-frame wall=${Date.now()}`);
});

const RECENTS_KEY = "hmmagainagain.recents";
const REFRESH_DEBOUNCE_MS = 300;

/** Fail-fast lookup: a missing id is a template/TS mismatch, not a runtime case. */
function byId<T extends HTMLElement>(id: string): T {
	const element = document.getElementById(id);
	if (!element) throw new Error(`missing element #${id}`);
	return element as T;
}

// Porcelain letters (?, ., !) can't be CSS class names — slug them instead.
const STATUS_SLUGS: Record<string, string> = {
	M: "m",
	A: "a",
	D: "d",
	R: "r",
	C: "c",
	U: "u",
	"?": "untracked",
	"!": "ignored",
	".": "clean",
};

const statusSlug = (letter: string): string => STATUS_SLUGS[letter] ?? "other";

const treeContainer = byId<HTMLDivElement>("tree-container");
const statusList = byId<HTMLUListElement>("status-list");
const repoInfo = byId<HTMLSpanElement>("repo-info");
const repoInput = byId<HTMLInputElement>("repo-path");
const openBtn = byId<HTMLButtonElement>("open-btn");
const diffContainer = byId<HTMLDivElement>("diff-container");
const diffInfo = byId<HTMLSpanElement>("diff-info");
const rangeButtons = [
	...document.querySelectorAll<HTMLButtonElement>(
		"#diff-toolbar [data-diff-range]",
	),
];
const diffApplyBtn = byId<HTMLButtonElement>("diff-range-apply");
const diffFromInput = byId<HTMLInputElement>("diff-from");
const diffToInput = byId<HTMLInputElement>("diff-to");
const unifiedBtn = byId<HTMLButtonElement>("diff-style-unified");
const splitBtn = byId<HTMLButtonElement>("diff-style-split");
const stageSelectedBtn = byId<HTMLButtonElement>("stage-selected-btn");
const commitMessage = byId<HTMLTextAreaElement>("commit-message");
const commitBtn = byId<HTMLButtonElement>("commit-btn");
const stagedCount = byId<HTMLSpanElement>("staged-count");
const writeError = byId<HTMLPreElement>("write-error");
const historyList = byId<HTMLUListElement>("history-list");
const branchSelect = byId<HTMLSelectElement>("branch-select");
const branchName = byId<HTMLInputElement>("branch-name");
const branchCreateBtn = byId<HTMLButtonElement>("branch-create-btn");
const olderBtn = byId<HTMLButtonElement>("older-btn");
const pushBtn = byId<HTMLButtonElement>("push-btn");
const pullBtn = byId<HTMLButtonElement>("pull-btn");
const fetchBtn = byId<HTMLButtonElement>("fetch-btn");
const cancelBtn = byId<HTMLButtonElement>("cancel-btn");
const remoteProgress = byId<HTMLPreElement>("remote-progress");

type DiffMode = "worktree" | "staged" | "head" | "range";

interface AppState {
	/** Opened repository root ("" when none). */
	root: string;
	info: RepoInfo | null;
	status: GitStatus | null;
	diffMode: DiffMode;
	diffFrom: string;
	diffTo: string;
	diffStyle: DiffStyle;
}

const store = createStore<AppState>({
	root: "",
	info: null,
	status: null,
	diffMode: "worktree",
	diffFrom: "",
	diffTo: "",
	diffStyle: "unified",
});

let tree: TreeHandle | null = null;
let diffView: DiffViewHandle | null = null;
let watcher: { stop: () => Promise<void> } | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
// Guards against applying a stale diff response after a rapid range switch.
let diffSeq = 0;
let diffController: AbortController | null = null;
// Stage timings of the last diff load — read by the SMOKE self-test.
const diffTimings = { fetchMs: 0, parseMs: 0, files: 0 };
// The patch behind the current diff view + the user's line selection in it —
// the inputs to hunk staging (patch surgery).
let lastPatch = "";
let lastSelection: { path: string; start: number; end: number } | null = null;

function readRecents(): RecentRepos {
	try {
		const raw = localStorage.getItem(RECENTS_KEY);
		if (raw) {
			const parsed: unknown = JSON.parse(raw);
			// Shape-guard: a poisoned value must not throw during render
			// (CodeRabbit U0–U8 review).
			if (
				typeof parsed === "object" &&
				parsed !== null &&
				Array.isArray((parsed as { recents?: unknown }).recents)
			) {
				return parsed as RecentRepos;
			}
		}
	} catch {
		// corrupted storage — reset to defaults (non-destructive)
	}
	return { recents: [] };
}

function saveRecent(root: string): void {
	try {
		const { recents } = readRecents();
		const next = [root, ...recents.filter((r) => r !== root)].slice(0, 5);
		localStorage.setItem(RECENTS_KEY, JSON.stringify({ recents: next }));
		renderRecents();
	} catch {
		// storage unavailable — recents are best-effort
	}
}

function renderRecents(): void {
	const list = byId<HTMLDataListElement>("recent-list");
	list.innerHTML = "";
	for (const recent of readRecents().recents) {
		const option = document.createElement("option");
		option.value = recent;
		list.appendChild(option);
	}
}

function renderRepoInfo(info: RepoInfo, status: GitStatus): void {
	let badge = "";
	const { ahead, behind } = status.branch;
	if (ahead !== undefined && behind !== undefined) {
		badge = ` · ↑${ahead} ↓${behind}`;
	} else if (ahead !== undefined) {
		badge = ` · ↑${ahead}`;
	} else if (behind !== undefined) {
		badge = ` · ↓${behind}`;
	}
	repoInfo.textContent = `${info.branch} · ${info.head.slice(0, 7)} · ${status.entries.length} change(s)${badge}`;
	// Never re-enable mid-operation: watcher-driven renders fire while a
	// remote op is in flight (CodeRabbit U0–U8 review). Cancel stays on its
	// own lifecycle in runRemote.
	pushBtn.disabled = remoteOpRunning;
	pullBtn.disabled = remoteOpRunning;
	fetchBtn.disabled = remoteOpRunning;
}

function renderStatusList(status: GitStatus): void {
	statusList.innerHTML = "";
	if (status.entries.length === 0) {
		const empty = document.createElement("li");
		empty.textContent = "working tree clean";
		statusList.appendChild(empty);
		return;
	}
	for (const entry of status.entries) {
		const item = document.createElement("li");
		const active =
			entry.worktreeStatus !== "." ? entry.worktreeStatus : entry.indexStatus;
		item.dataset.path = entry.path;
		item.dataset.staged = entry.indexStatus !== "." ? "yes" : "no";
		const letter = document.createElement("span");
		// CSS classes can't carry raw porcelain letters (?, ., !) — slug them.
		letter.className = `status-letter status-${statusSlug(active)}`;
		letter.textContent = active;
		const label = document.createElement("span");
		label.className = "status-path";
		label.textContent =
			entry.renamedFrom !== undefined
				? `${entry.renamedFrom} → ${entry.path}`
				: entry.path;
		const action = document.createElement("button");
		action.type = "button";
		action.className = "status-action";
		action.textContent = entry.indexStatus !== "." ? "unstage" : "stage";
		action.dataset.actionPath = entry.path;
		action.dataset.actionKind = entry.indexStatus !== "." ? "unstage" : "stage";
		item.append(letter, label, action);
		statusList.appendChild(item);
	}
}

/** Single render path: every state change paints through here. */
function render(state: AppState): void {
	if (state.status) {
		renderStatusList(state.status);
		tree?.setGitStatus(statusToTreeEntries(state.status.entries));
	}
	if (state.info && state.status) renderRepoInfo(state.info, state.status);
	if (state.status) {
		const staged = state.status.entries.filter(
			(e) => e.indexStatus !== ".",
		).length;
		stagedCount.textContent = `${staged} staged`;
		commitBtn.disabled = staged === 0;
	}
	for (const button of rangeButtons) {
		button.classList.toggle(
			"active",
			button.dataset.diffRange === state.diffMode,
		);
	}
	unifiedBtn.classList.toggle("active", state.diffStyle === "unified");
	splitBtn.classList.toggle("active", state.diffStyle === "split");
}

store.subscribe(render);

/** Diff line selection → hunk-staging input (patch surgery). */
function handleDiffSelection(selection: {
	id: string;
	start: number;
	end: number;
}): void {
	const path = selection.id.startsWith("diff:")
		? selection.id.slice("diff:".length)
		: null;
	lastSelection = path
		? { path, start: selection.start, end: selection.end }
		: null;
	stageSelectedBtn.disabled = lastSelection === null;
}

async function refreshStatus(): Promise<void> {
	const { root } = store.get();
	if (!root) return;
	const status = await getPlatform().gitStatus(root);
	const info = await getPlatform().readRepo(root);
	store.set({ ...store.get(), root, info, status });
}

function diffOptionsFor(state: AppState): GitDiffOptions {
	switch (state.diffMode) {
		case "staged":
			return { staged: true };
		case "head":
			return { from: "HEAD" };
		case "range":
			return { from: state.diffFrom, to: state.diffTo };
		default:
			return {};
	}
}

async function refreshDiff(): Promise<void> {
	const state = store.get();
	if (!state.root) return;
	if (!diffView) diffView = mountDiffView(diffContainer, handleDiffSelection);
	const seq = ++diffSeq;
	// A2: superseded diffs die instead of racing. The previous request is
	// aborted before the new one starts; the seq guard below stays as the
	// final stale-result backstop.
	diffController?.abort();
	const controller = new AbortController();
	diffController = controller;
	try {
		const t0 = performance.now();
		const result = await getPlatform().gitDiff(state.root, {
			...diffOptionsFor(state),
			signal: controller.signal,
		});
		const fetchMs = performance.now() - t0;
		if (seq !== diffSeq) return; // a newer request superseded this one
		const t1 = performance.now();
		lastPatch = result.patch;
		lastSelection = null;
		stageSelectedBtn.disabled = true;
		diffView.setPatch(result.patch);
		const parseMs = performance.now() - t1;
		diffTimings.fetchMs = fetchMs;
		diffTimings.parseMs = parseMs;
		diffTimings.files = result.files.length;
		diffInfo.textContent = `${result.files.length} file(s)`;
	} catch (error) {
		// A superseded request's abort is silence, not an error to display.
		if (controller.signal.aborted) return;
		// Surface bad ranges (e.g. unknown ref) in the pane, not as a rejection.
		if (seq === diffSeq) {
			diffTimings.files = 0;
			diffInfo.textContent = `error: ${String(error)}`;
		}
	}
}

function scheduleStatusRefresh(): void {
	if (refreshTimer) clearTimeout(refreshTimer);
	refreshTimer = setTimeout(() => {
		void refreshStatus()
			.then(() => {
				const { diffMode } = store.get();
				// HEAD and explicit ranges are static under worktree edits.
				if (diffMode === "worktree" || diffMode === "staged") {
					return refreshDiff();
				}
			})
			.catch(() => {});
	}, REFRESH_DEBOUNCE_MS);
}

async function openRepo(root: string): Promise<string> {
	const [status, info, paths] = await Promise.all([
		getPlatform().gitStatus(root),
		getPlatform().readRepo(root),
		getPlatform().gitWorktreePaths(root),
	]);
	if (!tree) tree = mountFileTree(treeContainer);
	tree.setPaths(paths);
	if (!diffView) diffView = mountDiffView(diffContainer, handleDiffSelection);

	// Watcher-driven refresh: one subscription per open repository.
	if (watcher) await watcher.stop();
	watcher = await getPlatform().watchRepo(root, scheduleStatusRefresh);

	saveRecent(root);
	store.set({ ...store.get(), root, info, status });
	void refreshDiff();
	refreshBranches();
	refreshHistory();
	return `${info.branch} · ${info.head.slice(0, 7)} · ${status.entries.length} change(s)`;
}

openBtn.addEventListener("click", () => {
	const root = repoInput.value.trim();
	if (!root) return;
	pushBtn.disabled = true;
	pullBtn.disabled = true;
	fetchBtn.disabled = true;
	openRepo(root)
		.then((summary) => {
			repoInfo.textContent = summary;
			pushBtn.disabled = false;
			pullBtn.disabled = false;
			fetchBtn.disabled = false;
		})
		.catch((error) => {
			repoInfo.textContent = `error: ${String(error)}`;
		});
});

// ---- Diff toolbar + status-list interactions ----
const setDiffState = (partial: Partial<AppState>): void => {
	store.set({ ...store.get(), ...partial });
	void refreshDiff();
};

const showWriteError = (error: unknown): void => {
	writeError.textContent =
		error instanceof Error ? error.message : String(error);
};

async function runWriteAction(path: string, unstage: boolean): Promise<void> {
	const { root } = store.get();
	if (!root) return;
	try {
		if (unstage) await getPlatform().unstagePaths(root, [path]);
		else await getPlatform().stagePaths(root, [path]);
		writeError.textContent = "";
		await refreshStatus();
		const { diffMode } = store.get();
		if (diffMode === "worktree" || diffMode === "staged") await refreshDiff();
	} catch (error) {
		showWriteError(error);
	}
}

for (const button of rangeButtons) {
	button.addEventListener("click", () => {
		const mode = button.dataset.diffRange as DiffMode | undefined;
		if (!mode || mode === "range") return;
		setDiffState({ diffMode: mode });
	});
}

diffApplyBtn.addEventListener("click", () => {
	setDiffState({
		diffMode: "range",
		diffFrom: diffFromInput.value.trim(),
		diffTo: diffToInput.value.trim(),
	});
});

for (const [button, style] of [
	[unifiedBtn, "unified"],
	[splitBtn, "split"],
] as const) {
	button.addEventListener("click", () => {
		// Style is a render option — no refetch, just re-render in place.
		store.set({ ...store.get(), diffStyle: style });
		diffView?.setDiffStyle(style);
	});
}

// Clicking a changed file jumps the diff to that file's item; the stage/
// unstage action button writes the index instead.
statusList.addEventListener("click", (event) => {
	const target = event.target as HTMLElement | null;
	const action = target?.closest<HTMLButtonElement>("[data-action-path]");
	if (action) {
		void runWriteAction(
			action.dataset.actionPath ?? "",
			action.dataset.actionKind === "unstage",
		);
		return;
	}
	const item = target?.closest("li");
	const path = item?.dataset.path;
	if (path) diffView?.scrollToFile(path);
});

stageSelectedBtn.addEventListener("click", () => {
	const { root } = store.get();
	if (!root || !lastSelection) return;
	const patch = buildStagedPatch(lastPatch, lastSelection.path, {
		start: lastSelection.start,
		end: lastSelection.end,
	});
	if (!patch) return;
	void getPlatform()
		.applyIndexPatch(root, patch)
		.then(() => {
			writeError.textContent = "";
			return refreshStatus().then(() => refreshDiff());
		})
		.catch(showWriteError);
});

commitBtn.addEventListener("click", () => {
	const { root } = store.get();
	if (!root) return;
	const message = commitMessage.value;
	if (message.trim().length === 0) {
		writeError.textContent = "Commit message is empty.";
		return;
	}
	void getPlatform()
		.commit(root, message)
		.then(() => {
			commitMessage.value = "";
			writeError.textContent = "";
			// A commit moves HEAD: every diff range can change.
			refreshBranches();
			refreshHistory();
			return refreshStatus().then(() => refreshDiff());
		})
		.catch(showWriteError);
});

renderRecents();

// ---- U7: push/pull/fetch ----
let remoteOpRunning = false;
let remoteController: AbortController | null = null;

async function runRemote(op: "fetch" | "push" | "pull"): Promise<void> {
	const { root, info } = store.get();
	if (!root || remoteOpRunning) return;
	const branch = info?.branch === "(detached)" ? undefined : info?.branch;
	const controller = new AbortController();
	remoteController = controller;
	remoteOpRunning = true;
	pushBtn.disabled = true;
	pullBtn.disabled = true;
	fetchBtn.disabled = true;
	cancelBtn.disabled = false;
	remoteProgress.textContent = `${op} …`;
	try {
		const result = await getPlatform().gitRemote(
			root,
			op,
			{
				remote: "origin",
				branch,
				setUpstream: op === "push",
				signal: controller.signal,
			},
			(line) => {
				remoteProgress.textContent = (remoteProgress.textContent + line).slice(
					-2000,
				);
			},
		);
		remoteProgress.textContent = `${op} done\n${result.stderr}`;
		writeError.textContent = "";
		if (op === "pull") {
			// A pull moves HEAD and changes the file set, exactly like a
			// branch switch — refresh tree paths, branches, history and diff,
			// not just the status list (H2: pull.txt stayed invisible until
			// the repo was reopened).
			await afterWorktreeChange();
		} else {
			await refreshStatus();
		}
	} catch (error) {
		// Verbatim: auth failures, diverged pull, no upstream, hook output —
		// or the kill from Cancel, reported as cancelled, not failed.
		writeError.textContent = String(error);
		remoteProgress.textContent = controller.signal.aborted
			? `${op} cancelled`
			: `${op} failed`;
		await refreshStatus().catch(() => {});
	} finally {
		remoteController = null;
		remoteOpRunning = false;
		cancelBtn.disabled = true;
		if (store.get().root) {
			pushBtn.disabled = false;
			pullBtn.disabled = false;
			fetchBtn.disabled = false;
		}
	}
}

pushBtn.addEventListener("click", () => void runRemote("push"));
pullBtn.addEventListener("click", () => void runRemote("pull"));
fetchBtn.addEventListener("click", () => void runRemote("fetch"));
cancelBtn.addEventListener("click", () => remoteController?.abort());

// ---- U6 history pane + A3 windowing ----
// The commit array grows unboundedly (cheap objects) while only a bounded
// row window lives in the DOM (post-v1 Unit A3). Deliberate, documented
// limit: ~200–400 B per commit means even 100k histories stay ≈20–40 MB —
// unreachable for personal repos, while the DOM jank vector (the actual
// budget) is capped. A page-cache redesign waits for a real need.
// All renders go through renderHistoryWindow so selection and spacers stay
// consistent.
const HISTORY_PAGE = 50;
let historyCommits: LogCommit[] = [];
let selectedOid: string | null = null;
let historyScrollQueued = false;

function buildCommitRow(commit: LogCommit): HTMLElement {
	const item = document.createElement("li");
	item.className = "history-row";
	item.dataset.oid = commit.oid;
	const short = document.createElement("span");
	short.className = "history-oid";
	short.textContent = commit.shortOid;
	const subject = document.createElement("span");
	subject.className = "history-subject";
	subject.textContent =
		commit.refs.length > 0
			? `${commit.subject} (${commit.refs})`
			: commit.subject;
	item.append(short, subject);
	item.addEventListener("click", () => viewCommit(commit.oid));
	return item;
}

function historyRowHeight(): number {
	const first = historyList.querySelector(".history-row");
	const measured = first instanceof HTMLElement ? first.offsetHeight : 0;
	return measured > 0 ? measured : FALLBACK_ROW_HEIGHT;
}

/** Rebuilds the visible row window; DOM rows stay bounded (~60 max). */
function renderHistoryWindow(): void {
	const total = historyCommits.length;
	const rowH = historyRowHeight();
	const win = windowRows(
		total,
		historyList.scrollTop,
		rowH,
		historyList.clientHeight,
	);
	historyList.innerHTML = "";
	if (total === 0) return;
	const top = document.createElement("li");
	top.className = "history-spacer";
	top.setAttribute("aria-hidden", "true");
	top.style.height = `${win.topPad}px`;
	historyList.append(top);
	for (let i = win.start; i < win.end; i++) {
		const row = buildCommitRow(historyCommits[i]);
		if (historyCommits[i].oid === selectedOid) row.classList.add("selected");
		historyList.append(row);
	}
	const bottom = document.createElement("li");
	bottom.className = "history-spacer";
	bottom.setAttribute("aria-hidden", "true");
	bottom.style.height = `${win.bottomPad}px`;
	historyList.append(bottom);
}

function queueHistoryWindowRender(): void {
	if (historyScrollQueued) return;
	historyScrollQueued = true;
	requestAnimationFrame(() => {
		historyScrollQueued = false;
		renderHistoryWindow();
	});
}

/** Streams the next page of history; append=false restarts the list. */
let historyLoading = false;
// A full refresh requested while a page load is in flight (e.g. from the
// pull path) is re-run on settle instead of dropped (CodeRabbit follow-up).
let historyRefreshQueued = false;
// Generation guard (CodeRabbit round 2): reset points below used to replace
// the array while an earlier gitLog stream was still pushing into it —
// cross-contaminating repositories/branches. Every load takes a generation;
// stale callbacks no-op.
let historyGen = 0;
function refreshHistory(append = false): void {
	const { root } = store.get();
	if (!root) return;
	if (historyLoading) {
		// Queuing alone leaves the in-flight stream current: its callbacks
		// would keep appending old-repository commits under the new root.
		// Invalidate it now (CodeRabbit round 3); the queued re-run loads
		// fresh on settle.
		if (!append) {
			historyRefreshQueued = true;
			historyGen += 1;
			historyCommits = [];
			renderHistoryWindow();
		}
		return;
	}
	historyLoading = true;
	olderBtn.disabled = true;
	const gen = ++historyGen;
	if (!append) {
		historyCommits = [];
		renderHistoryWindow();
	}
	void getPlatform()
		.gitLog(
			root,
			{ limit: HISTORY_PAGE, skip: append ? historyCommits.length : 0 },
			(commit) => {
				if (gen === historyGen) historyCommits.push(commit);
			},
		)
		.then(({ count }) => {
			if (gen !== historyGen) return;
			olderBtn.hidden = count < HISTORY_PAGE;
			renderHistoryWindow();
		})
		.catch((error) => {
			if (gen !== historyGen) return;
			olderBtn.hidden = true;
			historyCommits = [];
			renderHistoryWindow();
			const item = document.createElement("li");
			item.textContent = `error: ${String(error)}`;
			historyList.append(item);
		})
		.finally(() => {
			// Serializes Older clicks: no duplicate pages from double-clicks
			// (CodeRabbit U0–U8 review).
			historyLoading = false;
			olderBtn.disabled = false;
			if (historyRefreshQueued) {
				historyRefreshQueued = false;
				refreshHistory();
			}
		});
}

function refreshBranches(): void {
	const { root } = store.get();
	if (!root) return;
	void getPlatform()
		.gitBranches(root)
		.then((list) => {
			branchSelect.innerHTML = "";
			for (const branch of list) {
				const option = document.createElement("option");
				option.value = branch.name;
				option.textContent = branch.current ? `● ${branch.name}` : branch.name;
				if (branch.current) option.selected = true;
				branchSelect.appendChild(option);
			}
		})
		.catch((error) => {
			writeError.textContent = String(error);
		});
}

/** Shows one commit's diff in the diff pane (commit vs its parent). */
function viewCommit(oid: string): void {
	store.set({
		...store.get(),
		diffMode: "range",
		diffFrom: `${oid}^`,
		diffTo: oid,
	});
	void refreshDiff();
	selectedOid = oid;
	renderHistoryWindow();
}

/** After the worktree itself changed (branch switch or successful pull):
 * tree paths + status + diff all refresh and the diff view returns to the
 * worktree mode. */
function afterWorktreeChange(): Promise<void> {
	const { root } = store.get();
	store.set({ ...store.get(), diffMode: "worktree", diffFrom: "", diffTo: "" });
	return refreshStatus()
		.then(() => {
			if (!root) return;
			return getPlatform()
				.gitWorktreePaths(root)
				.then((paths) => tree?.setPaths(paths));
		})
		.then(() => {
			refreshBranches();
			refreshHistory();
			return refreshDiff();
		});
}

branchSelect.addEventListener("change", () => {
	const { root } = store.get();
	const name = branchSelect.value;
	if (!root || !name) return;
	void getPlatform()
		.gitSwitchBranch(root, name)
		.then(() => afterWorktreeChange())
		.catch(showWriteError);
});

branchCreateBtn.addEventListener("click", () => {
	const { root } = store.get();
	const name = branchName.value.trim();
	if (!root || !name) {
		writeError.textContent = "Branch name is empty.";
		return;
	}
	void getPlatform()
		.gitCreateBranch(root, name, true)
		.then(() => {
			branchName.value = "";
			writeError.textContent = "";
			return afterWorktreeChange();
		})
		.catch(showWriteError);
});

olderBtn.addEventListener("click", () => refreshHistory(true));
historyList.addEventListener("scroll", queueHistoryWindowRender, {
	passive: true,
});

/** Samples requestAnimationFrame gaps while stepping the diff scroll — a
 * cheap jank proxy for the scroll-smoothness budget. SMOKE-only. */
function sampleScrollGaps(
	durationMs: number,
): Promise<{ maxGap: number; p95Gap: number }> {
	const gaps: number[] = [];
	let last = performance.now();
	const start = last;
	return new Promise((resolve) => {
		const step = (now: number) => {
			gaps.push(now - last);
			last = now;
			// Step the scroll; wrap at the bottom to keep frames flowing.
			diffContainer.scrollTop += Math.max(
				120,
				diffContainer.clientHeight * 0.15,
			);
			if (
				diffContainer.scrollTop + diffContainer.clientHeight >=
				diffContainer.scrollHeight - 1
			) {
				diffContainer.scrollTop = 0;
			}
			if (now - start >= durationMs) {
				const sorted = [...gaps].sort((a, b) => a - b);
				const p95 =
					sorted[
						Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))
					] ?? 0;
				resolve({ maxGap: sorted[sorted.length - 1] ?? 0, p95Gap: p95 });
				return;
			}
			requestAnimationFrame(step);
		};
		requestAnimationFrame(step);
	});
}

// ---- SMOKE=1 self-test (driven by the main process over RPC) ----
window.addEventListener("hmmagainagain:self-test", (event) => {
	const detail = (
		event as CustomEvent<{
			root: string;
			stage?: boolean;
			branch?: boolean;
		}>
	).detail;
	const root = detail.root;
	const run = async (): Promise<{ ok: boolean; detail: string }> => {
		const loadError = getPlatformLoadError();
		if (loadError) {
			return { ok: false, detail: `LOAD ERR: ${loadError}` };
		}
		const status = await getPlatform().gitStatus(root);
		await openRepo(root);
		// Let the tree render its rows before counting them.
		await new Promise((resolve) => setTimeout(resolve, 500));
		const treeRows = tree?.getRowCount() ?? 0;
		const statusItems = statusList.children.length;
		// Diff flow + stage timings (RON-297 budget evidence).
		const diffT0 = performance.now();
		await refreshDiff();
		const diffTotalMs = performance.now() - diffT0;
		// First diff paint, then sample frame gaps while scrolling.
		await new Promise((resolve) => requestAnimationFrame(resolve));
		const scroll = await sampleScrollGaps(1500);
		// SMOKE_STAGE=1: staging/commit flow — fixture repos ONLY.
		let stageDetail = "stage=off";
		let stageOk = true;
		if (detail.stage) {
			const first = status.entries[0]?.path;
			if (!first) {
				stageOk = false;
				stageDetail = "stage=no-entries";
			} else {
				await getPlatform().stagePaths(root, [first]);
				let st = await getPlatform().gitStatus(root);
				const stagedOk =
					(st.entries.find((e) => e.path === first)?.indexStatus ?? ".") !==
					".";
				await getPlatform().unstagePaths(root, [first]);
				st = await getPlatform().gitStatus(root);
				const unstagedOk =
					(st.entries.find((e) => e.path === first)?.indexStatus ?? ".") ===
					".";
				await getPlatform().stagePaths(root, [first]);
				await getPlatform().commit(root, "smoke: fixture commit");
				st = await getPlatform().gitStatus(root);
				const committedOk = !st.entries.some((e) => e.indexStatus !== ".");
				stageDetail = `stage staged=${stagedOk} unstaged=${unstagedOk} committed=${committedOk}`;
				stageOk = stagedOk && unstagedOk && committedOk;
			}
		}
		// SMOKE_BRANCH=1: branch create/switch flow — fixture repos ONLY.
		let branchDetail = "branch=off";
		let branchOk = true;
		if (detail.branch) {
			const smokeBranch = `u6-smoke-${Date.now()}`;
			await getPlatform().gitCreateBranch(root, smokeBranch, true);
			let list = await getPlatform().gitBranches(root);
			const createdOk = list.find((b) => b.current)?.name === smokeBranch;
			await getPlatform().gitSwitchBranch(root, "main");
			list = await getPlatform().gitBranches(root);
			const switchedOk = list.find((b) => b.current)?.name === "main";
			branchDetail = `branch created=${createdOk} switchedBack=${switchedOk}`;
			branchOk = createdOk && switchedOk;
		}
		const domOk =
			treeRows > 0 &&
			statusItems > 0 &&
			store.get().root === root &&
			(status.entries.length === 0 || diffTimings.files > 0) &&
			(!detail.stage || stageOk) &&
			(!detail.branch || branchOk);
		const detailText = `treeRows=${treeRows} statusItems=${statusItems} entries=${status.entries.length} diffFiles=${diffTimings.files} diffTotalMs=${diffTotalMs.toFixed(0)} fetchMs=${diffTimings.fetchMs.toFixed(0)} parseMs=${diffTimings.parseMs.toFixed(0)} scrollMaxGap=${scroll.maxGap.toFixed(1)} scrollP95Gap=${scroll.p95Gap.toFixed(1)} ${stageDetail} ${branchDetail}`;
		return { ok: domOk, detail: detailText };
	};
	void run()
		.then(({ ok, detail }) => sendSelfTestResult({ ok, detail }))
		.catch((error) => sendSelfTestResult({ ok: false, detail: String(error) }));
});

interface RecentRepos {
	recents: string[];
}
