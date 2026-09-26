// Wrapper around @pierre/trees — the ONLY module allowed to import it. The
// component is 1.0.0-beta.6 (preact-11-beta inside); this seam keeps it
// swappable if the API moves (ADR-0001 R1 mitigation).

import type { GitStatusEntry } from "@pierre/trees";
import { FileTree } from "@pierre/trees";

export interface TreeHandle {
	setPaths(paths: readonly string[]): void;
	setGitStatus(entries: readonly GitStatusEntry[]): void;
	/** Filters visible rows through the built-in search session. */
	setSearch(words: string | null): void;
	/** Folds every folder; decorations and the search session are kept. */
	collapseAll(): void;
	/** Unfolds every folder; decorations and the search session are kept. */
	expandAll(): void;
	/** Applies themeToTreeStyles output to the host container. The trees
	 * stylesheet reads --trees-theme-* through its fallback chain, and CSS
	 * custom properties inherit into the shadow tree — no FileTree API
	 * needed. CamelCase keys are plain inline styles (React-shaped output). */
	setTheme(styles: Record<string, string>): void;
	/** Rendered row count — lets callers assert the tree without shadow-DOM access. */
	getRowCount(): number;
	destroy(): void;
}

export function mountFileTree(
	container: HTMLElement,
	onSelect?: (path: string) => void,
): TreeHandle {
	// resetPaths rebuilds the row projection, so the wrapper replays the
	// cached inputs around it: expansion first, then decorations + search.
	let cachedPaths: readonly string[] = [];
	let cachedStatus: readonly GitStatusEntry[] = [];
	let cachedSearch: string | null = null;
	// Construction expansion is the only reliable fold control: a reset
	// with initialExpandedPaths: [] still opens everything when the base
	// expansion is "open" (upstream fast path), so folding remounts.
	let expansion: "open" | "closed" = "open";
	const createTree = (): FileTree => {
		const next = new FileTree({
			paths: [...cachedPaths],
			initialExpansion: expansion,
			// Workbench density + filterable (diffshub parity: compact rows).
			density: "compact",
			search: true,
			// Render buffer above/below the viewport. Upstream default is 10;
			// measured (RON-332, 20k-row synthetic tree, headless Chromium):
			// overscan 40 → 74fps, 10 → ~140fps, 4 → 211fps, 2 → 236fps.
			// Per-frame Preact cost dominates, so a small buffer buys the most
			// headroom; 4 keeps fast-fling coverage on 60Hz displays.
			// It does not fix the upstream event flood (sync update per scroll
			// event, no frame coalescing) — that needs an upstream change.
			overscan: 4,
			// Our own filter box + the / shortcut drive the search session, so
			// the built-in box is redundant chrome. Hidden through the supported
			// unsafeCSS shadow seam — the box carries a data attribute, not a
			// class (upstream style.js targets [data-file-tree-search-*]).
			unsafeCSS: "[data-file-tree-search-container]{display:none}",
			// Row clicks jump the diff view (wired by the caller); folders
			// select too, and the caller ignores what has no diff item.
			onSelectionChange: (paths) => {
				const first = paths[0];
				if (first !== undefined) onSelect?.(first);
			},
		});
		next.render({ containerWrapper: container });
		next.setGitStatus(cachedStatus);
		next.setSearch(cachedSearch);
		return next;
	};
	let tree = createTree();
	const refold = (next: "open" | "closed"): void => {
		if (expansion === next) return;
		expansion = next;
		tree.cleanUp();
		// cleanUp disconnects but leaves the host element behind; clear it
		// so the remount is the only tree in the container.
		container.innerHTML = "";
		tree = createTree();
	};
	return {
		setPaths: (paths) => {
			cachedPaths = paths;
			tree.resetPaths(paths);
		},
		setSearch: (words) => {
			cachedSearch = words;
			tree.setSearch(words);
		},
		setGitStatus: (entries) => {
			cachedStatus = entries;
			tree.setGitStatus(entries);
		},
		collapseAll: () => refold("closed"),
		expandAll: () => refold("open"),
		setTheme: (styles) => {
			for (const [key, value] of Object.entries(styles)) {
				if (key.startsWith("--")) container.style.setProperty(key, value);
				else
					container.style.setProperty(
						key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`),
						value,
					);
			}
		},
		getRowCount: () => tree.getVisibleCount(),
		destroy: () => tree.cleanUp(),
	};
}

export type { GitStatusEntry };
