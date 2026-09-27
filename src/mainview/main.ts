import "./style.css";
import { themeToTreeStyles } from "@pierre/trees";
import type {
	GitDiffOptions,
	GitStatus,
	LogCommit,
	RepoInfo,
} from "../shared/platform";
import { deriveChromeTokens } from "./chrome-tokens";
import {
	type DiffStyle,
	type DiffViewHandle,
	mountDiffView,
	recoverRenderOnInvariant,
} from "./diff-view-wrapper";
import { mountFileTree, type TreeHandle } from "./file-tree-wrapper";
import { statusToTreeEntries } from "./git-status-mapping";
import { FALLBACK_ROW_HEIGHT, windowRows } from "./history-window";
import { buildStagedPatch } from "./patch-surgery";
import { patchToItems } from "./patch-to-items";
import { getPlatform, isTauri } from "./platform";
import { enableSmoothWheel } from "./smooth-wheel";
import { staticTheme } from "./static-themes";
import { isStagedStatus, renderStatusList } from "./status-list";
import { createStore } from "./store";
import {
	cycleThemeVariant,
	knownThemeNames,
	parseStoredTheme,
	pierreThemeName,
	type ShellTheme,
	themeVariantLabel,
	themeVariantTitle,
} from "./theme-names";

// Mouse-wheel input arrives notched; WebKit applies it as instant jumps.
// Glide it instead (touchpads, pinch-zoom, and reduced-motion stay native).
enableSmoothWheel();

// U8b cold-start proxy: first compositor frame in the webview, on the shared
// Date.now wall clock. Surfaces in main-process output only if Electrobun
// forwards webview console output; its absence is itself a finding (proxy
// falls back to the main-ready marker with a stated limit).
requestAnimationFrame(() => {
	console.log(`[STARTUP] first-frame wall=${Date.now()}`);
});

const RECENTS_KEY = "hmmagainagain.recents";
const THEME_KEY = "hmmagainagain.theme";
const TAB_KEY = "hmmagainagain.sidebar-tab";
const REFRESH_DEBOUNCE_MS = 300;

/** Fail-fast lookup: a missing id is a template/TS mismatch, not a runtime case. */
function byId<T extends HTMLElement>(id: string): T {
	const element = document.getElementById(id);
	if (!element) throw new Error(`missing element #${id}`);
	return element as T;
}

const treeContainer = byId<HTMLDivElement>("tree-container");
const statusList = byId<HTMLUListElement>("status-list");
const repoInfo = byId<HTMLSpanElement>("repo-info");
const repoInput = byId<HTMLInputElement>("repo-path");
const openBtn = byId<HTMLButtonElement>("open-btn");
const browseBtn = byId<HTMLButtonElement>("browse-btn");
const themeBtn = byId<HTMLButtonElement>("theme-btn");
const themeStyleBtn = byId<HTMLButtonElement>("theme-style-btn");
const treeFilter = byId<HTMLInputElement>("tree-filter");
const treeToggleBtn = byId<HTMLButtonElement>("tree-toggle-btn");
const welcome = byId<HTMLDivElement>("welcome");
const welcomeRecents = byId<HTMLDivElement>("welcome-recents");
const welcomeBrowse = byId<HTMLButtonElement>("welcome-browse");
const diffToolbar = byId<HTMLDivElement>("diff-toolbar");
const sidebarFooter = byId<HTMLElement>("sidebar-footer");
const changesCount = byId<HTMLSpanElement>("changes-count");
const tabButtons = [
	...document.querySelectorAll<HTMLButtonElement>("#sidebar-tabs [data-tab]"),
];
const tabPanes = [...document.querySelectorAll<HTMLElement>("[data-tabpane]")];
const diffContainer = byId<HTMLDivElement>("diff-container");
const diffInfo = byId<HTMLSpanElement>("diff-info");
const rangeButtons = [
	...document.querySelectorAll<HTMLButtonElement>(
		"#diff-toolbar [data-diff-range]",
	),
];
const diffApplyBtn = byId<HTMLButtonElement>("diff-range-apply");
const fileViewBackBtn = byId<HTMLButtonElement>("fileview-back");
const diffFromInput = byId<HTMLInputElement>("diff-from");
const diffToInput = byId<HTMLInputElement>("diff-to");
const unifiedBtn = byId<HTMLButtonElement>("diff-style-unified");
const splitBtn = byId<HTMLButtonElement>("diff-style-split");
const stageSelectedBtn = byId<HTMLButtonElement>("stage-selected-btn");
const commitMessage = byId<HTMLTextAreaElement>("commit-message");
const commitBtn = byId<HTMLButtonElement>("commit-btn");
const stagedCount = byId<HTMLSpanElement>("staged-count");
const writeError = byId<HTMLPreElement>("write-error");
const historyList = byId<HTMLDivElement>("history-list");
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
// Stage timings of the last diff load (perf telemetry for the budget).
const diffTimings = { fetchMs: 0, parseMs: 0, files: 0 };
// The patch behind the current diff view + the user's line selection in it —
// the inputs to hunk staging (patch surgery).
let lastPatch = "";
let lastSelection: { path: string; start: number; end: number } | null = null;

// Render-race self-heal (upstream race, no API to serialize on): one fresh
// setPatch per window when the invariant fires. Installed once.
recoverRenderOnInvariant(
	() => diffView,
	() => lastPatch,
);

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
	repoInfo.innerHTML = "";
	// Span-as-button (not <button>): WebKitGTK paints native button chrome
	// (prelight on hover) that no appearance:none reliably kills, which
	// read as link-blue. Keyboard parity via keydown.
	const branch = document.createElement("span");
	branch.className = "repo-branch";
	branch.textContent = info.branch;
	branch.tabIndex = 0;
	branch.setAttribute("role", "button");
	branch.title = "Switch branch (History)";
	const openHistory = (): void => {
		setTab("history");
		branchSelect.focus();
	};
	branch.addEventListener("click", openHistory);
	branch.addEventListener("keydown", (event) => {
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			openHistory();
		}
	});
	const head = document.createElement("span");
	head.className = "repo-head";
	head.textContent = info.head.slice(0, 7);
	const count = document.createElement("span");
	count.className = "repo-count";
	const total = status.entries.length;
	count.textContent = total === 1 ? "1 change" : `${total} changes`;
	repoInfo.append(branch, head, count);
	const { ahead, behind } = status.branch;
	if (ahead !== undefined || behind !== undefined) {
		const sync = document.createElement("span");
		sync.className = "repo-ahead";
		const parts: string[] = [];
		if (ahead !== undefined && ahead > 0) parts.push(`↑${ahead}`);
		if (behind !== undefined && behind > 0) parts.push(`↓${behind}`);
		sync.textContent = parts.join(" ");
		if (sync.textContent) repoInfo.append(sync);
	}
	// Never re-enable mid-operation: watcher-driven renders fire while a
	// remote op is in flight (CodeRabbit U0–U8 review). Cancel stays on its
	// own lifecycle in runRemote.
	pushBtn.disabled = remoteOpRunning;
	pullBtn.disabled = remoteOpRunning;
	fetchBtn.disabled = remoteOpRunning;
}

/** Single render path: every state change paints through here. */
let lastStatusKey: string | null = null;
const statusKey = (
	entries: readonly {
		path: string;
		indexStatus: string;
		worktreeStatus: string;
		renamedFrom?: string;
	}[],
): string =>
	entries
		.map(
			(e) =>
				`${e.path}:${e.indexStatus}:${e.worktreeStatus}:${e.renamedFrom ?? ""}`,
		)
		.join("\n");

function render(state: AppState): void {
	renderWelcome(state.root);
	if (state.status) {
		// Watcher refreshes fire on background churn (editors rewriting
		// generated files); rebuilding the list each time flickers hover
		// under a stationary cursor. Identical entries repaint identically,
		// so skip the rebuild — and the tree decoration pass with it.
		const key = statusKey(state.status.entries);
		if (key !== lastStatusKey) {
			lastStatusKey = key;
			renderStatusList(statusList, state.status.entries, {
				onToggle: (path, unstage, renamedFrom) =>
					void runWriteAction(path, unstage, renamedFrom),
				onJump: (path) => diffView?.scrollToFile(path),
				onToggleAll: (unstage) =>
					void runBulkWrite(state.status?.entries ?? [], unstage),
			});
			tree?.setGitStatus(statusToTreeEntries(state.status.entries));
		}
	}
	if (state.info && state.status) renderRepoInfo(state.info, state.status);
	if (state.status) {
		const staged = state.status.entries.filter((e) =>
			isStagedStatus(e.indexStatus),
		).length;
		stagedCount.textContent = `${staged} staged`;
		commitBtn.disabled = staged === 0;
		const total = state.status.entries.length;
		changesCount.textContent = total > 0 ? String(total) : "";
	}
	for (const button of rangeButtons) {
		button.classList.toggle(
			"active",
			button.dataset.diffRange === state.diffMode,
		);
	}
	// Keep the range inputs honest: history clicks set the range behind them.
	if (document.activeElement !== diffFromInput)
		diffFromInput.value = state.diffFrom;
	if (document.activeElement !== diffToInput) diffToInput.value = state.diffTo;
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
	if (!diffView)
		diffView = mountDiffView(
			diffContainer,
			handleDiffSelection,
			codeThemeNames(),
			shellTheme.scheme,
		);
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
		showDiffResult(result.patch, result.files.length);
		const parseMs = performance.now() - t1;
		diffTimings.fetchMs = fetchMs;
		diffTimings.parseMs = parseMs;
		diffTimings.files = result.files.length;
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

/** Single file view (tree clicks on changeless files): the viewer shows one
 * file item instead of the diff list. Null = diff list mode. */
let fileView: { path: string; contents: string } | null = null;

/** Paints file-view mode chrome: the way back + what is shown. */
function paintFileView(): void {
	fileViewBackBtn.hidden = fileView === null;
	if (fileView) diffInfo.textContent = fileView.path;
}

/** Leaves file-view mode, restoring the diff list + count. */
function exitFileView(): void {
	fileView = null;
	if (diffView) {
		diffView.setPatch(lastPatch);
		diffInfo.textContent = `${patchToItems(lastPatch).paths.length} file(s)`;
	}
	paintFileView();
}

/** Paints a patch, preserving an active file view when it still applies. */
function showDiffResult(patch: string, count: number): void {
	if (!diffView) return;
	const current = fileView;
	if (current !== null) {
		if (patchToItems(patch).paths.includes(current.path)) {
			// The file gained a diff: back to list mode, jumped to it.
			const target = current.path;
			exitFileView();
			diffView.scrollToFile(target);
		} else {
			// Still changeless: keep the file view (re-read below).
			void refreshFileView(current.path);
			return;
		}
	} else {
		diffView.setPatch(patch);
		diffInfo.textContent = `${count} file(s)`;
	}
}

/** Opens a tree file: jump when it has a diff item, else read its full
 * text into a single-file view. Read failures surface verbatim. */
async function openTreeFile(path: string): Promise<void> {
	const { root } = store.get();
	if (!root || !diffView) return;
	if (patchToItems(lastPatch).paths.includes(path)) {
		fileView = null;
		diffView.scrollToFile(path);
		return;
	}
	try {
		const contents = await getPlatform().readFileText(root, path);
		fileView = { path, contents };
		diffView.showFile(path, contents);
		paintFileView();
	} catch (error) {
		showWriteError(error);
	}
}

/** Re-reads the open file view (watcher ticks must not strand stale text). */
async function refreshFileView(path: string): Promise<void> {
	const { root } = store.get();
	if (!root || !diffView) {
		fileView = null;
		return;
	}
	try {
		const contents = await getPlatform().readFileText(root, path);
		fileView = { path, contents };
		diffView.showFile(path, contents);
		paintFileView();
	} catch {
		exitFileView();
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

async function openRepo(root: string): Promise<void> {
	const [status, info, paths] = await Promise.all([
		getPlatform().gitStatus(root),
		getPlatform().readRepo(root),
		getPlatform().gitWorktreePaths(root),
	]);
	if (!tree)
		tree = mountFileTree(treeContainer, (path) => {
			void openTreeFile(path);
		});
	tree.setPaths(paths);
	treeFilter.value = "";
	tree.setSearch(null);
	// Fresh tree views start expanded; the toggle owns the state after.
	setTreeExpanded(true);
	applyPierreTheme();
	if (!diffView)
		diffView = mountDiffView(
			diffContainer,
			handleDiffSelection,
			codeThemeNames(),
			shellTheme.scheme,
		);

	// Watcher-driven refresh: one subscription per open repository.
	if (watcher) await watcher.stop();
	watcher = await getPlatform().watchRepo(root, scheduleStatusRefresh);

	saveRecent(root);
	store.set({ ...store.get(), root, info, status });
	void refreshDiff();
	refreshBranches();
	refreshHistory();
}

openBtn.addEventListener("click", () => {
	const root = repoInput.value.trim();
	if (!root) return;
	pushBtn.disabled = true;
	pullBtn.disabled = true;
	fetchBtn.disabled = true;
	openRepo(root)
		.then(() => {
			pushBtn.disabled = false;
			pullBtn.disabled = false;
			fetchBtn.disabled = false;
		})
		.catch((error) => {
			repoInfo.textContent = `error: ${String(error)}`;
		});
});

// Native folder picker (main-process Gtk dialog). Hidden in plain-browser
// dev: the fake has no dialog and must never learn absolute paths.
browseBtn.hidden = !isTauri();
browseBtn.addEventListener("click", () => {
	void getPlatform()
		.pickDirectory()
		.then((picked) => {
			// Null = the user cancelled — leave the input alone, silently.
			if (!picked) return;
			repoInput.value = picked;
			openBtn.click();
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

async function runWriteAction(
	path: string,
	unstage: boolean,
	renamedFrom?: string,
): Promise<void> {
	const { root } = store.get();
	if (!root) return;
	// Renames travel as both sides: staging or unstaging the destination
	// alone leaves a half-staged split (verified: restore --staged on the
	// new path keeps the source deletion staged).
	const paths = renamedFrom === undefined ? [path] : [renamedFrom, path];
	try {
		if (unstage) await getPlatform().unstagePaths(root, paths);
		else await getPlatform().stagePaths(root, paths);
		writeError.textContent = "";
		await refreshStatus();
		const { diffMode } = store.get();
		if (diffMode === "worktree" || diffMode === "staged") await refreshDiff();
	} catch (error) {
		showWriteError(error);
	}
}

/** Stage-all / Unstage-all: one index write for the whole side. Empty is a
 * no-op (headers only render for non-empty sides, so this is defensive). */
async function runBulkWrite(
	entries: readonly {
		path: string;
		indexStatus: string;
		worktreeStatus: string;
		renamedFrom?: string;
	}[],
	unstage: boolean,
): Promise<void> {
	const { root } = store.get();
	if (!root) return;
	const paths = entries
		.filter((e) =>
			unstage ? isStagedStatus(e.indexStatus) : e.worktreeStatus !== ".",
		)
		.flatMap((e) =>
			e.renamedFrom !== undefined ? [e.path, e.renamedFrom] : [e.path],
		);
	if (paths.length === 0) return;
	try {
		if (unstage) await getPlatform().unstagePaths(root, paths);
		else await getPlatform().stagePaths(root, paths);
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

fileViewBackBtn.addEventListener("click", () => {
	exitFileView();
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
// Initial paint before any store change: welcome owns the empty state.
renderWelcome(store.get().root);

// ---- Theme (PRD SHOULD: light/dark + Pierre variants). CodeView follows
// the page color-scheme via light-dark(); the pool takes variant names that
// resolve through diffs' theming catalog, and the tree gets themeToTreeStyles
// on its host container (custom properties inherit into the shadow tree).
let shellTheme: ShellTheme = { scheme: "dark", variant: "default" };

/** CodeView pool names, falling back to the canonical pair when the
 * catalog no longer knows a variant (upstream rename resilience). */
function codeThemeNames(): { light: string; dark: string } {
	const known = knownThemeNames();
	const pick = (scheme: "light" | "dark"): string => {
		const name = pierreThemeName(scheme, shellTheme.variant);
		return known.includes(name) ? name : `pierre-${scheme}`;
	};
	return { light: pick("light"), dark: pick("dark") };
}

function persistTheme(): void {
	try {
		localStorage.setItem(THEME_KEY, JSON.stringify(shellTheme));
	} catch {
		// storage unavailable — theme is best-effort
	}
}

/** Applies the bundled Pierre theme to the shell chrome and the file tree.
 * Synchronous: themes are statically imported (static-themes.ts) because the
 * dynamic resolveTheme path fails to import variant chunks in webview
 * runtimes (RON-340). Failures still clear stale inline vars so the
 * [data-theme] stylesheet values take over, and log the reason. */
let appliedChromeKeys: string[] = [];

function applyPierreTheme(): void {
	try {
		const theme = staticTheme(shellTheme.scheme, shellTheme.variant);
		const tokens = deriveChromeTokens(theme, shellTheme.scheme);
		appliedChromeKeys = Object.keys(tokens);
		for (const [key, value] of Object.entries(tokens)) {
			document.documentElement.style.setProperty(key, value);
		}
		tree?.setTheme(themeToTreeStyles(theme));
	} catch (error) {
		for (const key of appliedChromeKeys) {
			document.documentElement.style.removeProperty(key);
		}
		appliedChromeKeys = [];
		console.warn(`[theme] static theme apply failed: ${String(error)}`);
	}
}

function applyTheme(next: ShellTheme): void {
	shellTheme = next;
	document.documentElement.dataset.theme = next.scheme;
	themeBtn.textContent = next.scheme === "dark" ? "Light" : "Dark";
	themeBtn.setAttribute("aria-pressed", String(next.scheme === "light"));
	themeStyleBtn.textContent = themeVariantLabel(next.variant);
	themeStyleBtn.title = themeVariantTitle(next.variant);
	persistTheme();
	// The worker pool binds theme names at creation: remount the diff view
	// so the variant takes effect, restoring patch + style after.
	if (diffView) {
		const style = store.get().diffStyle;
		diffView.destroy();
		diffView = mountDiffView(
			diffContainer,
			handleDiffSelection,
			codeThemeNames(),
			shellTheme.scheme,
		);
		if (lastPatch) diffView.setPatch(lastPatch);
		if (fileView) diffView.showFile(fileView.path, fileView.contents);
		diffView.setDiffStyle(style);
	}
	applyPierreTheme();
}

{
	let stored: string | null = null;
	try {
		stored = localStorage.getItem(THEME_KEY);
	} catch {
		// storage unavailable — fall back to dark
	}
	shellTheme = parseStoredTheme(stored);
	if (stored === null) {
		try {
			if (matchMedia("(prefers-color-scheme: light)").matches) {
				shellTheme = { ...shellTheme, scheme: "light" };
			}
		} catch {
			// matchMedia unavailable — fall back to dark
		}
	}
	applyTheme(shellTheme);
}

themeBtn.addEventListener("click", () => {
	applyTheme({
		...shellTheme,
		scheme: shellTheme.scheme === "light" ? "dark" : "light",
	});
});

themeStyleBtn.addEventListener("click", () => {
	applyTheme({ ...shellTheme, variant: cycleThemeVariant(shellTheme.variant) });
});

// ---- Sidebar tabs (Files | Changes | History) ----
type SidebarTab = "files" | "changes" | "history";

function setTab(tab: SidebarTab): void {
	for (const button of tabButtons) {
		button.setAttribute("aria-selected", String(button.dataset.tab === tab));
	}
	for (const pane of tabPanes) {
		pane.hidden = pane.dataset.tabpane !== tab;
	}
	try {
		localStorage.setItem(TAB_KEY, tab);
	} catch {
		// storage unavailable — tab is best-effort
	}
}

{
	let initial: SidebarTab = "changes";
	try {
		const stored = localStorage.getItem(TAB_KEY);
		if (stored === "files" || stored === "changes" || stored === "history") {
			initial = stored;
		}
	} catch {
		// storage unavailable — fall back to changes
	}
	setTab(initial);
}

for (const button of tabButtons) {
	button.addEventListener("click", () => {
		const tab = button.dataset.tab;
		if (tab === "files" || tab === "changes" || tab === "history") {
			setTab(tab);
		}
	});
}

// ---- Welcome (no repository open yet) ----
function renderWelcome(root: string): void {
	const open = root !== "";
	welcome.hidden = open;
	diffToolbar.hidden = !open;
	diffContainer.hidden = !open;
	// The commit box is dead chrome with no repo (0 staged, disabled
	// Commit) — the welcome overlay owns the empty state instead.
	sidebarFooter.hidden = !open;
	if (open) return;
	welcomeRecents.innerHTML = "";
	for (const recent of readRecents().recents) {
		const item = document.createElement("button");
		item.type = "button";
		item.className = "welcome-recent";
		item.textContent = recent;
		item.title = recent;
		item.addEventListener("click", () => {
			repoInput.value = recent;
			openBtn.click();
		});
		welcomeRecents.append(item);
	}
}

welcomeBrowse.addEventListener("click", () => {
	if (!browseBtn.hidden) browseBtn.click();
	else {
		repoInput.focus();
		repoInfo.textContent = "Type a repository path, then Open.";
	}
});

// ---- Tree filter + fold toggle + global shortcuts ----
// Typing anywhere except a text control: / filters files, 1/2/3 switch tabs.
treeFilter.addEventListener("input", () => {
	tree?.setSearch(treeFilter.value.trim() || null);
});

let treeExpanded = true;

function setTreeExpanded(expanded: boolean): void {
	treeExpanded = expanded;
	treeToggleBtn.textContent = expanded ? "Collapse all" : "Expand all";
	if (expanded) tree?.expandAll();
	else tree?.collapseAll();
}

treeToggleBtn.addEventListener("click", () => {
	setTreeExpanded(!treeExpanded);
});

document.addEventListener("keydown", (event) => {
	const target = event.target as HTMLElement | null;
	const typing =
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement ||
		target?.isContentEditable;
	if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
	if (event.key === "/") {
		event.preventDefault();
		setTab("files");
		treeFilter.focus();
	} else if (event.key === "1") {
		setTab("files");
	} else if (event.key === "2") {
		setTab("changes");
	} else if (event.key === "3") {
		setTab("history");
	} else if (event.key === "Escape" && fileView) {
		exitFileView();
	}
});

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
// Ctrl-click compare anchor (PRD secondary flow: diff any two commits).
let compareAnchor: string | null = null;
let historyScrollQueued = false;

function buildCommitRow(commit: LogCommit): HTMLElement {
	const item = document.createElement("div");
	item.className = "history-row";
	item.dataset.oid = commit.oid;
	item.setAttribute("role", "option");
	item.setAttribute("aria-selected", "false");
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
	item.addEventListener("click", (event) => {
		if (event.ctrlKey || event.metaKey || event.shiftKey)
			compareCommits(commit.oid);
		else viewCommit(commit.oid);
	});
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
	if (total === 0) {
		// Fresh repos (unborn HEAD) have no commits; without an open repo
		// the welcome overlay owns the empty state instead.
		if (store.get().root) {
			const empty = document.createElement("div");
			empty.className = "history-empty";
			empty.textContent = "No commits yet.";
			historyList.append(empty);
		}
		return;
	}
	const top = document.createElement("div");
	top.className = "history-spacer";
	top.setAttribute("aria-hidden", "true");
	top.style.height = `${win.topPad}px`;
	historyList.append(top);
	for (let i = win.start; i < win.end; i++) {
		const row = buildCommitRow(historyCommits[i]);
		const selected = historyCommits[i].oid === selectedOid;
		if (selected) row.classList.add("selected");
		row.setAttribute("aria-selected", String(selected));
		if (historyCommits[i].oid === compareAnchor) row.classList.add("compare");
		historyList.append(row);
	}
	const bottom = document.createElement("div");
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
			const item = document.createElement("div");
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
				if (branch.remote === true) option.dataset.remote = "true";
				branchSelect.appendChild(option);
			}
		})
		.catch((error) => {
			writeError.textContent = String(error);
		});
}

/** Shows one commit's diff in the diff pane (commit vs its parent). */
function viewCommit(oid: string): void {
	compareAnchor = null;
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

/** Shows the diff between any two history commits (PRD secondary flow).
 * Click order doesn't matter: the older commit is always `from`. */
function compareCommits(oid: string): void {
	if (!compareAnchor || compareAnchor === oid) {
		compareAnchor = oid;
		selectedOid = oid;
		renderHistoryWindow();
		return;
	}
	const anchorIdx = historyCommits.findIndex((c) => c.oid === compareAnchor);
	const oidIdx = historyCommits.findIndex((c) => c.oid === oid);
	if (anchorIdx === -1 || oidIdx === -1) {
		// History reloaded under the anchor (branch switch, pull) — re-anchor.
		compareAnchor = oidIdx === -1 ? null : oid;
		selectedOid = compareAnchor;
		renderHistoryWindow();
		return;
	}
	// History is newest-first: the larger index is the older commit.
	const [older, newer] =
		anchorIdx > oidIdx ? [compareAnchor, oid] : [oid, compareAnchor as string];
	compareAnchor = older;
	selectedOid = newer;
	store.set({
		...store.get(),
		diffMode: "range",
		diffFrom: older,
		diffTo: newer,
	});
	void refreshDiff();
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
				.then((paths) => {
					tree?.setPaths(paths);
					setTreeExpanded(true);
				});
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
	const remote = branchSelect.selectedOptions[0]?.dataset.remote === "true";
	void (
		remote
			? getPlatform().gitSwitchRemoteBranch(root, name)
			: getPlatform().gitSwitchBranch(root, name)
	)
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

// Keyboard-first history (PRD SHOULD): arrows walk commits, Enter's
// implicit — every step views, like a click.
historyList.addEventListener("keydown", (event) => {
	if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
	event.preventDefault();
	if (historyCommits.length === 0) return;
	const current = historyCommits.findIndex((c) => c.oid === selectedOid);
	const next =
		current === -1
			? 0
			: Math.min(
					historyCommits.length - 1,
					Math.max(0, current + (event.key === "ArrowDown" ? 1 : -1)),
				);
	viewCommit(historyCommits[next].oid);
	historyList
		.querySelector(".history-row.selected")
		?.scrollIntoView({ block: "nearest" });
});

// Enter submits the two text-box actions (repo open, branch create).
repoInput.addEventListener("keydown", (event) => {
	if (event.key === "Enter") openBtn.click();
});
branchName.addEventListener("keydown", (event) => {
	if (event.key === "Enter") branchCreateBtn.click();
});

interface RecentRepos {
	recents: string[];
}
