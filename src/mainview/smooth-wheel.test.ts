// Component tests for the smooth-wheel glide (RON-381). jsdom has no
// layout, so scroll metrics are faked with own properties; rAF, WheelEvent,
// and matchMedia are installed from the jsdom window.

import { describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
	url: "http://localhost",
	// Enables requestAnimationFrame, which the glide runs on.
	pretendToBeVisual: true,
});

let reduceMotion = false;

Object.assign(globalThis, {
	document: dom.window.document,
	Event: dom.window.Event,
	HTMLElement: dom.window.HTMLElement,
	HTMLDivElement: dom.window.HTMLDivElement,
	MouseEvent: dom.window.MouseEvent,
	Node: dom.window.Node,
	WheelEvent: dom.window.WheelEvent,
	window: dom.window,
	requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
	cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
	matchMedia: () => ({ matches: reduceMotion }),
});

const { enableSmoothWheel } = await import("./smooth-wheel");

function scrollBox(): HTMLDivElement {
	const box = document.createElement("div");
	// Real scrollers need overflow set; jsdom fakes the metrics below.
	box.style.overflowY = "auto";
	Object.defineProperty(box, "scrollHeight", {
		value: 500,
		configurable: true,
	});
	Object.defineProperty(box, "clientHeight", {
		value: 100,
		configurable: true,
	});
	const inner = document.createElement("div");
	box.append(inner);
	document.body.append(box);
	return box;
}

function wheel(
	target: HTMLElement,
	init: WheelEventInit & { deltaMode?: number },
): boolean {
	const event = new dom.window.WheelEvent("wheel", {
		bubbles: true,
		cancelable: true,
		...init,
	});
	return target.dispatchEvent(event);
}

const settle = async (ms = 400): Promise<void> => {
	await new Promise((resolve) => setTimeout(resolve, ms));
};

describe("enableSmoothWheel", () => {
	test("glides notched pixel detents to the target", async () => {
		enableSmoothWheel();
		const box = scrollBox();
		const prevented = !wheel(box.firstElementChild as HTMLElement, {
			deltaY: 100,
		});
		expect(prevented).toBe(true);
		await settle();
		expect(box.scrollTop).toBe(100);
		box.remove();
	});

	test("glides line-mode deltas", async () => {
		const box = scrollBox();
		const prevented = !wheel(box.firstElementChild as HTMLElement, {
			deltaY: 3,
			deltaMode: dom.window.WheelEvent.DOM_DELTA_LINE,
		});
		expect(prevented).toBe(true);
		await settle();
		expect(box.scrollTop).toBe(48);
		box.remove();
	});

	test("leaves touchpad deltas native", async () => {
		const box = scrollBox();
		const prevented = !wheel(box.firstElementChild as HTMLElement, {
			deltaY: 12.5,
		});
		expect(prevented).toBe(false);
		await settle();
		expect(box.scrollTop).toBe(0);
		box.remove();
	});

	test("leaves pinch-zoom and reduced-motion native", async () => {
		const box = scrollBox();
		const child = box.firstElementChild as HTMLElement;
		expect(!wheel(child, { deltaY: 100, ctrlKey: true })).toBe(false);
		reduceMotion = true;
		try {
			expect(!wheel(child, { deltaY: 100 })).toBe(false);
		} finally {
			reduceMotion = false;
		}
		await settle();
		expect(box.scrollTop).toBe(0);
		box.remove();
	});

	test("accumulates rapid notches onto the active target", async () => {
		const box = scrollBox();
		const child = box.firstElementChild as HTMLElement;
		wheel(child, { deltaY: 100 });
		wheel(child, { deltaY: 100 });
		await settle();
		// Second notch builds on the first target (200), not the lagging
		// live position — sustained input must not velocity-cap (RON-381).
		expect(box.scrollTop).toBe(200);
		box.remove();
	});

	test("a reversal starts over from the live position", async () => {
		const box = scrollBox();
		const child = box.firstElementChild as HTMLElement;
		wheel(child, { deltaY: 100 });
		wheel(child, { deltaY: -100 });
		await settle();
		expect(box.scrollTop).toBe(0);
		box.remove();
	});

	test("leaves a bottom-edge downward notch native for chaining", async () => {
		const box = scrollBox();
		box.scrollTop = 400;
		const prevented = !wheel(box.firstElementChild as HTMLElement, {
			deltaY: 100,
		});
		expect(prevented).toBe(false);
		await settle();
		expect(box.scrollTop).toBe(400);
		box.remove();
	});

	test("glides upward from the bottom edge", async () => {
		const box = scrollBox();
		box.scrollTop = 400;
		const prevented = !wheel(box.firstElementChild as HTMLElement, {
			deltaY: -100,
		});
		expect(prevented).toBe(true);
		await settle();
		expect(box.scrollTop).toBe(300);
		box.remove();
	});

	test("a blocked glide target yields to chaining", async () => {
		const box = scrollBox();
		const child = box.firstElementChild as HTMLElement;
		box.scrollTop = 300;
		expect(!wheel(child, { deltaY: 100 })).toBe(true);
		// Second notch while the first glide is in flight: its target (400)
		// is the edge, so the event stays native instead of re-gliding to
		// nowhere — while the first glide still lands.
		expect(!wheel(child, { deltaY: 100 })).toBe(false);
		await settle();
		expect(box.scrollTop).toBe(400);
		box.remove();
	});
});
