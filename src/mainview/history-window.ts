// Windowed-list math for the history pane (post-v1 Unit A3): the commit
// array keeps growing (cheap objects) but only a bounded row window lives
// in the DOM. Pure and unit-tested; main.ts owns the DOM side.
export interface RowWindow {
	/** First visible data index (inclusive). */
	start: number;
	/** End data index (exclusive). */
	end: number;
	/** Spacer height above the window, px. */
	topPad: number;
	/** Spacer height below the window, px. */
	bottomPad: number;
}

/** Fallback row height when measurement is unavailable. */
export const FALLBACK_ROW_HEIGHT = 24;
/** Rows rendered beyond the viewport on each side. */
export const WINDOW_OVERSCAN = 10;

export function windowRows(
	total: number,
	scrollTop: number,
	rowHeight: number,
	viewportHeight: number,
	overscan: number = WINDOW_OVERSCAN,
): RowWindow {
	if (total <= 0) return { start: 0, end: 0, topPad: 0, bottomPad: 0 };
	const rh = rowHeight > 0 ? rowHeight : FALLBACK_ROW_HEIGHT;
	const vh = Math.max(0, viewportHeight);
	// Clamp the effective scroll: beyond content height the range would
	// invert (start > end). Browsers clamp scrollTop themselves, but the
	// pure function must hold for any input (CodeRabbit round 2).
	const maxScroll = Math.max(0, total * rh - vh);
	const clamped = Math.min(Math.max(0, scrollTop), maxScroll);
	const start = Math.max(0, Math.floor(clamped / rh) - overscan);
	const visible = Math.ceil(vh / rh) + overscan * 2;
	const end = Math.min(total, start + visible);
	return { start, end, topPad: start * rh, bottomPad: (total - end) * rh };
}
