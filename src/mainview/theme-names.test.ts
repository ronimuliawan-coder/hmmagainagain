import { describe, expect, test } from "bun:test";
import {
	cycleThemeVariant,
	parseStoredTheme,
	pierreThemeName,
	themeVariantLabel,
	themeVariantTitle,
} from "./theme-names";

describe("pierreThemeName", () => {
	test("default variants are the canonical pair", () => {
		expect(pierreThemeName("dark", "default")).toBe("pierre-dark");
		expect(pierreThemeName("light", "default")).toBe("pierre-light");
	});

	test("variants suffix the scheme", () => {
		expect(pierreThemeName("dark", "soft")).toBe("pierre-dark-soft");
		expect(pierreThemeName("light", "tritanopia")).toBe(
			"pierre-light-tritanopia",
		);
	});
});

describe("parseStoredTheme", () => {
	test("migrates the RON-323 plain scheme strings", () => {
		expect(parseStoredTheme("light")).toEqual({
			scheme: "light",
			variant: "default",
		});
		expect(parseStoredTheme("dark")).toEqual({
			scheme: "dark",
			variant: "default",
		});
	});

	test("reads the object form and rejects garbage", () => {
		expect(
			parseStoredTheme(JSON.stringify({ scheme: "light", variant: "soft" })),
		).toEqual({ scheme: "light", variant: "soft" });
		expect(parseStoredTheme(null)).toEqual({
			scheme: "dark",
			variant: "default",
		});
		expect(parseStoredTheme("{{{nope")).toEqual({
			scheme: "dark",
			variant: "default",
		});
		expect(
			parseStoredTheme(JSON.stringify({ scheme: "dark", variant: "neon" })),
		).toEqual({ scheme: "dark", variant: "default" });
	});
});

describe("style cycle button", () => {
	test("cycles in order and wraps around", () => {
		expect(cycleThemeVariant("default")).toBe("soft");
		expect(cycleThemeVariant("soft")).toBe("vibrant");
		expect(cycleThemeVariant("vibrant")).toBe("protanopia-deuteranopia");
		expect(cycleThemeVariant("protanopia-deuteranopia")).toBe("tritanopia");
		expect(cycleThemeVariant("tritanopia")).toBe("default");
	});

	test("labels stay short, titles carry the full names", () => {
		expect(themeVariantLabel("protanopia-deuteranopia")).toBe("Red-green");
		expect(themeVariantLabel("tritanopia")).toBe("Blue-yellow");
		expect(themeVariantTitle("protanopia-deuteranopia")).toContain(
			"colorblind-safe",
		);
	});
});
