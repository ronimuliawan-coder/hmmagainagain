import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "hmmagainagain",
		identifier: "dev.hmmagainagain.app",
		version: "0.0.1",
	},
	build: {
		// Main process stays on Bun (RON-315): the Cottontail cutover is
		// proven but stable packaging is blocked on a toolchain pairing
		// skew — see ADR-0002. Shipped main code is dual-compatible so the
		// migration re-arms to a config flip when the toolchain heals.
		mainProcess: "bun",
		bun: {
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
