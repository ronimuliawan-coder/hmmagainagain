// Component test: mounts the real @pierre/trees FileTree (1.0.0-beta.6) into
// jsdom to prove the beta-API integration through the wrapper seam. This
// mirrors the upstream harness in pierrecomputer/pierre (packages/trees/test):
// browser globals are installed before the render module is imported, because
// it touches them at import time.

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

// Same global set upstream's installDom() manages; the dist renderer reads
// these from globalThis. Reflect.get for members missing from jsdom types.
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
	window: dom.window,
});

const flushDom = async (): Promise<void> => {
	await new Promise((resolve) => setTimeout(resolve, 0));
};

// Dynamic import ON PURPOSE: it must evaluate after the globals above exist.
const { mountFileTree } = await import("./file-tree-wrapper");

const FIXTURE_PATHS = [
	"README.md",
	"package.json",
	"src/index.ts",
	"src/components/Button.tsx",
	"src/components/Card.tsx",
	"src/utils/worker.ts",
	"test/fixture.test.ts",
];

function shadowRootOf(container: HTMLElement): ShadowRoot {
	const host = container.querySelector("file-tree-container");
	if (!(host instanceof HTMLElement) || !host.shadowRoot) {
		throw new Error("file tree host or shadow root missing");
	}
	return host.shadowRoot;
}

function mount(): {
	container: HTMLElement;
	tree: ReturnType<typeof mountFileTree>;
} {
	const container = document.createElement("div");
	document.body.appendChild(container);
	return { container, tree: mountFileTree(container) };
}

describe("mountFileTree (component, jsdom)", () => {
	test("renders fixture paths as rows in the shadow tree", async () => {
		const { container, tree } = mount();
		tree.setPaths(FIXTURE_PATHS);
		await flushDom();

		expect(tree.getRowCount()).toBeGreaterThan(0);
		const shadow = shadowRootOf(container);
		expect(
			shadow.querySelector('[data-item-path="src/index.ts"]'),
		).not.toBeNull();
		expect(
			shadow.querySelector('[data-item-path="src/components/Button.tsx"]'),
		).not.toBeNull();
		tree.destroy();
	});

	test("setGitStatus decorates rows and marks changed ancestor folders", async () => {
		const { container, tree } = mount();
		tree.setPaths(FIXTURE_PATHS);
		tree.setGitStatus([
			{ path: "src/index.ts", status: "modified" },
			{ path: "README.md", status: "untracked" },
		]);
		await flushDom();

		const shadow = shadowRootOf(container);
		expect(
			shadow
				.querySelector('[data-item-path="src/index.ts"]')
				?.getAttribute("data-item-git-status"),
		).toBe("modified");
		expect(
			shadow
				.querySelector('[data-item-path="README.md"]')
				?.getAttribute("data-item-git-status"),
		).toBe("untracked");
		expect(
			shadow
				.querySelector('[data-item-path="src/"]')
				?.getAttribute("data-item-contains-git-change"),
		).toBe("true");
		tree.destroy();
	});

	test("destroy cleans up without throwing", async () => {
		const { container, tree } = mount();
		tree.setPaths(["a.txt"]);
		await flushDom();
		expect(tree.getRowCount()).toBeGreaterThan(0);
		expect(() => tree.destroy()).not.toThrow();
		container.remove();
	});

	test("setSearch filters rows through the search session", async () => {
		const { container, tree } = mount();
		tree.setPaths(FIXTURE_PATHS);
		await flushDom();
		const before = tree.getRowCount();
		tree.setSearch("Button");
		await flushDom();
		expect(tree.getRowCount()).toBeLessThan(before);
		expect(tree.getRowCount()).toBeGreaterThan(0);
		tree.setSearch(null);
		await flushDom();
		expect(tree.getRowCount()).toBe(before);
		tree.destroy();
		container.remove();
	});

	test("collapseAll folds to roots, expandAll restores, decorations kept", async () => {
		const { container, tree } = mount();
		tree.setPaths(FIXTURE_PATHS);
		tree.setGitStatus([
			{ path: "src/index.ts", status: "modified" },
			{ path: "README.md", status: "untracked" },
		]);
		await flushDom();
		const full = tree.getRowCount();

		tree.collapseAll();
		await flushDom();
		const folded = tree.getRowCount();
		expect(folded).toBeGreaterThan(0);
		expect(folded).toBeLessThan(full);
		// The folded folder still carries its change marker (RON-382).
		const shadow = shadowRootOf(container);
		expect(
			shadow
				.querySelector('[data-item-path="src/"]')
				?.getAttribute("data-item-contains-git-change"),
		).toBe("true");

		tree.expandAll();
		await flushDom();
		expect(tree.getRowCount()).toBe(full);
		expect(
			shadowRootOf(container)
				.querySelector('[data-item-path="src/index.ts"]')
				?.getAttribute("data-item-git-status"),
		).toBe("modified");
		tree.destroy();
		container.remove();
	});

	test("built-in search box stays hidden while the session filters", async () => {
		const { container, tree } = mount();
		tree.setPaths(FIXTURE_PATHS);
		await flushDom();
		// Our own filter box drives the session; the component's box must
		// not render a second one (RON-329).
		const shadow = shadowRootOf(container);
		const unsafe = shadow.querySelector("style[data-file-tree-unsafe-css]");
		expect(unsafe?.textContent).toContain("[data-file-tree-search-container]");
		// The session itself still works through setSearch.
		const before = tree.getRowCount();
		tree.setSearch("Button");
		await flushDom();
		expect(tree.getRowCount()).toBeLessThan(before);
		tree.destroy();
		container.remove();
	});
});
