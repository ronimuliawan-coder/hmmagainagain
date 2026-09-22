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
const GLIDE_MS = 140;
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

function scrollableAncestor(event: Event): HTMLElement | null {
	const path =
		typeof event.composedPath === "function" ? event.composedPath() : [];
	for (const node of path) {
		if (
			node instanceof HTMLElement &&
			node.scrollHeight > node.clientHeight + 1
		) {
			return node;
		}
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
 * position so successive notches build velocity instead of queuing jumps. */
function feed(element: HTMLElement, delta: number): void {
	const to = Math.min(maxTop(element), Math.max(0, element.scrollTop + delta));
	// At a scroll edge with nowhere to go, leave the event native (bounce).
	if (to === element.scrollTop && !active) return;
	if (active && active.element !== element) stopGlide();
	const from = element.scrollTop;
	if (active) cancelAnimationFrame(active.frame);
	active = {
		element,
		from,
		to,
		start: null,
		frame: requestAnimationFrame(step),
	};
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
	const target = scrollableAncestor(event);
	if (!target) return;
	event.preventDefault();
	feed(target, delta);
}

/** Enables the glide for every scrollable in the document. Idempotent. */
let attached = false;

export function enableSmoothWheel(): void {
	if (attached) return;
	attached = true;
	document.addEventListener("wheel", onWheel, { passive: false });
}
