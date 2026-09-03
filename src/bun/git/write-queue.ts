// Serialized write queue for ALL repository mutations. One in-flight write at
// a time keeps the main process the single writer (GOVERNANCE ownership map)
// and our own commands free of index.lock contention.

let queueTail: Promise<unknown> = Promise.resolve();

export function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
	const next = queueTail.then(task, task);
	queueTail = next.catch(() => {});
	return next;
}
