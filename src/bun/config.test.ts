import { describe, expect, test } from "bun:test";
import electrobunConfig from "../../electrobun.config";

describe("electrobun.config", () => {
	test("main process runs on Cottontail (ADR-0002, RON-315)", () => {
		expect(electrobunConfig.build.mainProcess).toBe("cottontail");
	});

	test("app identity is hmmagainagain", () => {
		expect(electrobunConfig.app.name).toBe("hmmagainagain");
		expect(electrobunConfig.app.identifier).toBe("dev.hmmagainagain.app");
	});

	test("no bundled Chromium on any platform (size budget)", () => {
		expect(electrobunConfig.build.linux?.bundleCEF).toBe(false);
		expect(electrobunConfig.build.mac?.bundleCEF).toBe(false);
		expect(electrobunConfig.build.win?.bundleCEF).toBe(false);
	});
});
