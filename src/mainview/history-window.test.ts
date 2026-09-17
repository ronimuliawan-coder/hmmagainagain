// Unit tests for history windowing math (post-v1 Unit A3).
import { describe, expect, test } from "bun:test";
import { FALLBACK_ROW_HEIGHT, windowRows } from "./history-window";

describe("windowRows", () => {
	test("empty list renders nothing", () => {
		expect(windowRows(0, 0, 28, 400)).toEqual({
			start: 0,
			end: 0,
			topPad: 0,
			bottomPad: 0,
		});
	});

	test("top of list has no top pad", () => {
		const w = windowRows(1000, 0, 28, 400);
		expect(w.start).toBe(0);
		expect(w.topPad).toBe(0);
		expect(w.end).toBeLessThanOrEqual(1000);
		// ~14 visible + 20 overscan.
		expect(w.end).toBeLessThan(60);
		expect(w.bottomPad).toBe((1000 - w.end) * 28);
	});

	test("middle window is bounded on both sides", () => {
		const w = windowRows(1000, 14000, 28, 400);
		expect(w.start).toBeGreaterThan(0);
		expect(w.end - w.start).toBeLessThanOrEqual(40);
		expect(w.topPad).toBe(w.start * 28);
		expect(w.bottomPad).toBe((1000 - w.end) * 28);
	});

	test("bottom clamps the end and empties the bottom pad", () => {
		const w = windowRows(1000, 1_000_000, 28, 400);
		expect(w.end).toBe(1000);
		expect(w.bottomPad).toBe(0);
	});

	test("non-positive row height falls back", () => {
		const w = windowRows(100, 0, 0, 400);
		expect(w.end).toBeGreaterThan(0);
		expect(w.bottomPad).toBe((100 - w.end) * FALLBACK_ROW_HEIGHT);
	});

	test("pads always sum to the unrendered height", () => {
		for (const scroll of [0, 500, 5000, 13579, 99999]) {
			const w = windowRows(2000, scroll, 28, 400);
			expect(w.topPad + w.bottomPad).toBe((2000 - (w.end - w.start)) * 28);
		}
	});
});
