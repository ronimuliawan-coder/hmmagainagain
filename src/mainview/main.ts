import "./style.css";
import type { GitDiffOptions, GitStatus, RepoInfo } from "../shared/platform";
import {
	type DiffStyle,
	type DiffViewHandle,
	mountDiffView,
} from "./diff-view-wrapper";
import { mountFileTree, type TreeHandle } from "./file-tree-wrapper";
import { statusToTreeEntries } from "./git-status-mapping";
import { buildStagedPatch } from "./patch-surgery";
import { getPlatform, sendSelfTestResult } from "./platform";
import { createStore } from "./store";

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
// Stage timings of the last diff load — read by the SMOKE self-test.
const diffTimings = { fetchMs: 0, parseMs: 0, files: 0 };
// The patch behind the current diff view + the user's line selection in it —
// the inputs to hunk staging (patch surgery).
let lastPatch = "";
let lastSelection: { path: string; start: number; end: number } | null = null;

function readRecents(): RecentRepos {
	try {
		const raw = localStorage.getItem(RECENTS_KEY);
		if (raw) return JSON.parse(raw) as RecentRepos;
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
	repoInfo.textContent = `${info.branch} · ${info.head.slice(0, 7)} · ${status.entries.length} change(s)`;
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
	try {
		const t0 = performance.now();
		const result = await getPlatform().gitDiff(
			state.root,
			diffOptionsFor(state),
		);
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
	return `${info.branch} · ${info.head.slice(0, 7)} · ${status.entries.length} change(s)`;
}

openBtn.addEventListener("click", () => {
	const root = repoInput.value.trim();
	if (!root) return;
	openRepo(root)
		.then((summary) => {
			repoInfo.textContent = summary;
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
			return refreshStatus().then(() => refreshDiff());
		})
		.catch(showWriteError);
});

renderRecents();

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
	const detail = (event as CustomEvent<{ root: string; stage?: boolean }>)
		.detail;
	const root = detail.root;
	const run = async (): Promise<{ ok: boolean; detail: string }> => {
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
		const domOk =
			treeRows > 0 &&
			statusItems > 0 &&
			store.get().root === root &&
			(status.entries.length === 0 || diffTimings.files > 0) &&
			(!detail.stage || stageOk);
		const detailText = `treeRows=${treeRows} statusItems=${statusItems} entries=${status.entries.length} diffFiles=${diffTimings.files} diffTotalMs=${diffTotalMs.toFixed(0)} fetchMs=${diffTimings.fetchMs.toFixed(0)} parseMs=${diffTimings.parseMs.toFixed(0)} scrollMaxGap=${scroll.maxGap.toFixed(1)} scrollP95Gap=${scroll.p95Gap.toFixed(1)} ${stageDetail}`;
		return { ok: domOk, detail: detailText };
	};
	void run().then(({ ok, detail }) => sendSelfTestResult({ ok, detail }));
});

interface RecentRepos {
	recents: string[];
}
