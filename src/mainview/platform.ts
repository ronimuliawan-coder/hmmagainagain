// Webview-side Platform selector (M6 cutover): the Tauri bridge when the
// shell provides it, otherwise the fake fixture for plain browsers. The
// Electrobun RPC client lived here before M6; see ADR-0003.

import type { Platform } from "../shared/platform";
import { buildFakeFixture } from "../shared/platform-fake";
import { createTauriPlatform, isTauri } from "./platform-tauri";

export { isTauri };

/** The single Platform instance the UI consumes. Cached: the fake fixture
 * owns mutable index/branch/commit state that must survive across calls,
 * and the Tauri bridge is stateless so sharing it is free. */
let instance: Platform | null = null;
export function getPlatform(): Platform {
	instance ??= isTauri() ? createTauriPlatform() : buildFakeFixture().platform;
	return instance;
}
