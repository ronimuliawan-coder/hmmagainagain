// Minimal observable store — the app/UI state owner per the GOVERNANCE map.
// Synchronous subscribers keep the shell DOM derivable from one state object
// instead of being mutated ad hoc from async flows.

export type Unsubscribe = () => void;

export interface Store<T> {
	get(): T;
	set(next: T): void;
	subscribe(listener: (state: T) => void): Unsubscribe;
}

export function createStore<T>(initial: T): Store<T> {
	let state = initial;
	const listeners = new Set<(state: T) => void>();
	return {
		get: () => state,
		set: (next) => {
			state = next;
			for (const listener of listeners) listener(state);
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}
