// App-chrome tokens derived from the active Pierre theme (diffshub's
// deriveChromeTokens pattern): resolveTheme → normalizeThemeColors → our
// --* shell variables. Pure and sync: the resolved theme is the only input,
// missing keys fall back to the canonical hand-tuned values (which also
// remain the pre-resolution defaults in style.css).

import type { ThemeLike } from "@pierre/theming";
import { colorUtils, normalizeThemeColors } from "@pierre/theming/color";
import type { ColorScheme } from "./theme-names";

/** Fallbacks: the canonical pairs from style.css (:root / [data-theme]). */
const FALLBACKS: Record<ColorScheme, Record<string, string>> = {
	dark: {
		"--bg": "#14161a",
		"--panel": "#1c1f24",
		"--inset": "#101215",
		"--border": "#2a2e34",
		"--fg": "#e6e6e6",
		"--muted": "#9aa4ae",
		"--accent": "#61afef",
		"--danger": "#e06c75",
		"--selected": "#232830",
		"--st-m": "#e5c07b",
		"--st-a": "#98c379",
		"--st-d": "#e06c75",
		"--st-rc": "#61afef",
		"--st-u": "#c678dd",
		"--st-untracked": "#7a828e",
		"--st-ignored": "#5c6370",
	},
	light: {
		"--bg": "#eef0f3",
		"--panel": "#ffffff",
		"--inset": "#f6f8fa",
		"--border": "#d9dee5",
		"--fg": "#1c1f24",
		"--muted": "#5b6570",
		"--accent": "#0969da",
		"--danger": "#cf222e",
		"--selected": "#e3ecf9",
		"--st-m": "#9a6700",
		"--st-a": "#1a7f37",
		"--st-d": "#cf222e",
		"--st-rc": "#0969da",
		"--st-u": "#8250df",
		"--st-untracked": "#6e7781",
		"--st-ignored": "#8c959f",
	},
};

const first = (
	colors: Record<string, string | undefined> | undefined,
	fallback: string,
	...keys: string[]
): string => {
	for (const key of keys) {
		const value = colors?.[key];
		if (typeof value === "string" && value.length > 0) return value;
	}
	return fallback;
};

/** Derives the shell variables from a Shiki-normalized resolved theme.
 * Never throws: any gap or color-math failure keeps the fallback value. */
export function deriveChromeTokens(
	theme: unknown,
	scheme: ColorScheme,
): Record<string, string> {
	const fallback = FALLBACKS[scheme] as Record<string, string>;
	try {
		const { colors } = normalizeThemeColors(theme as ThemeLike);
		const bg = first(colors, fallback["--bg"], "editor.background");
		const fg = first(colors, fallback["--fg"], "editor.foreground");
		// Borders: the theme's own border keys equal the surfaces here, so a
		// translucent-foreground composite stays visible on any theme.
		let border = fallback["--border"];
		try {
			border = colorUtils.compositeOverBg(`${fg}24`, bg) ?? border;
		} catch {
			// keep fallback
		}
		let muted = fallback["--muted"];
		try {
			muted = colorUtils.deriveMutedFg(fg, bg);
		} catch {
			// keep fallback
		}
		// Selections ship translucent; flatten over our surface for rows.
		const selection = first(
			colors,
			"",
			"list.activeSelectionBackground",
			"list.inactiveSelectionBackground",
		);
		let selected = fallback["--selected"];
		if (selection) {
			try {
				selected = colorUtils.compositeOverBg(selection, bg) ?? selected;
			} catch {
				// keep fallback
			}
		}
		return {
			"--bg": bg,
			"--panel": first(
				colors,
				fallback["--panel"],
				"titleBar.activeBackground",
				"sideBar.background",
			),
			"--inset": first(colors, fallback["--inset"], "input.background"),
			"--border": border,
			"--fg": fg,
			"--muted": muted,
			"--accent": first(
				colors,
				fallback["--accent"],
				"list.focusOutline",
				"focusBorder",
				"textLink.foreground",
			),
			"--danger": first(
				colors,
				fallback["--danger"],
				"gitDecoration.deletedResourceForeground",
			),
			"--selected": selected,
			"--st-m": first(
				colors,
				fallback["--st-m"],
				"gitDecoration.modifiedResourceForeground",
			),
			"--st-a": first(
				colors,
				fallback["--st-a"],
				"gitDecoration.addedResourceForeground",
			),
			"--st-d": first(
				colors,
				fallback["--st-d"],
				"gitDecoration.deletedResourceForeground",
			),
			"--st-rc": first(
				colors,
				fallback["--st-rc"],
				"gitDecoration.renamedResourceForeground",
				"textLink.foreground",
			),
			"--st-u": first(
				colors,
				fallback["--st-u"],
				"gitDecoration.conflictingResourceForeground",
			),
			"--st-untracked": first(
				colors,
				fallback["--st-untracked"],
				"gitDecoration.untrackedResourceForeground",
				"gitDecoration.addedResourceForeground",
			),
			"--st-ignored": first(
				colors,
				fallback["--st-ignored"],
				"gitDecoration.ignoredResourceForeground",
			),
		};
	} catch {
		return { ...fallback };
	}
}
