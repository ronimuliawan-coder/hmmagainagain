// Serialized write queues, one lane per repository root. One in-flight
// write at a time PER REPO keeps the main process the single writer
// (GOVERNANCE ownership map) and our own commands free of index.lock
// contention — without a stalled push in one repo blocking index writes in
// another (post-v1 Unit B; previously one global lane).
//
// Keys are exact root strings (documented): the app opens one canonical
// path per repository. No realpath resolution — it throws on missing paths
// and the cure would exceed the disease for a single-window app.

const queues = new Map<string, Promise<unknown>>();

export function enqueueWrite<T>(
	root: string,
	task: () => Promise<T>,
): Promise<T> {
	const tail = queues.get(root) ?? Promise.resolve();
	const next = tail.then(task, task);
	const tailRef: Promise<unknown> = next.catch(() => {});
	queues.set(root, tailRef);
	// Bounded without a reaper: drop the entry only while it is still this
	// call's tail (a newer task already replaced it otherwise).
	const forget = (): void => {
		if (queues.get(root) === tailRef) queues.delete(root);
	};
	void next.then(forget, forget);
	return next;
}
