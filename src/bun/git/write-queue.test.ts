// Unit tests for the serialized write queues: per-root ordering, cross-root
// overlap, and failure isolation — the single-writer properties the data
// safety model rests on (post-v1 Unit B).
import { describe, expect, test } from "bun:test";
import { enqueueWrite } from "./write-queue";

describe("enqueueWrite", () => {
	test("runs same-root tasks in submission order", async () => {
		const order: number[] = [];
		const slow = enqueueWrite("repo-ord", async () => {
			await new Promise((r) => setTimeout(r, 50));
			order.push(1);
		});
		const fast = enqueueWrite("repo-ord", async () => {
			order.push(2);
		});
		await Promise.all([slow, fast]);
		expect(order).toEqual([1, 2]);
	});

	test("different roots run concurrently", async () => {
		const events: string[] = [];
		const slowA = enqueueWrite("repo-a", async () => {
			await new Promise((r) => setTimeout(r, 50));
			events.push("a-done");
		});
		const fastB = enqueueWrite("repo-b", async () => {
			events.push("b-done");
		});
		await Promise.all([slowA, fastB]);
		expect(events).toEqual(["b-done", "a-done"]);
	});

	test("a rejecting task does not break its lane", async () => {
		await expect(
			enqueueWrite("repo-err", async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		const after: string[] = [];
		await enqueueWrite("repo-err", async () => {
			after.push("ran");
		});
		expect(after).toEqual(["ran"]);
	});
});
