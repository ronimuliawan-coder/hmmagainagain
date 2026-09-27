// Wrapper around @pierre/diffs CodeView — the ONLY module allowed to import it
// (mirror of file-tree-wrapper.ts). Owns the shared worker pool so Shiki
// highlighting runs off the main thread (RON-297). The pool is a module-wide
// singleton upstream; we create it lazily here and terminate on destroy.

import { CodeView } from "@pierre/diffs";
import {
	getOrCreateWorkerPoolSingleton,
	terminateWorkerPoolSingleton,
} from "@pierre/diffs/worker";
import { patchToItems } from "./patch-to-items";

export type DiffStyle = "unified" | "split";

const POOL_SIZE = 4;
// Practical default language set for a git client; Shiki resolves these from
// its bundled grammars. Extend only when a repo in the wild needs it.
const HIGHLIGHT_LANGS = [
	"bash",
	"c",
	"cpp",
	"css",
	"go",
	"html",
	"javascript",
	"json",
	"jsx",
	"markdown",
	"python",
	"rust",
	"tsx",
	"typescript",
	"yaml",
];

const THEME = { light: "pierre-light", dark: "pierre-dark" } as const;

export interface DiffViewHandle {
	/** Parses the unified patch and replaces the list (one item per file). */
	setPatch(patch: string): void;
	/** Scrolls the given file's diff item into view. */
	scrollToFile(path: string): void;
	/** Shows one file's full text, replacing the diff list (file viewer;
	 * ids are file:-prefixed so they never collide with diff: items). */
	showFile(path: string, contents: string): void;
	setDiffStyle(style: DiffStyle): void;
	destroy(): void;
}

export interface CodeThemeNames {
	light: string;
	dark: string;
}

/** Invariant failure the renderer throws when a render pass walks hunk
 * indices against incompletely tokenized lines (async overlap between
 * successive renders — upstream #964 mechanism). A fresh setPatch with
 * the same patch recomputes cleanly, which is exactly the manual action
 * that clears it in-app. */
const RENDER_RACE_MESSAGE = "deletionLine and additionLine are null";

/** Installs a narrow self-heal: on the render-race invariant only, redo
 * the current patch once per window (guarded against loops). Returns an
 * uninstaller. Upstream owns the real fix; this keeps one poisoned frame
 * from killing the pane in the meantime. */
export function recoverRenderOnInvariant(
	getViewer: () => { setPatch(patch: string): void } | null,
	getPatch: () => string,
): () => void {
	let lastRecovery = 0;
	const onError = (event: Event): void => {
		// ErrorEvent in browsers; plain shape keeps this testable without
		// DOM globals (bun has no ErrorEvent).
		const message =
			typeof ErrorEvent !== "undefined" && event instanceof ErrorEvent
				? event.message
				: String((event as { message?: unknown }).message ?? event);
		if (!message.includes(RENDER_RACE_MESSAGE)) return;
		const now = Date.now();
		if (now - lastRecovery < 5000) return;
		lastRecovery = now;
		console.warn(`[diff] render race detected, re-rendering: ${message}`);
		const viewer = getViewer();
		const patch = getPatch();
		if (viewer && patch) viewer.setPatch(patch);
	};
	window.addEventListener("error", onError);
	return () => window.removeEventListener("error", onError);
}

const DEFAULT_THEME_NAMES: CodeThemeNames = { ...THEME };

export function mountDiffView(
	container: HTMLElement,
	onSelectionChange?: (selection: {
		id: string;
		start: number;
		end: number;
	}) => void,
	names: CodeThemeNames = DEFAULT_THEME_NAMES,
	// App color scheme. Passed as themeType because the tokenizer defaults
	// to the OS media query ("system") — on a dark OS the diff would stay
	// dark under a light app theme. Stored for setOptions, which replaces.
	scheme: "light" | "dark" = "dark",
): DiffViewHandle {
	// Variant theme names (pierre-dark-soft, …) resolve through diffs'
	// bundled theming catalog — the pool takes names, not objects.
	const pool = getOrCreateWorkerPoolSingleton({
		poolOptions: {
			poolSize: POOL_SIZE,
			workerFactory: () =>
				new Worker(new URL("@pierre/diffs/worker/worker.js", import.meta.url), {
					type: "module",
				}),
		},
		highlighterOptions: {
			langs: [...HIGHLIGHT_LANGS],
			theme: { ...names },
		},
	});

	let style: DiffStyle = "unified";
	// Shared by construction and setDiffStyle: setOptions REPLACES
	// (CodeView.js: `this.options = options`), so both call sites must
	// supply the selection keys or line selection silently dies after any
	// style switch (CodeRabbit U0–U8 review).
	const handleSelection = (
		selection: {
			id: string;
			range: { start: number; end: number };
		} | null,
	) => {
		if (!selection) return;
		onSelectionChange?.({
			id: selection.id,
			start: selection.range.start,
			end: selection.range.end,
		});
	};
	const viewer = new CodeView(
		{
			theme: { ...names },
			themeType: scheme,
			diffStyle: style,
			stickyHeaders: true,
			enableLineSelection: true,
			onSelectedLinesChange: handleSelection,
		},
		pool,
	);
	// The container is the scroll root: it must be the sized, scrolling box.
	container.style.overflow = "auto";
	viewer.setup(container);

	return {
		setPatch: (patch) => {
			viewer.setItems(patchToItems(patch).items);
		},
		showFile: (path, contents) => {
			viewer.setItems([
				{
					id: `file:${path}`,
					type: "file",
					file: { name: path, contents },
					version: 0,
				},
			]);
		},
		scrollToFile: (path) => {
			viewer.scrollTo({ type: "item", id: `diff:${path}`, align: "start" });
		},
		setDiffStyle: (next) => {
			style = next;
			viewer.setOptions({
				theme: { ...names },
				themeType: scheme,
				diffStyle: style,
				stickyHeaders: true,
				enableLineSelection: true,
				onSelectedLinesChange: handleSelection,
			});
			viewer.render(true);
		},
		destroy: () => {
			viewer.cleanUp();
			terminateWorkerPoolSingleton();
		},
	};
}
