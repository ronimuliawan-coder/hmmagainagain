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

// display-p3 → sRGB matrices (D65). Display P3 uses the sRGB transfer
// function, so the round trip is EOTF → P3→XYZ → XYZ→sRGB → OETF.
const P3_TO_XYZ: readonly (readonly [number, number, number])[] = [
	[0.4865709, 0.2656677, 0.1982173],
	[0.2289746, 0.6917385, 0.0792869],
	[0.0, 0.0451134, 1.0439444],
];

const XYZ_TO_SRGB: readonly (readonly [number, number, number])[] = [
	[3.2404542, -1.5371385, -0.4985314],
	[-0.969266, 1.8760108, 0.041556],
	[0.0556434, -0.2040259, 1.0572252],
];

const eotf = (c: number): number =>
	c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

const oetf = (c: number): number =>
	c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;

const clamp8 = (c: number): string =>
	Math.min(255, Math.max(0, Math.round(c * 255)))
		.toString(16)
		.padStart(2, "0");

const P3_PATTERN =
	/^color\(display-p3\s+([0-9.eE+-]+)\s+([0-9.eE+-]+)\s+([0-9.eE+-]+)(?:\s*\/\s*([0-9.eE+-]+))?\)$/;

/** Converts a `color(display-p3 …)` value to sRGB hex; anything else passes
 * through untouched. Out-of-gamut channels clip — the Pierre themes stay
 * near sRGB, so clipping is a backstop, not a path. */
export function displayP3ToHex(value: string): string {
	const match = P3_PATTERN.exec(value.trim());
	if (!match) return value;
	const [r, g, b] = [match[1], match[2], match[3]].map((n) => eotf(Number(n)));
	const toSrgb = (row: readonly [number, number, number]): number =>
		oetf(
			row[0] *
				(P3_TO_XYZ[0][0] * r + P3_TO_XYZ[0][1] * g + P3_TO_XYZ[0][2] * b) +
				row[1] *
					(P3_TO_XYZ[1][0] * r + P3_TO_XYZ[1][1] * g + P3_TO_XYZ[1][2] * b) +
				row[2] *
					(P3_TO_XYZ[2][0] * r + P3_TO_XYZ[2][1] * g + P3_TO_XYZ[2][2] * b),
		);
	const hex = `#${clamp8(toSrgb(XYZ_TO_SRGB[0]))}${clamp8(toSrgb(XYZ_TO_SRGB[1]))}${clamp8(toSrgb(XYZ_TO_SRGB[2]))}`;
	const alpha = match[4] === undefined ? 1 : Number(match[4]);
	return alpha >= 1 ? hex : `${hex}${clamp8(alpha)}`;
}

/** Returns the theme with its `colors` record converted to sRGB hex. */
function srgbTheme(theme: StaticTheme): StaticTheme {
	const colors: Record<string, string> = {};
	for (const [key, value] of Object.entries(theme.colors)) {
		colors[key] = displayP3ToHex(value);
	}
	return { ...theme, colors };
}

const TABLE: Record<string, StaticTheme> = {
	"pierre-dark": srgbTheme(pierreDark),
	"pierre-dark-protanopia-deuteranopia": srgbTheme(
		pierreDarkProtanopiaDeuteranopia,
	),
	"pierre-dark-soft": srgbTheme(pierreDarkSoft),
	"pierre-dark-tritanopia": srgbTheme(pierreDarkTritanopia),
	"pierre-dark-vibrant": srgbTheme(pierreDarkVibrant),
	"pierre-light": srgbTheme(pierreLight),
	"pierre-light-protanopia-deuteranopia": srgbTheme(
		pierreLightProtanopiaDeuteranopia,
	),
	"pierre-light-soft": srgbTheme(pierreLightSoft),
	"pierre-light-tritanopia": srgbTheme(pierreLightTritanopia),
	"pierre-light-vibrant": srgbTheme(pierreLightVibrant),
};

/** The bundled theme object for a scheme + variant, falling back to the
 * canonical pair for unknown names (same degrade rule as the pool names). */
export function staticTheme(
	scheme: ColorScheme,
	variant: ThemeVariant,
): StaticTheme {
	const name =
		variant === "default" ? `pierre-${scheme}` : `pierre-${scheme}-${variant}`;
	return TABLE[name] ?? TABLE[`pierre-${scheme}`];
}
