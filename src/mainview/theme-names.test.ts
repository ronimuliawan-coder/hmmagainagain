import { describe, expect, test } from "bun:test";
import { parseStoredTheme, pierreThemeName } from "./theme-names";

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
