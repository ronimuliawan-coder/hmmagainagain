// Soundcheck tests: the Pierre entries mount and theme from the harness
// modules (same jsdom pattern as file-tree-wrapper.test.ts). The diff
// mount is intentionally NOT constructed here: its worker URL is a bare
// specifier that only resolves under the vite build, so constructing it
// outside bundling throws. The `tauri build` step is the diff's proof.

import { describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
	url: "http://localhost",
});

class MockStyleSheet {
	replaceSync(_value: string): void {}
}

class MockResizeObserver {
	observe(_target: Element): void {}
	disconnect(): void {}
}

Object.assign(globalThis, {
	CSS: Reflect.get(dom.window, "CSS"),
	CSSStyleSheet: MockStyleSheet,
	customElements: dom.window.customElements,
	document: dom.window.document,
	Event: dom.window.Event,
	FocusEvent: dom.window.FocusEvent,
	HTMLElement: dom.window.HTMLElement,
	HTMLButtonElement: dom.window.HTMLButtonElement,
	HTMLDivElement: dom.window.HTMLDivElement,
	HTMLInputElement: dom.window.HTMLInputElement,
	HTMLStyleElement: dom.window.HTMLStyleElement,
	HTMLTemplateElement: dom.window.HTMLTemplateElement,
	KeyboardEvent: dom.window.KeyboardEvent,
	MouseEvent: dom.window.MouseEvent,
	MutationObserver: dom.window.MutationObserver,
	navigator: dom.window.navigator,
	Node: dom.window.Node,
	ResizeObserver: MockResizeObserver,
	SVGElement: dom.window.SVGElement,
	ShadowRoot: dom.window.ShadowRoot,
	requestAnimationFrame: (callback: FrameRequestCallback): number =>
		setTimeout(() => callback(Date.now()), 0) as unknown as number,
	cancelAnimationFrame: (handle: number): void => clearTimeout(handle),
	window: dom.window,
});

const flushDom = async (): Promise<void> => {
	await new Promise((resolve) => setTimeout(resolve, 0));
};

// Dynamic import ON PURPOSE: it must evaluate after the globals above exist.
const {
	applySoundcheckTheme,
	mountSoundcheckDiff,
	mountSoundcheckTree,
	patchToItems,
} = await import("./harness");
// Theme objects imported directly: token values are upstream data, never
// hardcoded guesses in the assertions below.
const { default: pierreLight } = await import("@pierre/theme/pierre-light");

describe("soundcheck", () => {
	test("theme tokens land on the root and the tree host", () => {
		const root = document.documentElement;
		const host = document.createElement("div");
		applySoundcheckTheme(root, host, "dark");
		expect(root.dataset.theme).toBe("dark");
		expect(root.style.getPropertyValue("--soundcheck-bg")).toBe("#0a0a0a");
		expect(root.style.getPropertyValue("--soundcheck-fg")).toBe("#fafafa");
		const treeKeys: string[] = [];
		for (let i = 0; i < host.style.length; i++) {
			treeKeys.push(host.style[i]);
		}
		expect(treeKeys.some((k) => k.startsWith("--trees-theme"))).toBe(true);
	});

	test("scheme toggle flips the tokens", () => {
		const root = document.documentElement;
		const host = document.createElement("div");
		applySoundcheckTheme(root, host, "light");
		expect(root.dataset.theme).toBe("light");
		expect(root.style.getPropertyValue("--soundcheck-bg")).toBe(
			pierreLight.colors["editor.background"],
		);
		expect(root.style.getPropertyValue("--soundcheck-fg")).toBe(
			pierreLight.colors["editor.foreground"],
		);
	});

	test("tree mounts rows from the sample paths", async () => {
		const container = document.createElement("div");
		document.body.appendChild(container);
		const tree = mountSoundcheckTree(container);
		await flushDom();
		expect(tree.getVisibleCount()).toBeGreaterThan(0);
		tree.cleanUp();
		container.remove();
	});

	test("sample patch maps to exactly one diff item", () => {
		const items = patchToItems(
			"diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n",
		);
		expect(items).toHaveLength(1);
		expect(items[0].id).toBe("diff:x");
	});

	test("diff mounts the sample file without a worker", async () => {
		const container = document.createElement("div");
		document.body.appendChild(container);
		const viewer = mountSoundcheckDiff(container, false);
		await flushDom();
		expect(viewer.getItem("diff:src/theme.ts")).toBeDefined();
		viewer.cleanUp();
		container.remove();
	});
});
