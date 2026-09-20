import { describe, expect, test } from "bun:test";
import { displayP3ToHex, staticTheme } from "./static-themes";

describe("displayP3ToHex", () => {
	test("converts display-p3 anchors to sRGB hex", () => {
		expect(displayP3ToHex("color(display-p3 1 1 1)")).toBe("#ffffff");
		expect(displayP3ToHex("color(display-p3 0 0 0)")).toBe("#000000");
		// Pierre dark background (0.039216^3 sRGB-ish) lands on #0a0a0a.
		expect(displayP3ToHex("color(display-p3 0.039216 0.039216 0.039216)")).toBe(
			"#0a0a0a",
		);
	});

	test("carries alpha into 8-digit hex", () => {
		const hex = displayP3ToHex(
			"color(display-p3 0.308664 0.645271 1.000000 / 0.300000)",
		);
		expect(hex).toMatch(/^#[0-9a-f]{8}$/);
		expect(hex.slice(7)).toBe("4d"); // 0.3 * 255 rounds to 77
	});

	test("passes non-p3 values through untouched", () => {
		expect(displayP3ToHex("#61afef")).toBe("#61afef");
		expect(displayP3ToHex("transparent")).toBe("transparent");
		expect(displayP3ToHex("red")).toBe("red");
	});
});

describe("staticTheme", () => {
	test("serves sRGB-only colors for every scheme and variant", () => {
		for (const scheme of ["light", "dark"] as const) {
			for (const variant of [
				"default",
				"soft",
				"vibrant",
				"protanopia-deuteranopia",
				"tritanopia",
			] as const) {
				const theme = staticTheme(scheme, variant);
				expect(theme.type).toBe(scheme);
				for (const value of Object.values(theme.colors)) {
					expect(value.startsWith("color(")).toBe(false);
				}
			}
		}
	});
});
