// Wrapper around @pierre/trees — the ONLY module allowed to import it. The
// component is 1.0.0-beta.6 (preact-11-beta inside); this seam keeps it
// swappable if the API moves (ADR-0001 R1 mitigation).

import type { GitStatusEntry } from "@pierre/trees";
import { FileTree } from "@pierre/trees";

export interface TreeHandle {
	setPaths(paths: readonly string[]): void;
	setGitStatus(entries: readonly GitStatusEntry[]): void;
	/** Rendered row count — lets callers assert the tree without shadow-DOM access. */
	getRowCount(): number;
	destroy(): void;
}

export function mountFileTree(container: HTMLElement): TreeHandle {
	const tree = new FileTree({
		paths: [],
		initialExpansion: "open",
	});
	tree.render({ containerWrapper: container });
	return {
		setPaths: (paths) => tree.resetPaths(paths),
		setGitStatus: (entries) => tree.setGitStatus(entries),
		getRowCount: () => tree.getVisibleCount(),
		destroy: () => tree.cleanUp(),
	};
}

export type { GitStatusEntry };
