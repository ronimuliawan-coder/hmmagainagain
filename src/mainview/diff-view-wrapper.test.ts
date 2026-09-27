// Tests for the render-race self-heal. No DOM needed: a stub window
// records listeners, and synthetic error events drive the handler.

import { beforeEach, describe, expect, test } from "bun:test";
import { recoverRenderOnInvariant } from "./diff-view-wrapper";

type Listener = (event: Event) => void;

let listeners: Listener[];
let patches: string[];

function stubWindow(): void {
	listeners = [];
	(globalThis as unknown as { window: unknown }).window = {
		addEventListener: (_type: string, fn: Listener) => {
			listeners.push(fn);
		},
		removeEventListener: (_type: string, fn: Listener) => {
			listeners = listeners.filter((l) => l !== fn);
		},
	};
}

function renderError(): object {
	return {
		message:
			"DiffHunksRenderer.processDiffResult: deletionLine and additionLine are null, something is wrong",
	};
}

function viewer() {
	return {
		setPatch: (patch: string) => {
			patches.push(patch);
		},
	};
}

beforeEach(() => {
	stubWindow();
	patches = [];
});

describe("recoverRenderOnInvariant", () => {
	test("re-renders once on the invariant, then guards the loop", () => {
		const uninstall = recoverRenderOnInvariant(viewer, () => "PATCH");
		for (const l of [...listeners]) l(renderError() as Event);
		expect(patches).toEqual(["PATCH"]);
		for (const l of [...listeners]) l(renderError() as Event);
		expect(patches).toEqual(["PATCH"]);
		uninstall();
	});

	test("ignores unrelated errors", () => {
		recoverRenderOnInvariant(viewer, () => "PATCH");
		for (const l of [...listeners]) l({ message: "boom" } as unknown as Event);
		expect(patches).toEqual([]);
	});

	test("uninstall stops handling", () => {
		const uninstall = recoverRenderOnInvariant(viewer, () => "PATCH");
		uninstall();
		for (const l of [...listeners]) l(renderError() as Event);
		expect(patches).toEqual([]);
	});

	test("missing viewer or patch is a silent no-op", () => {
		recoverRenderOnInvariant(
			() => null,
			() => "PATCH",
		);
		recoverRenderOnInvariant(viewer, () => "");
		for (const l of [...listeners]) l(renderError() as Event);
		expect(patches).toEqual([]);
	});
});
