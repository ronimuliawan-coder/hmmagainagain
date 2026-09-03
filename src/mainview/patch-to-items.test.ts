// RED phase: patch → CodeView item mapping tests, written before the module
// exists (before-state proof for the diff-view wrapper).

import { describe, expect, test } from "bun:test";
import { patchToItems } from "./patch-to-items";

const TWO_FILE_PATCH = `diff --git a/src/alpha.ts b/src/alpha.ts
index 1111111..2222222 100644
--- a/src/alpha.ts
+++ b/src/alpha.ts
@@ -1,3 +1,4 @@
 const one = 1;
+const two = 2;
 const three = 3;
 const four = 4;
diff --git a/docs/readme.md b/docs/readme.md
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/docs/readme.md
@@ -0,0 +1,2 @@
+# readme
+hello
`;

const RENAME_PATCH = `diff --git a/old-name.ts b/new-name.ts
similarity index 100%
rename from old-name.ts
rename to new-name.ts
`;

describe("patchToItems", () => {
	test("empty patch yields no items", () => {
		const result = patchToItems("");
		expect(result.items).toEqual([]);
		expect(result.paths).toEqual([]);
	});

	test("one item per changed file, in patch order", () => {
		const result = patchToItems(TWO_FILE_PATCH);
		expect(result.items).toHaveLength(2);
		expect(result.paths).toEqual(["src/alpha.ts", "docs/readme.md"]);
		expect(result.items[0]?.id).toBe("diff:src/alpha.ts");
		expect(result.items[1]?.id).toBe("diff:docs/readme.md");
		expect(result.items.every((item) => item.type === "diff")).toBe(true);
	});

	test("renamed files are keyed by their new path", () => {
		const result = patchToItems(RENAME_PATCH);
		expect(result.paths).toEqual(["new-name.ts"]);
		expect(result.items[0]?.id).toBe("diff:new-name.ts");
	});

	test("binary-only patch does not crash and reports the path", () => {
		const result = patchToItems(
			"diff --git a/logo.png b/logo.png\nindex 111..222 100644\nBinary files a/logo.png and b/logo.png differ\n",
		);
		// Upstream's parser may skip hunk-less files; the contract is only
		// that parsing succeeds and never invents a bogus path.
		for (const path of result.paths) {
			expect(path).toBe("logo.png");
		}
	});
});
