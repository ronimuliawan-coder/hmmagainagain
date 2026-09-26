// Smooth mouse-wheel scrolling (RON-381). WebKitGTK applies notched-wheel
// deltas as instant jumps while Chromium animates the same input — the
// reported "20-35fps" with an idle main thread. This helper glides discrete
// wheel input with an eased rAF animation instead.
//
// Only notched input is touched: line-mode deltas and large integer pixel
// detents. Touchpads (fractional pixel deltas), pinch-zoom (ctrlKey), and
// reduced-motion users keep native behavior. One document-level capture
// listener finds the nearest scrollable ancestor through the composed path,
// so shadow-DOM scrollers (file tree) just work.

const LINE_PX = 16;
/** Glide length. 140ms felt heavy/trailing on hardware (RON-381) — 90ms
 * tracks the wheel without losing the smoothing. */
const GLIDE_MS = 90;
/** Pixel detents at or above this are a mouse notch, not a touchpad. */
const NOTCH_PX = 50;

interface Glide {
	element: HTMLElement;
	from: number;
	to: number;
	/** Set on the first animation frame: the rAF timestamp is the only
	 * clock used, so virtualized clocks (jsdom) stay consistent. */
	start: number | null;
	frame: number;
}

let active: Glide | null = null;

const reducedMotion = (): boolean =>
	typeof matchMedia === "function" &&
	matchMedia("(prefers-reduced-motion: reduce)").matches;

const maxTop = (element: HTMLElement): number =>
	Math.max(0, element.scrollHeight - element.clientHeight);
function scrollableAncestor(event: Event, delta: number): HTMLElement | null {
	const path =
		typeof event.composedPath === "function" ? event.composedPath() : [];
	// An in-flight glide owns its element: reversals and continuations must
	// retarget it even when the live position has no room in the new
	// direction — feed() decides whether there is anything to do. (Strict
	// equality, not .includes: the unannotated ternary's union member
	// poisons generic method resolution.)
	const gliding = active?.element;
	const glidingTo = active?.to;
	for (const node of path) {
		if (!(node instanceof HTMLElement)) continue;
		if (node === gliding && glidingTo !== undefined) {
			// ...but only while its target can still advance: a blocked
			// target yields to outer scrollers instead of re-gliding to
			// nowhere and cancelling the event.
			const room = delta > 0 ? glidingTo < maxTop(node) : glidingTo > 0;
			if (room) return node;
			continue;
		}
		if (node.scrollHeight <= node.clientHeight + 1) continue;
		// Direction matters: an element at its edge still qualifies by size
		// alone, but gliding it would go nowhere while cancelling the
		// event — keep looking outward so scroll chaining survives.
		const room = delta > 0 ? node.scrollTop < maxTop(node) : node.scrollTop > 0;
		if (room) return node;
	}
	return null;
}

function stopGlide(): void {
	if (active) cancelAnimationFrame(active.frame);
	active = null;
}

function step(now: number): void {
	const glide = active;
	if (!glide) return;
	if (glide.start === null) glide.start = now;
	const t = Math.min(1, (now - glide.start) / GLIDE_MS);
	// easeOutCubic: fast start, soft landing.
	const eased = 1 - (1 - t) ** 3;
	glide.element.scrollTop = glide.from + (glide.to - glide.from) * eased;
	if (t >= 1 || glide.element.scrollTop === glide.to) {
		active = null;
		return;
	}
	glide.frame = requestAnimationFrame(step);
}

/** Feeds one wheel delta into the glide; restarts the clock from the live
 * position so motion stays smooth, but accumulates onto the active target —
 * targeting from the lagging live position on every notch capped sustained
 * speed below input rate and felt heavy (RON-381). A reversal starts over
 * from the live position instead of chasing the old direction. Returns
 * whether the glide took the delta: false leaves the event native so
 * chaining (bounce, parent scrollers) keeps working. */
function feed(element: HTMLElement, delta: number): boolean {
	const continuing =
		active !== null &&
		active.element === element &&
		(active.to === element.scrollTop ||
			Math.sign(delta) === Math.sign(active.to - element.scrollTop));
	if (!continuing) stopGlide();
	const base =
		active && active.element === element ? active.to : element.scrollTop;
	const to = Math.min(maxTop(element), Math.max(0, base + delta));
	// At a scroll edge with nowhere to go, leave the event native (bounce).
	if (to === element.scrollTop && !active) return false;
	const from = element.scrollTop;
	if (active) cancelAnimationFrame(active.frame);
	active = {
		element,
		from,
		to,
		start: null,
		frame: requestAnimationFrame(step),
	};
	return true;
}

function onWheel(event: WheelEvent): void {
	if (event.ctrlKey || event.metaKey || reducedMotion()) return;
	let delta = event.deltaY;
	if (delta === 0) return;
	if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
		delta *= LINE_PX;
	} else if (!Number.isInteger(delta) || Math.abs(delta) < NOTCH_PX) {
		// Fractional or small pixel deltas are a touchpad — native is smooth.
		return;
	}
	const target = scrollableAncestor(event, delta);
	if (!target) return;
	// Cancel only when the glide moves the target: a cancelled edge event
	// would block scroll chaining to outer scrollers.
	if (feed(target, delta)) event.preventDefault();
}

/** Enables the glide for every scrollable in the document. Idempotent. */
let attached = false;

export function enableSmoothWheel(): void {
	if (attached) return;
	attached = true;
	document.addEventListener("wheel", onWheel, { passive: false });
}
