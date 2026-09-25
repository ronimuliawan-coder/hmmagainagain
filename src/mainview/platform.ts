// Webview-side Platform selector (M6 cutover): the Tauri bridge when the
// shell provides it, otherwise the fake fixture for plain browsers. The
// Electrobun RPC client lived here before M6; see ADR-0003.

import type { Platform } from "../shared/platform";
import { buildFakeFixture } from "../shared/platform-fake";
import { createTauriPlatform, isTauri } from "./platform-tauri";

export { isTauri };

/** The single Platform instance the UI consumes. Cached: the fake fixture
 * owns mutable index/branch/commit state that must survive across calls,
 * and the Tauri bridge is stateless so sharing it is free. A missing
 * bridge is warned once: the fixture simulates git in memory, so a packaged
 * build that somehow selected it must never look healthy in devtools. */
let instance: Platform | null = null;
export function getPlatform(): Platform {
	if (!instance) {
		instance = isTauri() ? createTauriPlatform() : buildFakeFixture().platform;
		if (!isTauri()) {
			console.warn(
				"[platform] no Tauri bridge detected — using the in-memory dev fixture; git operations are simulated",
			);
		}
	}
	return instance;
}
