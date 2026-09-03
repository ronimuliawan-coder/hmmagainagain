// Patch-surgery tests. Fixtures are built from line ARRAYS joined with \n —
// never raw template literals, because lines starting with `--- ` / `+++ `
// get stripped by some write paths (session-tooling quirk, observed
// 2026-09-03). The array form is immune and keeps the patch byte-precise.

import { describe, expect, test } from "bun:test";
import { buildStagedPatch, splitFilePatches } from "./patch-surgery";

const lines = (...rows: string[]): string => `${rows.join("\n")}\n`;

const MULTI_PATCH = lines(
	"diff --git a/src/alpha.ts b/src/alpha.ts",
	"index 1111111..2222222 100644",
	"--- a/src/alpha.ts",
	"+++ b/src/alpha.ts",
	"@@ -1,4 +1,5 @@",
	" const one = 1;",
	"+const two = 2;",
	" const three = 3;",
	" const four = 4;",
	" const five = 5;",
	"@@ -10,3 +11,4 @@ tail context",
	" const ten = 10;",
	"+const eleven = 11;",
	" const twelve = 12;",
	"diff --git a/docs/readme.md b/docs/readme.md",
	"index 4444444..5555555 100644",
	"--- a/docs/readme.md",
	"+++ b/docs/readme.md",
	"@@ -1 +1,2 @@",
	" # readme",
	"+hello",
);

const BINARY_PATCH = lines(
	"diff --git a/logo.png b/logo.png",
	"index 111..222 100644",
	"Binary files a/logo.png and b/logo.png differ",
);

describe("splitFilePatches", () => {
	test("splits a multi-file patch, paths from the +++ line", () => {
		const files = splitFilePatches(MULTI_PATCH);
		expect(files.map((f) => f.path)).toEqual([
			"src/alpha.ts",
			"docs/readme.md",
		]);
		expect(files[0]?.hunks).toHaveLength(2);
		expect(files[1]?.hunks).toHaveLength(1);
	});

	test("hunks carry their new-file ranges", () => {
		const [first] = splitFilePatches(MULTI_PATCH);
		expect(first?.hunks[0]?.start).toBe(1);
		expect(first?.hunks[0]?.end).toBe(5);
		expect(first?.hunks[1]?.start).toBe(11);
		expect(first?.hunks[1]?.end).toBe(14);
	});

	test("headers include the diff --git line (git apply requires it)", () => {
		const files = splitFilePatches(MULTI_PATCH);
		expect(files[0]?.header.startsWith("diff --git a/src/alpha.ts")).toBe(true);
		expect(files[0]?.header).toContain("--- a/src/alpha.ts");
		expect(files[0]?.header).toContain("+++ b/src/alpha.ts");
	});

	test("hunk-less binary files parse without hunks", () => {
		const files = splitFilePatches(BINARY_PATCH);
		expect(files.map((f) => f.path)).toEqual(["logo.png"]);
		expect(files[0]?.hunks).toHaveLength(0);
	});
});

describe("buildStagedPatch", () => {
	test("selecting lines in one hunk keeps only that hunk, header intact", () => {
		const staged = buildStagedPatch(MULTI_PATCH, "src/alpha.ts", {
			start: 11,
			end: 12,
		});
		expect(staged?.startsWith("diff --git a/src/alpha.ts")).toBe(true);
		expect(staged).toContain("@@ -10,3 +11,4 @@");
		expect(staged).not.toContain("@@ -1,4 +1,5 @@");
		expect(staged).toContain("+const eleven = 11;");
		// A valid patch ends with a newline for `git apply --cached`.
		expect(staged?.endsWith("\n")).toBe(true);
	});

	test("selection spanning both hunks keeps the whole file section", () => {
		const staged = buildStagedPatch(MULTI_PATCH, "src/alpha.ts", {
			start: 1,
			end: 14,
		});
		expect(staged).toContain("@@ -1,4 +1,5 @@");
		expect(staged).toContain("@@ -10,3 +11,4 @@");
	});

	test("selection in another file does not leak hunks across files", () => {
		const staged = buildStagedPatch(MULTI_PATCH, "docs/readme.md", {
			start: 1,
			end: 2,
		});
		expect(staged).toContain("docs/readme.md");
		expect(staged).not.toContain("src/alpha.ts");
	});

	test("no intersecting hunk yields null (nothing to stage)", () => {
		expect(
			buildStagedPatch(MULTI_PATCH, "src/alpha.ts", { start: 100, end: 200 }),
		).toBeNull();
	});

	test("unknown path yields null", () => {
		expect(
			buildStagedPatch(MULTI_PATCH, "nope.txt", { start: 1, end: 2 }),
		).toBeNull();
	});

	test("binary file yields null (stage the whole file instead)", () => {
		expect(
			buildStagedPatch(BINARY_PATCH, "logo.png", { start: 1, end: 2 }),
		).toBeNull();
	});
});
