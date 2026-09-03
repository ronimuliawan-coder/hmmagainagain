import "./style.css";
import type { GitStatus, RepoInfo } from "../shared/platform";
import { mountFileTree, type TreeHandle } from "./file-tree-wrapper";
import { statusToTreeEntries } from "./git-status-mapping";
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

interface AppState {
	/** Opened repository root ("" when none). */
	root: string;
	info: RepoInfo | null;
	status: GitStatus | null;
}

const store = createStore<AppState>({ root: "", info: null, status: null });

let tree: TreeHandle | null = null;
let watcher: { stop: () => Promise<void> } | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

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
		const letter = document.createElement("span");
		const active =
			entry.worktreeStatus !== "." ? entry.worktreeStatus : entry.indexStatus;
		// CSS classes can't carry raw porcelain letters (?, ., !) — slug them.
		letter.className = `status-letter status-${statusSlug(active)}`;
		letter.textContent = active;
		const label = document.createElement("span");
		label.className = "status-path";
		label.textContent =
			entry.renamedFrom !== undefined
				? `${entry.renamedFrom} → ${entry.path}`
				: entry.path;
		item.append(letter, label);
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
}

store.subscribe(render);

async function refreshStatus(): Promise<void> {
	const { root } = store.get();
	if (!root) return;
	const status = await getPlatform().gitStatus(root);
	const info = await getPlatform().readRepo(root);
	store.set({ root, info, status });
}

function scheduleStatusRefresh(): void {
	if (refreshTimer) clearTimeout(refreshTimer);
	refreshTimer = setTimeout(() => {
		void refreshStatus().catch(() => {});
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

	// Watcher-driven refresh: one subscription per open repository.
	if (watcher) await watcher.stop();
	watcher = await getPlatform().watchRepo(root, scheduleStatusRefresh);

	saveRecent(root);
	store.set({ root, info, status });
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

renderRecents();

// ---- SMOKE=1 self-test (driven by the main process over RPC) ----
window.addEventListener("hmmagainagain:self-test", (event) => {
	const root = (event as CustomEvent<{ root: string }>).detail.root;
	const run = async (): Promise<{ ok: boolean; detail: string }> => {
		const status = await getPlatform().gitStatus(root);
		await openRepo(root);
		// Let the tree render its rows before counting them.
		await new Promise((resolve) => setTimeout(resolve, 500));
		const treeRows = tree?.getRowCount() ?? 0;
		const statusItems = statusList.children.length;
		const domOk = treeRows > 0 && statusItems > 0 && store.get().root === root;
		const detail = `treeRows=${treeRows} statusItems=${statusItems} entries=${status.entries.length}`;
		return { ok: domOk, detail };
	};
	void run().then(({ ok, detail }) => sendSelfTestResult({ ok, detail }));
});

interface RecentRepos {
	recents: string[];
}
