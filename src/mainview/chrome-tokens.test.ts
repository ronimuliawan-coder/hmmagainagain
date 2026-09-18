import { describe, expect, test } from "bun:test";
import { deriveChromeTokens } from "./chrome-tokens";

// Minimal ThemeLike: normalized shape (fg/bg/type + workbench colors).
const darkTheme = {
	name: "test-dark",
	type: "dark" as const,
	bg: "#0a0a0a",
	fg: "#fafafa",
	colors: {
		"editor.background": "#0a0a0a",
		"editor.foreground": "#fafafa",
		"sideBar.background": "#171717",
		"input.background": "#1d1d1d",
		"list.focusOutline": "#009fff",
		"list.activeSelectionBackground": "#19283c99",
		"gitDecoration.addedResourceForeground": "#07c480",
		"gitDecoration.modifiedResourceForeground": "#009fff",
		"gitDecoration.deletedResourceForeground": "#ff2e3f",
		"gitDecoration.conflictingResourceForeground": "#7b43f8",
		"textLink.foreground": "#009fff",
	},
};

describe("deriveChromeTokens", () => {
	test("maps workbench keys onto shell variables", () => {
		const tokens = deriveChromeTokens(darkTheme, "dark");
		expect(tokens["--bg"]).toBe("#0a0a0a");
		expect(tokens["--panel"]).toBe("#171717");
		expect(tokens["--inset"]).toBe("#1d1d1d");
		expect(tokens["--fg"]).toBe("#fafafa");
		expect(tokens["--accent"]).toBe("#009fff");
		expect(tokens["--danger"]).toBe("#ff2e3f");
		expect(tokens["--st-a"]).toBe("#07c480");
		expect(tokens["--st-m"]).toBe("#009fff");
		expect(tokens["--st-u"]).toBe("#7b43f8");
		// Renamed is absent → falls through to the link color.
		expect(tokens["--st-rc"]).toBe("#009fff");
	});

	test("derives muted/selection/border instead of copying", () => {
		const tokens = deriveChromeTokens(darkTheme, "dark");
		// Measured against colorUtils (see RON-324 evidence).
		expect(tokens["--muted"]).toBe("#9a9a9a");
		expect(tokens["--selected"]).toBe("#131c28");
		expect(tokens["--border"]).toBe("#2c2c2c");
	});

	test("missing keys and garbage fall back per scheme", () => {
		const tokens = deriveChromeTokens({ colors: {} }, "light");
		expect(tokens["--bg"]).toBe("#eef0f3");
		expect(tokens["--fg"]).toBe("#1c1f24");
		expect(deriveChromeTokens(null, "dark")["--bg"]).toBe("#14161a");
	});
});
