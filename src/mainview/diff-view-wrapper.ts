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
	setDiffStyle(style: DiffStyle): void;
	destroy(): void;
}

export function mountDiffView(
	container: HTMLElement,
	onSelectionChange?: (selection: {
		id: string;
		start: number;
		end: number;
	}) => void,
): DiffViewHandle {
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
			theme: { ...THEME },
		},
	});

	let style: DiffStyle = "unified";
	const viewer = new CodeView(
		{
			theme: { ...THEME },
			diffStyle: style,
			stickyHeaders: true,
			enableLineSelection: true,
			onSelectedLinesChange: (selection) => {
				if (!selection) return;
				onSelectionChange?.({
					id: selection.id,
					start: selection.range.start,
					end: selection.range.end,
				});
			},
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
		scrollToFile: (path) => {
			viewer.scrollTo({ type: "item", id: `diff:${path}`, align: "start" });
		},
		setDiffStyle: (next) => {
			style = next;
			viewer.setOptions({
				theme: { ...THEME },
				diffStyle: style,
				stickyHeaders: true,
			});
			viewer.render(true);
		},
		destroy: () => {
			viewer.cleanUp();
			terminateWorkerPoolSingleton();
		},
	};
}
