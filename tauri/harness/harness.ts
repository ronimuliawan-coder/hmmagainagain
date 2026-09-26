// Soundcheck: the smallest page that proves the Pierre entries resolve,
// bundle, mount, and theme inside the Tauri shell on every OS.
//
// It mirrors the app's theming recipe (main.ts) without importing app
// code: the harness must bundle from tauri/node_modules alone, because
// the tauri CI jobs never install the repo-root dependencies. Versions
// are pinned exact in tauri/package.json and must match the root's.
import { CodeView, type CodeViewItem, parsePatchFiles } from "@pierre/diffs";
import { getOrCreateWorkerPoolSingleton } from "@pierre/diffs/worker";
import pierreDark from "@pierre/theme/pierre-dark";
import pierreLight from "@pierre/theme/pierre-light";
import { FileTree, themeToTreeStyles } from "@pierre/trees";

export type SoundcheckScheme = "light" | "dark";

const THEMES = { light: pierreLight, dark: pierreDark } as const;

const SAMPLE_PATHS = ["src/main.ts", "src/theme.ts", "README.md"] as const;

const SAMPLE_PATCH = [
	"diff --git a/src/theme.ts b/src/theme.ts",
	"--- a/src/theme.ts",
	"+++ b/src/theme.ts",
	"@@ -1,2 +1,2 @@",
	"-export const bg = '#ffffff';",
	"+export const bg = '#0a0a0a';",
	" export const fg = '#0a0a0a';",
].join("\n");

// Inline of the app's patch-to-items mapping (src/mainview/patch-to-items):
// unified patch text → one CodeView diff item per file. Duplicated (not
// imported) because the harness bundles from tauri/node_modules alone.
// Exported so tests lock the sample patch to exactly one item.
export function patchToItems(patch: string): CodeViewItem[] {
	const items: CodeViewItem[] = [];
	for (const parsed of parsePatchFiles(patch)) {
		for (const fileDiff of parsed.files) {
			if (!fileDiff.name) continue;
			items.push({
				id: `diff:${fileDiff.name}`,
				type: "diff",
				fileDiff,
				version: 0,
			});
		}
	}
	return items;
}

/** Applies the theme the way the app does: page tokens on the root,
 * tree styles on the tree host (custom properties inherit into its
 * shadow tree), scheme on data-theme for light-dark(). */
export function applySoundcheckTheme(
	root: HTMLElement,
	treeHost: HTMLElement,
	scheme: SoundcheckScheme,
): void {
	const theme = THEMES[scheme];
	root.dataset.theme = scheme;
	root.style.setProperty("--soundcheck-bg", theme.colors["editor.background"]);
	root.style.setProperty("--soundcheck-fg", theme.colors["editor.foreground"]);
	for (const [key, value] of Object.entries(themeToTreeStyles(theme))) {
		treeHost.style.setProperty(key, value);
	}
}

export function mountSoundcheckTree(container: HTMLElement): FileTree {
	const tree = new FileTree({
		paths: [...SAMPLE_PATHS],
		initialExpansion: "open",
		density: "compact",
		search: false,
		overscan: 4,
	});
	tree.render({ containerWrapper: container });
	return tree;
}

export function mountSoundcheckDiff(
	container: HTMLElement,
	withWorker = true,
): CodeView {
	// Same worker pattern as the app's diff-view wrapper: the pool loads
	// the Shiki worker through a bare-specifier URL, which only resolves
	// under a bundler with ES-module workers (see tauri/vite.config.ts).
	// If this line breaks a Tauri build, the app's highlighting breaks too.
	// withWorker=false is test-only: it mounts pool-less (highlighting
	// falls back to the main thread) so jsdom can assert mounted content
	// without a Worker implementation.
	const pool = withWorker
		? getOrCreateWorkerPoolSingleton({
				poolOptions: {
					poolSize: 1,
					workerFactory: () =>
						new Worker(
							new URL("@pierre/diffs/worker/worker.js", import.meta.url),
							{
								type: "module",
							},
						),
				},
				highlighterOptions: {
					langs: ["typescript"],
					theme: { light: "pierre-light", dark: "pierre-dark" },
				},
			})
		: undefined;
	const viewer = new CodeView(
		{
			theme: { light: "pierre-light", dark: "pierre-dark" },
			// Explicit scheme like the app wrapper: the tokenizer would
			// otherwise follow the OS media query, not the page toggle.
			themeType: "dark",
			diffStyle: "unified",
			stickyHeaders: false,
			enableLineSelection: false,
		},
		pool,
	);
	container.style.overflow = "auto";
	viewer.setup(container);
	viewer.setItems(patchToItems(SAMPLE_PATCH));
	return viewer;
}

// Standalone page behavior: no-op when the harness elements are absent
// (keeps the module import-safe for tests).
if (typeof document !== "undefined") {
	window.addEventListener("DOMContentLoaded", () => {
		const treeHost = document.querySelector<HTMLElement>("#tree");
		const diffHost = document.querySelector<HTMLElement>("#diff");
		const toggle = document.querySelector<HTMLButtonElement>("#scheme-toggle");
		if (!treeHost || !diffHost || !toggle) return;
		let scheme: SoundcheckScheme = "dark";
		const apply = () => {
			applySoundcheckTheme(document.documentElement, treeHost, scheme);
			toggle.textContent = scheme === "dark" ? "Light" : "Dark";
		};
		mountSoundcheckTree(treeHost);
		const viewer = mountSoundcheckDiff(diffHost);
		apply();
		toggle.addEventListener("click", () => {
			scheme = scheme === "dark" ? "light" : "dark";
			apply();
			// setOptions replaces: every key must ride along.
			viewer.setOptions({
				theme: { light: "pierre-light", dark: "pierre-dark" },
				themeType: scheme,
				diffStyle: "unified",
				stickyHeaders: false,
				enableLineSelection: false,
			});
			viewer.render(true);
		});
	});
}
