import { defineConfig } from "vite";

export default defineConfig({
	root: "src/mainview",
	// The diffs worker pool imports a chunked worker entry; IIFE (the default
	// worker format) cannot code-split. ES module workers are required.
	worker: {
		format: "es",
	},
	build: {
		outDir: "../../dist",
		emptyOutDir: true,
	},
	server: {
		port: 5173,
		strictPort: true,
	},
});
