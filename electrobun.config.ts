import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "hmmagainagain",
		identifier: "dev.hmmagainagain.app",
		version: "0.0.1",
	},
	build: {
		// Main process on Cottontail (RON-315, ADR-0002): the Bun runtime is
		// 97% of the installer payload. Shipped main code stays importable
		// under both runtimes (compatible subset only); revert this block
		// to roll back.
		mainProcess: "cottontail",
		cottontail: {
			entrypoint: "src/bun/index.ts",
		},
		copy: {
			"dist/index.html": "views/mainview/index.html",
			"dist/assets": "views/mainview/assets",
		},
		watchIgnore: ["dist/**"],
		mac: {
			bundleCEF: false,
		},
		linux: {
			bundleCEF: false,
		},
		win: {
			bundleCEF: false,
		},
	},
} satisfies ElectrobunConfig;
