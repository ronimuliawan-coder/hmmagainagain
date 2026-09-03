import { describe, expect, test } from "bun:test";
import { createStore } from "./store";

describe("createStore", () => {
	test("get returns current state and set replaces it", () => {
		const store = createStore({ count: 1 });
		expect(store.get()).toEqual({ count: 1 });
		store.set({ count: 2 });
		expect(store.get()).toEqual({ count: 2 });
	});

	test("subscribers receive each state synchronously", () => {
		const store = createStore({ n: 0 });
		const seen: number[] = [];
		store.subscribe((state) => seen.push(state.n));
		store.set({ n: 1 });
		store.set({ n: 2 });
		expect(seen).toEqual([1, 2]);
	});

	test("unsubscribe stops notifications", () => {
		const store = createStore({ n: 0 });
		let calls = 0;
		const unsubscribe = store.subscribe(() => {
			calls += 1;
		});
		store.set({ n: 1 });
		unsubscribe();
		store.set({ n: 2 });
		expect(calls).toBe(1);
	});
});
