// Component tests for the grouped changed-files list (Unstaged/Staged
// with stage checkboxes). Same jsdom harness shape as
// file-tree-wrapper.test.ts: globals first, module import after.

import { describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
	url: "http://localhost",
});

Object.assign(globalThis, {
	document: dom.window.document,
	Event: dom.window.Event,
	HTMLElement: dom.window.HTMLElement,
	HTMLInputElement: dom.window.HTMLInputElement,
	HTMLUListElement: dom.window.HTMLUListElement,
	MouseEvent: dom.window.MouseEvent,
	Node: dom.window.Node,
	window: dom.window,
});

const { renderStatusList, statusSlug } = await import("./status-list");

import type { StatusListCallbacks } from "./status-list";

function render(entries: Parameters<typeof renderStatusList>[1]): {
	list: HTMLUListElement;
	calls: string[];
} {
	const list = document.createElement("ul");
	const calls: string[] = [];
	const callbacks: StatusListCallbacks = {
		onToggle: (path, unstage) =>
			calls.push(`toggle:${path}:${unstage ? "unstage" : "stage"}`),
		onJump: (path) => calls.push(`jump:${path}`),
		onToggleAll: (unstage) =>
			calls.push(`all:${unstage ? "unstage" : "stage"}`),
	};
	renderStatusList(list, entries, callbacks);
	return { list, calls };
}

describe("statusSlug", () => {
	test("slugs non-class-name porcelain letters", () => {
		expect(statusSlug("?")).toBe("untracked");
		expect(statusSlug(".")).toBe("clean");
		expect(statusSlug("M")).toBe("m");
		expect(statusSlug("~")).toBe("other");
	});
});

describe("renderStatusList", () => {
	test("empty status renders the clean message", () => {
		const { list } = render([]);
		expect(list.children).toHaveLength(1);
		expect(list.textContent).toContain("Working tree clean");
	});

	test("splits sides with headers, counts, and bulk actions", () => {
		const { list, calls } = render([
			{ path: "a.txt", indexStatus: ".", worktreeStatus: "M" },
			{ path: "b.txt", indexStatus: "M", worktreeStatus: "." },
		]);
		const headers = [...list.querySelectorAll(".status-group-header")];
		expect(headers.map((h) => h.textContent)).toEqual([
			"Unstaged (1)Stage all",
			"Staged (1)Unstage all",
		]);
		(headers[0].querySelector("button") as HTMLButtonElement).click();
		(headers[1].querySelector("button") as HTMLButtonElement).click();
		expect(calls).toEqual(["all:stage", "all:unstage"]);
	});

	test("checkboxes reflect their side and toggle it", () => {
		const { list, calls } = render([
			{ path: "a.txt", indexStatus: ".", worktreeStatus: "M" },
			{ path: "b.txt", indexStatus: "A", worktreeStatus: "." },
		]);
		const checks = [...list.querySelectorAll("input.status-check")];
		expect(checks.map((c) => (c as HTMLInputElement).checked)).toEqual([
			false,
			true,
		]);
		checks[0].dispatchEvent(new dom.window.Event("change", { bubbles: true }));
		checks[1].dispatchEvent(new dom.window.Event("change", { bubbles: true }));
		expect(calls).toEqual(["toggle:a.txt:stage", "toggle:b.txt:unstage"]);
	});

	test("a both-modified file appears on both sides; row click jumps", () => {
		const { list, calls } = render([
			{ path: "both.txt", indexStatus: "M", worktreeStatus: "M" },
		]);
		expect(list.querySelectorAll("li[data-path]").length).toBe(2);
		const row = list.querySelector('li[data-path="both.txt"]') as HTMLLIElement;
		row.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
		expect(calls).toEqual(["jump:both.txt"]);
	});

	test("checkbox clicks do not jump the diff", () => {
		const { list, calls } = render([
			{ path: "a.txt", indexStatus: ".", worktreeStatus: "M" },
		]);
		const check = list.querySelector("input") as HTMLInputElement;
		check.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
		expect(calls).toEqual([]);
	});

	test("arrows walk rows and Enter jumps the diff", () => {
		const { list, calls } = render([
			{ path: "a.txt", indexStatus: ".", worktreeStatus: "M" },
			{ path: "b.txt", indexStatus: ".", worktreeStatus: "M" },
		]);
		document.body.append(list);
		try {
			const rows = [...list.querySelectorAll("li[data-path]")] as HTMLElement[];
			rows[0].focus();
			rows[0].dispatchEvent(
				new dom.window.KeyboardEvent("keydown", {
					key: "ArrowDown",
					bubbles: true,
				}),
			);
			expect(document.activeElement).toBe(rows[1]);
			rows[1].dispatchEvent(
				new dom.window.KeyboardEvent("keydown", {
					key: "Enter",
					bubbles: true,
				}),
			);
			expect(calls).toContain("jump:b.txt");
		} finally {
			list.remove();
		}
	});
});
