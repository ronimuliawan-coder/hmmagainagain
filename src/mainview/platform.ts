// Webview-side Platform selector (M6 cutover): the Tauri bridge when the
// shell provides it, otherwise the fake fixture for plain browsers. The
// Electrobun RPC client lived here before M6; see ADR-0003.

import type { Platform } from "../shared/platform";
import { buildFakeFixture } from "../shared/platform-fake";
import { createTauriPlatform, isTauri } from "./platform-tauri";

export { isTauri };

/** The single Platform instance the UI consumes. */
export function getPlatform(): Platform {
	if (isTauri()) return createTauriPlatform();
	return buildFakeFixture().platform;
}
