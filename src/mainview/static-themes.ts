// Statically bundled Pierre themes for shell chrome + file tree (RON-340).
// The dynamic resolveTheme path fails to import variant chunks in webview
// runtimes (vite-dev optimizer staleness; Electrobun "Importing a module
// script failed"), leaving shell/tree theming dead for anything but the
// default pair. Static imports bundle reliably in every runtime — proven
// byte-identical to the resolved path for deriveChromeTokens and
// themeToTreeStyles. The diff worker pool keeps resolving names internally
// (upstream, out of scope).

import pierreDark from "@pierre/theme/pierre-dark";
import pierreDarkProtanopiaDeuteranopia from "@pierre/theme/pierre-dark-protanopia-deuteranopia";
import pierreDarkSoft from "@pierre/theme/pierre-dark-soft";
import pierreDarkTritanopia from "@pierre/theme/pierre-dark-tritanopia";
import pierreDarkVibrant from "@pierre/theme/pierre-dark-vibrant";
import pierreLight from "@pierre/theme/pierre-light";
import pierreLightProtanopiaDeuteranopia from "@pierre/theme/pierre-light-protanopia-deuteranopia";
import pierreLightSoft from "@pierre/theme/pierre-light-soft";
import pierreLightTritanopia from "@pierre/theme/pierre-light-tritanopia";
import pierreLightVibrant from "@pierre/theme/pierre-light-vibrant";
import type { ColorScheme, ThemeVariant } from "./theme-names";

type StaticTheme = typeof pierreDark;

const TABLE: Record<string, StaticTheme> = {
	"pierre-dark": pierreDark,
	"pierre-dark-protanopia-deuteranopia": pierreDarkProtanopiaDeuteranopia,
	"pierre-dark-soft": pierreDarkSoft,
	"pierre-dark-tritanopia": pierreDarkTritanopia,
	"pierre-dark-vibrant": pierreDarkVibrant,
	"pierre-light": pierreLight,
	"pierre-light-protanopia-deuteranopia": pierreLightProtanopiaDeuteranopia,
	"pierre-light-soft": pierreLightSoft,
	"pierre-light-tritanopia": pierreLightTritanopia,
	"pierre-light-vibrant": pierreLightVibrant,
};

/** The bundled theme object for a scheme + variant, falling back to the
 * canonical pair for unknown names (same degrade rule as the pool names). */
export function staticTheme(
	scheme: ColorScheme,
	variant: ThemeVariant,
): StaticTheme {
	const name =
		variant === "default" ? `pierre-${scheme}` : `pierre-${scheme}-${variant}`;
	return TABLE[name] ?? (scheme === "dark" ? pierreDark : pierreLight);
}
