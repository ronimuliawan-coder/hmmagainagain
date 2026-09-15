// Unit tests for the serialized write queue: ordering and failure
// isolation are the data-safety properties the single-writer model
// rests on (CodeRabbit follow-up round).
import { describe, expect, test } from "bun:test";
import { enqueueWrite } from "./write-queue";

describe("enqueueWrite", () => {
	test("runs tasks in submission order", async () => {
		const order: number[] = [];
		const slow = enqueueWrite(async () => {
			await new Promise((r) => setTimeout(r, 50));
			order.push(1);
		});
		const fast = enqueueWrite(async () => {
			order.push(2);
		});
		await Promise.all([slow, fast]);
		expect(order).toEqual([1, 2]);
	});

	test("a rejecting task does not break the chain", async () => {
		await expect(
			enqueueWrite(async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		const after: string[] = [];
		await enqueueWrite(async () => {
			after.push("ran");
		});
		expect(after).toEqual(["ran"]);
	});
});
