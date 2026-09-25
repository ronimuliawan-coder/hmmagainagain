import { resolve } from "node:path";
import { defineConfig } from "vite";

// Frontend build for the Tauri shell (M5 soundcheck; the full mainview
// moves over at M6 cutover). Mirrors the root vite config where it
// matters: the diffs worker pool imports a chunked worker entry, so ES
// module workers are required — IIFE output would break highlighting in
// exactly the way this harness exists to catch.
//
// NOTE: tauri/package.json pins the Pierre deps exact to match the repo
// root (no ^). The harness bundles from tauri/node_modules alone because
// tauri CI never installs root deps — drift there silently un-proves the
// app. package.json itself carries no comments: npm requires strict JSON.
export default defineConfig({
	root: resolve(__dirname, "harness"),
	worker: {
		format: "es",
	},
	build: {
		outDir: resolve(__dirname, "dist"),
		emptyOutDir: true,
	},
});
