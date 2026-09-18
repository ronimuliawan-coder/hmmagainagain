// Pure Pierre theme-name mapping (testable; main.ts owns the DOM side).
// Names resolve through @pierre/diffs' bundled theming catalog at runtime
// (verified: soft/vibrant/colorblind variants resolve under diffs 1.3.6).
// The catalog below is the source of truth for known names so a renamed
// upstream theme degrades to the default pair instead of breaking highlight.

import { themes } from "@pierre/theming/themes";

export type ColorScheme = "light" | "dark";

export type ThemeVariant =
	| "default"
	| "soft"
	| "vibrant"
	| "protanopia-deuteranopia"
	| "tritanopia";

export interface ShellTheme {
	scheme: ColorScheme;
	variant: ThemeVariant;
}

const VARIANTS: readonly ThemeVariant[] = [
	"default",
	"soft",
	"vibrant",
	"protanopia-deuteranopia",
	"tritanopia",
];

export function isThemeVariant(value: unknown): value is ThemeVariant {
	return (
		typeof value === "string" && (VARIANTS as readonly string[]).includes(value)
	);
}

/** Full Pierre theme name, e.g. pierre-dark-soft. */
export function pierreThemeName(
	scheme: ColorScheme,
	variant: ThemeVariant,
): string {
	return variant === "default"
		? `pierre-${scheme}`
		: `pierre-${scheme}-${variant}`;
}

/** Catalog-known theme names (Pierre + Shiki); unknown names fall back. */
export function knownThemeNames(): readonly string[] {
	try {
		return themes.getThemeNames();
	} catch {
		return ["pierre-light", "pierre-dark"];
	}
}

/** Stored theme (THEME_KEY), migrating the RON-323 plain "light"/"dark". */
export function parseStoredTheme(raw: string | null): ShellTheme {
	if (raw === "light" || raw === "dark")
		return { scheme: raw, variant: "default" };
	try {
		const parsed: unknown = raw ? JSON.parse(raw) : null;
		if (typeof parsed === "object" && parsed !== null) {
			const { scheme, variant } = parsed as {
				scheme?: unknown;
				variant?: unknown;
			};
			if (
				(scheme === "light" || scheme === "dark") &&
				isThemeVariant(variant)
			) {
				return { scheme, variant };
			}
		}
	} catch {
		// corrupted storage — fall through to the default
	}
	return { scheme: "dark", variant: "default" };
}
