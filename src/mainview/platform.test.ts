// Selector tests (M6): getPlatform() returns one shared instance, so the
// fake fixture's mutable index state survives across calls (a staged file
// unstaged through one handle reads back unstaged through the next).
// Runs outside any shell: window.__TAURI__ is absent, so the fake serves.

import { describe, expect, test } from "bun:test";
import { getPlatform } from "./platform";

describe("platform selector", () => {
	test("shares one fake fixture across calls", async () => {
		await getPlatform().unstagePaths("/virtual/repo", ["hello.txt"]);
		const status = await getPlatform().gitStatus("/virtual/repo");
		const entry = status.entries.find((e) => e.path === "hello.txt");
		expect(entry).toMatchObject({ indexStatus: ".", worktreeStatus: "M" });
	});
});
